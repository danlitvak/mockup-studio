export interface GradientLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Endpoints of a CSS-style linear gradient across a rectangle.
 *
 * Angles follow the CSS convention: 0° points to the top, 90° to the right.
 * The line is sized so the gradient reaches both far corners rather than
 * running out early on a diagonal.
 *
 * Coordinates are in canvas space, where y grows downward.
 */
export function gradientLine(angleDeg: number, width: number, height: number): GradientLine {
  const radians = ((Number.isFinite(angleDeg) ? angleDeg : 0) * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);

  // Projection of the rectangle onto the gradient direction.
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = width / 2;
  const cy = height / 2;

  return {
    x0: cx - (dx * length) / 2,
    y0: cy - (dy * length) / 2,
    x1: cx + (dx * length) / 2,
    y1: cy + (dy * length) / 2,
  };
}
