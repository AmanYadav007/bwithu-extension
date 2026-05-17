export type BearState =
  | "hidden"
  | "spawning"
  | "intro"
  | "idle"
  | "blink"
  | "wave"
  | "drag"
  | "walk"
  | "listen"
  | "think"
  | "talk"
  | "happy"
  | "curious"
  | "searching"
  | "sleepy"
  | "sleep";

export interface AnimationConfig {
  imageSrc: string;
  frameCount: number;
  fps: number;
  loop: boolean;
}

export const COMPANION_NAME = "Bumi";

export const INTRO_TEXT = `Hi... I'm ${COMPANION_NAME}. This is my first day here.`;

export const animationConfigs: Record<Exclude<BearState, "hidden">, AnimationConfig> = {
  spawning: { imageSrc: "spawn.png", frameCount: 6, fps: 12, loop: false },
  intro: { imageSrc: "idle.png", frameCount: 4, fps: 8, loop: true },
  idle: { imageSrc: "idle.png", frameCount: 4, fps: 8, loop: true },
  blink: { imageSrc: "blink.png", frameCount: 3, fps: 12, loop: false },
  wave: { imageSrc: "wave.png", frameCount: 4, fps: 10, loop: false },
  drag: { imageSrc: "idle.png", frameCount: 4, fps: 12, loop: true },
  walk: { imageSrc: "idle.png", frameCount: 4, fps: 10, loop: true },
  listen: { imageSrc: "blink.png", frameCount: 3, fps: 5, loop: true },
  think: { imageSrc: "idle.png", frameCount: 4, fps: 5, loop: true },
  talk: { imageSrc: "wave.png", frameCount: 4, fps: 8, loop: true },
  happy: { imageSrc: "wave.png", frameCount: 4, fps: 12, loop: false },
  curious: { imageSrc: "idle.png", frameCount: 4, fps: 6, loop: true },
  searching: { imageSrc: "idle.png", frameCount: 4, fps: 9, loop: true },
  sleepy: { imageSrc: "idle.png", frameCount: 4, fps: 3, loop: true },
  sleep: { imageSrc: "idle.png", frameCount: 4, fps: 3, loop: true },
};
