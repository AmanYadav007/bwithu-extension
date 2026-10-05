import { motion } from "framer-motion";
import type { TargetAndTransition } from "framer-motion";
import type { BearState } from "@bwithu/shared";
import LiveOrb from "./components/ui/live-orb";
import type { LiveOrbGaze, LiveOrbVariant } from "./components/ui/live-orb";

interface OrbCharacterProps {
  state: BearState;
  size: number;
  variant?: LiveOrbVariant;
}

interface OrbPose {
  /** Fixed gaze; null lets the eyes follow the pointer. */
  gaze: LiveOrbGaze | null;
  motion: TargetAndTransition;
  halo: string | null;
}

const float: TargetAndTransition = {
  y: [0, -6, 0],
  scale: 1,
  rotate: 0,
  transition: { duration: 4, repeat: Infinity, ease: "easeInOut" },
};

function poseFor(state: BearState): OrbPose {
  switch (state) {
    case "listen":
      return {
        gaze: { x: 0, y: 0.1 },
        motion: { y: [0, -3, 0], scale: [1, 1.02, 1], rotate: 0, transition: { duration: 1.6, repeat: Infinity, ease: "easeInOut" } },
        halo: "rgba(125, 211, 252, 0.55)",
      };
    case "think":
    case "searching":
      return {
        gaze: { x: 0.55, y: 0.6 },
        motion: { y: [0, -4, 0], rotate: [-3, 3, -3], scale: 1, transition: { duration: 2.4, repeat: Infinity, ease: "easeInOut" } },
        halo: "rgba(196, 181, 253, 0.45)",
      };
    case "talk":
      return {
        gaze: { x: 0, y: 0.05 },
        motion: { y: [0, -5, 0], scale: [1, 1.045, 1], rotate: 0, transition: { duration: 0.42, repeat: Infinity, ease: "easeInOut" } },
        halo: "rgba(253, 230, 138, 0.45)",
      };
    case "happy":
    case "wave":
    case "intro":
    case "spawning":
      return {
        gaze: { x: 0, y: 0.2 },
        motion: { y: [0, -18, 0], scale: [1, 1.06, 1], rotate: 0, transition: { duration: 0.7, repeat: 2, ease: "easeOut" } },
        halo: "rgba(251, 207, 232, 0.45)",
      };
    case "curious":
      return {
        gaze: { x: -0.5, y: 0.15 },
        motion: { rotate: -10, y: 0, scale: 1, transition: { type: "spring", stiffness: 160, damping: 12 } },
        halo: null,
      };
    case "sleepy":
    case "sleep":
      return {
        gaze: { x: 0, y: -0.7 },
        motion: { y: [0, 4, 0], scale: 1, rotate: 0, transition: { duration: 5, repeat: Infinity, ease: "easeInOut" } },
        halo: null,
      };
    default:
      return { gaze: null, motion: float, halo: null };
  }
}

/** B as a white orb whose eyes and body language follow its conversation state. */
export default function OrbCharacter({ state, size, variant = "white" }: OrbCharacterProps) {
  const pose = poseFor(state);

  return (
    <div style={{ position: "relative", width: size, height: size, display: "grid", placeItems: "center" }}>
      <motion.div
        aria-hidden
        animate={{ opacity: pose.halo ? [0.55, 1, 0.55] : 0, scale: pose.halo ? [0.92, 1.04, 0.92] : 0.9 }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute",
          width: size * 0.78,
          height: size * 0.78,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${pose.halo ?? "transparent"} 0%, transparent 70%)`,
          filter: "blur(18px)",
        }}
      />
      <motion.div key={state} animate={pose.motion} style={{ width: size * 0.62, height: size * 0.62 }}>
        <LiveOrb size={size * 0.62} variant={variant} gaze={pose.gaze} />
      </motion.div>
      <div
        aria-hidden
        style={{
          position: "absolute",
          bottom: size * 0.1,
          width: size * 0.34,
          height: size * 0.05,
          borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(0,0,0,0.45) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}
