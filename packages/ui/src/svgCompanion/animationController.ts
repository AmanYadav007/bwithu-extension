import type { BearState } from "@bwithu/shared";

export type SvgCompanionState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "greeting"
  | "reacting";

const VALID_STATES: readonly SvgCompanionState[] = [
  "idle",
  "listening",
  "thinking",
  "speaking",
  "greeting",
  "reacting",
];

const BLINKING_STATES: readonly SvgCompanionState[] = [
  "idle",
  "listening",
  "thinking",
  "greeting",
  "reacting",
];

type MouthShape = "open" | "half" | "smile";

const MOUTH_CLASS: Record<MouthShape, string> = {
  open: "bwithu-mouth-open",
  half: "bwithu-mouth-half",
  smile: "bwithu-mouth-smile",
};

/**
 * Maps the extension's existing BearState (driven by the real voice lifecycle)
 * to the SVG companion's animation states. Every case resolves, so unknown or
 * future states can never crash the renderer.
 */
export function mapBearStateToSvgState(state: BearState): SvgCompanionState {
  switch (state) {
    case "listen":
      return "listening";
    case "think":
    case "searching":
      return "thinking";
    case "talk":
      return "speaking";
    case "wave":
    case "intro":
      return "greeting";
    case "happy":
      return "reacting";
    case "idle":
    case "blink":
    case "curious":
    case "sleepy":
    case "sleep":
    case "drag":
    case "walk":
    case "hidden":
    case "spawning":
      return "idle";
  }
}

/**
 * Deterministic, interruption-safe animation controller for the layered SVG
 * companion. Kept fully separate from the artwork: it only toggles CSS classes
 * and mouth-layer visibility on the host <svg>; it never edits artwork paths.
 *
 * Contract:
 * - applyState is idempotent: re-applying the current state is a no-op.
 * - Every applyState first cancels all scheduled timers and resets mouth
 *   classes, so two animations can never run at the same time.
 * - Invalid input and prefers-reduced-motion resolve to a static neutral frame.
 * - dispose() releases every timer and class this controller owns.
 */
export class SvgAnimationController {
  private state: SvgCompanionState | null = null;
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  constructor(private readonly root: SVGSVGElement) {}

  applyState(next: SvgCompanionState): void {
    if (!VALID_STATES.includes(next)) next = "idle";
    if (next === this.state) return;
    this.cancelScheduled();
    if (this.state) this.root.classList.remove(`bwithu-svg-state-${this.state}`);
    this.state = next;
    this.root.classList.add(`bwithu-svg-state-${next}`);

    if (prefersReducedMotion()) return; // static frame; mouth stays neutral

    switch (next) {
      case "idle":
      case "listening":
      case "thinking":
        this.scheduleBlink();
        break;
      case "speaking":
        this.cycleMouth();
        break;
      case "greeting":
      case "reacting":
        this.setMouth("smile");
        this.scheduleBlink();
        break;
    }
  }

  dispose(): void {
    this.cancelScheduled();
    if (this.state) this.root.classList.remove(`bwithu-svg-state-${this.state}`);
    this.state = null;
  }

  private cancelScheduled(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.setMouth(null);
  }

  private setMouth(shape: MouthShape | null): void {
    for (const className of Object.values(MOUTH_CLASS)) this.root.classList.remove(className);
    if (shape) this.root.classList.add(MOUTH_CLASS[shape]);
  }

  /** Cycles open → half → closed with timing jitter while the state stays "speaking". */
  private cycleMouth(): void {
    const step = () => {
      if (this.state !== "speaking") return; // interrupted: stop, never fight a newer state
      const roll = Math.random();
      const shape: MouthShape | null = roll < 0.4 ? "open" : roll < 0.72 ? "half" : null;
      this.setMouth(shape);
      const delay = shape === null ? 110 + Math.random() * 130 : 90 + Math.random() * 80;
      this.timers.push(setTimeout(step, delay));
    };
    step();
  }

  private scheduleBlink(): void {
    const blink = () => {
      if (this.state === null || !BLINKING_STATES.includes(this.state)) return;
      this.root.classList.add("bwithu-blink");
      this.timers.push(setTimeout(() => this.root.classList.remove("bwithu-blink"), 140));
      this.timers.push(setTimeout(blink, 2400 + Math.random() * 3600));
    };
    this.timers.push(setTimeout(blink, 1400 + Math.random() * 2600));
  }
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
    );
  } catch {
    return false;
  }
}
