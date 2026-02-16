import { create } from "zustand";
import { McpClient } from "../mcp-client";
import { ApiClient } from "../api-client";
import { SseClient } from "../sse-client";
import type { ActivityEvent } from "../types";

/** Lazy store accessors to avoid circular dependency issues */
function getActivityStore() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./activity").useActivityStore;
}
function getServersStore() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./servers").useServersStore;
}

export interface ConnectionState {
  url: string;
  sessionId: string | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  mcpClient: McpClient | null;
  apiClient: ApiClient | null;
  sseClient: SseClient | null;
  connect: (url?: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  url: "http://localhost:3100",
  sessionId: null,
  connected: false,
  connecting: false,
  error: null,
  mcpClient: null,
  apiClient: null,
  sseClient: null,

  connect: async (url?: string) => {
    const targetUrl = url ?? get().url;
    set({ connecting: true, error: null, url: targetUrl });

    try {
      const mcp = new McpClient(targetUrl);
      const api = new ApiClient(targetUrl);
      const sse = new SseClient();

      // Initialize MCP session
      await mcp.connect();

      // Connect SSE for real-time events
      sse.connect(`${targetUrl}/events`);

      // Wire SSE events to activity store
      sse.onAny((event) => {
        try {
          getActivityStore().getState().addEvent({
            id: `${event.type}-${event.timestamp ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: event.type,
            timestamp: event.timestamp ?? Date.now(),
            data: (event.data as Record<string, unknown>) ?? {},
          } as ActivityEvent);
        } catch {
          // Store not ready yet
        }
      });

      // Wire server status events to servers store
      const refreshServers = () => {
        try {
          getServersStore().getState().fetchServers();
        } catch {
          // Store not ready yet
        }
      };
      sse.on("server:status", refreshServers);
      sse.on("server:added", refreshServers);
      sse.on("server:removed", refreshServers);

      set({
        connected: true,
        connecting: false,
        sessionId: mcp.currentSessionId,
        mcpClient: mcp,
        apiClient: api,
        sseClient: sse,
      });
    } catch (err) {
      set({
        connected: false,
        connecting: false,
        error: err instanceof Error ? err.message : String(err),
        mcpClient: null,
        apiClient: null,
        sseClient: null,
      });
    }
  },

  disconnect: async () => {
    const { mcpClient, sseClient } = get();
    try {
      sseClient?.disconnect();
      await mcpClient?.disconnect();
    } finally {
      set({
        connected: false,
        connecting: false,
        sessionId: null,
        mcpClient: null,
        apiClient: null,
        sseClient: null,
      });
    }
  },
}));
