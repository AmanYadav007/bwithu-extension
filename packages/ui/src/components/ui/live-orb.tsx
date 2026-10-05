import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { cn } from "../../lib/utils";
import { createLiveOrb, fallbackFaceStyle, resolveVariant } from "./live-orb-engine";
import type { LiveOrbInstance, LiveOrbOptions } from "./live-orb-engine";

export * from "./live-orb-engine";

export type LiveOrbProps = Omit<LiveOrbOptions, "onHasGl"> & {
  className?: string;
  style?: CSSProperties;
  /** Edge length in CSS pixels. Default `280`. */
  size?: number;
};

// Inline layout styles instead of Tailwind classes: the apps don't compile Tailwind.
const eyeStyle: CSSProperties = { position: "absolute", borderRadius: "9999px", width: "13%", height: "28%", top: "34%" };

/**
 * Evenly lit sphere with two capsule eyes that follow the pointer.
 * The orb stays put — only the gaze moves.
 */
export function LiveOrb({
  className,
  style,
  size = 280,
  variant = "white",
  color,
  eyeColor,
  colors,
  interactive = true,
  blink = true,
  gaze = null,
}: LiveOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<LiveOrbInstance | null>(null);
  const [hasGl, setHasGl] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    instanceRef.current = createLiveOrb(canvas, {
      variant,
      color,
      eyeColor,
      colors,
      interactive,
      blink,
      gaze,
      onHasGl: setHasGl,
    });
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
    // Engine reads live options via setOptions; mount once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    instanceRef.current?.setOptions({ variant, color, eyeColor, colors, interactive, blink, gaze, onHasGl: setHasGl });
  }, [variant, color, eyeColor, colors, interactive, blink, gaze]);

  const resolved = resolveVariant(variant, color, eyeColor, colors);

  return (
    <div
      data-slot="live-orb"
      role="img"
      aria-label="Orb character"
      className={cn(className)}
      style={{ position: "relative", flexShrink: 0, width: size, height: size, ...style }}
    >
      {!hasGl ? (
        <div
          aria-hidden
          style={{ position: "absolute", inset: "2%", overflow: "hidden", borderRadius: "9999px", ...fallbackFaceStyle(resolved) }}
        >
          <span style={{ ...eyeStyle, backgroundColor: resolved.eye, left: "31%" }} />
          <span style={{ ...eyeStyle, backgroundColor: resolved.eye, left: "56%" }} />
        </div>
      ) : null}
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
    </div>
  );
}

export default LiveOrb;
