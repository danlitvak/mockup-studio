import { describe, expect, it } from 'vitest';
import {
  QUALITY_IDS,
  bitrateFor,
  codecFor,
  estimateBytes,
  exportFilename,
  extensionFor,
  formatBytes,
  mimeFor,
} from '../../src/core/export-config.ts';

describe('bitrateFor', () => {
  it('rises with resolution', () => {
    const hd = bitrateFor(1280, 720, 30, 'high');
    const fhd = bitrateFor(1920, 1080, 30, 'high');
    const uhd = bitrateFor(3840, 2160, 30, 'high');
    expect(fhd).toBeGreaterThan(hd);
    expect(uhd).toBeGreaterThan(fhd);
  });

  it('rises with frame rate', () => {
    expect(bitrateFor(1920, 1080, 60, 'high')).toBeGreaterThan(bitrateFor(1920, 1080, 30, 'high'));
  });

  it('rises with each quality step', () => {
    const values = QUALITY_IDS.map((q) => bitrateFor(1920, 1080, 30, q));
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
  });

  it('lands in a sane range for 1080p30 high', () => {
    const bitrate = bitrateFor(1920, 1080, 30, 'high');
    expect(bitrate).toBeGreaterThan(5_000_000);
    expect(bitrate).toBeLessThan(12_000_000);
  });

  it('clamps tiny and enormous frames into encodable territory', () => {
    expect(bitrateFor(16, 16, 1, 'low')).toBeGreaterThanOrEqual(800_000);
    expect(bitrateFor(8192, 4320, 60, 'very-high')).toBeLessThanOrEqual(160_000_000);
  });

  it('returns whole numbers', () => {
    for (const q of QUALITY_IDS) {
      expect(Number.isInteger(bitrateFor(1920, 1080, 30, q))).toBe(true);
    }
  });
});

describe('format helpers', () => {
  it('pairs each container with a compatible codec', () => {
    expect(codecFor('mp4')).toBe('avc');
    expect(codecFor('webm')).toBe('vp9');
  });

  it('reports matching mime types and extensions', () => {
    expect(mimeFor('mp4')).toBe('video/mp4');
    expect(mimeFor('webm')).toBe('video/webm');
    expect(extensionFor('mp4')).toBe('mp4');
    expect(extensionFor('webm')).toBe('webm');
  });
});

describe('estimateBytes', () => {
  it('converts bitrate and duration into bytes', () => {
    expect(estimateBytes(8_000_000, 10)).toBe(10_000_000);
  });

  it('never returns a negative size', () => {
    expect(estimateBytes(8_000_000, -5)).toBe(0);
  });
});

describe('formatBytes', () => {
  it('picks a readable unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(1536 * 1024 * 1024)).toBe('1.5 GB');
  });

  it('drops the decimal for larger numbers', () => {
    expect(formatBytes(45 * 1024 * 1024)).toBe('45 MB');
  });
});

describe('exportFilename', () => {
  it('slugifies the project name', () => {
    expect(exportFilename('My Cool App', 'mp4')).toBe('my-cool-app.mp4');
    expect(exportFilename('Launch  Video!! 2026', 'webm')).toBe('launch-video-2026.webm');
  });

  it('falls back when the name has nothing usable', () => {
    expect(exportFilename('', 'mp4')).toBe('mockup.mp4');
    expect(exportFilename('***', 'mp4')).toBe('mockup.mp4');
    expect(exportFilename('   ', 'mp4')).toBe('mockup.mp4');
  });

  it('strips characters that break filesystems', () => {
    const name = exportFilename('a/b\\c:d*e?f"g<h>i|j', 'mp4');
    expect(name).toBe('a-b-c-d-e-f-g-h-i-j.mp4');
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
  });

  it('caps the length', () => {
    const name = exportFilename('x'.repeat(500), 'mp4');
    expect(name.length).toBeLessThanOrEqual(65);
  });

  it('never leaves a leading or trailing dash', () => {
    expect(exportFilename('  --hello--  ', 'mp4')).toBe('hello.mp4');
  });
});
