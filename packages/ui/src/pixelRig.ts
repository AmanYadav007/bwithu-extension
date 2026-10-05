/**
 * Layered pixel-art rig for the companions. Every part (hair, face, eyes, brows, mouth,
 * glasses, body) is drawn separately at native resolution so the character can look around,
 * turn and tilt its head, blink, talk and emote. Pure drawing code: no DOM, no React.
 */
import type { CompanionAvatar } from "@bwithu/shared";

export const RIG_SIZE = 64;
/** Where the 48x56 bust sits on the 64x64 canvas; the space above/right is for emotes. */
const BUST_X = 8;
const BUST_Y = 8;
const BUST_W = 48;
const BUST_H = 56;

export type EyeShape = "open" | "closed" | "happy" | "wide" | "half";
export type BrowShape = "neutral" | "up" | "worried" | "focused" | "quizzical";
export type MouthShape = "neutral" | "smile" | "grin" | "open" | "wide" | "o" | "hmm" | "wavy";
export type Emote = "none" | "heart" | "exclaim" | "question" | "think" | "zzz" | "sparkle" | "sweat" | "note";

export interface RigPose {
  /** Whole-head nudge in pixels (-1..1). */
  headX: number;
  headY: number;
  /** Shifts face features and fringe sideways to fake a head turn (-1..1). */
  turn: number;
  /** Shears the top of the head sideways to fake a tilt (-1..1). */
  tilt: number;
  /** Breathing: moves the whole bust down a pixel. */
  bodyY: number;
  /** Where the eyes look (-1..1 each). */
  lookX: number;
  lookY: number;
  eyes: EyeShape;
  /** Optional different shape for the right eye (wink). */
  rightEye?: EyeShape;
  brows: BrowShape;
  mouth: MouthShape;
  blush: boolean;
  emote: Emote;
  /** Animation frame counter for emotes. */
  frame: number;
}

export const NEUTRAL_POSE: RigPose = {
  headX: 0,
  headY: 0,
  turn: 0,
  tilt: 0,
  bodyY: 0,
  lookX: 0,
  lookY: 0,
  eyes: "open",
  brows: "neutral",
  mouth: "smile",
  blush: false,
  emote: "none",
  frame: 0,
};

type RGB = readonly [number, number, number];

function hex(value: string): RGB {
  return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
}

class Layer {
  readonly data: Uint8ClampedArray<ArrayBuffer>;

  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  set(x: number, y: number, color: RGB) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = color[0];
    this.data[i + 1] = color[1];
    this.data[i + 2] = color[2];
    this.data[i + 3] = 255;
  }

  has(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.data[(y * this.width + x) * 4 + 3] > 0;
  }

  span(y: number, left: number, right: number, color: RGB) {
    for (let x = left; x <= right; x += 1) this.set(x, y, color);
  }

  /** Copies opaque pixels onto `target`; `shift` lets rows move independently (for tilt). */
  drawOnto(target: Layer, dx: number, dy: number, shift: (y: number) => number = () => 0) {
    for (let y = 0; y < this.height; y += 1) {
      const rowShift = shift(y);
      for (let x = 0; x < this.width; x += 1) {
        const i = (y * this.width + x) * 4;
        if (this.data[i + 3] === 0) continue;
        target.set(x + dx + rowShift, y + dy, [this.data[i], this.data[i + 1], this.data[i + 2]]);
      }
    }
  }
}

interface Palette {
  skin: RGB;
  skinShade: RGB;
  skinDeep: RGB;
  blush: RGB;
  hair: RGB;
  hairDark: RGB;
  hairMid: RGB;
  hairLight: RGB;
  hairShine: RGB;
  eyeWhite: RGB;
  iris: RGB;
  irisDark: RGB;
  irisLight: RGB;
  lash: RGB;
  mouthLine: RGB;
  mouthInside: RGB;
  tongue: RGB;
  glasses: RGB;
  cloth: RGB;
  clothDark: RGB;
  clothLight: RGB;
  accent: RGB;
}

