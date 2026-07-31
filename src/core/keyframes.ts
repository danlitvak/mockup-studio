import { DEG, clamp01, easeInOutCubic, easeOutBack, easeOutCubic, lerp, linear } from './easing.ts';
import type { Easing } from './easing.ts';
import type { EasingId, Keyframe, Transform } from './types.ts';

/**
 * The keyframe track: poses at chosen times, interpolated between.
 *
 * Like the presets in `motion.ts`, this is a pure function of normalised time.
 * The preview and the export both go through it at the same `t` and get the
 * same answer, which is what keeps an exported video equal to what was on
 * screen.
 */

export const EASING_IDS: EasingId[] = ['linear', 'ease-in-out', 'ease-out', 'ease-in', 'back'];

export const EASING_LABELS: Record<EasingId, string> = {
  linear: 'Linear',
  'ease-in-out': 'Ease in-out',
  'ease-out': 'Ease out',
  'ease-in': 'Ease in',
  back: 'Overshoot',
};

/** `easeInCubic` is not in easing.ts, and is only wanted here. */
const easeInCubic: Easing = (t) => {
  const x = clamp01(t);
  return x * x * x;
};

const EASINGS: Record<EasingId, Easing> = {
  linear,
  'ease-in-out': easeInOutCubic,
  'ease-out': easeOutCubic,
  'ease-in': easeInCubic,
  back: easeOutBack,
};

export const easingFor = (id: EasingId): Easing => EASINGS[id] ?? linear;

export const isEasingId = (value: unknown): value is EasingId =>
  typeof value === 'string' && (EASING_IDS as string[]).includes(value);

/** How many poses a track may hold. Generous for hand-authoring, bounded. */
export const MAX_KEYFRAMES = 24;

export const defaultKeyframe = (t = 0): Keyframe => ({
  t: clamp01(t),
  x: 0,
  y: 0,
  z: 0,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  scale: 1,
  easing: 'ease-in-out',
});

/** Ordered by time. Callers may hand over anything; evaluation needs order. */
export const sortKeyframes = (keyframes: readonly Keyframe[]): Keyframe[] =>
  [...keyframes].sort((a, b) => a.t - b.t);

const blend = (a: Keyframe, b: Keyframe, u: number): Omit<Keyframe, 't' | 'easing'> => ({
  x: lerp(a.x, b.x, u),
  y: lerp(a.y, b.y, u),
  z: lerp(a.z, b.z, u),
  rotationX: lerp(a.rotationX, b.rotationX, u),
  rotationY: lerp(a.rotationY, b.rotationY, u),
  rotationZ: lerp(a.rotationZ, b.rotationZ, u),
  scale: lerp(a.scale, b.scale, u),
});

/**
 * The pose the track describes at time `t`, as raw offsets.
 *
 * With `loop` on, the track is treated as cyclic over [0, 1): the span from the
 * last keyframe round to the first is just another segment, and `t` is wrapped
 * before lookup. That is what makes `f(0)` and `f(1)` the same pose without
 * needing a special case for the ends — the seamless-loop property the export
 * relies on falls out of the wrapping.
 *
 * With `loop` off the track holds its first pose before it starts and its last
 * pose after it ends, rather than snapping back to rest.
 */
export function sampleKeyframes(
  keyframes: readonly Keyframe[],
  t: number,
  loop: boolean,
): Omit<Keyframe, 't' | 'easing'> | null {
  const track = sortKeyframes(keyframes);
  if (track.length === 0) return null;

  const first = track[0]!;
  const last = track[track.length - 1]!;
  if (track.length === 1) return blend(first, first, 0);

  const time = loop ? t - Math.floor(t) : clamp01(t);

  if (!loop) {
    if (time <= first.t) return blend(first, first, 0);
    if (time >= last.t) return blend(last, last, 0);
  }

  for (let i = 0; i < track.length - 1; i += 1) {
    const a = track[i]!;
    const b = track[i + 1]!;
    if (time >= a.t && time <= b.t) {
      const span = b.t - a.t;
      // Two keyframes at the same instant: the later one simply wins, rather
      // than dividing by zero.
      const u = span <= 0 ? 1 : (time - a.t) / span;
      return blend(a, b, easingFor(b.easing)(u));
    }
  }

  // Only reachable when looping and `time` sits in the wrap-around span,
  // outside [first.t, last.t]. The segment runs from the last keyframe forward
  // to the first one a whole cycle later.
  const span = 1 - last.t + first.t;
  if (span <= 0) return blend(first, first, 0);
  const elapsed = time > last.t ? time - last.t : 1 - last.t + time;
  return blend(last, first, easingFor(first.easing)(elapsed / span));
}

/**
 * Apply a sampled pose on top of the resting transform.
 *
 * Offsets add and the scale multiplies, so the scene's own controls stay
 * meaningful rather than being replaced by the track.
 */
export function applyKeyframePose(
  resting: Transform,
  pose: Omit<Keyframe, 't' | 'easing'>,
): Transform {
  return {
    position: {
      x: resting.position.x + pose.x,
      y: resting.position.y + pose.y,
      z: resting.position.z + pose.z,
    },
    rotation: {
      x: resting.rotation.x + pose.rotationX * DEG,
      y: resting.rotation.y + pose.rotationY * DEG,
      z: resting.rotation.z + pose.rotationZ * DEG,
    },
    scale: resting.scale * pose.scale,
  };
}
