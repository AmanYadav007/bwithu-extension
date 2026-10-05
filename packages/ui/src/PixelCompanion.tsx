import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { BearMood, BearState, CompanionAvatar } from "@bwithu/shared";
import { NEUTRAL_POSE, RIG_SIZE, renderRig } from "./pixelRig";
import type { MouthShape, RigPose } from "./pixelRig";
import { PIXEL_COMPANIONS } from "./pixelCompanions";

const TICK_MS = 100;

type Emotion = "happy" | "sad" | "surprised" | "neutral";

/** Rough feeling of a reply, so the face can match what the companion is saying. */
function emotionOf(text: string): Emotion {
  if (!text) return "neutral";
  if (/\b(sorry|sad|unfortunately|miss you|tough|oops|can't|cannot|hard day)\b/i.test(text)) return "sad";
  if (/\b(wow|whoa|no way|amazing|incredible)\b|\boh!/i.test(text)) return "surprised";
  if (/\b(haha|hehe|yay|love|great|awesome|glad|happy|fun|cute|proud|sunshine|sweet)\b|!|😊|😄|❤|🥰/iu.test(text)) return "happy";
  return "neutral";
}

const VISEMES: Record<Emotion, MouthShape[]> = {
  neutral: ["open", "wide", "o", "open", "neutral", "open", "wide", "smile"],
  happy: ["grin", "open", "wide", "grin", "smile", "open"],
  sad: ["open", "wavy", "open", "neutral", "o"],
  surprised: ["o", "wide", "open", "o", "open"],
};

const GAZES: Array<{ x: number; y: number; turn: number }> = [
  { x: 0, y: 0, turn: 0 },
  { x: 0, y: 0, turn: 0 },
  { x: 0, y: 0, turn: 0 },
  { x: -1, y: 0, turn: 0 },
  { x: 1, y: 0, turn: 0 },
  { x: -1, y: 0, turn: -1 },
  { x: 1, y: 0, turn: 1 },
  { x: 0, y: -1, turn: 0 },
  { x: 1, y: -1, turn: 0 },
  { x: -1, y: 1, turn: 0 },
];

interface Inputs {
  state: BearState;
  mood: BearMood;
  emotion: Emotion;
  lookAtDisplay: boolean;
  pointerGaze: { x: number; y: number; turn: number; at: number } | null;
  still: boolean;
}

interface Brain {
  frame: number;
  lastState: BearState | null;
  stateSince: number;
  nextBlink: number;
  blinkUntil: number;
  gaze: { x: number; y: number; turn: number };
  nextGaze: number;
  mouth: MouthShape;
  nextMouth: number;
  nodUntil: number;
  nextNod: number;
  browUntil: number;
  displaySince: number;
}

function newBrain(now: number): Brain {
  return {
    frame: 0,
    lastState: null,
    stateSince: now,
    nextBlink: now + 1200 + Math.random() * 2000,
    blinkUntil: 0,
    gaze: GAZES[0],
    nextGaze: now + 1500,
    mouth: "open",
    nextMouth: now,
    nodUntil: 0,
    nextNod: now + 1800,
    browUntil: 0,
    displaySince: 0,
  };
}

/** Decides the next pose from the conversation state, the pointer and a few timers. */
function think(brain: Brain, now: number, input: Inputs): RigPose {
  brain.frame += 1;
  if (input.state !== brain.lastState) {
    brain.lastState = input.state;
    brain.stateSince = now;
  }
  const inState = now - brain.stateSince;
  const pose: RigPose = { ...NEUTRAL_POSE, frame: brain.frame };

  if (now >= brain.nextBlink) {
    brain.blinkUntil = now + 130;
    // Now and then a quick double blink.
    brain.nextBlink = Math.random() < 0.15 ? now + 330 : now + 2200 + Math.random() * 3200;
  }
  const blinking = now < brain.blinkUntil;
  if (input.still) {
    if (blinking) pose.eyes = "closed";
    return pose;
  }

  const sleepy = input.state === "sleepy" || input.state === "sleep";
  const breathPeriod = input.state === "talk" ? 900 : sleepy ? 4000 : 2800;
  pose.bodyY = now % breathPeriod < breathPeriod / 2 ? 0 : 1;

  if (now >= brain.nextGaze) {
    brain.gaze = GAZES[Math.floor(Math.random() * GAZES.length)];
    brain.nextGaze = now + 1600 + Math.random() * 2600;
  }
  const pointer = input.pointerGaze && now - input.pointerGaze.at < 2500 ? input.pointerGaze : null;
  const gaze = pointer ?? brain.gaze;
  pose.lookX = gaze.x;
  pose.lookY = gaze.y;
  pose.turn = gaze.turn;
  const faceUser = () => {
    if (pointer) return;
    pose.lookX = 0;
    pose.lookY = 0;
    pose.turn = 0;
  };

  switch (input.state) {
    case "talk": {
      if (now >= brain.nextMouth) {
        const shapes = VISEMES[input.emotion];
        brain.mouth = shapes[Math.floor(Math.random() * shapes.length)];
        brain.nextMouth = now + 100 + Math.random() * 90;
      }
      pose.mouth = brain.mouth;
      pose.headY = brain.mouth === "wide" ? -1 : 0;
      faceUser();
      if (now >= brain.browUntil + 1500 && Math.random() < 0.04) brain.browUntil = now + 400;
      if (now < brain.browUntil) pose.brows = "up";
      if (input.emotion === "happy") {
        pose.blush = true;
        if (inState % 2600 < 700) pose.eyes = "happy";
      } else if (input.emotion === "sad") {
        pose.brows = "worried";
      } else if (input.emotion === "surprised" && inState < 900) {
        pose.eyes = "wide";
        pose.brows = "up";
        pose.emote = "exclaim";
      }
      break;
    }
    case "listen": {
      pose.mouth = "neutral";
      pose.brows = inState < 700 ? "up" : "neutral";
      faceUser();
      if (now >= brain.nextNod) {
        brain.nodUntil = now + 260;
        brain.nextNod = now + 2200 + Math.random() * 2000;
      }
      pose.headY = now < brain.nodUntil ? 1 : 0;
      // Every few seconds tilt the head a little, like someone paying attention.
      pose.tilt = Math.floor(now / 3200) % 3 === 1 ? 1 : 0;
      break;
    }
    case "think":
      pose.lookX = 1;
      pose.lookY = -1;
      pose.turn = 1;
      pose.brows = "quizzical";
      pose.mouth = "hmm";
      pose.emote = "think";
      break;
    case "searching":
      pose.lookX = Math.floor(now / 450) % 2 ? 1 : -1;
      pose.lookY = 0;
      pose.turn = pose.lookX;
      pose.brows = "focused";
      pose.mouth = "neutral";
      pose.emote = "think";
      break;
    case "happy":
    case "wave":
    case "intro":
      pose.eyes = "happy";
      pose.mouth = "grin";
      pose.blush = true;
      pose.brows = "up";
      pose.emote = inState < 1600 ? (input.state === "wave" ? "sparkle" : "heart") : "none";
      if (inState < 800) pose.bodyY = Math.floor(inState / 200) % 2 ? -1 : 0;
      break;
    case "spawning":
      if (inState < 600) {
        pose.eyes = "wide";
        pose.mouth = "o";
        pose.brows = "up";
        pose.emote = "exclaim";
        faceUser();
      } else if (inState < 2200) {
        pose.eyes = "happy";
        pose.mouth = "grin";
        pose.blush = true;
        pose.emote = "sparkle";
        if (inState < 1400) pose.bodyY = Math.floor(inState / 200) % 2 ? -1 : 0;
      }
      break;
    case "curious":
      pose.brows = "quizzical";
      pose.tilt = 1;
      pose.lookX = 1;
      pose.turn = 1;
      pose.mouth = "neutral";
      pose.emote = inState < 1400 ? "question" : "none";
      break;
    case "drag":
      pose.eyes = "wide";
      pose.mouth = "o";
      pose.brows = "worried";
      pose.emote = "sweat";
      break;
    case "sleepy":
      pose.eyes = "half";
      pose.mouth = "neutral";
      pose.emote = "zzz";
      pose.headY = Math.floor(now / 2600) % 2;
      break;
    case "sleep":
      pose.eyes = "closed";
      pose.mouth = "neutral";
      pose.emote = "zzz";
      pose.headY = 1;
      break;
    default:
      if (input.mood === "excited" && now % 7000 < 900) {
        pose.eyes = "happy";
        pose.mouth = "grin";
      } else if (input.mood === "sleepy" && now % 6000 < 2400) {
        pose.eyes = "half";
      }
  }

  // Showing something on the display: react, look up at it, glance back now and then.
  if (input.lookAtDisplay) {
    if (!brain.displaySince) brain.displaySince = now;
    const shown = now - brain.displaySince;
    if (shown < 700) {
      pose.eyes = "wide";
      pose.brows = "up";
      pose.emote = "exclaim";
    }
    if (shown % 3600 < 2400 && !pointer) {
      pose.lookX = 0;
      pose.lookY = -1;
      pose.turn = 0;
    }
  } else {
    brain.displaySince = 0;
  }

  if (blinking && (pose.eyes === "open" || pose.eyes === "half" || pose.eyes === "wide")) pose.eyes = "closed";
  return pose;
}

interface PixelCompanionProps {
  avatar: CompanionAvatar;
  state: BearState;
  mood?: BearMood;
  /** What the companion is saying right now; its tone drives the expression. */
  speechText?: string;
  /** True while a display popup is open, so the companion looks at it. */
  lookAtDisplay?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  /** Fixed pixel scale instead of fitting (used on the picker). */
  scale?: number;
  /** Only blink; no other motion. */
  still?: boolean;
}

/** Animated pixel companion. Scales by whole pixels only so the art stays crisp. */
export default function PixelCompanion({
  avatar,
  state,
  mood = "calm",
  speechText = "",
  lookAtDisplay = false,
  maxWidth = RIG_SIZE * 4,
  maxHeight = RIG_SIZE * 4,
  scale: fixedScale,
  still = false,
}: PixelCompanionProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scale = fixedScale ?? Math.max(1, Math.floor(Math.min(maxWidth / RIG_SIZE, maxHeight / RIG_SIZE)));
  const inputsRef = useRef<Inputs>({ state, mood, emotion: "neutral", lookAtDisplay, pointerGaze: null, still });

  useEffect(() => {
    const inputs = inputsRef.current;
    inputs.state = state;
    inputs.mood = mood;
    inputs.emotion = emotionOf(speechText);
    inputs.lookAtDisplay = lookAtDisplay;
    inputs.still = still;
  }, [state, mood, speechText, lookAtDisplay, still]);

  // Eyes (and at larger distances the head) follow the pointer.
  useEffect(() => {
    if (still) return undefined;
    const handleMove = (event: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width * 0.5);
      const dy = event.clientY - (rect.top + rect.height * 0.44);
      inputsRef.current.pointerGaze = {
        x: dx > rect.width * 0.12 ? 1 : dx < -rect.width * 0.12 ? -1 : 0,
        y: dy < -rect.height * 0.18 ? -1 : dy > rect.height * 0.3 ? 1 : 0,
        turn: Math.abs(dx) > rect.width * 0.38 ? Math.sign(dx) : 0,
        at: performance.now(),
      };
    };
    window.addEventListener("pointermove", handleMove);
    return () => window.removeEventListener("pointermove", handleMove);
  }, [still]);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return undefined;
    const brain = newBrain(performance.now());
    let lastKey = "";
    const draw = () => {
      const pose = think(brain, performance.now(), inputsRef.current);
      const key = JSON.stringify(pose.emote === "none" ? { ...pose, frame: 0 } : pose);
      if (key === lastKey) return;
      lastKey = key;
      context.putImageData(new ImageData(renderRig(avatar, pose), RIG_SIZE, RIG_SIZE), 0, 0);
    };
    draw();
    const timer = setInterval(draw, TICK_MS);
    return () => clearInterval(timer);
  }, [avatar]);

  const size = RIG_SIZE * scale;
  return (
    <div
      className="bwithu-pixel-companion"
      data-state={state}
      style={{ width: size, height: size, "--px": `${scale}px` } as CSSProperties}
      role="img"
      aria-label={`${PIXEL_COMPANIONS[avatar].label} companion`}
    >
      <canvas ref={canvasRef} width={RIG_SIZE} height={RIG_SIZE} style={{ width: size, height: size }} />
    </div>
  );
}

interface FittedPixelCompanionProps {
  avatar: CompanionAvatar;
  state: BearState;
  mood?: BearMood;
  speechText?: string;
  lookAtDisplay?: boolean;
}

/** Fills its parent and refits the companion whenever the space changes (e.g. a sheet opens). */
export function FittedPixelCompanion(props: FittedPixelCompanionProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="bwithu-pixel-fit">
      {box.height > 0 && <PixelCompanion {...props} maxWidth={box.width} maxHeight={box.height * 0.78} />}
    </div>
  );
}
