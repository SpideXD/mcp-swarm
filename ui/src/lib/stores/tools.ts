import { create } from "zustand";
import type { ToolInfo } from "../types";
import { useConnectionStore } from "./connection";
import { extractText } from "../utils/parse-mcp-response";

export interface ToolsState {
  tools: ToolInfo[];
  loading: boolean;
  error: string | null;
  lastCallResult: string | null;
  fetchTools: () => Promise<void>;
  callTool: (
    server: string,
    tool: string,
    args: Record<string, unknown>
  ) => Promise<string>;
}

export const useToolsStore = create<ToolsState>((set) => ({
  tools: [],
  loading: false,
  error: null,
  lastCallResult: null,

  fetchTools: async () => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) return;
    set({ loading: true, error: null });
    try {
      // First get the list of servers to know which ones are connected
      const servers = await mcp.listManagedServers();
      const connected = servers.filter((s) => s.status === "connected");

      // Fetch tools per connected server in detail mode (gives descriptions + params)
      const allTools: ToolInfo[] = [];
      const results = await Promise.allSettled(
        connected.map((s) => mcp.listServerTools(s.name))
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          allTools.push(...result.value);
        }
      }

      set({ tools: allTools, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  callTool: async (server, tool, args) => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) throw new Error("Not connected");
    const result = await mcp.callServerTool(server, tool, args);
    const text = extractText(result);
    set({ lastCallResult: text });
    return text;
  },
}));
