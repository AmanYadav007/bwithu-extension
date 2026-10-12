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

export const COMPANION_NAME = "your companion";

export const INTRO_TEXT = `Hi... I'm ${COMPANION_NAME}. This is my first day here.`;
