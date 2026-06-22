import type { BearState } from "./animationStates";

export type BearMood = "calm" | "curious" | "sleepy" | "excited" | "focused";

export type BehaviorEvent =
  | "spawned"
  | "clicked"
  | "dragged"
  | "hovered"
  | "voiceStarted"
  | "voiceEnded"
  | "messageStarted"
  | "messageEnded"
  | "idleTimeout"
  | "wanderStarted"
  | "wanderEnded"
  | "searchStarted"
  | "searchEnded"
  | "success"
  | "error"
  | "scroll"
  | "sleepTimeout";

interface WeightedState {
  state: BearState;
  weight: number;
}

export function nextBehaviorState(current: BearState, event: BehaviorEvent, mood: BearMood = "calm"): BearState {
  if (current === "hidden" || current === "spawning" || current === "intro") return current;

  switch (event) {
    case "clicked":
      return "wave";
    case "dragged":
      return "drag";
    case "hovered":
      return current === "idle" ? "curious" : current;
    case "voiceStarted":
      return "listen";
    case "voiceEnded":
    case "messageStarted":
      return "think";
    case "messageEnded":
      return "talk";
    case "idleTimeout":
      return chooseIdleBehavior(mood);
    case "wanderStarted":
      return "walk";
    case "wanderEnded":
      return "idle";
    case "searchStarted":
      return "searching";
    case "searchEnded":
    case "success":
      return "happy";
    case "error":
      return "curious";
    case "scroll":
      return current === "idle" ? "curious" : current;
    case "sleepTimeout":
      return "sleepy";
    case "spawned":
    default:
      return current;
  }
}

export function nextMood(current: BearMood, event: BehaviorEvent): BearMood {
  switch (event) {
    case "clicked":
    case "success":
    case "spawned":
      return "excited";
    case "dragged":
    case "hovered":
    case "scroll":
      return "curious";
    case "voiceStarted":
    case "messageStarted":
    case "searchStarted":
      return "focused";
    case "sleepTimeout":
      return "sleepy";
    case "error":
      return "calm";
    case "voiceEnded":
    case "messageEnded":
    case "searchEnded":
      return current === "sleepy" ? "calm" : current;
    default:
      return current;
  }
}

export function environmentalMood(hour = new Date().getHours(), idleMs = 0): BearMood {
  if (idleMs > 12 * 60 * 1000) return "sleepy";
  if (hour >= 23 || hour < 6) return "sleepy";
  if (hour >= 18 || hour < 9) return "calm";
  return "curious";
}

export function stateDuration(state: BearState) {
  switch (state) {
    case "blink":
      return 420;
    case "wave":
    case "happy":
      return 1200;
    case "drag":
    case "curious":
      return 1400;
    case "walk":
      return 1800;
    case "sleepy":
      return 2600;
    case "talk":
      return 2200;
    case "think":
    case "searching":
      return 1600;
    default:
      return 0;
  }
}

function chooseIdleBehavior(mood: BearMood): BearState {
  const weights: Record<BearMood, WeightedState[]> = {
    calm: [
      { state: "curious", weight: 3 },
      { state: "idle", weight: 4 },
      { state: "sleepy", weight: 1 },
    ],
    curious: [
      { state: "curious", weight: 6 },
      { state: "walk", weight: 3 },
      { state: "wave", weight: 1 },
      { state: "idle", weight: 2 },
    ],
    sleepy: [
      { state: "sleepy", weight: 7 },
      { state: "idle", weight: 3 },
      { state: "curious", weight: 2 },
    ],
    excited: [
      { state: "happy", weight: 4 },
      { state: "wave", weight: 3 },
      { state: "curious", weight: 2 },
    ],
    focused: [
      { state: "think", weight: 4 },
      { state: "curious", weight: 2 },
      { state: "idle", weight: 2 },
    ],
  };

  const pool = weights[mood];
  const total = pool.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of pool) {
    roll -= item.weight;
    if (roll <= 0) return item.state;
  }
  return "blink";
}
