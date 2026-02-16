import { create } from "zustand";
import type { ServerInfo, AddServerParams } from "../types";
import { useConnectionStore } from "./connection";

export interface ServersState {
  servers: ServerInfo[];
  loading: boolean;
  error: string | null;
  /** Whether initial data has been loaded at least once */
  initialized: boolean;
  fetchServers: () => Promise<void>;
  addServer: (config: AddServerParams) => Promise<void>;
  removeServer: (name: string) => Promise<void>;
  restartServer: (name: string) => Promise<void>;
  stopServer: (name: string) => Promise<void>;
  startServer: (name: string) => Promise<void>;
  updateServer: (params: Record<string, unknown>) => Promise<void>;
  updateServerStatus: (name: string, status: ServerInfo["status"]) => void;
  setServers: (servers: ServerInfo[]) => void;
}

/** Debounce timer for SSE-triggered refreshes */
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _refreshing = false;

export const useServersStore = create<ServersState>((set, get) => ({
  servers: [],
  loading: false,
  error: null,
  initialized: false,

  fetchServers: async () => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) return;

    // If already refreshing, debounce: schedule one more after current finishes
    if (_refreshing) {
      if (!_refreshTimer) {
        _refreshTimer = setTimeout(() => {
          _refreshTimer = null;
          get().fetchServers();
        }, 500);
      }
      return;
    }

    // Only show loading spinner on initial load (not background SSE refreshes)
    const isInitial = !get().initialized;
    if (isInitial) set({ loading: true, error: null });

    _refreshing = true;
    try {
      const servers = await mcp.listManagedServers();
      set({ servers, loading: false, initialized: true });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      _refreshing = false;
    }
  },

  addServer: async (config) => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) throw new Error("Not connected");
    await mcp.addManagedServer(config);
    // Refresh the list
    const servers = await mcp.listManagedServers();
    set({ servers });
  },

  removeServer: async (name) => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) throw new Error("Not connected");
    await mcp.removeManagedServer(name);
    // Refresh from backend (SSE also triggers refresh, but this ensures immediate update)
    const servers = await mcp.listManagedServers();
    set({ servers });
  },

  restartServer: async (name) => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) throw new Error("Not connected");
    await mcp.restartServer(name);
    // Refresh
    const servers = await mcp.listManagedServers();
    set({ servers });
  },

  stopServer: async (name) => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) throw new Error("Not connected");
    await mcp.stopServer(name);
    const servers = await mcp.listManagedServers();
    set({ servers });
  },

  startServer: async (name) => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) throw new Error("Not connected");
    await mcp.startServer(name);
    const servers = await mcp.listManagedServers();
    set({ servers });
  },

  updateServer: async (params) => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) throw new Error("Not connected");
    await mcp.updateServer(params);
    const servers = await mcp.listManagedServers();
    set({ servers });
  },

  updateServerStatus: (name, status) => {
    set((state) => ({
      servers: state.servers.map((s) =>
        s.name === name ? { ...s, status } : s
      ),
    }));
  },

  setServers: (servers) => set({ servers }),
}));
