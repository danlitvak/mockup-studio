import { describe, expect, it } from 'vitest';
import {
  MOTION_IDS,
  MOTION_LABELS,
  cyclesFor,
  evaluateMotion,
  isCyclic,
  restingTransform,
} from '../../src/core/motion.ts';
import { defaultMotion, defaultScene } from '../../src/core/project.ts';
import type { MotionId, MotionSettings, Transform } from '../../src/core/types.ts';

const TAU = Math.PI * 2;

const scene = () => defaultScene();
const motion = (over: Partial<MotionSettings> = {}): MotionSettings => ({
  ...defaultMotion(),
  ...over,
});

/** Compare rotations modulo a full turn — a spin of 2π is the same pose as 0. */
const sameAngle = (a: number, b: number): boolean => {
  const diff = ((a - b) % TAU + TAU) % TAU;
  return Math.min(diff, TAU - diff) < 1e-9;
};

const expectSamePose = (a: Transform, b: Transform) => {
  expect(a.position.x).toBeCloseTo(b.position.x, 9);
  expect(a.position.y).toBeCloseTo(b.position.y, 9);
  expect(a.position.z).toBeCloseTo(b.position.z, 9);
  expect(a.scale).toBeCloseTo(b.scale, 9);
  expect(sameAngle(a.rotation.x, b.rotation.x)).toBe(true);
  expect(sameAngle(a.rotation.y, b.rotation.y)).toBe(true);
  expect(sameAngle(a.rotation.z, b.rotation.z)).toBe(true);
};