interface CharacterDef {
  palette: Palette;
  glasses: "round" | "square";
  hairBack: (layer: Layer, p: Palette) => void;
  hairFront: (layer: Layer, p: Palette) => void;
  clothing: (layer: Layer, p: Palette) => void;
  /** Drawn on the head after the face, before the fringe (ears, earrings). */
  headDetails: (layer: Layer, p: Palette) => void;
}

// ---------- Shared anatomy (bust coordinates, 48x56, face centred between x=23 and x=24) ----------

const FACE_ROWS: Record<number, number> = {
  11: 7, 12: 9, 13: 10, 14: 11, 15: 11, 16: 11, 17: 11, 18: 11, 19: 11, 20: 11, 21: 11, 22: 11,
  23: 11, 24: 11, 25: 11, 26: 11, 27: 11, 28: 11, 29: 10, 30: 10, 31: 9, 32: 8, 33: 6, 34: 4,
};

const BODY_ROWS: Record<number, number> = {
  36: 6, 37: 9, 38: 13, 39: 16, 40: 18, 41: 19, 42: 20, 43: 21, 44: 22,
};

function halfSpan(half: number): [number, number] {
  return [24 - half, 23 + half];
}

function forRows(rows: Record<number, number>, fn: (y: number, left: number, right: number) => void) {
  for (const [key, half] of Object.entries(rows)) {
    const [left, right] = halfSpan(half);
    fn(Number(key), left, right);
  }
}

/** Paints an outline colour on every pixel of `mask` that touches the outside. */
function outline(layer: Layer, mask: Layer, color: RGB) {
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (!mask.has(x, y)) continue;
      if (!mask.has(x - 1, y) || !mask.has(x + 1, y) || !mask.has(x, y - 1) || !mask.has(x, y + 1)) {
        layer.set(x, y, color);
      }
    }
  }
}

function drawFace(head: Layer, p: Palette) {
  const mask = new Layer(BUST_W, BUST_H);
  forRows(FACE_ROWS, (y, left, right) => {
    mask.span(y, left, right, p.skin);
    head.span(y, left, right, p.skin);
    // Light from the upper left: shade the right cheek.
    if (y >= 19) {
      head.set(right - 1, y, p.skinShade);
      if (y >= 24) head.set(right - 2, y, p.skinShade);
    }
  });
  outline(head, mask, p.skinDeep);
}

function drawNeck(body: Layer, p: Palette) {
  for (let y = 32; y <= 38; y += 1) {
    body.span(y, 20, 27, p.skinShade);
    body.set(20, y, p.skinDeep);
    body.set(27, y, p.skinDeep);
  }
  // Shadow under the chin.
  body.span(33, 21, 26, p.skinDeep);
  body.span(34, 21, 26, p.skinDeep);
}

function drawTorso(body: Layer, p: Palette) {
  const mask = new Layer(BUST_W, BUST_H);
  forRows(BODY_ROWS, (y, left, right) => mask.span(y, left, right, p.cloth));
  for (let y = 45; y < BUST_H; y += 1) mask.span(y, 2, 45, p.cloth);
  mask.drawOnto(body, 0, 0);
  outline(body, mask, p.clothDark);
  // Arms hanging at the sides.
  for (let y = 44; y < BUST_H; y += 1) {
    body.set(8, y, p.clothDark);
    body.set(39, y, p.clothDark);
  }
  // Soft folds.
  for (let i = 0; i < 6; i += 1) {
    body.set(12 + i, 46 + i, p.clothDark);
    body.set(35 - i, 46 + i, p.clothDark);
  }
  // Shoulder highlights.
  body.span(40, 9, 13, p.clothLight);
  body.span(41, 7, 10, p.clothLight);
}

function eyeBox(side: "left" | "right", turn: number) {
  return { x: (side === "left" ? 16 : 27) + turn, y: 21 };
}

