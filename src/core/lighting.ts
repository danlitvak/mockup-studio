import { DEG, clamp01, lerp } from './easing.ts';
import type { SceneSettings, Vec3 } from './types.ts';

/**
 * Where the lights go and what colour they are.
 *
 * Kept out of the renderer for the usual reason: it is arithmetic, so it can be
 * tested in plain Node, and three.js is left only to place what has already been
 * worked out.
 *
 * The three lights are derived from one angle rather than being aimed
 * independently. A key light the user can put anywhere, with a fill and a rim
 * that wander off on their own, mostly produces lighting that looks broken —
 * tying them together means turning the dial rotates a whole coherent rig.
 */

export interface LightRig {
  key: Vec3;
  fill: Vec3;
  rim: Vec3;
  /** `#rrggbb`, warmed or cooled from white. */
  keyColor: string;
  fillColor: string;
  intensities: {
    ambient: number;
    key: number;
    fill: number;
    rim: number;
  };
}

/** Distance the lights sit from the origin. Only the direction matters. */
const RADIUS = 7.8;

/** Base intensities, scaled by the scene's own controls. */
const BASE = { ambient: 1.1, key: 2.1, fill: 0.75, rim: 1.1 };

/**
 * How far round from the key the fill and rim sit, in degrees.
 *
 * The fill stays on the camera's side of the device on purpose. These are flat
 * slabs facing the viewer, so only a light with a component toward the camera
 * reaches a surface anyone can see — swing the fill behind and it stops filling
 * anything. The rim is behind by definition and is kept deliberately weak: on a
 * shape this flat there is no silhouette for it to draw, and measured across its
 * whole range it moved the frame by well under one percent, which is why it is
 * fixed here rather than being offered as a control that does nothing.
 */
const FILL_OFFSET = -85;
const RIM_OFFSET = 195;

/** Fixed rim contribution — see above. */
const RIM_LEVEL = 1;

/**
 * Fold an azimuth into the half of the circle facing the camera.
 *
 * Mirroring across the ±90° line rather than clamping to it: the fill keeps
 * tracking the key as it turns, and the mapping is continuous at the boundary,
 * so there is no jump as the key swings past the side. The user is free to put
 * the key behind the device for a backlit look — the fill staying in front is
 * what keeps the visible face readable when they do.
 */
const toFrontHalf = (azimuth: number): number => {
  const wrapped = ((azimuth % 360) + 360) % 360;
  return wrapped > 90 && wrapped < 270 ? 180 - wrapped : wrapped;
};

const positionAt = (azimuth: number, elevation: number): Vec3 => {
  const a = azimuth * DEG;
  const e = elevation * DEG;
  const horizontal = Math.cos(e) * RADIUS;
  return {
    x: horizontal * Math.sin(a),
    y: Math.sin(e) * RADIUS,
    z: horizontal * Math.cos(a),
  };
};

const channel = (value: number): string =>
  Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, '0');

const toHex = (r: number, g: number, b: number): string =>
  `#${channel(r)}${channel(g)}${channel(b)}`;

/**
 * Warm and cool ends of the key light.
 *
 * Warmth runs -1 (overcast daylight) through 0 (neutral) to 1 (tungsten). The
 * mix is done per channel rather than by colour temperature maths because the
 * ends are chosen to look right, not to be physically accurate.
 */
const COOL = { r: 0.76, g: 0.85, b: 1 };
const WARM = { r: 1, g: 0.86, b: 0.68 };

export function tintForWarmth(warmth: number): string {
  const w = Number.isFinite(warmth) ? Math.min(1, Math.max(-1, warmth)) : 0;
  const end = w >= 0 ? WARM : COOL;
  const amount = Math.abs(w);
  return toHex(lerp(1, end.r, amount), lerp(1, end.g, amount), lerp(1, end.b, amount));
}

const safe = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

export function lightRig(scene: SceneSettings): LightRig {
  const angle = safe(scene.lightAngle, 27);
  const elevation = safe(scene.lightElevation, 31);
  const overall = Math.max(0, safe(scene.lightIntensity, 1));

  return {
    key: positionAt(angle, elevation),
    // Low and to the other side of the camera, lifting the shaded face.
    fill: positionAt(toFrontHalf(angle + FILL_OFFSET), Math.min(elevation, 10) - 20),
    rim: positionAt(angle + RIM_OFFSET, elevation * 0.5 + 12),
    keyColor: tintForWarmth(scene.lightWarmth),
    // The fill leans the opposite way to the key, which is what stops a warm
    // scene turning uniformly orange.
    fillColor: tintForWarmth(-safe(scene.lightWarmth, 0) * 0.6),
    intensities: {
      ambient: BASE.ambient * overall * Math.max(0, safe(scene.ambientIntensity, 1)),
      key: BASE.key * overall,
      fill: BASE.fill * overall * Math.max(0, safe(scene.fillIntensity, 1)),
      rim: BASE.rim * overall * RIM_LEVEL,
    },
  };
}
