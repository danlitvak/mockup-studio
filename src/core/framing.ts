import type { AspectId, ResolutionId, Vec3 } from './types.ts';
import type { Size } from './devices.ts';

/** Frame width / height for each aspect preset. */
export const ASPECT_RATIOS: Record<AspectId, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '21:9': 21 / 9,
};

export const ASPECT_IDS = Object.keys(ASPECT_RATIOS) as AspectId[];

/**
 * Resolution tiers are defined by the *short* edge, so "4K" means 2160 pixels
 * tall in landscape and 2160 wide in portrait — matching what 4K means for
 * both a YouTube upload and a vertical App Store preview.
 */
export const RESOLUTION_SHORT_EDGE: Record<ResolutionId, number> = {
  '720p': 720,
  '1080p': 1080,
  '1440p': 1440,
  '4k': 2160,
};

export const RESOLUTION_IDS = Object.keys(RESOLUTION_SHORT_EDGE) as ResolutionId[];

export const RESOLUTION_LABELS: Record<ResolutionId, string> = {
  '720p': '720p',
  '1080p': '1080p',
  '1440p': '1440p',
  '4k': '4K',
};

/** Video encoders require even dimensions; chroma subsampling works on 2×2 blocks. */
const toEven = (n: number): number => {
  const rounded = Math.round(n);
  return rounded % 2 === 0 ? rounded : rounded + 1;
};

/** Generous ceilings that still keep us inside what browser encoders accept. */
const MAX_EDGE = 8192;
const MAX_PIXELS = 35_000_000;

/**
 * Scale a frame down, preserving aspect, until it fits within encoder limits.
 * Ultra-wide at 4K is the only preset combination that gets close.
 */
export function clampToEncoderLimits(size: Size): Size {
  let { width, height } = size;
  const edgeScale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)));
  const scale = Math.min(edgeScale, pixelScale);
  if (scale < 1) {
    width *= scale;
    height *= scale;
  }
  return { width: Math.max(2, toEven(width)), height: Math.max(2, toEven(height)) };
}

/** Pixel dimensions for an aspect + resolution pairing. */
export function resolveResolution(aspect: AspectId, resolution: ResolutionId): Size {
  const ratio = ASPECT_RATIOS[aspect];
  const shortEdge = RESOLUTION_SHORT_EDGE[resolution];
  const raw: Size =
    ratio >= 1
      ? { width: shortEdge * ratio, height: shortEdge }
      : { width: shortEdge, height: shortEdge / ratio };
  return clampToEncoderLimits(raw);
}

/** Half-angle helper shared by the fit and visible-size calculations. */
const halfFovTan = (fovDeg: number): number => Math.tan((fovDeg * Math.PI) / 360);

/**
 * Camera distance at which an object of `bounds` fits inside the frame with
 * `margin` headroom (1.15 = 15% padding). Accounts for both axes so a portrait
 * frame doesn't crop a wide laptop.
 */
export function fitCameraDistance(
  bounds: Size,
  frameAspect: number,
  fovDeg: number,
  margin = 1.15,
): number {
  const t = halfFovTan(fovDeg);
  const byHeight = (bounds.height * margin) / 2 / t;
  const byWidth = (bounds.width * margin) / 2 / (t * frameAspect);
  return Math.max(byHeight, byWidth);
}

/** World-space size of the plane at `distance` in front of a perspective camera. */
export function visibleSizeAt(distance: number, frameAspect: number, fovDeg: number): Size {
  const height = 2 * distance * halfFovTan(fovDeg);
  return { width: height * frameAspect, height };
}

/**
 * Convert the UI's frame-relative offset (-1..1, where 1 is the frame edge)
 * into world units at the subject's depth.
 */
export function offsetToWorld(offsetX: number, offsetY: number, visible: Size): Vec3 {
  return { x: (offsetX * visible.width) / 2, y: (offsetY * visible.height) / 2, z: 0 };
}

/** Total frames in a clip. Always at least one so a still image still renders. */
export function frameCount(duration: number, fps: number): number {
  if (!Number.isFinite(duration) || !Number.isFinite(fps) || duration <= 0 || fps <= 0) return 1;
  return Math.max(1, Math.round(duration * fps));
}

/**
 * Normalised time for a frame index.
 *
 * For a seamless loop the last rendered frame must stop *short* of t = 1,
 * because t = 1 is the same pose as t = 0 and would show twice. One-shot
 * intros do the opposite: the last frame must land exactly on the rest pose.
 */
export function timeForFrame(index: number, totalFrames: number, seamless: boolean): number {
  if (totalFrames <= 1) return seamless ? 0 : 1;
  const clamped = Math.min(Math.max(index, 0), totalFrames - 1);
  return seamless ? clamped / totalFrames : clamped / (totalFrames - 1);
}