function drawEye(head: Layer, p: Palette, side: "left" | "right", shape: EyeShape, pose: RigPose) {
  const { x, y } = eyeBox(side, pose.turn);
  const lookX = Math.max(-1, Math.min(1, Math.round(pose.lookX)));
  const lookY = Math.max(-1, Math.min(1, Math.round(pose.lookY)));
  const irisLeft = x + 1 + lookX;

  const iris = (top: number, bottom: number) => {
    for (let row = top; row <= bottom; row += 1) {
      const color = row === top ? p.irisDark : row === bottom ? p.irisLight : p.iris;
      head.span(row, irisLeft, irisLeft + 2, color);
    }
    head.set(irisLeft + 1, Math.min(bottom, top + 1), p.irisDark);
    // Sparkle.
    head.set(irisLeft, top, p.eyeWhite);
  };

  switch (shape) {
    case "closed":
      head.span(y + 3, x, x + 4, p.lash);
      head.set(x, y + 2, p.lash);
      head.set(x + 4, y + 2, p.lash);
      return;
    case "happy":
      head.set(x, y + 3, p.lash);
      head.set(x + 1, y + 2, p.lash);
      head.span(y + 1, x + 2, x + 2, p.lash);
      head.set(x + 3, y + 2, p.lash);
      head.set(x + 4, y + 3, p.lash);
      head.set(x + 2, y + 2, p.lash);
      return;
    case "half":
      head.span(y + 2, x, x + 4, p.lash);
      head.span(y + 3, x, x + 4, p.eyeWhite);
      head.span(y + 4, x + 1, x + 3, p.eyeWhite);
      head.span(y + 3, irisLeft, irisLeft + 2, p.irisDark);
      head.span(y + 4, irisLeft, irisLeft + 2, p.iris);
      return;
    case "wide":
      head.span(y - 1, x, x + 4, p.lash);
      for (let row = y; row <= y + 4; row += 1) head.span(row, x, x + 4, p.eyeWhite);
      head.span(y + 1, irisLeft, irisLeft + 2, p.iris);
      head.span(y + 2, irisLeft, irisLeft + 2, p.irisDark);
      head.span(y + 3, irisLeft, irisLeft + 2, p.iris);
      head.set(irisLeft, y + 1, p.eyeWhite);
      return;
    default: {
      const lidRow = lookY > 0 ? y + 1 : y;
      head.span(lidRow, x, x + 4, p.lash);
      for (let row = lidRow + 1; row <= y + 4; row += 1) {
        const corners = row === y + 4;
        head.span(row, corners ? x + 1 : x, corners ? x + 3 : x + 4, p.eyeWhite);
      }
      // Lash corners give the eye an almond shape.
      head.set(x, lidRow + 1, p.lash);
      head.set(x + 4, lidRow + 1, p.lash);
      iris(lidRow + 1, lookY < 0 ? y + 3 : y + 4);
    }
  }
}

function drawGlasses(head: Layer, p: Palette, style: CharacterDef["glasses"], turn: number) {
  for (const side of ["left", "right"] as const) {
    const { x, y } = eyeBox(side, turn);
    const left = x - 1;
    const right = x + 5;
    const top = y - 1;
    const bottom = y + 5;
    if (style === "square") head.span(top, left, right, p.glasses);
    else head.span(top, left + 1, right - 1, p.glasses);
    head.span(bottom, left + 1, right - 1, p.glasses);
    for (let row = top + 1; row < bottom; row += 1) {
      head.set(left, row, p.glasses);
      head.set(right, row, p.glasses);
    }
  }
  head.span(style === "square" ? 21 : 22, 22 + turn, 25 + turn, p.glasses);
  head.span(22, 13 + turn, 14 + turn, p.glasses);
  head.span(22, 33 + turn, 34 + turn, p.glasses);
}

