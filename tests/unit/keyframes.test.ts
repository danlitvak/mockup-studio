import { describe, expect, it } from 'vitest';
import {
  EASING_IDS,
  MAX_KEYFRAMES,
  applyKeyframePose,
  defaultKeyframe,
  easingFor,
  isEasingId,
  sampleKeyframes,
  sortKeyframes,
} from '../../src/core/keyframes.ts';
import { evaluateMotion, isSeamlessLoop, restingTransform, usesKeyframes } from '../../src/core/motion.ts';
import { defaultMotion, defaultScene, migrateProject } from '../../src/core/project.ts';
import type { Keyframe, MotionSettings, SceneSettings } from '../../src/core/types.ts';

const key = (t: number, over: Partial<Keyframe> = {}): Keyframe => ({
  ...defaultKeyframe(t),
  easing: 'linear',
  ...over,
});

const keyframeMotion = (keyframes: Keyframe[], over: Partial<MotionSettings> = {}): MotionSettings => ({
  ...defaultMotion(),
  mode: 'keyframes',
  keyframes,
  ...over,
});

const scene = (over: Partial<SceneSettings> = {}): SceneSettings => ({ ...defaultScene(), ...over });

describe('easings', () => {
  it('every advertised easing resolves and is anchored at both ends', () => {
    for (const id of EASING_IDS) {
      const easing = easingFor(id);
      expect(easing(0)).toBeCloseTo(0, 6);
      expect(easing(1)).toBeCloseTo(1, 6);
      expect(isEasingId(id)).toBe(true);
    }
  });

  it('rejects anything that is not an easing id', () => {
    for (const value of ['bounce', '', null, 3, {}]) expect(isEasingId(value)).toBe(false);
  });
});

describe('sampling a track', () => {
  it('returns nothing for an empty track', () => {
    expect(sampleKeyframes([], 0.5, false)).toBeNull();
  });

  it('holds a single keyframe for the whole clip', () => {
    const track = [key(0.5, { y: 2 })];
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sampleKeyframes(track, t, false)!.y).toBe(2);
    }
  });

  it('interpolates linearly between two keyframes', () => {
    const track = [key(0, { y: 0 }), key(1, { y: 10 })];
    expect(sampleKeyframes(track, 0.5, false)!.y).toBeCloseTo(5, 6);
    expect(sampleKeyframes(track, 0.25, false)!.y).toBeCloseTo(2.5, 6);
  });

  it('interpolates every channel, not just position', () => {
    const a = key(0, { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1 });
    const b = key(1, { x: 2, y: 4, z: 6, rotationX: 10, rotationY: 20, rotationZ: 30, scale: 2 });
    const mid = sampleKeyframes([a, b], 0.5, false)!;
    expect(mid).toEqual({
      x: 1,
      y: 2,
      z: 3,
      rotationX: 5,
      rotationY: 10,
      rotationZ: 15,
      scale: 1.5,
    });
  });

  it('accepts an unsorted track', () => {
    const sorted = sampleKeyframes([key(1, { y: 10 }), key(0, { y: 0 })], 0.5, false)!;
    expect(sorted.y).toBeCloseTo(5, 6);
  });

  it('holds the end poses when not looping', () => {
    const track = [key(0.3, { y: 1 }), key(0.7, { y: 9 })];
    expect(sampleKeyframes(track, 0, false)!.y).toBe(1);
    expect(sampleKeyframes(track, 0.1, false)!.y).toBe(1);
    expect(sampleKeyframes(track, 0.9, false)!.y).toBe(9);
    expect(sampleKeyframes(track, 1, false)!.y).toBe(9);
  });

  it('does not divide by zero when two keyframes share an instant', () => {
    const track = [key(0.5, { y: 1 }), key(0.5, { y: 2 })];
    const pose = sampleKeyframes(track, 0.5, false)!;
    expect(Number.isFinite(pose.y)).toBe(true);
  });

  it('applies the easing of the keyframe being moved into', () => {
    const linearTrack = [key(0, { y: 0 }), key(1, { y: 10, easing: 'linear' })];
    const easedTrack = [key(0, { y: 0 }), key(1, { y: 10, easing: 'ease-in' })];
    // Ease-in starts slower than linear, so at a quarter of the way it is behind.
    expect(sampleKeyframes(easedTrack, 0.25, false)!.y).toBeLessThan(
      sampleKeyframes(linearTrack, 0.25, false)!.y,
    );
  });
});

