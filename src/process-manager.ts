/**
 * ProcessManager - Spawns and manages MCP servers directly on the host.
 *
 * Supports all transport types:
 * - STDIO: spawns child process via StdioClientTransport
 * - SSE: connects via SSEClientTransport
 * - STREAMABLE_HTTP: connects via StreamableHTTPClientTransport
 *
 * Features:
 * - Auto-reconnect on crash (max 3 retries with backoff)
 * - Tool call timeout (default 60s)
 * - listChanged notification handling (auto-refresh tool cache)
 * - Image/audio content passthrough
 * - SQLite-backed config persistence (~/.mcp-swarm/swarm.db)
 * - PID tracking + orphan cleanup for STDIO servers
 */

import { EventEmitter } from "events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough } from "stream";
import {
  BRIDGE_DATA_DIR,
  TOOL_CALL_TIMEOUT_MS,
  AUTO_RECONNECT_MAX_RETRIES,
  AUTO_RECONNECT_BASE_DELAY_MS,
  MAX_SERVER_INSTANCES,
  IDLE_KILL_MS,
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_TIMEOUT_MS,
} from "./config.js";
import * as db from "./db.js";
import { RequestQueue } from "./request-queue.js";
import type { ServerConfig, ManagedServer, ToolCallResult, ServerInstance } from "./types.js";

const MAX_STDERR_LINES = 50;
const MAX_STDERR_LINE_LENGTH = 1000;
const CONNECT_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 5_000;

export class ProcessManager extends EventEmitter {
  private servers = new Map<string, ManagedServer>();
  private spawnLocks = new Map<string, Promise<ManagedServer>>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // --- Pool scaling ---
  private requestQueue: RequestQueue;
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;
  /** Tracks in-flight scale-ups to prevent duplicates */
  private scalingInProgress = new Set<string>();

  // --- Health watchdog ---
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  // --- Session-scoped stateful instances ---
  /** Maps sessionId → (serverName → internalName) for stateful per-session instances */
  private sessionInstances = new Map<string, Map<string, string>>();
  /** Locks to prevent concurrent session instance spawns for same server+session */
  private sessionSpawnLocks = new Map<string, Promise<ManagedServer>>();
  /** Tracks temp dirs created for Puppeteer session instances (for cleanup) */
  private sessionTempDirs = new Map<string, string[]>();

  constructor() {
    super();
    mkdirSync(BRIDGE_DATA_DIR, { recursive: true });
    this.cleanupOrphanedProcesses();

    // Initialize the request queue with executor and scale-up callback
    this.requestQueue = new RequestQueue(
      (instanceName, toolName, args) =>
        this.callTool(instanceName, toolName, args),
      (serverName) => {
        this._handleScaleUp(serverName).catch((err) => {
          console.error(
            `[ProcessManager] Unhandled scale-up error for '${serverName}': ${err instanceof Error ? err.message : String(err)}`
          );
        });
      }
    );

    // Periodically check for idle scaled instances to kill
    this.idleCheckTimer = setInterval(() => this._checkIdleInstances(), 10_000);
    this.idleCheckTimer.unref();

    // Health watchdog: periodically ping connected servers
    if (HEALTH_CHECK_INTERVAL_MS > 0) {
      this.healthCheckTimer = setInterval(
        () => this._healthCheck(),
        HEALTH_CHECK_INTERVAL_MS
      );
      this.healthCheckTimer.unref();
    }
  }

  // --- Public API ---

  async spawnServer(config: ServerConfig): Promise<ManagedServer> {
    // Serialize concurrent spawns for the same server name.
    // Loop ensures that if a new lock appears after we await (e.g., a third
    // concurrent caller), we wait for that one too before proceeding.
    while (this.spawnLocks.has(config.name)) {
      await this.spawnLocks.get(config.name)!.catch(() => { });
    }

    const promise = this._doSpawn(config);
    this.spawnLocks.set(config.name, promise);

    try {
      return await promise;
    } finally {
      if (this.spawnLocks.get(config.name) === promise) {
        this.spawnLocks.delete(config.name);
      }
    }
  }

