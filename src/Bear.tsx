import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import SpriteSheet from "./SpriteSheet";
import { animationConfigs } from "./animationStates";
import type { AnimationState } from "./animationStates";

export default function Bear() {
  const [currentState, setCurrentState] = useState<AnimationState>('idle');
  const [isVisible, setIsVisible] = useState(false);

  // Spawn animation
  useEffect(() => {
    setTimeout(() => {
      setIsVisible(true);
      setCurrentState('idle');
    }, 300);
  }, []);

  // Random idle behavior switching
  useEffect(() => {
    if (currentState !== 'idle') return;

    const interval = setInterval(() => {
      const rand = Math.random();
      if (rand < 0.3) {
        setCurrentState('blink');
        setTimeout(() => setCurrentState('idle'), 500);
      } else if (rand < 0.4) {
        setCurrentState('lookLeft');
        setTimeout(() => setCurrentState('idle'), 800);
      } else if (rand < 0.5) {
        setCurrentState('lookRight');
        setTimeout(() => setCurrentState('idle'), 800);
      } else if (rand < 0.6) {
        setCurrentState('wave');
        setTimeout(() => setCurrentState('idle'), 1000);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [currentState]);

  const config = animationConfigs[currentState];

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          drag
          dragMomentum={false}
          dragElastic={0.1}
          initial={{ y: -300, scale: 0.5, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          exit={{ y: -300, scale: 0.5, opacity: 0 }}
          transition={{ type: "spring", stiffness: 120 }}
          style={{
            cursor: "grab",
            position: "relative"
          }}
          whileDrag={{ cursor: "grabbing" }}
        >
          {/* Placeholder sprite sheet - replace with actual sprite sheet once designed */}
          <SpriteSheet
            src="/bear-sprite.png" // Replace with actual sprite sheet path
            frameWidth={64}
            frameHeight={64}
            frames={config.frames}
            frameRate={config.frameRate}
            style={{
              imageRendering: "pixelated"
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