describe('looping a track', () => {
  it('wraps around the end, so the clip tiles without a seam', () => {
    const track = [key(0, { y: 0 }), key(0.5, { y: 10 })];
    const start = sampleKeyframes(track, 0, true)!;
    const end = sampleKeyframes(track, 1, true)!;
    expect(end).toEqual(start);
  });

  it('holds f(0) === f(1) for every arrangement of keyframes', () => {
    const arrangements: Keyframe[][] = [
      [key(0, { y: 1 }), key(1, { y: 5 })],
      [key(0.2, { x: 3 }), key(0.9, { x: -3 })],
      [key(0, { scale: 0.5 }), key(0.33, { scale: 2 }), key(0.66, { rotationY: 45 })],
      [key(0.5, { y: 4 })],
      [key(0.1, { rotationZ: 10 }), key(0.4, { rotationZ: -10 }), key(0.95, { rotationZ: 0 })],
    ];
    for (const track of arrangements) {
      expect(sampleKeyframes(track, 1, true)).toEqual(sampleKeyframes(track, 0, true));
    }
  });

  it('interpolates across the wrap rather than jumping', () => {
    // Keyframes at 0 and 0.5 mean the wrap segment runs 0.5 -> 1.0.
    const track = [key(0, { y: 0 }), key(0.5, { y: 10 })];
    const threeQuarters = sampleKeyframes(track, 0.75, true)!;
    expect(threeQuarters.y).toBeGreaterThan(0);
    expect(threeQuarters.y).toBeLessThan(10);
  });
});

describe('applying a pose to the resting transform', () => {
  it('adds offsets and multiplies scale, leaving the scene meaningful', () => {
    const resting = restingTransform(scene({ rotationX: 0, rotationY: 0, rotationZ: 0, scale: 2 }));
    const applied = applyKeyframePose(resting, {
      x: 1,
      y: -2,
      z: 3,
      rotationX: 90,
      rotationY: 0,
      rotationZ: 0,
      scale: 0.5,
    });
    expect(applied.position).toEqual({ x: 1, y: -2, z: 3 });
    expect(applied.rotation.x).toBeCloseTo(Math.PI / 2, 6);
    expect(applied.scale).toBe(1);
  });

  it('keeps the scene rotation underneath the keyframed offset', () => {
    const resting = restingTransform(scene({ rotationY: 30 }));
    const applied = applyKeyframePose(resting, { ...defaultKeyframe(0), rotationY: 15 });
    expect(applied.rotation.y).toBeCloseTo((30 + 15) * (Math.PI / 180), 6);
  });
});

describe('keyframes inside evaluateMotion', () => {
  it('takes over from the preset when the track has poses', () => {
    const motion = keyframeMotion([key(0, { y: 0 }), key(1, { y: 10 })], { preset: 'spin' });
    expect(usesKeyframes(motion)).toBe(true);
    // A spin would have rotated y; the track says otherwise.
    expect(evaluateMotion(motion, scene({ rotationY: 0 }), 0.5).rotation.y).toBeCloseTo(0, 6);
    expect(evaluateMotion(motion, scene(), 0.5).position.y).toBeCloseTo(5, 6);
  });

  it('falls back to the preset when the track is empty', () => {
    const empty = keyframeMotion([], { preset: 'spin' });
    expect(usesKeyframes(empty)).toBe(false);
    const spun = evaluateMotion(empty, scene(), 0.5);
    const preset = evaluateMotion({ ...empty, mode: 'preset' }, scene(), 0.5);
    expect(spun).toEqual(preset);
  });

  it('ignores amount and speed, which belong to the presets', () => {
    const track = [key(0, { y: 0 }), key(1, { y: 10 })];
    const plain = evaluateMotion(keyframeMotion(track), scene(), 0.5);
    const loud = evaluateMotion(keyframeMotion(track, { amount: 2, speed: 6 }), scene(), 0.5);
    expect(loud).toEqual(plain);
  });

  it('still returns to its start over a looping clip', () => {
    const motion = keyframeMotion([key(0, { y: 0 }), key(0.5, { y: 3 })], { loop: true });
    expect(evaluateMotion(motion, scene(), 1)).toEqual(evaluateMotion(motion, scene(), 0));
  });
});

