/**
 * Shared type definitions for the MCP Bridge v4.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

// --- Server Configuration ---

export interface ServerConfig {
  name: string;
  type: "STDIO" | "SSE" | "STREAMABLE_HTTP";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  description?: string;
  headers?: Record<string, string>;
  /** Whether this server is stateful (needs per-session isolation) */
  stateful?: boolean;
}

// --- Managed Server (live state) ---

export interface CachedTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface ManagedServer {
  name: string;
  config: ServerConfig;
  client: Client | null;
  transport: Transport | null;
  status: "connecting" | "connected" | "error" | "stopped";
  tools: CachedTool[];
  pid: number | null; // Only for STDIO servers
  stderrBuffer: string[];
  errorMessage: string | null;
  reconnectAttempts: number;
}

// --- Profile Types ---

export interface ProfileServer {
  name: string;
  command: string;
  args: string[];
  description: string;
  env?: Record<string, string>;
}

export interface Profile {
  description: string;
  servers: ProfileServer[];
}

export type ProfilesConfig = Record<string, Profile>;

// Bridge uses SQLite directly for persistence.

export interface McpToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

// --- Queue / Tool Call Types ---

export interface ToolCallResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

// --- Server Instance (for pool scaling) ---

export interface ServerInstance {
  /** Internal name, e.g. "playwright" for primary, "playwright#1" for scaled */
  internalName: string;
  /** Base server name, always "playwright" */
  baseName: string;
  /** Index: 0 = primary, 1+ = scaled copies */
  index: number;
  /** Whether currently executing a tool call */
  busy: boolean;
  /** Timestamp of last tool call completion (for idle detection) */
  lastActiveAt: number;
}

// --- Bridge Session (HTTP mode) ---

export interface BridgeSession {
  sessionId: string;
  createdAt: number;
  lastActiveAt: number;
}

// --- Registry Types ---

export interface RegistryServer {
  server: {
    name?: string;
    description?: string;
    repository?: { url?: string; source?: string };
    version?: string;
    packages?: Array<{
      registryType?: string;
      identifier?: string;
      version?: string;
      transport?: { type?: string };
      environmentVariables?: Array<{
        name?: string;
        description?: string;
        isRequired?: boolean;
        isSecret?: boolean;
      }>;
    }>;
  };
}

export interface RegistryResponse {
  servers?: RegistryServer[];
  metadata?: { nextCursor?: string; count?: number };
}
