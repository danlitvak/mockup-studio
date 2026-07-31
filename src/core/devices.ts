import type { DeviceId } from './types.ts';

/**
 * Device geometry, described in abstract scene units rather than millimetres.
 * The renderer builds meshes from these numbers, so tweaking a mockup's
 * proportions never means touching Three.js code.
 */
export interface DeviceSpec {
  id: DeviceId;
  label: string;
  /** Screen width / height. */
  screenAspect: number;
  /** Screen height in scene units. */
  screenHeight: number;
  /** Body margin around the screen, per side. */
  bezel: number;
  /** Body corner radius. */
  cornerRadius: number;
  /** Body thickness along z. */
  bodyDepth: number;
  hasNotch: boolean;
  /** Browser-style title bar above the screen. */
  hasChrome: boolean;
  chromeHeight: number;
  /** Laptop-style base wedge below the screen. */
  hasBase: boolean;
  /** Base depth, from the hinge edge forward to the front lip. */
  baseDepth: number;
  /** Base thickness at the hinge edge. */
  baseThickness: number;
  /** Base thickness at the front lip — thinner, which is what makes it a wedge. */
  baseFrontThickness: number;
  /** How far the base overhangs the lid, per side. */
  baseOverhang: number;
  /** Radius of the hinge barrel running along the foot of the lid. */
  hingeRadius: number;
  /** Whether the media should be cropped to fill the screen (vs. contained). */
  defaultFill: boolean;
}

const SPECS: Record<DeviceId, DeviceSpec> = {
  phone: {
    id: 'phone',
    label: 'Phone',
    screenAspect: 9 / 19.5,
    screenHeight: 2.4,
    bezel: 0.055,
    cornerRadius: 0.17,
    bodyDepth: 0.1,
    hasNotch: true,
    hasChrome: false,
    chromeHeight: 0,
    hasBase: false,
    baseDepth: 0,
    baseThickness: 0,
    baseFrontThickness: 0,
    baseOverhang: 0,
    hingeRadius: 0,
    defaultFill: true,
  },
  tablet: {
    id: 'tablet',
    label: 'Tablet',
    screenAspect: 3 / 4,
    screenHeight: 2.5,
    bezel: 0.09,
    cornerRadius: 0.13,
    bodyDepth: 0.09,
    hasNotch: false,
    hasChrome: false,
    chromeHeight: 0,
    hasBase: false,
    baseDepth: 0,
    baseThickness: 0,
    baseFrontThickness: 0,
    baseOverhang: 0,
    hingeRadius: 0,
    defaultFill: true,
  },
  laptop: {
    id: 'laptop',
    label: 'Laptop',
    screenAspect: 16 / 10,
    screenHeight: 1.75,
    bezel: 0.05,
    cornerRadius: 0.06,
    bodyDepth: 0.05,
    hasNotch: false,
    hasChrome: false,
    chromeHeight: 0,
    hasBase: true,
    // The base is shallower than a real laptop's, which is roughly as deep as
    // its lid is tall. The lid faces the camera head-on here, so a true-to-life
    // depth would be seen almost edge-on and read as a slab under the screen.
    baseDepth: 1.24,
    baseThickness: 0.105,
    baseFrontThickness: 0.032,
    baseOverhang: 0.012,
    hingeRadius: 0.038,
    defaultFill: true,
  },
  browser: {
    id: 'browser',
    label: 'Browser',
    screenAspect: 16 / 9,
    screenHeight: 1.85,
    bezel: 0.014,
    cornerRadius: 0.07,
    bodyDepth: 0.045,
    hasNotch: false,
    hasChrome: true,
    chromeHeight: 0.17,
    hasBase: false,
    baseDepth: 0,
    baseThickness: 0,
    baseFrontThickness: 0,
    baseOverhang: 0,
    hingeRadius: 0,
    defaultFill: false,
  },
  screen: {
    id: 'screen',
    label: 'Screen only',
    screenAspect: 16 / 9,
    screenHeight: 2.0,
    bezel: 0,
    cornerRadius: 0.09,
    bodyDepth: 0.02,
    hasNotch: false,
    hasChrome: false,
    chromeHeight: 0,
    hasBase: false,
    baseDepth: 0,
    baseThickness: 0,
    baseFrontThickness: 0,
    baseOverhang: 0,
    hingeRadius: 0,
    defaultFill: false,
  },
};

export const DEVICE_IDS = Object.keys(SPECS) as DeviceId[];

export const isDeviceId = (value: unknown): value is DeviceId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SPECS, value);

export function getDevice(id: DeviceId): DeviceSpec {
  return SPECS[id];
}

export interface Size {
  width: number;
  height: number;
}

/** Size of the lit screen area. */
export function screenSize(spec: DeviceSpec): Size {
  return { width: spec.screenHeight * spec.screenAspect, height: spec.screenHeight };
}

/** Outer size of the device body, including bezel and any browser chrome. */
export function bodySize(spec: DeviceSpec): Size {
  const screen = screenSize(spec);
  return {
    width: screen.width + spec.bezel * 2,
    height: screen.height + spec.bezel * 2 + spec.chromeHeight,
  };
}

