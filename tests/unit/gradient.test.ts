import { describe, expect, it } from 'vitest';
import { gradientLine } from '../../src/core/gradient.ts';

describe('gradientLine', () => {
  it('0deg runs bottom to top', () => {
    const line = gradientLine(0, 200, 100);
    expect(line.x0).toBeCloseTo(100, 9);
    expect(line.y0).toBeCloseTo(100, 9);
    expect(line.x1).toBeCloseTo(100, 9);
    expect(line.y1).toBeCloseTo(0, 9);
  });

  it('90deg runs left to right', () => {
    const line = gradientLine(90, 200, 100);
    expect(line.x0).toBeCloseTo(0, 9);
    expect(line.y0).toBeCloseTo(50, 9);
    expect(line.x1).toBeCloseTo(200, 9);
    expect(line.y1).toBeCloseTo(50, 9);
  });

  it('180deg runs top to bottom', () => {
    const line = gradientLine(180, 200, 100);
    expect(line.y0).toBeCloseTo(0, 9);
    expect(line.y1).toBeCloseTo(100, 9);
  });

  it('270deg runs right to left', () => {
    const line = gradientLine(270, 200, 100);
    expect(line.x0).toBeCloseTo(200, 9);
    expect(line.x1).toBeCloseTo(0, 9);
  });

  it('always stays centred on the rectangle', () => {
    for (const angle of [0, 33, 90, 137, 180, 250, 359]) {
      const line = gradientLine(angle, 300, 180);
      expect((line.x0 + line.x1) / 2).toBeCloseTo(150, 9);
      expect((line.y0 + line.y1) / 2).toBeCloseTo(90, 9);
    }
  });

  it('spans far enough to cover the whole rectangle on a diagonal', () => {
    const width = 200;
    const height = 100;
    for (const angle of [0, 30, 45, 60, 90, 135, 210, 315]) {
      const line = gradientLine(angle, width, height);
      const length = Math.hypot(line.x1 - line.x0, line.y1 - line.y0);
      // Every corner must project inside the gradient line's extent.
      const dx = (line.x1 - line.x0) / length;
      const dy = (line.y1 - line.y0) / length;
      for (const [cx, cy] of [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height],
      ] as const) {
        const projection = (cx - line.x0) * dx + (cy - line.y0) * dy;
        expect(projection).toBeGreaterThanOrEqual(-1e-9);
        expect(projection).toBeLessThanOrEqual(length + 1e-9);
      }
    }
  });

  it('wraps around after a full turn', () => {
    const a = gradientLine(45, 200, 100);
    const b = gradientLine(405, 200, 100);
    expect(a.x0).toBeCloseTo(b.x0, 9);
    expect(a.y0).toBeCloseTo(b.y0, 9);
  });

  it('is antisymmetric across 180 degrees', () => {
    const a = gradientLine(60, 200, 100);
    const b = gradientLine(240, 200, 100);
    expect(a.x0).toBeCloseTo(b.x1, 9);
    expect(a.y0).toBeCloseTo(b.y1, 9);
  });

  it('falls back to a usable line for a non-finite angle', () => {
    const line = gradientLine(Number.NaN, 200, 100);
    for (const v of [line.x0, line.y0, line.x1, line.y1]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