  private async _doSpawn(config: ServerConfig): Promise<ManagedServer> {
    // Stop existing server with same name if running
    if (this.servers.has(config.name)) {
      await this.stopServer(config.name);
    }

    const managed: ManagedServer = {
      name: config.name,
      config,
      client: null,
      transport: null,
      status: "connecting",
      tools: [],
      pid: null,
      stderrBuffer: [],
      errorMessage: null,
      reconnectAttempts: 0,
    };
    this.servers.set(config.name, managed);

    try {
      if (config.type === "STDIO") {
        await this._spawnStdio(managed, config);
      } else if (config.type === "SSE") {
        await this._spawnSSE(managed, config);
      } else if (config.type === "STREAMABLE_HTTP") {
        await this._spawnStreamableHTTP(managed, config);
      } else {
        managed.status = "error";
        managed.errorMessage = `Unknown transport type: ${config.type}`;
        return managed;
      }

      managed.status = "connected";
      managed.reconnectAttempts = 0;

      // Cache tools
      try {
        const toolsResult = await managed.client!.listTools();
        managed.tools = (toolsResult.tools || []).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
      } catch {
        console.error(
          `[ProcessManager] Warning: Could not list tools for '${config.name}'`
        );
      }

      this.savePids();
      this.saveLocalConfig();
      console.error(
        `[ProcessManager] Server '${config.name}' connected (${config.type}${managed.pid ? `, PID: ${managed.pid}` : ""}, ${managed.tools.length} tools)`
      );

      this.emit("server:status", {
        type: "server:status",
        timestamp: Date.now(),
        data: { name: config.name, status: "connected" },
      });
      this.emit("server:added", {
        type: "server:added",
        timestamp: Date.now(),
        data: { name: config.name, type: config.type, tools: managed.tools.length },
      });

      return managed;
    } catch (err) {
      managed.status = "error";
      managed.errorMessage =
        err instanceof Error ? err.message : String(err);

      if (managed.stderrBuffer.length > 0) {
        managed.errorMessage += `\n\nStderr output:\n${managed.stderrBuffer.slice(-10).join("\n")}`;
      }

      console.error(
        `[ProcessManager] Failed to spawn '${config.name}': ${managed.errorMessage}`
      );

      this.emit("server:status", {
        type: "server:status",
        timestamp: Date.now(),
        data: { name: config.name, status: "error", error: managed.errorMessage },
      });

      // Clean up partial state
      try {
        await managed.transport?.close();
      } catch {
        // ignore
      }
      managed.client = null;
      managed.transport = null;

      return managed;
    }
  }

