import type { ExportFormat, QualityId } from './types.ts';

/**
 * Bitrate planning. Kept away from the encoder so it can be unit-tested and
 * shown in the UI ("~12 MB") before the user commits to a long export.
 */

/** Bits per pixel per frame. Tuned so 1080p30 "high" lands around 8 Mbps. */
const BITS_PER_PIXEL: Record<QualityId, number> = {
  low: 0.05,
  medium: 0.09,
  high: 0.14,
  'very-high': 0.22,
};

export const QUALITY_IDS = Object.keys(BITS_PER_PIXEL) as QualityId[];

export const QUALITY_LABELS: Record<QualityId, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  'very-high': 'Very high',
};

const MIN_BITRATE = 800_000;
const MAX_BITRATE = 160_000_000;

export function bitrateFor(
  width: number,
  height: number,
  fps: number,
  quality: QualityId,
): number {
  const bpp = BITS_PER_PIXEL[quality];
  const raw = width * height * fps * bpp;
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw)));
}

/** Codec identifier in mediabunny's vocabulary. */
export function codecFor(format: ExportFormat): 'avc' | 'vp9' {
  return format === 'mp4' ? 'avc' : 'vp9';
}

export function mimeFor(format: ExportFormat): string {
  return format === 'mp4' ? 'video/mp4' : 'video/webm';
}

export function extensionFor(format: ExportFormat): string {
  return format === 'mp4' ? 'mp4' : 'webm';
}

/** Rough encoded size in bytes, for the pre-export estimate in the UI. */
export function estimateBytes(bitrate: number, duration: number): number {
  return Math.round((bitrate * Math.max(0, duration)) / 8);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Filename that is safe on every OS and still recognisable. */
export function exportFilename(projectName: string, format: ExportFormat): string {
  const base =
    projectName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'mockup';
  return `${base}.${extensionFor(format)}`;
}
