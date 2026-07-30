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
    defaultFill: true,
  },
  laptop: {
    id: 'laptop',
    label: 'Laptop',
    screenAspect: 16 / 10,
    screenHeight: 1.75,
    bezel: 0.05,
    cornerRadius: 0.06,
    bodyDepth: 0.06,
    hasNotch: false,
    hasChrome: false,
    chromeHeight: 0,
    hasBase: true,
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
 * Total bounding size of the mockup including the laptop base, used for
 * camera framing so nothing is clipped at the edge of the frame.
 */
export function mockupBounds(spec: DeviceSpec): Size {
  const body = bodySize(spec);
  if (!spec.hasBase) return body;
  // The base is wider than the lid and sits below it.
  return { width: body.width * 1.12, height: body.height + 0.16 };
}
