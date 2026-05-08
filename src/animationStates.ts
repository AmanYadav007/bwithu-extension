type AnimationState = 
  | 'idle'
  | 'blink'
  | 'lookLeft'
  | 'lookRight'
  | 'wave'
  | 'happyBounce'
  | 'talk'
  | 'sleep'
  | 'surprised'
  | 'walkLeft'
  | 'walkRight'
  | 'spawn';

interface AnimationConfig {
  frames: number;
  frameRate: number;
  loop: boolean;
}

export const animationConfigs: Record<AnimationState, AnimationConfig> = {
  idle: { frames: 4, frameRate: 8, loop: true },
  blink: { frames: 3, frameRate: 12, loop: false },
  lookLeft: { frames: 2, frameRate: 6, loop: false },
  lookRight: { frames: 2, frameRate: 6, loop: false },
  wave: { frames: 6, frameRate: 10, loop: false },
  happyBounce: { frames: 4, frameRate: 8, loop: true },
  talk: { frames: 3, frameRate: 12, loop: true },
  sleep: { frames: 4, frameRate: 4, loop: true },
  surprised: { frames: 2, frameRate: 8, loop: false },
  walkLeft: { frames: 4, frameRate: 8, loop: true },
  walkRight: { frames: 4, frameRate: 8, loop: true },
  spawn: { frames: 6, frameRate: 12, loop: false },
};

export type { AnimationState, AnimationConfig };
