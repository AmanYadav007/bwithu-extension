#!/usr/bin/env python3
"""
rebuild-sprites.py
Reads bear.png (1536×1024, single bear on white/transparent bg).
Crops to bear content, then generates 4 sprite sheets with synthetic animation:

  idle.png  — 4×128px frames — breathing loop (1px vertical shift)
  blink.png — 3×128px frames — eyes open / half-closed / closed
  wave.png  — 4×128px frames — gentle bob
  spawn.png — 6×128px frames — scale-in appearance sequence

Run from project root: python3 scripts/rebuild-sprites.py
"""

from pathlib import Path
from PIL import Image, ImageFilter
import sys

PUBLIC = Path(__file__).parent.parent / "public"
BEAR_PATH = PUBLIC / "bear.png"
FRAME = 128   # output frame size
PAD   = 0.08  # padding as fraction of bear size

def find_content_box(img: Image.Image, bg_thresh=240, alpha_thresh=25):
    """Return (x0, y0, x1, y1) tight bounding box of non-background pixels."""
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    x0, y0, x1, y1 = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a >= alpha_thresh and not (r > bg_thresh and g > bg_thresh and b > bg_thresh):
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
    return (x0, y0, x1 + 1, y1 + 1)

def crop_bear(img: Image.Image) -> Image.Image:
    """Crop to bear content, add padding, return RGBA Image."""
    box = find_content_box(img)
    bw = box[2] - box[0]
    bh = box[3] - box[1]
    padx = max(4, int(bw * PAD))
    pady = max(4, int(bh * PAD))
    padded = (
        max(0, box[0] - padx),
        max(0, box[1] - pady),
        min(img.width,  box[2] + padx),
        min(img.height, box[3] + pady),
    )
    cropped = img.convert("RGBA").crop(padded)
    # Make white/near-white → transparent
    px = cropped.load()
    for y in range(cropped.height):
        for x in range(cropped.width):
            r, g, b, a = px[x, y]
            if r > 240 and g > 240 and b > 240:
                px[x, y] = (0, 0, 0, 0)
    return cropped

def bear_to_frame(bear: Image.Image, target=FRAME, y_shift=0, alpha_mult=1.0, scale=1.0) -> Image.Image:
    """Fit bear into a target×target transparent canvas."""
    bw, bh = int(bear.width * scale), int(bear.height * scale)
    if bw == 0 or bh == 0:
        return Image.new("RGBA", (target, target), (0, 0, 0, 0))

    fit_scale = min(target / bw, target / bh) * 0.88
    dw, dh = max(1, int(bw * fit_scale)), max(1, int(bh * fit_scale))

    resized = bear.resize((int(bear.width * scale * fit_scale),
                           int(bear.height * scale * fit_scale)),
                          Image.NEAREST)

    ox = (target - resized.width)  // 2
    oy = (target - resized.height) // 2 + y_shift

    frame = Image.new("RGBA", (target, target), (0, 0, 0, 0))
    frame.paste(resized, (ox, oy), mask=resized)

    if alpha_mult < 1.0:
        r, g, b, a = frame.split()
        a = a.point(lambda v: int(v * alpha_mult))
        frame = Image.merge("RGBA", (r, g, b, a))

    return frame

def make_blink_frame(base_frame: Image.Image, state: str) -> Image.Image:
    """
    Modify a base frame to simulate eye closing.
    state: 'open' | 'half' | 'closed'
    Strategy: scan for dark pixels in the upper-middle region (eyes),
    replace with surrounding fur tone for half/closed states.
    """
    if state == "open":
        return base_frame.copy()

    frame = base_frame.copy()
    px = frame.load()
    w, h = frame.size

    # Eyes are roughly in rows 20-50% of the bear height, center columns
    eye_y0 = int(h * 0.22)
    eye_y1 = int(h * 0.52)
    eye_x0 = int(w * 0.20)
    eye_x1 = int(w * 0.80)

    FUR = (245, 222, 179, 255)

    # Find dark pixels in the eye region (eyes are near-black)
    eye_pixels = []
    for y in range(eye_y0, eye_y1):
        for x in range(eye_x0, eye_x1):
            r, g, b, a = px[x, y]
            if a > 100 and r < 90 and g < 70 and b < 60:
                eye_pixels.append((x, y))

    if not eye_pixels:
        return frame  # no eyes found, return as-is

    # Sort by y to find top/bottom of eyes
    ys = sorted(set(p[1] for p in eye_pixels))
    mid_y = ys[len(ys) // 2]

    for (x, y) in eye_pixels:
        if state == "half":
            # Cover top half of eyes
            if y <= mid_y:
                px[x, y] = FUR
        else:  # closed
            px[x, y] = FUR

    return frame

def make_strip(frames: list) -> Image.Image:
    """Concatenate frames horizontally into a sprite strip."""
    w = sum(f.width for f in frames)
    h = max(f.height for f in frames)
    strip = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    x = 0
    for f in frames:
        strip.paste(f, (x, 0), mask=f)
        x += f.width
    return strip

# ── Load + crop bear ─────────────────────────────────────────────────────────
print("Loading bear.png…")
src = Image.open(BEAR_PATH).convert("RGBA")
print(f"  Source: {src.width}×{src.height}")
bear = crop_bear(src)
print(f"  Cropped: {bear.width}×{bear.height}")

base = bear_to_frame(bear)

# ── idle.png — 4 frames, subtle breathing ─────────────────────────────────
print("Generating idle.png…")
idle_frames = [
    bear_to_frame(bear, y_shift=0),
    bear_to_frame(bear, y_shift=-1),
    bear_to_frame(bear, y_shift=0),
    bear_to_frame(bear, y_shift=1),
]
idle = make_strip(idle_frames)
idle.save(PUBLIC / "idle.png")
print(f"  ✓ {idle.width}×{idle.height} (4 frames)")

# ── blink.png — 3 frames, eyes open→half→closed ───────────────────────────
print("Generating blink.png…")
blink_base = bear_to_frame(bear)
blink_frames = [
    make_blink_frame(blink_base, "open"),
    make_blink_frame(blink_base, "half"),
    make_blink_frame(blink_base, "closed"),
]
blink = make_strip(blink_frames)
blink.save(PUBLIC / "blink.png")
print(f"  ✓ {blink.width}×{blink.height} (3 frames)")

# ── wave.png — 4 frames, gentle bob ─────────────────────────────────────
print("Generating wave.png…")
wave_frames = [
    bear_to_frame(bear, y_shift=0),
    bear_to_frame(bear, y_shift=-2),
    bear_to_frame(bear, y_shift=-1),
    bear_to_frame(bear, y_shift=1),
]
wave = make_strip(wave_frames)
wave.save(PUBLIC / "wave.png")
print(f"  ✓ {wave.width}×{wave.height} (4 frames)")

# ── spawn.png — 6 frames, scale-in ───────────────────────────────────────
print("Generating spawn.png…")
spawn_configs = [
    (0.15, 0.25),
    (0.30, 0.50),
    (0.50, 0.70),
    (0.70, 0.88),
    (0.88, 0.95),
    (1.00, 1.00),
]
spawn_frames = [bear_to_frame(bear, scale=sc, alpha_mult=al) for sc, al in spawn_configs]
spawn = make_strip(spawn_frames)
spawn.save(PUBLIC / "spawn.png")
print(f"  ✓ {spawn.width}×{spawn.height} (6 frames)")

print("""
Done. animationStates.ts frame counts to set:
  idle:  frameCount: 4
  blink: frameCount: 3
  wave:  frameCount: 4
  spawn: frameCount: 6
""")
