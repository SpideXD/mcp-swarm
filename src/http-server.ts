/**
 * HTTP Server - Multi-client MCP swarm via StreamableHTTPServerTransport.
 *
 * Creates one McpServer + StreamableHTTPServerTransport per HTTP session.
 * All instances share the same ProcessManager singleton (shared server pool).
 *
 * Endpoints:
 *   POST /mcp     — MCP protocol (session creation + message routing)
 *   GET  /mcp     — SSE stream for server-initiated notifications
 *   DELETE /mcp   — Session termination
 *   GET  /health  — Health check (JSON)
 *   GET  /events  — SSE stream for dashboard events
 *   GET  /api/sessions — List active sessions
 *   GET  /api/logs/:name — Get server stderr logs
 *   GET  /api/config — Get current config
 *   GET  /ui/*    — Static file serving for dashboard
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { ProcessManager } from "./process-manager.js";
import { registerAllTools } from "./tools.js";
import { unlinkSync } from "fs";
import {
  BRIDGE_PORT,
  BRIDGE_HOST,
  BRIDGE_SOCKET,
  BRIDGE_MODE,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_CLEANUP_INTERVAL_MS,
  MAX_SESSIONS,
  TOOL_CALL_TIMEOUT_MS,
  MAX_SERVER_INSTANCES,
  SWARM_CORS,
} from "./config.js";
import type { ProfilesConfig, BridgeSession } from "./types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
};

interface ManagedSession {
  transport: StreamableHTTPServerTransport;
  mcpServer: McpServer;
  meta: BridgeSession;
}

/** Add CORS headers to a response if CORS is enabled. */
function applyCors(res: ServerResponse): void {
  if (!SWARM_CORS) return;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
}

/**
 * Start the HTTP swarm server.
 * Each new session gets its own McpServer + transport, but all share
 * the same ProcessManager (same server pool, same queue).
 */
export function startHttpServer(
  processManager: ProcessManager,
  profilesConfig: ProfilesConfig
): void {
  const sessions = new Map<string, ManagedSession>();

  // Warn if binding to a non-loopback address
  if (BRIDGE_HOST !== "127.0.0.1" && BRIDGE_HOST !== "localhost") {
    console.error(
      "[HTTP] WARNING: Swarm is bound to non-loopback address " +
      `(${BRIDGE_HOST}). This exposes MCP tools to the network. ` +
      "Consider adding authentication or restricting to 127.0.0.1."
    );
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleRequest(req, res, sessions, processManager, profilesConfig).catch(
      (err) => {
        console.error(
          `[HTTP] Unhandled error: ${err instanceof Error ? err.message : String(err)}`
        );
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      }
    );
  });

  if (BRIDGE_SOCKET) {
    // Unix socket mode — lighter IPC for same-container setups
    try {
      unlinkSync(BRIDGE_SOCKET);
    } catch {
      // Socket file doesn't exist yet, fine
    }
    server.listen(BRIDGE_SOCKET, () => {
      console.error(`[HTTP] Swarm server listening on unix:${BRIDGE_SOCKET}`);
    });
  } else {
    // TCP mode
    server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
      console.error(
        `[HTTP] Swarm server listening on ${BRIDGE_HOST}:${BRIDGE_PORT}`
      );
    });
  }

  // --- Session cleanup timer ---
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.meta.lastActiveAt > SESSION_IDLE_TIMEOUT_MS) {
        console.error(
          `[HTTP] Cleaning up idle session: ${id} (idle ${Math.round((now - session.meta.lastActiveAt) / 1000)}s)`
        );
        cleanupSession(id, sessions, processManager);
      }
    }
  }, SESSION_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