  private async _spawnStdio(
    managed: ManagedServer,
    config: ServerConfig
  ): Promise<void> {
    if (!config.command) {
      throw new Error("STDIO servers require a command.");
    }

    const env: Record<string, string> = {
      ...getDefaultEnvironment(),
      ...(config.env || {}),
    };

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env,
      stderr: "pipe",
    });
    managed.transport = transport;

    // Capture stderr
    const stderrStream = transport.stderr;
    if (stderrStream && stderrStream instanceof PassThrough) {
      stderrStream.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const rawLine of lines) {
          const line =
            rawLine.length > MAX_STDERR_LINE_LENGTH
              ? rawLine.slice(0, MAX_STDERR_LINE_LENGTH) + "..."
              : rawLine;
          managed.stderrBuffer.push(line);
          if (managed.stderrBuffer.length > MAX_STDERR_LINES) {
            managed.stderrBuffer.shift();
          }
        }
      });
    }

    // Set up close handler with auto-reconnect
    transport.onclose = () => {
      if (managed.status === "connected" || managed.status === "connecting") {
        managed.status = "error";
        managed.errorMessage =
          "Server process exited unexpectedly. Check stderr for details.";
        console.error(
          `[ProcessManager] Server '${config.name}' process exited`
        );

        // Skip reconnect for session-scoped instances (managed by session lifecycle)
        if (config.name.includes("@")) {
          console.error(
            `[ProcessManager] Skipping reconnect for session-scoped '${config.name}'`
          );
          return;
        }

        // Detect permanent failures from stderr (package not found, auth errors, etc.)
        const stderrText = managed.stderrBuffer.join("\n").toLowerCase();
        const isPermanentFailure =
          stderrText.includes("e404") ||
          stderrText.includes("not found") ||
          stderrText.includes("enoent") ||
          stderrText.includes("command not found") ||
          stderrText.includes("not in this registry");
        if (isPermanentFailure) {
          managed.errorMessage =
            `Permanent failure: ${managed.stderrBuffer.slice(-5).join("\n")}`;
          console.error(
            `[ProcessManager] Permanent failure detected for '${config.name}', skipping reconnect`
          );
          return;
        }

        this._scheduleReconnect(managed);
      }
    };

    const client = new Client(
      { name: "mcp-swarm", version: "4.1" },
      {
        capabilities: {},
        listChanged: {
          tools: {
            onChanged: (_error, tools) => {
              if (tools) {
                managed.tools = tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  inputSchema: t.inputSchema,
                }));
                console.error(
                  `[ProcessManager] Tools updated for '${config.name}': ${managed.tools.length} tools`
                );
              }
            },
          },
        },
      }
    );
    managed.client = client;

    // Connect with timeout
    let connectTimer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          connectTimer = setTimeout(
            () => reject(new Error("Connection timeout")),
            CONNECT_TIMEOUT_MS
          );
        }),
      ]);
    } finally {
      clearTimeout(connectTimer!);
    }

    managed.pid = transport.pid ?? null;
  }

  private async _spawnSSE(
    managed: ManagedServer,
    config: ServerConfig
  ): Promise<void> {
    if (!config.url) {
      throw new Error("SSE servers require a URL.");
    }

    const requestInit: RequestInit = {};
    if (config.headers && Object.keys(config.headers).length > 0) {
      requestInit.headers = config.headers;
    }

    const transport = new SSEClientTransport(new URL(config.url), {
      requestInit,
    });
    managed.transport = transport;

    transport.onclose = () => {
      if (managed.status === "connected" || managed.status === "connecting") {
        managed.status = "error";
        managed.errorMessage = "SSE connection closed unexpectedly.";
        console.error(
          `[ProcessManager] Server '${config.name}' SSE connection closed`
        );
        this._scheduleReconnect(managed);
      }
    };

    const client = new Client(
      { name: "mcp-swarm", version: "4.1" },
      {
        capabilities: {},
        listChanged: {
          tools: {
            onChanged: (_error, tools) => {
              if (tools) {
                managed.tools = tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  inputSchema: t.inputSchema,
                }));
              }
            },
          },
        },
      }
    );
    managed.client = client;

    let connectTimer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          connectTimer = setTimeout(
            () => reject(new Error("Connection timeout")),
            CONNECT_TIMEOUT_MS
          );
        }),
      ]);
    } finally {
      clearTimeout(connectTimer!);
    }
  }

  private async _spawnStreamableHTTP(
    managed: ManagedServer,
    config: ServerConfig
  ): Promise<void> {
    if (!config.url) {
      throw new Error("Streamable HTTP servers require a URL.");
    }

    const requestInit: RequestInit = {};
    if (config.headers && Object.keys(config.headers).length > 0) {
      requestInit.headers = config.headers;
    }

    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit,
    });
    managed.transport = transport;

    transport.onclose = () => {
      if (managed.status === "connected" || managed.status === "connecting") {
        managed.status = "error";
        managed.errorMessage = "HTTP connection closed unexpectedly.";
        console.error(
          `[ProcessManager] Server '${config.name}' HTTP connection closed`
        );
        this._scheduleReconnect(managed);
      }
    };

    const client = new Client(
      { name: "mcp-swarm", version: "4.1" },
      {
        capabilities: {},
        listChanged: {
          tools: {
            onChanged: (_error, tools) => {
              if (tools) {
                managed.tools = tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  inputSchema: t.inputSchema,
                }));
              }
            },
          },
        },
      }
    );
    managed.client = client;

    let connectTimer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          connectTimer = setTimeout(
            () => reject(new Error("Connection timeout")),
            CONNECT_TIMEOUT_MS
          );
        }),
      ]);
    } finally {
      clearTimeout(connectTimer!);
    }
  }

  // --- Auto-Reconnect ---

  private _scheduleReconnect(managed: ManagedServer): void {
    if (managed.status === "stopped") return;
    if (managed.reconnectAttempts >= AUTO_RECONNECT_MAX_RETRIES) {
      console.error(
        `[ProcessManager] Server '${managed.name}' exceeded max reconnect attempts (${AUTO_RECONNECT_MAX_RETRIES})`
      );
      return;
    }

    const delay =
      AUTO_RECONNECT_BASE_DELAY_MS *
      Math.pow(2, managed.reconnectAttempts);
    managed.reconnectAttempts++;

    console.error(
      `[ProcessManager] Scheduling reconnect for '${managed.name}' in ${delay}ms (attempt ${managed.reconnectAttempts}/${AUTO_RECONNECT_MAX_RETRIES})`
    );

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(managed.name);
      if (managed.status === "stopped") return;
      // Check that this managed server is still the one in our map
      if (this.servers.get(managed.name) !== managed) return;

      console.error(
        `[ProcessManager] Attempting reconnect for '${managed.name}'...`
      );

      const config = { ...managed.config };
      // Remove from map so _doSpawn can re-add
      this.servers.delete(managed.name);

      try {
        const newManaged = await this._doSpawn(config);
        if (newManaged.status === "connected") {
          // Reset counter on success — future crashes get full retry budget
          newManaged.reconnectAttempts = 0;
          console.error(
            `[ProcessManager] Reconnected '${config.name}' successfully`
          );
        } else {
          // Carry forward attempt count so backoff continues on next crash
          newManaged.reconnectAttempts = managed.reconnectAttempts;
        }
      } catch (err) {
        console.error(
          `[ProcessManager] Reconnect failed for '${config.name}': ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }, delay);
    timer.unref();
    this.reconnectTimers.set(managed.name, timer);
  }

  // --- Stop / Restart ---

  async stopServer(name: string): Promise<void> {
    // Cancel any pending reconnect
    const reconnectTimer = this.reconnectTimers.get(name);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(name);
    }

    const server = this.servers.get(name);
    if (!server) return;

    server.status = "stopped";
    this.servers.delete(name);

    // Drain queued requests and unregister all instances for this server
    const baseName = name.includes("#")
      ? name.slice(0, name.indexOf("#"))
      : name;
    const drained = this.requestQueue.drainServer(
      baseName,
      `Server '${baseName}' was stopped`
    );
    if (drained > 0) {
      console.error(
        `[ProcessManager] Rejected ${drained} queued request(s) for '${baseName}'`
      );
    }

    // Only persist primary instances (skip session @ and scaled # instances)
    if (!name.includes("@") && !name.includes("#")) {
      this.savePids();
      this.saveLocalConfig();
    }

    const closeWithTimeout = (fn: () => Promise<void>, label: string) =>
      Promise.race([
        fn(),
        new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            console.error(
              `[ProcessManager] ${label} close timed out for '${name}'`
            );
            resolve();
          }, CLOSE_TIMEOUT_MS);
          t.unref();
        }),
      ]).catch(() => { });

    await closeWithTimeout(
      () => server.client?.close() ?? Promise.resolve(),
      "Client"
    );
    await closeWithTimeout(
      () => server.transport?.close() ?? Promise.resolve(),
      "Transport"
    );

    server.client = null;
    server.transport = null;
    server.pid = null;

    console.error(`[ProcessManager] Server '${name}' stopped`);

    this.emit("server:status", {
      type: "server:status",
      timestamp: Date.now(),
      data: { name, status: "stopped" },
    });
    this.emit("server:removed", {
      type: "server:removed",
      timestamp: Date.now(),
      data: { name },
    });
  }

  async stopAll(): Promise<void> {
    // Stop the request queue and idle check timer
    this.requestQueue.stop();
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Clear all reconnect timers
    for (const [, timer] of this.reconnectTimers) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    const names = [...this.servers.keys()];
    await Promise.allSettled(names.map((name) => this.stopServer(name)));
    console.error(
      `[ProcessManager] All servers stopped (${names.length} total)`
    );
  }

  async restartServer(name: string): Promise<ManagedServer | null> {
    const server = this.servers.get(name);
    if (!server) return null;

    this.emit("server:status", {
      type: "server:status",
      timestamp: Date.now(),
      data: { name, status: "restarting" },
    });

    const config = { ...server.config };
    await this.stopServer(name);
    return this.spawnServer(config);
  }

  // --- Tool Calls (with timeout + content passthrough) ---

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
  }> {
    const server = this.servers.get(serverName);
    if (!server) {
      return {
        content: [
          {
            type: "text",
            text: `Server '${serverName}' not found. Use list_managed_servers to see available servers.`,
          },
        ],
        isError: true,
      };
    }

    if (server.status !== "connected" || !server.client) {
      return {
        content: [
          {
            type: "text",
            text: `Server '${serverName}' is not connected (status: ${server.status}).${server.errorMessage ? `\nError: ${server.errorMessage}` : ""}\n\nTry reset_server_error to retry connection.`,
          },
        ],
        isError: true,
      };
    }

    this.emit("tool:call", {
      type: "tool:call",
      timestamp: Date.now(),
      data: { server: serverName, tool: toolName, args },
    });

    try {
      // Call with timeout
      let callTimer: ReturnType<typeof setTimeout>;
      const result = await Promise.race([
        server.client.callTool({
          name: toolName,
          arguments: args,
        }),
        new Promise<never>((_, reject) => {
          callTimer = setTimeout(
            () =>
              reject(
                new Error(
                  `Tool call timed out after ${TOOL_CALL_TIMEOUT_MS / 1000}s`
                )
              ),
            TOOL_CALL_TIMEOUT_MS
          );
        }),
      ]).finally(() => {
        clearTimeout(callTimer!);
      });

      // Pass through all content types (text, image, audio, etc.)
      const content = (
        result.content as Array<{
          type: string;
          text?: string;
          data?: string;
          mimeType?: string;
        }>
      ).map((c) => {
        if (c.type === "text") {
          return { type: "text" as const, text: c.text || "" };
        }
        if (c.type === "image" && c.data) {
          return {
            type: "image" as const,
            data: c.data,
            mimeType: c.mimeType || "image/png",
          };
        }
        // For other types (audio, resource, etc.), pass through as-is
        return c;
      });

      const callResult = {
        content,
        isError: result.isError as boolean | undefined,
      };

      this.emit("tool:result", {
        type: "tool:result",
        timestamp: Date.now(),
        data: { server: serverName, tool: toolName, isError: callResult.isError || false },
      });

      return callResult;
    } catch (err) {
      const errorResult = {
        content: [
          {
            type: "text",
            text: `Error calling tool '${toolName}' on '${serverName}': ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };

      this.emit("tool:result", {
        type: "tool:result",
        timestamp: Date.now(),
        data: { server: serverName, tool: toolName, isError: true, error: err instanceof Error ? err.message : String(err) },
      });

      return errorResult;
    }
  }

  /**
   * Call a tool via the request queue. Used in HTTP mode to safely
   * serialize concurrent calls to single-threaded MCP servers.
   *
   * For stateful servers with a sessionId, routes to (or spawns) a
   * dedicated per-session instance instead of the shared pool.
   */
  async callToolQueued(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string
  ): Promise<ToolCallResult> {
    // --- Stateful server isolation ---
    const primaryServer = this.servers.get(serverName);
    if (sessionId && primaryServer?.config.stateful) {
      return this._callStatefulInstance(serverName, toolName, args, sessionId);
    }

    // --- Normal shared pool path ---
    // Ensure primary instance is registered with the queue
    const instances = this.requestQueue.getInstances(serverName);
    if (instances.length === 0 && this.servers.has(serverName)) {
      this.requestQueue.registerInstance({
        internalName: serverName,
        baseName: serverName,
        index: 0,
        busy: false,
        lastActiveAt: Date.now(),
      });
    }

    return this.requestQueue.enqueue(serverName, toolName, args);
  }

  /**
   * Route a tool call to a session-dedicated instance of a stateful server.
   * Spawns the instance on first use for this session.
   */
  private async _callStatefulInstance(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    sessionId: string
  ): Promise<ToolCallResult> {
    const shortSession = sessionId.slice(0, 8);
    const internalName = `${serverName}@${shortSession}`;

    // Check if we already have an instance for this session
    let sessionMap = this.sessionInstances.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      this.sessionInstances.set(sessionId, sessionMap);
    }

    // Spawn if not already running for this session
    if (!sessionMap.has(serverName) || !this.servers.has(internalName)) {
      const lockKey = `${sessionId}:${serverName}`;

      // Wait for any in-flight spawn for this exact session+server
      while (this.sessionSpawnLocks.has(lockKey)) {
        await this.sessionSpawnLocks.get(lockKey)!.catch(() => { });
      }

      // Check again after await — another caller may have finished spawning
      if (!this.servers.has(internalName)) {
        const primaryConfig = this.servers.get(serverName)?.config;
        if (!primaryConfig) {
          return {
            content: [
              {
                type: "text",
                text: `Server '${serverName}' not found. Cannot create session instance.`,
              },
            ],
            isError: true,
          };
        }

        console.error(
          `[ProcessManager] Spawning stateful instance '${internalName}' for session ${shortSession}`
        );

        // Clone config with unique name; for browser-based servers, add unique user-data-dir
        const sessionConfig: ServerConfig = {
          ...primaryConfig,
          name: internalName,
        };

        // Give each Playwright/Puppeteer session its own isolated browser
        if (
          primaryConfig.type === "STDIO" &&
          primaryConfig.args &&
          (primaryConfig.command === "npx" || primaryConfig.command === "node")
        ) {
          const argsStr = primaryConfig.args.join(" ").toLowerCase();
          if (argsStr.includes("playwright")) {
            // Playwright supports --isolated (in-memory profile — no disk cleanup needed)
            sessionConfig.args = [
              ...(primaryConfig.args || []),
              "--isolated",
            ];
            console.error(
              `[ProcessManager] Session '${shortSession}' Playwright using --isolated mode`
            );
          } else if (argsStr.includes("puppeteer")) {
            // Puppeteer needs a unique user-data-dir on disk
            const tempDir = mkdtempSync(join(tmpdir(), `mcp-${shortSession}-`));
            sessionConfig.args = [
              ...(primaryConfig.args || []),
              `--user-data-dir=${tempDir}`,
            ];
            // Track for cleanup on session release
            if (!this.sessionTempDirs.has(sessionId)) this.sessionTempDirs.set(sessionId, []);
            this.sessionTempDirs.get(sessionId)!.push(tempDir);
            console.error(
              `[ProcessManager] Session '${shortSession}' Puppeteer data dir: ${tempDir}`
            );
          }
        }

        const promise = this.spawnServer(sessionConfig);
        this.sessionSpawnLocks.set(lockKey, promise);

        try {
          const managed = await promise;
          if (managed.status !== "connected") {
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to spawn session instance '${internalName}': ${managed.errorMessage || "Unknown error"}`,
                },
              ],
              isError: true,
            };
          }
        } finally {
          if (this.sessionSpawnLocks.get(lockKey) === promise) {
            this.sessionSpawnLocks.delete(lockKey);
          }
        }

        sessionMap.set(serverName, internalName);
      }
    }

    // Call the tool directly on the session instance (no queue needed — it's dedicated)
    return this.callTool(internalName, toolName, args);
  }

  /**
   * Release all stateful instances owned by a session.
   * Called when an HTTP session disconnects.
   */
  async releaseSessionInstances(sessionId: string): Promise<void> {
    const sessionMap = this.sessionInstances.get(sessionId);
    if (!sessionMap || sessionMap.size === 0) return;

    const shortSession = sessionId.slice(0, 8);
    console.error(
      `[ProcessManager] Releasing ${sessionMap.size} stateful instance(s) for session ${shortSession}`
    );

    const stopPromises: Promise<void>[] = [];
    for (const [, internalName] of sessionMap) {
      if (this.servers.has(internalName)) {
        stopPromises.push(
          this.stopServer(internalName).catch((err) => {
            console.error(
              `[ProcessManager] Error stopping session instance '${internalName}': ${err instanceof Error ? err.message : String(err)}`
            );
          })
        );
      }
    }

    await Promise.allSettled(stopPromises);
    this.sessionInstances.delete(sessionId);

    // Clean up any temp dirs created for this session (e.g. Puppeteer user-data-dirs)
    const tempDirs = this.sessionTempDirs.get(sessionId);
    if (tempDirs) {
      for (const dir of tempDirs) {
        try {
          rmSync(dir, { recursive: true, force: true });
          console.error(`[ProcessManager] Cleaned up temp dir: ${dir}`);
        } catch { /* ignore */ }
      }
      this.sessionTempDirs.delete(sessionId);
    }
  }

  /**
   * Handle scale-up signal from the request queue.
   * Spawns a new instance of the server if under the max cap.
   */
  private async _handleScaleUp(serverName: string): Promise<void> {
    if (this.scalingInProgress.has(serverName)) return;

    const instances = this.requestQueue.getInstances(serverName);
    if (instances.length >= MAX_SERVER_INSTANCES) {
      this.requestQueue.clearPendingScaleUp(serverName);
      return; // At capacity
    }

    const primaryServer = this.servers.get(serverName);
    if (!primaryServer || primaryServer.config.type !== "STDIO" || primaryServer.config.stateful) {
      // Only scale non-stateful STDIO servers
      // Stateful servers use per-session instances (@), not pool scaling (#)
      this.requestQueue.clearPendingScaleUp(serverName);
      return;
    }

    // Find next available index (avoid collision with still-running instances)
    const existingIndexes = new Set(instances.map((i) => i.index));
    let newIndex = 1;
    while (existingIndexes.has(newIndex)) newIndex++;
    const internalName = `${serverName}#${newIndex}`;

    this.scalingInProgress.add(serverName);
    console.error(
      `[ProcessManager] Scaling up '${serverName}' → instance #${newIndex} (${internalName})`
    );

    try {
      // Spawn with the same config but different internal name
      const config: ServerConfig = {
        ...primaryServer.config,
        name: internalName,
      };

      const managed = await this.spawnServer(config);

      if (managed.status === "connected") {
        // Register the new instance with the queue
        this.requestQueue.registerInstance({
          internalName,
          baseName: serverName,
          index: newIndex,
          busy: false,
          lastActiveAt: Date.now(),
        });

        // Trigger dispatch so queued requests can use the new instance immediately
        this.requestQueue.triggerDispatch(serverName);

        this.emit("pool:scaled", {
          type: "pool:scaled",
          timestamp: Date.now(),
          data: { server: serverName, instance: internalName, totalInstances: this.requestQueue.getInstances(serverName).length },
        });

        console.error(
          `[ProcessManager] Scale-up complete: '${internalName}' (PID: ${managed.pid})`
        );
      } else {
        console.error(
          `[ProcessManager] Scale-up failed for '${internalName}': ${managed.errorMessage}`
        );
        // Clean up failed instance
        if (this.servers.has(internalName)) {
          await this.stopServer(internalName);
        }
      }
    } catch (err) {
      console.error(
        `[ProcessManager] Scale-up error for '${serverName}': ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      this.scalingInProgress.delete(serverName);
      this.requestQueue.clearPendingScaleUp(serverName);
    }
  }

  /**
   * Check for idle scaled instances and kill them to free resources.
   * Primary instances (index 0) are never killed.
   */
  private _checkIdleInstances(): void {
    const now = Date.now();

    for (const [baseName, instances] of this._getAllInstancesByBase()) {
      for (const instance of instances) {
        // Never kill the primary instance
        if (instance.index === 0) continue;
        // Don't kill busy instances
        if (instance.busy) continue;
        // Don't kill session-scoped instances (managed by session lifecycle)
        if (instance.internalName.includes("@")) continue;
        // Check idle time
        if (now - instance.lastActiveAt < IDLE_KILL_MS) continue;

        console.error(
          `[ProcessManager] Killing idle instance '${instance.internalName}' (idle ${Math.round((now - instance.lastActiveAt) / 1000)}s)`
        );

        // Unregister from queue first
        this.requestQueue.unregisterInstance(
          instance.internalName,
          baseName
        );

        // Stop the server process
        this.stopServer(instance.internalName).catch((err) => {
          console.error(
            `[ProcessManager] Error stopping idle instance '${instance.internalName}': ${err instanceof Error ? err.message : String(err)}`
          );
        });
      }
    }
  }

  /**
   * Health watchdog: ping each connected primary server with listTools().
   * If a server fails to respond within HEALTH_CHECK_TIMEOUT_MS, force-restart it.
   * Skips scaled (#) and session (@) instances — they're managed separately.
   */
  private async _healthCheck(): Promise<void> {
    const servers = [...this.servers.values()].filter(
      (s) =>
        s.status === "connected" &&
        s.client &&
        !s.name.includes("#") &&
        !s.name.includes("@")
    );

    if (servers.length === 0) return;

    for (const server of servers) {
      try {
        let timer: ReturnType<typeof setTimeout>;
        await Promise.race([
          server.client!.listTools(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Health check timeout")),
              HEALTH_CHECK_TIMEOUT_MS
            );
          }),
        ]).finally(() => clearTimeout(timer!));
      } catch (err) {
        console.error(
          `[Watchdog] Server '${server.name}' failed health check: ${err instanceof Error ? err.message : String(err)}. Restarting...`
        );

        this.emit("server:status", {
          type: "server:status",
          timestamp: Date.now(),
          data: { name: server.name, status: "restarting", reason: "health_check_failed" },
        });

        this.restartServer(server.name).catch((restartErr) => {
          console.error(
            `[Watchdog] Failed to restart '${server.name}': ${restartErr instanceof Error ? restartErr.message : String(restartErr)}`
          );
        });
      }
    }
  }

  /**
   * Group all registered instances by their base name.
   */
  private _getAllInstancesByBase(): Map<string, ServerInstance[]> {
    const result = new Map<string, ServerInstance[]>();
    const seen = new Set<string>();
    for (const server of this.servers.values()) {
      const hashIdx = server.name.indexOf("#");
      const baseName = hashIdx >= 0 ? server.name.slice(0, hashIdx) : server.name;
      if (seen.has(baseName)) continue;
      seen.add(baseName);
      const instances = this.requestQueue.getInstances(baseName);
      if (instances.length > 0) {
        result.set(baseName, instances);
      }
    }
    return result;
  }

  /**
   * Two-step tool discovery:
   * - Without serverName: returns summary (server name + tool count + brief description)
   * - With serverName: returns full tool schemas for that server
   */
  listTools(serverName?: string): {
    mode: "summary" | "detail";
    text: string;
  } {
    if (serverName) {
      const server = this.servers.get(serverName);
      if (!server) {
        const available = [...this.servers.keys()].join(", ");
        return {
          mode: "detail",
          text: `Server '${serverName}' not found.\n\nAvailable servers: ${available || "none"}`,
        };
      }

      if (server.tools.length === 0) {
        return {
          mode: "detail",
          text: `Server '${serverName}' has no tools cached (status: ${server.status}).${server.status === "connected" ? " Try refreshing with reset_server_error." : ""}`,
        };
      }

      let output = `## ${serverName} (${server.tools.length} tools)\n\n`;

      for (const tool of server.tools) {
        const desc = tool.description
          ? tool.description.split("\n")[0].slice(0, 150)
          : "No description";

        const props = tool.inputSchema?.properties || {};
        const required = new Set(tool.inputSchema?.required || []);
        const paramList = Object.entries(props)
          .map(([name, prop]) => {
            const propObj = prop as {
              type?: string;
              description?: string;
            };
            const req = required.has(name) ? " (required)" : " (optional)";
            const type = propObj.type || "any";
            return `    - \`${name}\`: ${type}${req}${propObj.description ? ` - ${propObj.description.split("\n")[0].slice(0, 100)}` : ""}`;
          })
          .join("\n");

        output += `- **${tool.name}**: ${desc}\n`;
        if (paramList) output += `  Parameters:\n${paramList}\n`;
        output += "\n";
      }

      output += `---\nTo use: \`call_server_tool(server_name="${serverName}", tool_name="...", arguments={...})\``;

      return { mode: "detail", text: output };
    }

    // Summary mode
    const entries = [...this.servers.values()];
    if (entries.length === 0) {
      return {
        mode: "summary",
        text: "No servers are currently running. Use add_managed_server to add one.",
      };
    }

    let output = `## Available Servers (${entries.length})\n\n`;

    for (const server of entries) {
      const statusIcon =
        server.status === "connected"
          ? ""
          : server.status === "error"
            ? " [ERROR]"
            : ` [${server.status.toUpperCase()}]`;

      let toolSummary: string;
      if (server.tools.length === 0) {
        toolSummary = server.config.description || "No tools loaded";
      } else {
        const toolNames = server.tools.slice(0, 4).map((t) => t.name);
        toolSummary = toolNames.join(", ");
        if (server.tools.length > 4) {
          toolSummary += ", ...";
        }
      }

      output += `- **${server.name}**${statusIcon} (${server.tools.length} tools): ${toolSummary}\n`;
    }

    output += `\nUse \`list_server_tools(server_name="...")\` to see full tool details for a specific server.`;

    return { mode: "summary", text: output };
  }

  async refreshTools(serverName?: string): Promise<void> {
    const targets = serverName
      ? [this.servers.get(serverName)].filter(Boolean)
      : [...this.servers.values()];

    for (const server of targets) {
      if (!server || server.status !== "connected" || !server.client) continue;
      try {
        const result = await server.client.listTools();
        server.tools = (result.tools || []).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
      } catch {
        console.error(
          `[ProcessManager] Failed to refresh tools for '${server.name}'`
        );
      }
    }
  }

  getServer(name: string): ManagedServer | undefined {
    return this.servers.get(name);
  }

  getAllServers(): ManagedServer[] {
    return [...this.servers.values()];
  }

  hasServer(name: string): boolean {
    return this.servers.has(name);
  }

  // --- SQLite-backed Config Persistence ---

  saveLocalConfig(): void {
    try {
      for (const server of this.servers.values()) {
        // Don't persist scaled instances (e.g., "playwright#1") or session instances ("playwright@abc")
        if (server.name.includes("#") || server.name.includes("@")) continue;
        db.upsertServer(server.config);
      }
    } catch {
      // Non-critical
    }
  }

  loadLocalConfig(): ServerConfig[] {
    try {
      return db.listServers();
    } catch {
      return [];
    }
  }

  // --- PID Tracking (SQLite) ---

  private savePids(): void {
    try {
      for (const [name, server] of this.servers) {
        // Don't persist transient instance PIDs
        if (name.includes("#") || name.includes("@")) continue;
        if (server.pid) db.savePid(name, server.pid);
      }
    } catch {
      // Non-critical
    }
  }

  private cleanupOrphanedProcesses(): void {
    try {
      const pids = db.loadPids();

      for (const [name, pid] of Object.entries(pids)) {
        if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
          console.error(
            `[ProcessManager] Invalid PID for '${name}': ${pid}, skipping`
          );
          continue;
        }
        try {
          process.kill(pid, 0);
          console.error(
            `[ProcessManager] Killing orphaned process '${name}' (PID: ${pid})`
          );
          process.kill(pid, "SIGTERM");
          const killTimer = setTimeout(() => {
            try {
              process.kill(pid, "SIGKILL");
            } catch {
              // Already dead
            }
          }, 2000);
          killTimer.unref();
        } catch {
          // Process not running, clean
        }
      }

      db.clearPids();
    } catch {
      // No DB or error - fresh start
    }
  }
}
