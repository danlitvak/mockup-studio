import * as THREE from 'three';
import { fitRect, type FitMode } from '../core/fit.ts';

/** Anything we can draw into the device screen. */
export type MediaSource = HTMLImageElement | HTMLVideoElement | ImageBitmap;

/** The longest edge of the screen canvas — enough detail for a 4K export. */
const SCREEN_LONG_EDGE = 1800;

const sourceSize = (source: MediaSource): { width: number; height: number } => {
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  return { width: source.width, height: source.height };
};

const isVideo = (source: MediaSource): source is HTMLVideoElement =>
  typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;

/**
 * Composites the user's media into the device screen.
 *
 * Doing this on a 2D canvas rather than with texture UV tricks means `cover`
 * and `contain` share one code path, letterbox bars are real pixels, and the
 * device geometry never has to bend to the media's aspect ratio.
 */
export class ScreenSurface {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private source: MediaSource | null = null;
  private fit: FitMode = 'cover';
  private aspect = 0.5;
  private dirty = true;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2;
    this.canvas.height = 2;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
  }

  setMedia(source: MediaSource | null): void {
    this.source = source;
    this.dirty = true;
  }

  setLayout(screenAspect: number, fit: FitMode): void {
    const safeAspect = Number.isFinite(screenAspect) && screenAspect > 0 ? screenAspect : 1;
    if (safeAspect === this.aspect && fit === this.fit) return;
    this.aspect = safeAspect;
    this.fit = fit;
    this.dirty = true;
  }

  /** True when the media changes on its own and must be re-read every frame. */
  get isLive(): boolean {
    return this.source !== null && isVideo(this.source);
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Redraw if anything changed. Cheap to call every frame. */
  update(): void {
    if (!this.dirty && !this.isLive) return;
    const ctx = this.ctx;
    if (!ctx) return;

    const width = this.aspect >= 1 ? SCREEN_LONG_EDGE : Math.round(SCREEN_LONG_EDGE * this.aspect);
    const height = this.aspect >= 1 ? Math.round(SCREEN_LONG_EDGE / this.aspect) : SCREEN_LONG_EDGE;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    // Letterbox bars and the "screen off" state share this backdrop.
    ctx.fillStyle = '#0b0b0e';
    ctx.fillRect(0, 0, width, height);

    const source = this.source;
    if (source) {
      const size = sourceSize(source);
      if (size.width > 0 && size.height > 0) {
        const rect = fitRect(size.width, size.height, width, height, this.fit);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        try {
          ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
        } catch {
          // A video that has not produced a frame yet throws; the backdrop
          // stays and the next update picks it up.
        }
      }
    }

    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  dispose(): void {
    this.texture.dispose();
    this.source = null;
  }
}
