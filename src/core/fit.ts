export type FitMode = 'cover' | 'contain';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where to draw source media inside the device screen.
 *
 * `cover` crops the overflow so the screen is completely filled — what you
 * want for a screenshot taken on the same device shape. `contain` letterboxes
 * instead, so a portrait capture dropped into a browser frame stays whole.
 *
 * Returns a destination rect in the target's coordinate space, which is
 * exactly what `CanvasRenderingContext2D.drawImage` takes.
 */
export function fitRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: FitMode,
): Rect {
  const safeSourceW = sourceWidth > 0 ? sourceWidth : 1;
  const safeSourceH = sourceHeight > 0 ? sourceHeight : 1;
  const sourceAspect = safeSourceW / safeSourceH;
  const targetAspect = targetWidth / targetHeight;

  // Whether the source is relatively wider than the target decides which axis
  // overflows under `cover` and which one gets bars under `contain`.
  const sourceIsWider = sourceAspect > targetAspect;
  const matchWidth = mode === 'cover' ? !sourceIsWider : sourceIsWider;

  const width = matchWidth ? targetWidth : targetHeight * sourceAspect;
  const height = matchWidth ? targetWidth / sourceAspect : targetHeight;

  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

/** Default fit for a device: phones and tablets fill, windowed frames contain. */
export const defaultFitFor = (deviceFills: boolean): FitMode => (deviceFills ? 'cover' : 'contain');