function drawBrows(head: Layer, p: Palette, shape: BrowShape, turn: number) {
  // Coordinates for the left brow; the right one is mirrored around the face centre.
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  const add = (points: Array<[number, number]>, target: Array<[number, number]>) => target.push(...points);
  const neutral: Array<[number, number]> = [[16, 19], [17, 18], [18, 18], [19, 18], [20, 18]];
  const raised = neutral.map(([x, y]) => [x, y - 1] as [number, number]);
  const worried: Array<[number, number]> = [[16, 19], [17, 18], [18, 18], [19, 17], [20, 17]];
  const focused: Array<[number, number]> = [[16, 17], [17, 17], [18, 18], [19, 18], [20, 19]];

  switch (shape) {
    case "up":
      add(raised, left);
      add(raised, right);
      break;
    case "worried":
      add(worried, left);
      add(worried, right);
      break;
    case "focused":
      add(focused, left);
      add(focused, right);
      break;
    case "quizzical":
      add(neutral, left);
      add(neutral.map(([x, y]) => [x, y - 2] as [number, number]), right);
      break;
    default:
      add(neutral, left);
      add(neutral, right);
  }
  for (const [x, y] of left) head.set(x + turn, y, p.hairDark);
  for (const [x, y] of right) head.set(47 - x + turn, y, p.hairDark);
}

function drawMouth(head: Layer, p: Palette, shape: MouthShape, turn: number) {
  const t = turn;
  const dark = p.mouthInside;
  switch (shape) {
    case "neutral":
      head.span(31, 22 + t, 25 + t, p.mouthLine);
      return;
    case "smile":
      head.set(21 + t, 30, p.mouthLine);
      head.set(26 + t, 30, p.mouthLine);
      head.span(31, 22 + t, 25 + t, p.mouthLine);
      return;
    case "grin":
      head.span(30, 21 + t, 26 + t, dark);
      head.span(31, 21 + t, 26 + t, dark);
      head.span(32, 22 + t, 25 + t, dark);
      head.span(31, 23 + t, 24 + t, p.tongue);
      head.span(32, 23 + t, 24 + t, p.tongue);
      return;
    case "open":
      head.span(31, 22 + t, 25 + t, dark);
      head.span(32, 22 + t, 25 + t, dark);
      head.span(32, 23 + t, 24 + t, p.tongue);
      return;
    case "wide":
      head.span(30, 22 + t, 25 + t, dark);
      head.span(31, 21 + t, 26 + t, dark);
      head.span(32, 21 + t, 26 + t, dark);
      head.span(33, 22 + t, 25 + t, dark);
      head.span(32, 22 + t, 25 + t, p.tongue);
      return;
    case "o":
      head.span(30, 23 + t, 24 + t, dark);
      head.span(31, 22 + t, 25 + t, dark);
      head.span(32, 22 + t, 25 + t, dark);
      head.span(33, 23 + t, 24 + t, dark);
      return;
    case "hmm":
      head.span(31, 23 + t, 26 + t, p.mouthLine);
      head.set(22 + t, 32, p.mouthLine);
      return;
    case "wavy":
      head.set(21 + t, 32, p.mouthLine);
      head.set(22 + t, 31, p.mouthLine);
      head.set(23 + t, 32, p.mouthLine);
      head.set(24 + t, 31, p.mouthLine);
      head.set(25 + t, 32, p.mouthLine);
      head.set(26 + t, 31, p.mouthLine);
  }
}

// ---------- Emotes (canvas coordinates) ----------

const EMOTES: Record<Exclude<Emote, "none" | "think" | "zzz">, { art: string[]; colors: Record<string, string> }> = {
  heart: {
    art: [".##.##.", "#o#####", "#######", ".#####.", "..###..", "...#..."],
    colors: { "#": "#e8434f", o: "#ff9aa2" },
  },
  exclaim: {
    art: ["##", "##", "##", "##", "##", "..", "##"],
    colors: { "#": "#f7c948" },
  },
  question: {
    art: [".###.", "##.##", "...##", "..##.", "..#..", ".....", "..#.."],
    colors: { "#": "#fff4dc" },
  },
  sparkle: {
    art: ["..#..", "..#..", "##o##", "..#..", "..#.."],
    colors: { "#": "#f7c948", o: "#fffbe6" },
  },
  sweat: {
    art: [".#.", "###", "#o#", "###", ".#."],
    colors: { "#": "#7ec8ff", o: "#e6f6ff" },
  },
  note: {
    art: ["..###", "..#.#", "..#.#", "..#..", "###..", "###.."],
    colors: { "#": "#fff4dc" },
  },
};

