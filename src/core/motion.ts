import { DEG, easeInOutCubic, easeOutBack, easeOutCubic, lerp, window01 } from './easing.ts';
import type { MotionId, MotionSettings, SceneSettings, Transform } from './types.ts';

/**
 * Motion is a pure function of normalised time. Nothing here touches the clock
 * or the renderer, which is what lets preview and export stay bit-identical:
 * both ask for the transform at the same `t` and get the same answer.
 */

export const MOTION_IDS: MotionId[] = [
  'still',
  'float',
  'spin',
  'orbit',
  'pan',
  'tilt-in',
  'push-in',
  'flip-in',
];

export const MOTION_LABELS: Record<MotionId, string> = {
  still: 'Still',
  float: 'Float',
  spin: 'Spin',
  orbit: 'Orbit',
  pan: 'Pan',
  'tilt-in': 'Tilt in',
  'push-in': 'Push in',
  'flip-in': 'Flip in',
};

/**
 * Cyclic presets can tile seamlessly; the others are one-shot intros that
 * resolve to the resting pose by the end of the clip.
 */
const CYCLIC: ReadonlySet<MotionId> = new Set<MotionId>(['still', 'float', 'spin', 'orbit', 'pan']);

export const isCyclic = (preset: MotionId): boolean => CYCLIC.has(preset);

export const isDeviceMotionId = (value: unknown): value is MotionId =>
  typeof value === 'string' && (MOTION_IDS as string[]).includes(value);

/**
 * Cycles across the clip. Seamless looping requires a whole number of cycles,
 * so when `loop` is on the speed is quantised.
 */
export function cyclesFor(motion: MotionSettings): number {
  if (!isCyclic(motion.preset)) return 1;
  const raw = Number.isFinite(motion.speed) ? motion.speed : 1;
  return motion.loop ? Math.max(1, Math.round(raw)) : Math.max(0.05, raw);
}

const TAU = Math.PI * 2;

/** The resting pose: base rotation from the scene, no motion applied. */
export function restingTransform(scene: SceneSettings): Transform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: {
      x: scene.rotationX * DEG,
      y: scene.rotationY * DEG,
      z: scene.rotationZ * DEG,
    },
    scale: scene.scale,
  };
}

/**
 * Resolve the device transform at normalised time `t` in [0, 1].
 *
 * Cyclic presets satisfy `f(0) == f(1)` (rotations modulo 2π) so exported
 * loops do not jump. Intro presets satisfy `f(1) == restingTransform`.
 */
export function evaluateMotion(
  motion: MotionSettings,
  scene: SceneSettings,
  t: number,
): Transform {
  const out = restingTransform(scene);
  const amount = Number.isFinite(motion.amount) ? Math.max(0, motion.amount) : 1;
  if (amount === 0 || motion.preset === 'still') return out;

  const n = cyclesFor(motion);
  const phase = TAU * n * t;

  switch (motion.preset) {
    case 'float': {
      out.position.y += 0.13 * amount * Math.sin(phase);
      out.rotation.x += 2.2 * DEG * amount * Math.cos(phase);
      out.rotation.z += 1.4 * DEG * amount * Math.sin(phase);
      break;
    }
    case 'spin': {
      out.rotation.y += phase;
      break;
    }
    case 'orbit': {
      const radius = 0.85 * amount;
      out.position.x += radius * Math.sin(phase);
      // Start at z = 0 so the device begins at its resting depth.
      out.position.z += radius * (Math.cos(phase) - 1);
      out.rotation.y += 0.32 * amount * Math.sin(phase);
      break;
    }
    case 'pan': {
      out.position.x += 0.95 * amount * Math.sin(phase);
      out.rotation.y += 7 * DEG * amount * Math.sin(phase);
      break;
    }
    case 'tilt-in': {
      const u = easeOutCubic(window01(t, 0, 0.65));
      out.rotation.y += lerp(-42 * DEG * amount, 0, u);
      out.rotation.x += lerp(15 * DEG * amount, 0, u);
      out.position.z += lerp(-1.25 * amount, 0, u);
      break;
    }
    case 'push-in': {
      const u = easeInOutCubic(window01(t, 0, 0.8));
      // Keep the multiplier strictly positive even at amount = 2.
      const startScale = Math.max(0.2, 1 - 0.3 * amount);
      out.scale *= lerp(startScale, 1, u);
      out.position.y += lerp(-0.12 * amount, 0, u);
      break;
    }
    case 'flip-in': {
      const u = easeOutBack(window01(t, 0, 0.7));
      out.rotation.x += lerp(-80 * DEG * amount, 0, u);
      out.position.y += lerp(0.35 * amount, 0, u);
      break;
    }
  }

  return out;
}
