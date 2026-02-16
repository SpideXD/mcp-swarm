import { create } from "zustand";
import type { ProfileInfo, CreateProfileParams } from "../types";
import { useConnectionStore } from "./connection";
import { useServersStore } from "./servers";

export interface ProfilesState {
  profiles: ProfileInfo[];
  loading: boolean;
  error: string | null;
  fetchProfiles: () => Promise<void>;
  activateProfile: (name: string) => Promise<string>;
  deactivateProfile: (name: string) => Promise<string>;
  createProfile: (params: CreateProfileParams) => Promise<void>;
  deleteProfile: (name: string) => Promise<void>;
}

export const useProfilesStore = create<ProfilesState>((set) => ({
  profiles: [],
  loading: false,
  error: null,

  fetchProfiles: async () => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) return;
    set({ loading: true, error: null });
    try {
      const profiles = await mcp.listProfiles();
      set({ profiles, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  activateProfile: async (name) => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) throw new Error("Not connected");
    const result = await mcp.activateProfile(name);
    // Refresh both profiles and servers
    const profiles = await mcp.listProfiles();
    set({ profiles });
    useServersStore.getState().fetchServers();
    return result;
  },

  deactivateProfile: async (name) => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) throw new Error("Not connected");
    const result = await mcp.deactivateProfile(name);
    // Refresh both profiles and servers
    const profiles = await mcp.listProfiles();
    set({ profiles });
    useServersStore.getState().fetchServers();
    return result;
  },

  createProfile: async (params) => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) throw new Error("Not connected");
    await mcp.createProfile(params);
    const profiles = await mcp.listProfiles();
    set({ profiles });
  },

  deleteProfile: async (name) => {
    const mcp = useConnectionStore.getState().mcpClient;
    if (!mcp) throw new Error("Not connected");
    await mcp.deleteProfile(name);
    const profiles = await mcp.listProfiles();
    set({ profiles });
  },
}));