const INK = hex("#120c24");

function drawArt(canvas: Layer, art: string[], colors: Record<string, string>, left: number, top: number) {
  const mask = new Layer(RIG_SIZE, RIG_SIZE);
  art.forEach((row, y) => {
    [...row].forEach((char, x) => {
      const color = colors[char];
      if (color) mask.set(left + x, top + y, hex(color));
    });
  });
  // Ink outline around the icon so it reads on any background.
  for (let y = 0; y < RIG_SIZE; y += 1) {
    for (let x = 0; x < RIG_SIZE; x += 1) {
      if (mask.has(x, y)) continue;
      if (mask.has(x - 1, y) || mask.has(x + 1, y) || mask.has(x, y - 1) || mask.has(x, y + 1)) canvas.set(x, y, INK);
    }
  }
  mask.drawOnto(canvas, 0, 0);
}

function drawEmote(canvas: Layer, emote: Emote, frame: number) {
  if (emote === "none") return;
  const bob = frame % 8 < 4 ? 0 : 1;
  if (emote === "think") {
    // Cloud with three dots lighting up in turn, and two puffs leading back to the head.
    const cloud = [
      "..#######..",
      ".#########.",
      "###########",
      "###########",
      ".#########.",
      "..#######..",
    ];
    drawArt(canvas, cloud, { "#": "#fff4dc" }, 49, 1 + bob);
    const lit = Math.floor(frame / 3) % 4;
    for (let dot = 0; dot < 3; dot += 1) {
      canvas.set(51 + dot * 3, 4 + bob, dot < lit ? INK : hex("#b8b0c9"));
      canvas.set(52 + dot * 3, 4 + bob, dot < lit ? INK : hex("#b8b0c9"));
    }
    drawArt(canvas, ["##", "##"], { "#": "#fff4dc" }, 48, 10);
    drawArt(canvas, ["#"], { "#": "#fff4dc" }, 46, 13);
    return;
  }
  if (emote === "zzz") {
    const rise = frame % 12;
    const big = ["####", "..#.", ".#..", "####"];
    const small = ["###", ".#.", "###"];
    drawArt(canvas, big, { "#": "#fff4dc" }, 52, 8 - Math.floor(rise / 3));
    if (rise > 5) drawArt(canvas, small, { "#": "#fff4dc" }, 58, 3 - Math.floor((rise - 6) / 3));
    return;
  }
  const { art, colors } = EMOTES[emote];
  const left = emote === "sweat" ? 48 : 52;
  const top = emote === "sweat" ? 14 + (frame % 6 < 3 ? 0 : 1) : 2 + bob;
  drawArt(canvas, art, colors, left, top);
}

// ---------- Characters ----------

function femaleHairBack(layer: Layer, p: Palette) {
  const rows: Record<number, [number, number]> = {
    0: [19, 28], 1: [16, 31], 2: [14, 33], 3: [12, 35], 4: [11, 36], 5: [10, 37], 6: [9, 38], 7: [9, 38],
  };
  const mask = new Layer(BUST_W, BUST_H);
  for (const [y, [l, r]] of Object.entries(rows)) mask.span(Number(y), l, r, p.hair);
  for (let y = 8; y <= 26; y += 1) mask.span(y, 8, 39, p.hair);
  for (let y = 27; y <= 31; y += 1) mask.span(y, 7, 40, p.hair);
  mask.span(32, 7, 40, p.hair);
  mask.span(33, 8, 39, p.hair);
  mask.span(34, 9, 16, p.hair);
  mask.span(34, 31, 38, p.hair);
  mask.drawOnto(layer, 0, 0);
  outline(layer, mask, p.hairDark);
  // Warm highlight ring around the crown.
  for (const [x, y] of [[16, 4], [17, 4], [18, 4], [29, 4], [30, 4], [31, 4], [14, 5], [15, 5], [32, 5], [33, 5], [13, 6], [34, 6]]) {
    layer.set(x, y, p.hairLight);
  }
  for (const [x, y] of [[19, 3], [20, 3], [27, 3], [28, 3]]) layer.set(x, y, p.hairShine);
  // Strands down the sides.
  for (let y = 12; y <= 32; y += 1) {
    if (y % 5 !== 0) {
      layer.set(10, y, p.hairMid);
      layer.set(37, y, p.hairMid);
    }
  }
}

