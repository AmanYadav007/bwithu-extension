import { create } from "zustand";
import { environmentalMood, nextMood } from "./behaviorController";
import type { BearMood, BehaviorEvent } from "./behaviorController";

interface BearStore {
  mood: BearMood;
  lastInteractionAt: number;
  dispatchMoodEvent: (event: BehaviorEvent) => void;
  refreshEnvironmentalMood: () => void;
}

export const useBearStore = create<BearStore>((set, get) => ({
  mood: environmentalMood(),
  lastInteractionAt: Date.now(),
  dispatchMoodEvent: (event) => {
    const interactiveEvent = event !== "idleTimeout" && event !== "wanderEnded";
    set((state) => ({
      mood: nextMood(state.mood, event),
      lastInteractionAt: interactiveEvent ? Date.now() : state.lastInteractionAt,
    }));
  },
  refreshEnvironmentalMood: () => {
    const idleMs = Date.now() - get().lastInteractionAt;
    set({ mood: environmentalMood(new Date().getHours(), idleMs) });
  },
}));
