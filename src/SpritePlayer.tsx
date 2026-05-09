import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

interface SpritePlayerProps {
  imageSrc: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  loop?: boolean;
  onComplete?: () => void;
  style?: CSSProperties;
}

export default function SpritePlayer({
  imageSrc,
  frameWidth,
  frameHeight,
  frameCount,
  fps,
  loop = true,
  onComplete,
  style,
}: SpritePlayerProps) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frameDuration = 1000 / fps;
    let frame = 0;
    let lastTime = 0;
    let rafId: number;
    let done = false;

    if (divRef.current) {
      divRef.current.style.backgroundPositionX = "0px";
    }

    function tick(timestamp: number) {
      if (!divRef.current || done) return;

      if (lastTime === 0) lastTime = timestamp;
      const elapsed = timestamp - lastTime;

      if (elapsed >= frameDuration) {
        frame++;
        lastTime = timestamp - (elapsed % frameDuration);

        if (frame >= frameCount) {
          if (loop) {
            frame = 0;
          } else {
            frame = frameCount - 1;
            done = true;
            divRef.current.style.backgroundPositionX = `-${frame * frameWidth}px`;
            onComplete?.();
            return;
          }
        }

        divRef.current.style.backgroundPositionX = `-${frame * frameWidth}px`;
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [imageSrc, frameWidth, frameHeight, frameCount, fps, loop, onComplete]);

  return (
    <div
      ref={divRef}
      style={{
        width: frameWidth,
        height: frameHeight,
        backgroundImage: `url(${imageSrc})`,
        backgroundRepeat: "no-repeat",
        backgroundPositionX: "0px",
        backgroundPositionY: "0px",
        backgroundSize: `${frameWidth * frameCount}px ${frameHeight}px`,
        imageRendering: "pixelated",
        ...style,
      }}
    />
  );
}
