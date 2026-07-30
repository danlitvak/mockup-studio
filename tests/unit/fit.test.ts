import { describe, expect, it } from 'vitest';
import { defaultFitFor, fitRect, type FitMode } from '../../src/core/fit.ts';

const MODES: FitMode[] = ['cover', 'contain'];

describe('fitRect', () => {
  it('fills exactly when the aspects already match', () => {
    for (const mode of MODES) {
      expect(fitRect(1600, 900, 800, 450, mode)).toEqual({
        x: 0,
        y: 0,
        width: 800,
        height: 450,
      });
    }
  });

  describe('cover', () => {
    it('overflows horizontally for a source that is wider than the screen', () => {
      const rect = fitRect(2000, 1000, 800, 600, 'cover');
      expect(rect.height).toBe(600);
      expect(rect.width).toBe(1200);
      // Overflow is split evenly, so the crop stays centred.
      expect(rect.x).toBe(-200);
      expect(rect.y).toBe(0);
    });

    it('overflows vertically for a source that is taller than the screen', () => {
      const rect = fitRect(1000, 2000, 800, 600, 'cover');
      expect(rect.width).toBe(800);
      expect(rect.height).toBe(1600);
      expect(rect.x).toBe(0);
      expect(rect.y).toBe(-500);
    });

    it('always covers the whole target', () => {
      const cases = [
        [1920, 1080],
        [1080, 1920],
        [500, 500],
        [3000, 400],
        [400, 3000],
      ] as const;
      for (const [w, h] of cases) {
        const rect = fitRect(w, h, 800, 600, 'cover');
        expect(rect.width).toBeGreaterThanOrEqual(800 - 1e-9);
        expect(rect.height).toBeGreaterThanOrEqual(600 - 1e-9);
        expect(rect.x).toBeLessThanOrEqual(1e-9);
        expect(rect.y).toBeLessThanOrEqual(1e-9);
      }
    });
  });

  describe('contain', () => {
    it('letterboxes a wide source with bars above and below', () => {
      const rect = fitRect(2000, 1000, 800, 600, 'contain');
      expect(rect.width).toBe(800);
      expect(rect.height).toBe(400);
      expect(rect.x).toBe(0);
      expect(rect.y).toBe(100);
    });

    it('pillarboxes a tall source with bars left and right', () => {
      const rect = fitRect(1000, 2000, 800, 600, 'contain');
      expect(rect.height).toBe(600);
      expect(rect.width).toBe(300);
      expect(rect.y).toBe(0);
      expect(rect.x).toBe(250);
    });

    it('always stays inside the target', () => {
      const cases = [
        [1920, 1080],
        [1080, 1920],
        [500, 500],
        [3000, 400],
      ] as const;
      for (const [w, h] of cases) {
        const rect = fitRect(w, h, 800, 600, 'contain');
        expect(rect.width).toBeLessThanOrEqual(800 + 1e-9);
        expect(rect.height).toBeLessThanOrEqual(600 + 1e-9);
        expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
        expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
      }
    });
  });

  it.each(MODES)('%s preserves the source aspect ratio', (mode) => {
    const cases = [
      [1920, 1080],
      [1080, 1920],
      [1234, 567],
      [640, 640],
    ] as const;
    for (const [w, h] of cases) {
      const rect = fitRect(w, h, 800, 600, mode);
      expect(rect.width / rect.height).toBeCloseTo(w / h, 9);
    }
  });

  it.each(MODES)('%s stays centred on the target', (mode) => {
    const rect = fitRect(1234, 567, 800, 600, mode);
    expect(rect.x + rect.width / 2).toBeCloseTo(400, 9);
    expect(rect.y + rect.height / 2).toBeCloseTo(300, 9);
  });

  it.each(MODES)('%s survives a degenerate source without NaN', (mode) => {
    for (const [w, h] of [
      [0, 0],
      [-5, 10],
      [10, 0],
    ] as const) {
      const rect = fitRect(w, h, 800, 600, mode);
      for (const v of [rect.x, rect.y, rect.width, rect.height]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
  });
});

describe('defaultFitFor', () => {
  it('fills for edge-to-edge devices and contains for windowed ones', () => {
    expect(defaultFitFor(true)).toBe('cover');
    expect(defaultFitFor(false)).toBe('contain');
  });
});
