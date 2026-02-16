import { create } from "zustand";
import type { SessionInfo } from "../types";
import { useConnectionStore } from "./connection";

export interface SessionsState {
  sessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  fetchSessions: () => Promise<void>;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [],
  loading: false,
  error: null,

  fetchSessions: async () => {
    const api = useConnectionStore.getState().apiClient;
    if (!api) return;
    set({ loading: true, error: null });
    try {
      const sessions = await api.getSessions();
      set({ sessions, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));
