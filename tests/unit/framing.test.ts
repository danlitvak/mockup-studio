import { describe, expect, it } from 'vitest';
import {
  ASPECT_IDS,
  ASPECT_RATIOS,
  RESOLUTION_IDS,
  clampToEncoderLimits,
  fitCameraDistance,
  frameCount,
  offsetToWorld,
  resolveResolution,
  timeForFrame,
  visibleSizeAt,
} from '../../src/core/framing.ts';

describe('resolveResolution', () => {
  it('matches the well-known landscape sizes', () => {
    expect(resolveResolution('16:9', '4k')).toEqual({ width: 3840, height: 2160 });
    expect(resolveResolution('16:9', '1440p')).toEqual({ width: 2560, height: 1440 });
    expect(resolveResolution('16:9', '1080p')).toEqual({ width: 1920, height: 1080 });
    expect(resolveResolution('16:9', '720p')).toEqual({ width: 1280, height: 720 });
  });

  it('treats a tier as the short edge, so vertical 4K is 2160x3840', () => {
    expect(resolveResolution('9:16', '4k')).toEqual({ width: 2160, height: 3840 });
    expect(resolveResolution('9:16', '1080p')).toEqual({ width: 1080, height: 1920 });
  });

  it('keeps square and 4:5 frames on the short-edge convention', () => {
    expect(resolveResolution('1:1', '1080p')).toEqual({ width: 1080, height: 1080 });
    expect(resolveResolution('4:5', '1080p')).toEqual({ width: 1080, height: 1350 });
  });

  it.each(ASPECT_IDS.flatMap((a) => RESOLUTION_IDS.map((r) => [a, r] as const)))(
    '%s @ %s yields even dimensions within encoder limits',
    (aspect, resolution) => {
      const { width, height } = resolveResolution(aspect, resolution);
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(Math.max(width, height)).toBeLessThanOrEqual(8192);
      expect(width * height).toBeLessThanOrEqual(35_000_000);
    },
  );

  it.each(ASPECT_IDS.flatMap((a) => RESOLUTION_IDS.map((r) => [a, r] as const)))(
    '%s @ %s stays close to the requested aspect after rounding',
    (aspect, resolution) => {
      const { width, height } = resolveResolution(aspect, resolution);
      expect(width / height).toBeCloseTo(ASPECT_RATIOS[aspect], 1);
    },
  );

  it('grows monotonically with the resolution tier', () => {
    const areas = RESOLUTION_IDS.map((r) => {
      const { width, height } = resolveResolution('16:9', r);
      return width * height;
    });
    for (let i = 1; i < areas.length; i += 1) {
      expect(areas[i]!).toBeGreaterThan(areas[i - 1]!);
    }
  });
});

describe('clampToEncoderLimits', () => {
  it('leaves ordinary sizes untouched', () => {
    expect(clampToEncoderLimits({ width: 1920, height: 1080 })).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('rounds odd dimensions up to even', () => {
    expect(clampToEncoderLimits({ width: 1921, height: 1081 })).toEqual({
      width: 1922,
      height: 1082,
    });
  });

  it('scales oversized frames down while preserving aspect', () => {
    const result = clampToEncoderLimits({ width: 20000, height: 10000 });
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(8192);
    expect(result.width / result.height).toBeCloseTo(2, 1);
  });

  it('never returns a degenerate frame', () => {
    const result = clampToEncoderLimits({ width: 0.4, height: 0.2 });
    expect(result.width).toBeGreaterThanOrEqual(2);
    expect(result.height).toBeGreaterThanOrEqual(2);
  });
});

describe('camera framing', () => {
  it('fits the subject inside the frame on both axes', () => {
    const bounds = { width: 3, height: 2 };
    const fov = 35;
    for (const aspect of [16 / 9, 9 / 16, 1]) {
      const distance = fitCameraDistance(bounds, aspect, fov, 1.15);
      const visible = visibleSizeAt(distance, aspect, fov);
      expect(visible.width).toBeGreaterThanOrEqual(bounds.width * 1.15 - 1e-9);
      expect(visible.height).toBeGreaterThanOrEqual(bounds.height * 1.15 - 1e-9);
    }
  });

  it('pulls the camera back for a taller subject', () => {
    const near = fitCameraDistance({ width: 2, height: 2 }, 1, 35);
    const far = fitCameraDistance({ width: 2, height: 6 }, 1, 35);
    expect(far).toBeGreaterThan(near);
  });

  it('pulls the camera back for a narrower frame', () => {
    const wide = fitCameraDistance({ width: 4, height: 1 }, 16 / 9, 35);
    const tall = fitCameraDistance({ width: 4, height: 1 }, 9 / 16, 35);
    expect(tall).toBeGreaterThan(wide);
  });

  it('a wider lens needs less distance', () => {
    const narrowLens = fitCameraDistance({ width: 2, height: 2 }, 1, 20);
    const wideLens = fitCameraDistance({ width: 2, height: 2 }, 1, 60);
    expect(wideLens).toBeLessThan(narrowLens);
  });

  it('visible size honours the frame aspect', () => {
    const visible = visibleSizeAt(10, 16 / 9, 35);
    expect(visible.width / visible.height).toBeCloseTo(16 / 9, 12);
  });
});

describe('offsetToWorld', () => {
  const visible = { width: 8, height: 4.5 };

  it('maps the centre to the origin', () => {
    expect(offsetToWorld(0, 0, visible)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('maps ±1 to the frame edges', () => {
    expect(offsetToWorld(1, 1, visible)).toEqual({ x: 4, y: 2.25, z: 0 });
    expect(offsetToWorld(-1, -1, visible)).toEqual({ x: -4, y: -2.25, z: 0 });
  });
});

describe('frameCount', () => {
  it('multiplies duration by frame rate', () => {
    expect(frameCount(5, 30)).toBe(150);
    expect(frameCount(2.5, 24)).toBe(60);
    expect(frameCount(1, 60)).toBe(60);
  });

  it('always renders at least one frame', () => {
    expect(frameCount(0, 30)).toBe(1);
    expect(frameCount(-5, 30)).toBe(1);
    expect(frameCount(5, 0)).toBe(1);
    expect(frameCount(Number.NaN, 30)).toBe(1);
  });
});

describe('timeForFrame', () => {
  it('stops short of t=1 for seamless loops so no frame repeats', () => {
    const total = 4;
    expect(timeForFrame(0, total, true)).toBe(0);
    expect(timeForFrame(1, total, true)).toBe(0.25);
    expect(timeForFrame(3, total, true)).toBe(0.75);
    // t = 1 would duplicate frame 0, so it is never emitted.
    expect(timeForFrame(total - 1, total, true)).toBeLessThan(1);
  });

  it('lands exactly on t=1 for one-shot intros so they finish at rest', () => {
    const total = 5;
    expect(timeForFrame(0, total, false)).toBe(0);
    expect(timeForFrame(total - 1, total, false)).toBe(1);
  });

  it('clamps out-of-range indices', () => {
    expect(timeForFrame(-3, 10, false)).toBe(0);
    expect(timeForFrame(99, 10, false)).toBe(1);
  });

  it('handles single-frame clips', () => {
    expect(timeForFrame(0, 1, true)).toBe(0);
    expect(timeForFrame(0, 1, false)).toBe(1);
  });

  it('produces strictly increasing times', () => {
    for (const seamless of [true, false]) {
      let previous = -1;
      for (let i = 0; i < 30; i += 1) {
        const t = timeForFrame(i, 30, seamless);
        expect(t).toBeGreaterThan(previous);
        previous = t;
      }
    }
  });
});