function femaleHairFront(layer: Layer, p: Palette) {
  // Fringe: straight-cut bangs with separate strand tips.
  const tipRow: Record<number, number> = { 14: 17, 15: 17, 19: 17, 24: 17, 25: 17, 30: 17, 33: 17, 17: 15, 22: 15, 28: 15, 35: 15 };
  for (let x = 11; x <= 36; x += 1) {
    const bottom = tipRow[x] ?? 16;
    for (let y = 8; y <= bottom; y += 1) layer.set(x, y, p.hair);
    layer.set(x, bottom, p.hairDark);
  }
  for (const x of [17, 22, 28]) for (let y = 11; y <= 14; y += 1) layer.set(x, y, p.hairMid);
  for (const [x, y] of [[20, 9], [21, 9], [26, 9], [27, 9], [19, 10], [28, 10]]) layer.set(x, y, p.hairLight);
  // Side locks framing the face.
  for (let y = 12; y <= 33; y += 1) {
    const inner = y <= 29 ? 14 : 15;
    const outer = y >= 27 && y <= 32 ? 7 : 8;
    layer.span(y, outer, inner, p.hair);
    layer.span(y, 47 - inner, 47 - outer, p.hair);
    layer.set(inner, y, p.hairDark);
    layer.set(47 - inner, y, p.hairDark);
    if (y % 4 === 1) {
      layer.set(11, y, p.hairMid);
      layer.set(36, y, p.hairMid);
    }
  }
  // Ends curl in at the jaw.
  layer.span(34, 9, 16, p.hairDark);
  layer.span(34, 31, 38, p.hairDark);
}

function femaleHeadDetails(layer: Layer, p: Palette) {
  // Ears peeking out, hair tucked behind them.
  for (const x of [13, 34]) {
    for (let y = 23; y <= 26; y += 1) layer.set(x, y, p.skin);
    layer.set(x, 23, p.skinDeep);
    layer.set(x, 26, p.skinDeep);
  }
}

function femaleClothing(layer: Layer, p: Palette) {
  drawTorso(layer, p);
  drawNeck(layer, p);
  // Ribbed crew-neck collar.
  layer.span(37, 18, 19, p.clothLight);
  layer.span(37, 28, 29, p.clothLight);
  layer.span(38, 18, 29, p.clothLight);
  layer.span(39, 19, 28, p.clothLight);
  for (let x = 19; x <= 28; x += 2) layer.set(x, 38, p.cloth);
  // Thin necklace.
  const chain: Array<[number, number]> = [[19, 40], [20, 41], [21, 42], [22, 43], [23, 44], [24, 44], [25, 43], [26, 42], [27, 41], [28, 40]];
  for (const [x, y] of chain) layer.set(x, y, p.accent);
  layer.span(45, 23, 24, p.accent);
}

