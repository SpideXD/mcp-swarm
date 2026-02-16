/** Shared type definitions for the UI client libraries and stores. */

export interface ServerInfo {
  name: string;
  status: "connected" | "connecting" | "error" | "stopped";
  type: string;
  pid: number | null;
  tools: number;
  error?: string;
  description?: string;
  stateful?: boolean;
  connection?: string;
}

export interface ToolInfo {
  server: string;
  name: string;
  description: string;
  schema?: string;
}

export interface ProfileInfo {
  name: string;
  description: string;
  status: "active" | "partial" | "inactive";
  activeCount: number;
  totalCount: number;
  servers: ProfileServerInfo[];
  source: "builtin" | "custom";
}

export interface ProfileServerInfo {
  name: string;
  status: string;
  description: string;
  command: string;
}

export interface RegistryResult {
  name: string;
  description: string;
  version?: string;
  repository?: string;
  installCommand?: string;
  source?: "registry" | "npm" | "smithery";
  downloads?: string;
  envVars?: { name: string; required: boolean; description?: string }[];
}

export interface HealthInfo {
  status: string;
  mode: string;
  sessions: number;
  servers: number;
  uptime: number;
}

export interface SessionInfo {
  id: string;
  createdAt: number;
  lastActiveAt: number;
  idle: number;
}

export interface SwarmConfig {
  port: number;
  host: string;
  socket: string | null;
  mode: string;
  sessionIdleTimeoutMs: number;
  sessionCleanupIntervalMs: number;
  maxSessions: number;
  toolCallTimeoutMs: number;
  maxServerInstances: number;
  cors: boolean;
}

export interface ActivityEvent {
  id: string;
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface AddServerParams {
  name: string;
  type: "STDIO" | "SSE" | "STREAMABLE_HTTP";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  description?: string;
  headers?: Record<string, string>;
  stateful?: boolean;
}

export interface CreateProfileParams {
  name: string;
  description: string;
  servers: Array<{
    name: string;
    command: string;
    args: string[];
    description?: string;
  }>;
}