describe('what counts as a seamless loop', () => {
  it('follows the track rather than the preset in keyframes mode', () => {
    const track = [key(0), key(0.5)];
    // 'tilt-in' is a one-shot preset and is not cyclic, but the track is what
    // is being played, so a looping track is still seamless.
    expect(isSeamlessLoop(keyframeMotion(track, { preset: 'tilt-in', loop: true }))).toBe(true);
    expect(isSeamlessLoop(keyframeMotion(track, { preset: 'float', loop: false }))).toBe(false);
  });

  it('falls back to the preset when there is no track', () => {
    expect(isSeamlessLoop({ ...defaultMotion(), preset: 'float', loop: true })).toBe(true);
    expect(isSeamlessLoop({ ...defaultMotion(), preset: 'tilt-in', loop: true })).toBe(false);
    expect(isSeamlessLoop(keyframeMotion([], { preset: 'tilt-in', loop: true }))).toBe(false);
  });
});

describe('migration', () => {
  const motionOf = (raw: unknown): MotionSettings => migrateProject({ motion: raw }).motion;

  it('defaults to preset mode with no keyframes', () => {
    expect(motionOf(undefined).mode).toBe('preset');
    expect(motionOf(undefined).keyframes).toEqual([]);
  });

  it('drops a keyframes field that is not an array', () => {
    for (const value of ['lots', 42, {}, null]) {
      expect(motionOf({ keyframes: value }).keyframes).toEqual([]);
    }
  });

  it('coerces and sorts arbitrary keyframe records', () => {
    const migrated = motionOf({
      mode: 'keyframes',
      keyframes: [
        { t: 5, y: 'up', easing: 'nope' },
        { t: -2, scale: 0 },
        'not a keyframe',
      ],
    });
    expect(migrated.keyframes).toHaveLength(3);
    expect(migrated.keyframes.map((frame) => frame.t)).toEqual([...migrated.keyframes.map((f) => f.t)].sort((a, b) => a - b));
    for (const frame of migrated.keyframes) {
      expect(frame.t).toBeGreaterThanOrEqual(0);
      expect(frame.t).toBeLessThanOrEqual(1);
      expect(frame.scale).toBeGreaterThan(0);
      expect(EASING_IDS).toContain(frame.easing);
      expect(Number.isFinite(frame.y)).toBe(true);
    }
  });

  it('caps a runaway track', () => {
    const many = Array.from({ length: MAX_KEYFRAMES + 40 }, (_, i) => ({ t: i / 200 }));
    expect(motionOf({ keyframes: many }).keyframes).toHaveLength(MAX_KEYFRAMES);
  });

  it('rejects an unknown mode', () => {
    expect(motionOf({ mode: 'freestyle' }).mode).toBe('preset');
  });

  it('round-trips a keyframed motion through JSON', () => {
    const motion = keyframeMotion([key(0, { y: 1 }), key(0.6, { rotationY: 20, easing: 'back' })]);
    expect(motionOf(JSON.parse(JSON.stringify(motion)))).toEqual({
      ...motion,
      keyframes: sortKeyframes(motion.keyframes),
    });
  });
});