function maleHair(layer: Layer, p: Palette) {
  const spans: Array<[number, number, number]> = [
    [0, 19, 19], [0, 26, 26],
    [1, 17, 21], [1, 24, 30],
    [2, 14, 34], [3, 12, 35], [4, 11, 36], [5, 10, 37], [6, 10, 38],
    [7, 9, 38], [8, 9, 38], [9, 9, 38], [10, 9, 38], [11, 9, 38], [12, 9, 38], [13, 9, 38],
    [14, 9, 38], [15, 9, 17], [15, 19, 23], [15, 25, 28], [15, 30, 38],
    [16, 9, 17], [16, 20, 23], [16, 25, 28], [16, 31, 38],
    [17, 10, 13], [17, 15, 17], [17, 20, 22], [17, 26, 28], [17, 31, 33], [17, 34, 37],
    [18, 10, 13], [18, 16, 16], [18, 20, 22], [18, 27, 28], [18, 34, 37],
    [19, 10, 13], [19, 21, 22], [19, 28, 28], [19, 34, 37],
    [20, 10, 13], [20, 21, 21], [20, 34, 37],
    [21, 11, 13], [21, 34, 36],
  ];
  const mask = new Layer(BUST_W, BUST_H);
  for (const [y, l, r] of spans) mask.span(y, l, r, p.hair);
  // Messy tufts poking out.
  for (const [x, y] of [[8, 8], [8, 12], [39, 9], [39, 13], [13, 1], [33, 1]]) mask.set(x, y, p.hair);
  mask.drawOnto(layer, 0, 0);
  outline(layer, mask, p.hairDark);
  // Cool sheen across the top and strand lines.
  for (const [x, y] of [[18, 3], [19, 3], [20, 3], [21, 4], [26, 3], [27, 3], [28, 4], [15, 5], [16, 5], [31, 5], [32, 5]]) {
    layer.set(x, y, p.hairLight);
  }
  for (const [x, y] of [[19, 2], [27, 2]]) layer.set(x, y, p.hairShine);
  for (const [x0, y0] of [[14, 8], [20, 7], [26, 7], [32, 8]]) {
    for (let i = 0; i < 5; i += 1) layer.set(x0 + (i >> 1), y0 + i, p.hairMid);
  }
}

function maleHeadDetails(layer: Layer, p: Palette) {
  for (const x of [11, 12, 35, 36]) {
    for (let y = 22; y <= 27; y += 1) layer.set(x, y, p.skin);
  }
  for (let y = 22; y <= 27; y += 1) {
    layer.set(11, y, p.skinDeep);
    layer.set(36, y, p.skinDeep);
  }
  layer.set(12, 24, p.skinShade);
  layer.set(35, 24, p.skinShade);
  // Silver stud earring.
  layer.set(11, 28, p.accent);
  layer.set(12, 28, p.accent);
}

function maleClothing(layer: Layer, p: Palette) {
  drawTorso(layer, p);
  drawNeck(layer, p);
  // Hood bunched around the neck.
  const hoodLeft: Array<[number, number, number]> = [[34, 16, 18], [35, 15, 19], [36, 14, 19], [37, 14, 19], [38, 14, 19], [39, 14, 19], [40, 15, 20], [41, 16, 21]];
  for (const [y, l, r] of hoodLeft) {
    layer.span(y, l, r, p.clothLight);
    layer.span(y, 47 - r, 47 - l, p.clothLight);
    layer.set(l, y, p.clothDark);
    layer.set(47 - l, y, p.clothDark);
  }
  for (let y = 39; y <= 42; y += 1) layer.span(y, 20 + (y - 39), 27 - (y - 39), p.clothDark);
  // Drawstrings.
  for (let y = 41; y <= 47; y += 1) {
    layer.set(21, y, p.accent);
    layer.set(26, y, p.accent);
  }
  layer.set(21, 48, p.clothLight);
  layer.set(26, 48, p.clothLight);
}

