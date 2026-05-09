export type BirthState = "portal" | "summon" | "spawn" | "awaken" | "intro" | "idle";

export type IdleState =
  | "idle"
  | "blink"
  | "lookLeft"
  | "lookRight"
  | "wave"
  | "bounce"
  | "sleepy";

export interface AnimationConfig {
  imageSrc: string;
  frameCount: number;
  fps: number;
  loop: boolean;
}

export const BIRTH_TIMINGS: Record<Exclude<BirthState, "idle">, number> = {
  portal: 800,
  summon: 600,
  spawn: 1200,
  awaken: 1500,
  intro: 3000,
};

// [state, weight] — higher weight = more likely to be picked
export const IDLE_BEHAVIORS: [IdleState, number][] = [
  ["blink", 35],
  ["lookLeft", 15],
  ["lookRight", 15],
  ["wave", 15],
  ["bounce", 10],
  ["sleepy", 10],
];

export const IDLE_DURATIONS: Record<IdleState, number> = {
  idle: Infinity,
  blink: 400,
  lookLeft: 700,
  lookRight: 700,
  wave: 1200,
  bounce: 600,
  sleepy: 2000,
};

// Paths are resolved via chrome.runtime.getURL in components.
// Place sprite PNGs in public/ (e.g. public/idle.png → idle.png).
export const animationConfigs: Record<string, AnimationConfig> = {
  idle:      { imageSrc: "idle.png",  frameCount: 4, fps: 8,  loop: true  },
  blink:     { imageSrc: "blink.png", frameCount: 3, fps: 12, loop: false },
  lookLeft:  { imageSrc: "idle.png",  frameCount: 2, fps: 6,  loop: false },
  lookRight: { imageSrc: "idle.png",  frameCount: 2, fps: 6,  loop: false },
  wave:      { imageSrc: "wave.png",  frameCount: 4, fps: 10, loop: false },
  bounce:    { imageSrc: "idle.png",  frameCount: 4, fps: 12, loop: false },
  sleepy:    { imageSrc: "idle.png",  frameCount: 4, fps: 4,  loop: true  },
  spawn:     { imageSrc: "spawn.png", frameCount: 6, fps: 12, loop: false },
  awaken:    { imageSrc: "blink.png", frameCount: 3, fps: 8,  loop: false },
  intro:     { imageSrc: "wave.png",  frameCount: 4, fps: 10, loop: true  },
};