describe('motion', () => {
  it('labels every preset', () => {
    for (const id of MOTION_IDS) {
      expect(MOTION_LABELS[id]).toBeTruthy();
    }
  });

  it('resting transform reflects the scene base pose', () => {
    const s = { ...scene(), rotationX: -90, rotationY: 45, rotationZ: 180, scale: 1.5 };
    const t = restingTransform(s);
    expect(t.rotation.x).toBeCloseTo(-Math.PI / 2, 12);
    expect(t.rotation.y).toBeCloseTo(Math.PI / 4, 12);
    expect(t.rotation.z).toBeCloseTo(Math.PI, 12);
    expect(t.scale).toBe(1.5);
    expect(t.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it.each(MOTION_IDS)('%s is deterministic', (preset) => {
    const m = motion({ preset });
    for (const t of [0, 0.13, 0.5, 0.77, 1]) {
      expect(evaluateMotion(m, scene(), t)).toEqual(evaluateMotion(m, scene(), t));
    }
  });

  it.each(MOTION_IDS)('%s produces finite values across the clip', (preset) => {
    for (const amount of [0, 0.5, 1, 2]) {
      const m = motion({ preset, amount });
      for (let i = 0; i <= 60; i += 1) {
        const t = evaluateMotion(m, scene(), i / 60);
        for (const v of [
          t.position.x,
          t.position.y,
          t.position.z,
          t.rotation.x,
          t.rotation.y,
          t.rotation.z,
          t.scale,
        ]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(t.scale).toBeGreaterThan(0);
      }
    }
  });

  it.each(MOTION_IDS)('%s collapses to the resting pose at amount 0', (preset) => {
    const m = motion({ preset, amount: 0 });
    for (const t of [0, 0.25, 0.5, 1]) {
      expectSamePose(evaluateMotion(m, scene(), t), restingTransform(scene()));
    }
  });

  describe('seamless looping', () => {
    const cyclic = MOTION_IDS.filter(isCyclic);

    it('classifies presets into cyclic and one-shot', () => {
      expect(cyclic).toEqual(['still', 'float', 'spin', 'orbit', 'pan']);
    });

    it.each(cyclic)('%s returns to its starting pose at t=1', (preset) => {
      for (const speed of [1, 2, 3]) {
        const m = motion({ preset, loop: true, speed, amount: 1.3 });
        expectSamePose(evaluateMotion(m, scene(), 1), evaluateMotion(m, scene(), 0));
      }
    });

    it('quantises speed to whole cycles when looping', () => {
      expect(cyclesFor(motion({ preset: 'float', loop: true, speed: 1.4 }))).toBe(1);
      expect(cyclesFor(motion({ preset: 'float', loop: true, speed: 1.6 }))).toBe(2);
      expect(cyclesFor(motion({ preset: 'float', loop: true, speed: 0.1 }))).toBe(1);
    });

    it('keeps fractional speed when looping is off', () => {
      expect(cyclesFor(motion({ preset: 'float', loop: false, speed: 1.4 }))).toBeCloseTo(1.4, 12);
    });

    it('a fractional loop speed still yields a seamless loop after quantisation', () => {
      const m = motion({ preset: 'pan', loop: true, speed: 2.4, amount: 1 });
      expectSamePose(evaluateMotion(m, scene(), 1), evaluateMotion(m, scene(), 0));
    });

    it('one-shot presets are not treated as loopable', () => {
      for (const preset of ['tilt-in', 'push-in', 'flip-in'] as MotionId[]) {
        expect(isCyclic(preset)).toBe(false);
        expect(cyclesFor(motion({ preset, speed: 3 }))).toBe(1);
      }
    });
  });

  describe('one-shot intros', () => {
    const intros: MotionId[] = ['tilt-in', 'push-in', 'flip-in'];

    it.each(intros)('%s finishes exactly on the resting pose', (preset) => {
      for (const amount of [0.5, 1, 2]) {
        const m = motion({ preset, amount });
        expectSamePose(evaluateMotion(m, scene(), 1), restingTransform(scene()));
      }
    });

    it.each(intros)('%s starts away from the resting pose', (preset) => {
      const m = motion({ preset, amount: 1 });
      const start = evaluateMotion(m, scene(), 0);
      const rest = restingTransform(scene());
      const moved =
        Math.abs(start.position.x - rest.position.x) +
        Math.abs(start.position.y - rest.position.y) +
        Math.abs(start.position.z - rest.position.z) +
        Math.abs(start.rotation.x - rest.rotation.x) +
        Math.abs(start.rotation.y - rest.rotation.y) +
        Math.abs(start.scale - rest.scale);
      expect(moved).toBeGreaterThan(0.05);
    });

    it('push-in never inverts or zeroes the scale, even at maximum amount', () => {
      const m = motion({ preset: 'push-in', amount: 2 });
      for (let i = 0; i <= 50; i += 1) {
        expect(evaluateMotion(m, scene(), i / 50).scale).toBeGreaterThan(0);
      }
    });
  });

  describe('preset behaviour', () => {
    it('still never deviates from the base pose', () => {
      const m = motion({ preset: 'still', amount: 2, speed: 4 });
      for (const t of [0, 0.3, 0.6, 1]) {
        expectSamePose(evaluateMotion(m, scene(), t), restingTransform(scene()));
      }
    });

    it('spin completes exactly `speed` full turns', () => {
      const m = motion({ preset: 'spin', loop: true, speed: 3, amount: 1 });
      const base = restingTransform(scene()).rotation.y;
      expect(evaluateMotion(m, scene(), 1).rotation.y - base).toBeCloseTo(3 * TAU, 9);
    });

    it('orbit starts at its resting depth rather than jumping backwards', () => {
      const m = motion({ preset: 'orbit', amount: 1.5 });
      const start = evaluateMotion(m, scene(), 0);
      expect(start.position.x).toBeCloseTo(0, 12);
      expect(start.position.z).toBeCloseTo(0, 12);
    });

    it('pan sweeps symmetrically about the centre', () => {
      const m = motion({ preset: 'pan', amount: 1, speed: 1, loop: true });
      const quarter = evaluateMotion(m, scene(), 0.25).position.x;
      const threeQuarter = evaluateMotion(m, scene(), 0.75).position.x;
      expect(quarter).toBeGreaterThan(0);
      expect(threeQuarter).toBeCloseTo(-quarter, 9);
    });

    it('scales deflection with the amount control', () => {
      const small = evaluateMotion(motion({ preset: 'float', amount: 0.5 }), scene(), 0.25);
      const large = evaluateMotion(motion({ preset: 'float', amount: 2 }), scene(), 0.25);
      expect(Math.abs(large.position.y)).toBeGreaterThan(Math.abs(small.position.y));
    });
  });

  it('survives a non-finite amount or speed without producing NaN', () => {
    const m = motion({ preset: 'float', amount: Number.NaN, speed: Number.POSITIVE_INFINITY });
    const t = evaluateMotion(m, scene(), 0.5);
    expect(Number.isFinite(t.position.y)).toBe(true);
    expect(Number.isFinite(t.rotation.y)).toBe(true);
  });
});