const CHARACTERS: Record<CompanionAvatar, CharacterDef> = {
  female: {
    palette: {
      skin: hex("#f7c79a"),
      skinShade: hex("#eaa97c"),
      skinDeep: hex("#c98256"),
      blush: hex("#f28c7c"),
      hair: hex("#231a1e"),
      hairDark: hex("#130d10"),
      hairMid: hex("#3a2a2c"),
      hairLight: hex("#6e4632"),
      hairShine: hex("#9a6446"),
      eyeWhite: hex("#fff8f0"),
      iris: hex("#7a4128"),
      irisDark: hex("#3a1d12"),
      irisLight: hex("#b36d3e"),
      lash: hex("#1a1014"),
      mouthLine: hex("#b84a3c"),
      mouthInside: hex("#5a1f24"),
      tongue: hex("#e0706a"),
      glasses: hex("#2a1f24"),
      cloth: hex("#211e26"),
      clothDark: hex("#131117"),
      clothLight: hex("#37323f"),
      accent: hex("#cfcdd9"),
    },
    glasses: "round",
    hairBack: femaleHairBack,
    hairFront: femaleHairFront,
    clothing: femaleClothing,
    headDetails: femaleHeadDetails,
  },
  male: {
    palette: {
      skin: hex("#f5d3bf"),
      skinShade: hex("#e6b8a2"),
      skinDeep: hex("#c4907a"),
      blush: hex("#f0a4a0"),
      hair: hex("#17161d"),
      hairDark: hex("#0a090e"),
      hairMid: hex("#282630"),
      hairLight: hex("#454357"),
      hairShine: hex("#6a6784"),
      eyeWhite: hex("#fbf9f6"),
      iris: hex("#3f3a48"),
      irisDark: hex("#1c1a20"),
      irisLight: hex("#6d6680"),
      lash: hex("#121014"),
      mouthLine: hex("#a45a50"),
      mouthInside: hex("#5a2228"),
      tongue: hex("#d9706c"),
      glasses: hex("#141218"),
      cloth: hex("#202027"),
      clothDark: hex("#111116"),
      clothLight: hex("#34343f"),
      accent: hex("#d9d9e3"),
    },
    glasses: "square",
    hairBack: () => undefined,
    hairFront: maleHair,
    clothing: maleClothing,
    headDetails: maleHeadDetails,
  },
};

/** Renders one frame as RGBA pixels (RIG_SIZE x RIG_SIZE). */
export function renderRig(avatar: CompanionAvatar, pose: RigPose): Uint8ClampedArray<ArrayBuffer> {
  const def = CHARACTERS[avatar];
  const p = def.palette;
  const canvas = new Layer(RIG_SIZE, RIG_SIZE);

  const body = new Layer(BUST_W, BUST_H);
  def.clothing(body, p);

  const head = new Layer(BUST_W, BUST_H);
  def.hairBack(head, p);
  drawFace(head, p);
  def.headDetails(head, p);

  // Fringe moves with the turn; it also casts a shadow on the forehead.
  const fringe = new Layer(BUST_W, BUST_H);
  def.hairFront(fringe, p);
  fringe.drawOnto(head, pose.turn, 0);
  for (let x = 0; x < BUST_W; x += 1) {
    for (let y = 1; y < 30; y += 1) {
      if (fringe.has(x - pose.turn, y) && !fringe.has(x - pose.turn, y + 1) && head.has(x, y + 1)) {
        const i = ((y + 1) * BUST_W + x) * 4;
        if (head.data[i] === p.skin[0] && head.data[i + 1] === p.skin[1]) head.set(x, y + 1, p.skinShade);
      }
    }
  }

  drawEye(head, p, "left", pose.eyes, pose);
  drawEye(head, p, "right", pose.rightEye ?? pose.eyes, pose);
  drawGlasses(head, p, def.glasses, pose.turn);
  drawBrows(head, p, pose.brows, pose.turn);
  head.set(24 + pose.turn, 28, p.skinDeep);
  head.set(23 + pose.turn, 28, p.skinShade);
  if (pose.blush) {
    head.span(28, 15 + pose.turn, 17 + pose.turn, p.blush);
    head.span(28, 30 + pose.turn, 32 + pose.turn, p.blush);
  }
  drawMouth(head, p, pose.mouth, pose.turn);

  const bodyY = BUST_Y + pose.bodyY;
  body.drawOnto(canvas, BUST_X, bodyY);
  // Tilt shears the top of the head; the chin stays put.
  const tilt = Math.round(pose.tilt);
  head.drawOnto(canvas, BUST_X + pose.headX, bodyY + pose.headY, (y) => (y < 14 ? tilt : y < 24 && tilt !== 0 ? Math.sign(tilt) * (y < 19 ? 1 : 0) : 0));
  drawEmote(canvas, pose.emote, pose.frame);
  return canvas.data;
}