/**
 * Vertical offset of the screen's centre relative to the body's centre.
 * Browser chrome sits above the screen, which pushes the screen down.
 */
export function screenCenterOffsetY(spec: DeviceSpec): number {
  // Guard the zero case explicitly: `-0 / 2` is `-0`, which survives JSON
  // round-trips as `0` but compares unequal under Object.is.
  return spec.chromeHeight === 0 ? 0 : -spec.chromeHeight / 2;
}

/**
 * Where a deck feature sits: its size, and the depth of its centre measured in
 * the same frame as everything else — z grows towards the camera.
 */
export interface DeckFeature {
  width: number;
  depth: number;
  centerZ: number;
}

/** Every measurement the laptop base is built from, derived from the spec. */
export interface BaseLayout {
  /** Outer width, including the overhang past the lid on each side. */
  width: number;
  depth: number;
  /** Thickness at the hinge edge, raking down to `frontThickness` at the lip. */
  thickness: number;
  frontThickness: number;
  /** Height of the deck's top face, relative to the body's centre. */
  topY: number;
  /** Depth of the base's centre; it runs forward from the back of the lid. */
  centerZ: number;
  /** Corner radius of the base's footprint, matching the lid's. */
  radius: number;
  hinge: { radius: number; length: number; centerY: number };
  well: DeckFeature;
  trackpad: DeckFeature;
}

/**
 * Deck features as fractions of the base, running from the hinge edge forward.
 * These are a real laptop's proportions across the width but compressed along
 * the depth, to match the shallower base above.
 */
const DECK = {
  wellStart: 0.06,
  wellDepth: 0.44,
  wellWidth: 0.72,
  trackpadStart: 0.55,
  trackpadDepth: 0.36,
  trackpadWidth: 0.345,
} as const;

/**
 * How far the deck sits below the foot of the lid, in hinge radii. The lid
 * rests on the hinge barrel rather than on the deck itself, and that lip is
 * what keeps it from looking glued to a slab.
 */
const DECK_LIP = 0.55;

/**
 * How far the camera ends up from the mockup once it is framed, as a multiple
 * of the bounds it was given. It falls out of the stage's field of view and fit
 * margin, and it is deliberately the landscape — closest — case, because that
 * is the one where perspective distorts the most. Only the laptop needs it:
 * nothing else has geometry that runs far enough towards the camera to care.
 */
const FIT_DISTANCE_PER_HEIGHT = 2.3;

/**
 * Resolve the laptop base, or null for the devices that are a body and nothing
 * else. Doing it here rather than in the renderer keeps the arithmetic pure and
 * lets the framing below work from exactly the numbers the meshes are built at.
 */
export function baseLayout(spec: DeviceSpec): BaseLayout | null {
  if (!spec.hasBase) return null;
  const body = bodySize(spec);
  const width = body.width + spec.baseOverhang * 2;
  // The base's rear edge is flush with the back of the lid, so the deck runs
  // forward from there and the hinge sits over the join.
  const rearZ = -spec.bodyDepth / 2;
  const feature = (start: number, depth: number, fraction: number): DeckFeature => ({
    width: width * fraction,
    depth: spec.baseDepth * depth,
    centerZ: rearZ + spec.baseDepth * (start + depth / 2),
  });

  return {
    width,
    depth: spec.baseDepth,
    thickness: spec.baseThickness,
    frontThickness: spec.baseFrontThickness,
    topY: -body.height / 2 - spec.hingeRadius * DECK_LIP,
    centerZ: rearZ + spec.baseDepth / 2,
    radius: spec.cornerRadius,
    hinge: {
      radius: spec.hingeRadius,
      // Stop short of the lid's rounded corners, where there is no straight
      // edge for a barrel to sit against.
      length: body.width - spec.cornerRadius * 2,
      centerY: -body.height / 2,
    },
    well: feature(DECK.wellStart, DECK.wellDepth, DECK.wellWidth),
    trackpad: feature(DECK.trackpadStart, DECK.trackpadDepth, DECK.trackpadWidth),
  };
}

/**
 * Total bounding size of the mockup including the laptop base, used for
 * camera framing so nothing is clipped at the edge of the frame.
 */
export function mockupBounds(spec: DeviceSpec): Size {
  const body = bodySize(spec);
  const base = baseLayout(spec);
  if (!base) return body;

  const frontZ = base.centerZ + base.depth / 2;
  const rearDrop = -base.topY + base.thickness;
  const frontDrop = -base.topY + base.frontThickness;

  // The base runs towards the camera, so perspective magnifies its front lip
  // and its front corners — while framing works entirely in the z = 0 plane and
  // would clip them straight off the frame. The allowance for that depends on
  // where the camera settles, which depends on the allowance; solving the two
  // together is what collapses to the `frontZ / FIT_DISTANCE_PER_HEIGHT` term.
  const height = Math.max(
    body.height,
    rearDrop * 2,
    frontDrop * 2 + frontZ / FIT_DISTANCE_PER_HEIGHT,
  );
  const distance = height * FIT_DISTANCE_PER_HEIGHT;
  return {
    width: Math.max(body.width, (base.width * distance) / (distance - frontZ)),
    height,
  };
}
