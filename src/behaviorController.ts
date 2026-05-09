import type { BearState } from "./animationStates";

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
  | "scroll"
  | "sleepTimeout";

export function nextBehaviorState(current: BearState, event: BehaviorEvent): BearState {
  if (current === "hidden" || current === "spawning" || current === "intro") return current;

  switch (event) {
    case "clicked":
      return "wave";
    case "dragged":
      return "curious";
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
      return Math.random() > 0.55 ? "blink" : "curious";
    case "wanderStarted":
      return "walk";
    case "wanderEnded":
      return "idle";
    case "scroll":
      return current === "idle" ? "curious" : current;
    case "sleepTimeout":
      return "sleep";
    case "spawned":
    default:
      return current;
  }
}

export function stateDuration(state: BearState) {
  switch (state) {
    case "blink":
      return 420;
    case "wave":
    case "happy":
      return 1200;
    case "curious":
      return 1400;
    case "talk":
      return 2200;
    case "think":
      return 1600;
    default:
      return 0;
  }
}
