import { describe, expect, it } from 'vitest';
import {
  clamp01,
  easeInOutCubic,
  easeInOutSine,
  easeOutBack,
  easeOutCubic,
  lerp,
  linear,
  window01,
} from '../../src/core/easing.ts';

const NAMED = {
  linear,
  easeInOutCubic,
  easeOutCubic,
  easeInOutSine,
  easeOutBack,
};

describe('easing', () => {
  it('clamps inputs to the unit interval', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(9)).toBe(1);
  });

  it.each(Object.entries(NAMED))('%s is anchored at both endpoints', (_name, fn) => {
    expect(fn(0)).toBeCloseTo(0, 10);
    expect(fn(1)).toBeCloseTo(1, 10);
  });

  it.each(Object.entries(NAMED))('%s clamps out-of-range input', (_name, fn) => {
    expect(fn(-5)).toBeCloseTo(fn(0), 10);
    expect(fn(5)).toBeCloseTo(fn(1), 10);
  });

  it.each(Object.entries(NAMED).filter(([n]) => n !== 'easeOutBack'))(
    '%s stays within [0, 1] across the curve',
    (_name, fn) => {
      for (let i = 0; i <= 100; i += 1) {
        const y = fn(i / 100);
        expect(y).toBeGreaterThanOrEqual(-1e-12);
        expect(y).toBeLessThanOrEqual(1 + 1e-12);
      }
    },
  );

  it('easeOutBack overshoots past 1 before settling', () => {
    let sawOvershoot = false;
    for (let i = 0; i <= 100; i += 1) {
      if (easeOutBack(i / 100) > 1.001) sawOvershoot = true;
    }
    expect(sawOvershoot).toBe(true);
    expect(easeOutBack(1)).toBeCloseTo(1, 10);
  });

  it.each(Object.entries(NAMED))('%s is monotonically non-decreasing overall', (name, fn) => {
    // easeOutBack dips back down after overshooting, so only check the others.
    if (name === 'easeOutBack') return;
    let previous = fn(0);
    for (let i = 1; i <= 200; i += 1) {
      const current = fn(i / 200);
      expect(current).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = current;
    }
  });

  describe('window01', () => {
    it('remaps a sub-range onto the unit interval', () => {
      expect(window01(0.2, 0.2, 0.6)).toBeCloseTo(0, 10);
      expect(window01(0.4, 0.2, 0.6)).toBeCloseTo(0.5, 10);
      expect(window01(0.6, 0.2, 0.6)).toBeCloseTo(1, 10);
    });

    it('clamps outside the window', () => {
      expect(window01(0, 0.2, 0.6)).toBe(0);
      expect(window01(1, 0.2, 0.6)).toBe(1);
    });

    it('degenerates safely when the window has no width', () => {
      expect(window01(0.1, 0.5, 0.5)).toBe(0);
      expect(window01(0.9, 0.5, 0.5)).toBe(1);
    });
  });

  it('lerp hits both ends and the midpoint', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });
});
