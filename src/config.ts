/**
 * Configuration constants for MCP Swarm.
 * All environment variables and paths are defined here.
 *
 * Environment variables use SWARM_ prefix (BRIDGE_ still supported for backwards compatibility).
 */

import { join } from "path";
import { homedir } from "os";

// Helper: read env with SWARM_ prefix, fallback to BRIDGE_ for backwards compat
function env(name: string, fallback?: string): string | undefined {
  return process.env[`SWARM_${name}`] ?? process.env[`BRIDGE_${name}`] ?? fallback;
}

// --- Data Directory ---
export const BRIDGE_DATA_DIR =
  env("DATA_DIR") || join(homedir(), ".mcp-swarm");

// --- SQLite Database ---
export const BRIDGE_DB_PATH = join(BRIDGE_DATA_DIR, "swarm.db");

// --- Timeouts ---
export const TOOL_CALL_TIMEOUT_MS = parseInt(
  process.env.TOOL_CALL_TIMEOUT_MS || "60000",
  10
);

// --- Auto-reconnect ---
export const AUTO_RECONNECT_MAX_RETRIES = 3;
export const AUTO_RECONNECT_BASE_DELAY_MS = 2000;

// --- Swarm Mode (HTTP multi-agent support) ---
export const BRIDGE_MODE = env("MODE", "stdio")!;
export const BRIDGE_PORT = parseInt(env("PORT", "3100")!, 10);
export const BRIDGE_HOST = env("HOST", "127.0.0.1")!;
// Unix socket path — if set, overrides PORT/HOST
// Example: SWARM_SOCKET=/tmp/mcp-swarm.sock
export const BRIDGE_SOCKET = env("SOCKET", "")!;

// --- Queue ---
export const QUEUE_REQUEST_TTL_MS = parseInt(
  process.env.QUEUE_REQUEST_TTL_MS || "60000",
  10
);

// --- Pool Scaling ---
export const MAX_SERVER_INSTANCES = parseInt(
  process.env.MAX_SERVER_INSTANCES || "4",
  10
);
export const SCALE_UP_WAIT_MS = parseInt(
  process.env.SCALE_UP_WAIT_MS || "5000",
  10
);
export const IDLE_KILL_MS = parseInt(
  process.env.IDLE_KILL_MS || "60000",
  10
);

// --- HTTP Session ---
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const SESSION_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
export const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || "50", 10);

// --- CORS ---
export const SWARM_CORS =
  env("CORS", "0") === "1" || process.env.NODE_ENV === "development";

// --- Health Watchdog ---
export const HEALTH_CHECK_INTERVAL_MS = parseInt(
  process.env.HEALTH_CHECK_INTERVAL_MS || "60000",
  10
);
export const HEALTH_CHECK_TIMEOUT_MS = parseInt(
  process.env.HEALTH_CHECK_TIMEOUT_MS || "10000",
  10
);

// --- Known Stateful Servers ---
// These servers maintain internal state (browser, working directory, etc.)
// and need per-session isolation in HTTP mode.
// Users can override via the `stateful` flag when adding a server.
export const KNOWN_STATEFUL_SERVERS = new Set([
  "playwright",
  "puppeteer",
  "puppeteer-mcp",
  "sequential-thinking",
  "git-mcp",
]);
