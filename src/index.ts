#!/usr/bin/env node

/**
 * MCP Swarm v4.1
 *
 * Multi-agent MCP server manager. Spawns servers directly on the host
 * via MCP SDK Client + StdioClientTransport, giving full access to
 * filesystem, Docker, browsers, git, etc.
 *
 * Supports two modes:
 * - stdio (default): Single-client mode via StdioServerTransport
 * - http: Multi-client mode via StreamableHTTPServerTransport on SWARM_PORT
 *
 * Features:
 * - SQLite-backed configuration persistence
 * - Stateful server isolation (per-session instances for Playwright, etc.)
 * - Auto pool scaling under load
 * - Auto-reconnect with exponential backoff
 *
 * Tools (14, constant context footprint):
 * - search_mcp_registry, add_managed_server, remove_managed_server,
 *   list_managed_servers, reset_server_error, list_server_tools,
 *   call_server_tool, stop_server, start_server, list_profiles,
 *   activate_profile, deactivate_profile, create_profile, delete_profile
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { ProcessManager } from "./process-manager.js";
import { registerAllTools } from "./tools.js";
import { initDb, closeDb } from "./db.js";
import { BRIDGE_MODE, BRIDGE_PORT, BRIDGE_HOST, BRIDGE_SOCKET } from "./config.js";
import { startHttpServer } from "./http-server.js";
import type { ProfilesConfig, ServerConfig } from "./types.js";

// --- Profiles ---

let profilesConfig: ProfilesConfig = {};

function loadProfiles(): void {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    let profilesPath = join(__dirname, "..", "profiles.json");
    try {
      const raw = readFileSync(profilesPath, "utf-8");
      profilesConfig = JSON.parse(raw);
    } catch {
      profilesPath = join(__dirname, "profiles.json");
      const raw = readFileSync(profilesPath, "utf-8");
      profilesConfig = JSON.parse(raw);
    }
    console.error(
      `Loaded ${Object.keys(profilesConfig).length} profiles: ${Object.keys(profilesConfig).join(", ")}`
    );
  } catch (err) {
    console.error(
      `Warning: Could not load profiles.json: ${err instanceof Error ? err.message : String(err)}`
    );
    profilesConfig = {};
  }
}

// --- Process Manager (shared singleton) ---

const processManager = new ProcessManager();

// --- Startup: Restore servers from SQLite ---

async function restoreServers(): Promise<void> {
  const configs: ServerConfig[] = processManager.loadLocalConfig();

  if (configs.length === 0) {
    console.error("No servers to restore.");
    return;
  }

  // Filter out invalid configs
  const validConfigs = configs.filter((config) => {
    if (config.type === "STDIO" && !config.command) {
      console.error(
        `  Skipping '${config.name}' (STDIO with no command)`
      );
      return false;
    }
    if (
      (config.type === "SSE" || config.type === "STREAMABLE_HTTP") &&
      !config.url
    ) {
      console.error(
        `  Skipping '${config.name}' (${config.type} with no URL)`
      );
      return false;
    }
    return true;
  });

  if (validConfigs.length === 0) {
    console.error("No valid servers to restore.");
    return;
  }

  console.error(
    `Restoring ${validConfigs.length} servers from SQLite...`
  );

  // Spawn all in parallel
  const spawnPromises = validConfigs
    .filter((config) => !processManager.hasServer(config.name))
    .map((config) =>
      processManager.spawnServer(config).catch((err) => {
        console.error(
          `  Failed to restore '${config.name}': ${err instanceof Error ? err.message : String(err)}`
        );
      })
    );

  await Promise.allSettled(spawnPromises);
}

// --- Shutdown Handlers ---

function setupShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      console.error(`[Swarm] Force exit on second ${signal}`);
      process.exit(1);
    }
    shuttingDown = true;
    console.error(`\n[Swarm] Received ${signal}, shutting down...`);

    const forceTimer = setTimeout(() => {
      console.error("[Swarm] Shutdown timed out, forcing exit");
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    try {
      await processManager.stopAll();
      closeDb();
    } catch (err) {
      console.error(
        `[Swarm] Error during shutdown: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// --- Start Server ---

async function main() {
  // Initialize SQLite before anything else
  initDb();

  loadProfiles();
  setupShutdownHandlers();

  const isHttpMode =
    BRIDGE_MODE === "http" ||
    process.env.SWARM_PORT !== undefined ||
    process.env.BRIDGE_PORT !== undefined ||
    BRIDGE_SOCKET !== "";

  if (isHttpMode) {
    // HTTP mode: multi-client via StreamableHTTPServerTransport
    startHttpServer(processManager, profilesConfig);
    const listenOn = BRIDGE_SOCKET
      ? `unix:${BRIDGE_SOCKET}`
      : `${BRIDGE_HOST}:${BRIDGE_PORT}`;
    console.error(
      `MCP Swarm v4.1 running on ${listenOn} (multi-client)`
    );
  } else {
    // Stdio mode: single-client (backward compatible)
    const mcpServer = new McpServer({
      name: "mcp-swarm",
      version: "4.1.0",
    });

    registerAllTools(mcpServer, processManager, profilesConfig, {
      useQueuedCalls: false,
    });

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error(
      "MCP Swarm v4.1 running on stdio (15 tools, host-side spawning)"
    );
  }

  // Both modes: restore servers in background
  restoreServers().catch((err) => {
    console.error(
      `Warning: Server restoration failed: ${err instanceof Error ? err.message : String(err)}`
    );
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