/**
 * Handle an incoming HTTP request.
 */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, ManagedSession>,
  processManager: ProcessManager,
  profilesConfig: ProfilesConfig
): Promise<void> {
  const url = req.url || "/";

  // --- CORS preflight ---
  if (req.method === "OPTIONS") {
    applyCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Apply CORS to all responses
  applyCors(res);

  // --- Health endpoint ---
  if (url === "/health" && req.method === "GET") {
    const health = {
      status: "ok",
      mode: "http",
      sessions: sessions.size,
      servers: processManager.getAllServers().length,
      uptime: process.uptime(),
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
    return;
  }

  // --- SSE /events endpoint ---
  if (url === "/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    // Forward ProcessManager events as SSE
    const eventNames = [
      "server:status", "server:added", "server:removed",
      "tool:call", "tool:result",
      "session:created", "session:closed",
      "pool:scaled",
    ];

    const listener = (event: { type: string; timestamp: number; data: unknown }) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    for (const name of eventNames) {
      processManager.on(name, listener);
    }

    // Keep-alive ping every 15 seconds
    const pingTimer = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: "ping" })}\n\n`);
    }, 15_000);

    // Clean up on connection close
    req.on("close", () => {
      clearInterval(pingTimer);
      for (const name of eventNames) {
        processManager.removeListener(name, listener);
      }
    });

    return;
  }

  // --- REST API: /api/sessions ---
  if (url === "/api/sessions" && req.method === "GET") {
    const now = Date.now();
    const sessionList = [...sessions.values()].map((s) => ({
      id: s.meta.sessionId,
      createdAt: s.meta.createdAt,
      lastActiveAt: s.meta.lastActiveAt,
      idle: now - s.meta.lastActiveAt,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(sessionList));
    return;
  }

  // --- REST API: /api/logs/:name ---
  if (url.startsWith("/api/logs/") && req.method === "GET") {
    const name = decodeURIComponent(url.slice("/api/logs/".length));
    const server = processManager.getServer(name);
    if (!server) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Server '${name}' not found` }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(server.stderrBuffer));
    return;
  }

  // --- REST API: /api/config ---
  if (url === "/api/config" && req.method === "GET") {
    const config = {
      port: BRIDGE_PORT,
      host: BRIDGE_HOST,
      socket: BRIDGE_SOCKET,
      mode: BRIDGE_MODE,
      sessionIdleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
      sessionCleanupIntervalMs: SESSION_CLEANUP_INTERVAL_MS,
      maxSessions: MAX_SESSIONS,
      toolCallTimeoutMs: TOOL_CALL_TIMEOUT_MS,
      maxServerInstances: MAX_SERVER_INSTANCES,
      cors: SWARM_CORS,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(config));
    return;
  }

  // --- Static file serving for /ui/* ---
  if (url.startsWith("/ui")) {
    await serveStatic(req, res, url);
    return;
  }

  // --- MCP endpoint ---
  if (url === "/mcp") {
    // Check for existing session
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Route to existing session's transport
      const session = sessions.get(sessionId)!;
      session.meta.lastActiveAt = Date.now();
      await session.transport.handleRequest(req, res);
      return;
    }

    // For GET/DELETE on non-existent session, return 404
    if (req.method === "GET" || req.method === "DELETE") {
      if (sessionId) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Missing Mcp-Session-Id header" })
        );
      }
      return;
    }

    // POST without valid session → create new session
    if (req.method === "POST") {
      if (sessions.size >= MAX_SESSIONS) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: `Too many sessions (max ${MAX_SESSIONS}). Try again later.`,
          })
        );
        return;
      }

      const newSession = createSession(
        processManager,
        profilesConfig,
        sessions
      );
      sessions.set(newSession.meta.sessionId, newSession);

      console.error(
        `[HTTP] New session created: ${newSession.meta.sessionId} (total: ${sessions.size})`
      );

      processManager.emit("session:created", {
        type: "session:created",
        timestamp: Date.now(),
        data: { sessionId: newSession.meta.sessionId, totalSessions: sessions.size },
      });

      // Let the transport handle the initialization request
      await newSession.transport.handleRequest(req, res);
      return;
    }

    // Unsupported method
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // --- 404 for everything else ---
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

/**
 * Serve static files from the ui/out directory for the dashboard SPA.
 */
async function serveStatic(
  _req: IncomingMessage,
  res: ServerResponse,
  url: string
): Promise<void> {
  const uiRoot = join(__dirname, "..", "ui", "out");

  // Strip /ui prefix and query string
  let filePath = url.slice("/ui".length) || "/";
  const queryIdx = filePath.indexOf("?");
  if (queryIdx >= 0) filePath = filePath.slice(0, queryIdx);

  // Default to index.html
  if (filePath === "/" || filePath === "") {
    filePath = "/index.html";
  }

  const fullPath = join(uiRoot, filePath);

  // Prevent directory traversal
  if (!fullPath.startsWith(uiRoot)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  try {
    const data = await readFile(fullPath);
    const ext = extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    // SPA fallback: serve index.html for non-file paths
    try {
      const data = await readFile(join(uiRoot, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  }
}

/**
 * Create a new MCP session with its own McpServer + transport.
 */
function createSession(
  processManager: ProcessManager,
  profilesConfig: ProfilesConfig,
  sessions: Map<string, ManagedSession>
): ManagedSession {
  const sessionId = randomUUID();

  // Create a new transport for this session
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
  });

  // Create a new McpServer for this session
  const mcpServer = new McpServer({
    name: "mcp-swarm",
    version: "4.1.0",
  });

  // Register all tools — they share the same processManager singleton
  // Pass sessionId so stateful servers get per-session instances
  registerAllTools(mcpServer, processManager, profilesConfig, {
    useQueuedCalls: true,
    sessionId,
  });

  // Set onclose BEFORE connect to avoid race condition
  transport.onclose = () => {
    console.error(`[HTTP] Transport closed for session: ${sessionId}`);
    cleanupSession(sessionId, sessions, processManager);
  };

  // Connect the server to the transport
  mcpServer.connect(transport).catch((err) => {
    console.error(
      `[HTTP] Failed to connect session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`
    );
    cleanupSession(sessionId, sessions, processManager);
  });

  return {
    transport,
    mcpServer,
    meta: {
      sessionId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    },
  };
}

/**
 * Clean up a session (close transport, release stateful instances, remove from map).
 */
function cleanupSession(
  sessionId: string,
  sessions: Map<string, ManagedSession>,
  processManager?: ProcessManager
): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  sessions.delete(sessionId);

  session.transport.close().catch(() => { });
  session.mcpServer.close().catch(() => { });

  // Emit session:closed event
  if (processManager) {
    processManager.emit("session:closed", {
      type: "session:closed",
      timestamp: Date.now(),
      data: { sessionId, totalSessions: sessions.size },
    });

    // Release any stateful server instances owned by this session
    processManager.releaseSessionInstances(sessionId).catch((err) => {
      console.error(
        `[HTTP] Error releasing session instances for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }
}
