import { create } from "zustand";
import type { ActivityEvent } from "../types";

export interface ActivityState {
  events: ActivityEvent[];
  maxEvents: number;
  addEvent: (event: ActivityEvent) => void;
  clearEvents: () => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  events: [],
  maxEvents: 500,

  addEvent: (event) =>
    set((state) => ({
      events: [event, ...state.events].slice(0, state.maxEvents),
    })),

  clearEvents: () => set({ events: [] }),
}));
