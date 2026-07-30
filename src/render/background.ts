import * as THREE from 'three';
import { gradientLine } from '../core/gradient.ts';
import type { Background } from '../core/types.ts';

/** Paint a project background onto a 2D context. Shared by the scene and PNG export. */
export function paintBackground(
  ctx: CanvasRenderingContext2D,
  background: Background,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  if (background.kind === 'transparent') return;

  if (background.kind === 'solid') {
    ctx.fillStyle = background.color;
  } else {
    const line = gradientLine(background.angle, width, height);
    const gradient = ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
    gradient.addColorStop(0, background.color);
    gradient.addColorStop(1, background.color2);
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, width, height);
}

/**
 * The scene backdrop, kept on its own canvas so gradients stay smooth
 * regardless of export resolution.
 */
export class BackgroundLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private signature = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 64;
    this.canvas.height = 64;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  /** Returns the texture to use as `scene.background`, or null when transparent. */
  update(background: Background, aspect: number): THREE.Texture | null {
    if (background.kind === 'transparent') return null;

    // Enough resolution for a smooth ramp; the GPU stretches it to the frame.
    const height = 512;
    const width = Math.max(2, Math.round(height * (Number.isFinite(aspect) ? aspect : 1)));
    const next = `${background.kind}|${background.color}|${background.color2}|${background.angle}|${width}`;
    if (next === this.signature) return this.texture;

    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (ctx) paintBackground(ctx, background, width, height);
    this.texture.needsUpdate = true;
    this.signature = next;
    return this.texture;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
