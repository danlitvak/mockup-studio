/**
 * Easing functions. All are pure and defined on [0, 1] with f(0) = 0 and
 * f(1) = 1, except `easeOutBack` which deliberately overshoots in between.
 */

export type Easing = (t: number) => number;

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

export const linear: Easing = (t) => clamp01(t);

export const easeInOutCubic: Easing = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export const easeOutCubic: Easing = (t) => {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
};

export const easeInOutSine: Easing = (t) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

export const easeOutBack: Easing = (t) => {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** Remap `t` from [a, b] onto [0, 1], clamped outside that window. */
export const window01 = (t: number, a: number, b: number): number => {
  if (b <= a) return t < a ? 0 : 1;
  return clamp01((t - a) / (b - a));
};

/** Linear interpolation. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const DEG = Math.PI / 180;
