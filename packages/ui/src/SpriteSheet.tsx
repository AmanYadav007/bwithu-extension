import { motion } from "framer-motion";

interface SpriteSheetProps {
  src: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  frameRate: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function SpriteSheet({
  src,
  frameWidth,
  frameHeight,
  frames,
  frameRate,
  className,
  style
}: SpriteSheetProps) {
  return (
    <motion.div
      className={className}
      style={{
        width: frameWidth,
        height: frameHeight,
        backgroundImage: `url(${src})`,
        backgroundSize: `${frameWidth * frames}px ${frameHeight}px`,
        ...style
      }}
      animate={{
        backgroundPositionX: [
          0,
          -frameWidth * (frames - 1)
        ]
      }}
      transition={{
        duration: frames / frameRate,
        repeat: Infinity,
        ease: [0, 0, 1, 1] // step-like easing
      }}
    />
  );
}
