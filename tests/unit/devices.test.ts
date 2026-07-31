import { describe, expect, it } from 'vitest';
import {
  DEVICE_IDS,
  baseLayout,
  bodySize,
  getDevice,
  isDeviceId,
  mockupBounds,
  screenCenterOffsetY,
  screenSize,
} from '../../src/core/devices.ts';
import { ASPECT_RATIOS, fitCameraDistance, visibleSizeAt } from '../../src/core/framing.ts';

/** The stage's camera — see FOV and FIT_MARGIN in src/render/stage.ts. */
const FOV = 32;
const FIT_MARGIN = 1.32;

describe('devices', () => {
  it('exposes the full device set', () => {
    expect(DEVICE_IDS).toEqual(['phone', 'tablet', 'laptop', 'browser', 'screen']);
  });

  it.each(DEVICE_IDS)('%s resolves to a coherent spec', (id) => {
    const spec = getDevice(id);
    expect(spec.id).toBe(id);
    expect(spec.label).toBeTruthy();
    expect(spec.screenAspect).toBeGreaterThan(0);
    expect(spec.screenHeight).toBeGreaterThan(0);
    expect(spec.bezel).toBeGreaterThanOrEqual(0);
    expect(spec.cornerRadius).toBeGreaterThanOrEqual(0);
    expect(spec.bodyDepth).toBeGreaterThan(0);
    expect(spec.baseDepth).toBeGreaterThanOrEqual(0);
    expect(spec.baseThickness).toBeGreaterThanOrEqual(0);
    expect(spec.baseFrontThickness).toBeGreaterThanOrEqual(0);
    expect(spec.baseOverhang).toBeGreaterThanOrEqual(0);
    expect(spec.hingeRadius).toBeGreaterThanOrEqual(0);
  });

  it.each(DEVICE_IDS)('%s has a base only if it is described as a wedge', (id) => {
    const spec = getDevice(id);
    expect(spec.hasBase).toBe(spec.baseDepth > 0);
    if (!spec.hasBase) return;
    // A base thinner at the front than at the hinge is what makes it a wedge
    // rather than the slab it used to be, and it needs a hinge to hang off.
    expect(spec.baseFrontThickness).toBeGreaterThan(0);
    expect(spec.baseFrontThickness).toBeLessThan(spec.baseThickness);
    expect(spec.hingeRadius).toBeGreaterThan(spec.bodyDepth / 2);
  });

  it('recognises valid ids and rejects everything else', () => {
    expect(isDeviceId('phone')).toBe(true);
    expect(isDeviceId('watch')).toBe(false);
    expect(isDeviceId(null)).toBe(false);
    expect(isDeviceId(42)).toBe(false);
    // Must not be fooled by inherited Object properties.
    expect(isDeviceId('toString')).toBe(false);
    expect(isDeviceId('constructor')).toBe(false);
  });

  it.each(DEVICE_IDS)('%s screen respects its aspect ratio', (id) => {
    const spec = getDevice(id);
    const screen = screenSize(spec);
    expect(screen.width / screen.height).toBeCloseTo(spec.screenAspect, 12);
    expect(screen.height).toBe(spec.screenHeight);
  });

  it.each(DEVICE_IDS)('%s body fully contains its screen', (id) => {
    const spec = getDevice(id);
    const screen = screenSize(spec);
    const body = bodySize(spec);
    expect(body.width).toBeGreaterThanOrEqual(screen.width);
    expect(body.height).toBeGreaterThanOrEqual(screen.height);
  });

  it.each(DEVICE_IDS)('%s bounds contain the body', (id) => {
    const spec = getDevice(id);
    const body = bodySize(spec);
    const bounds = mockupBounds(spec);
    expect(bounds.width).toBeGreaterThanOrEqual(body.width);
    expect(bounds.height).toBeGreaterThanOrEqual(body.height);
  });

  it('a phone is portrait and a browser is landscape', () => {
    expect(getDevice('phone').screenAspect).toBeLessThan(1);
    expect(getDevice('browser').screenAspect).toBeGreaterThan(1);
  });

  it('the screen-only device has no bezel or chrome', () => {
    const spec = getDevice('screen');
    expect(spec.bezel).toBe(0);
    expect(spec.hasChrome).toBe(false);
    expect(bodySize(spec)).toEqual(screenSize(spec));
  });

  it('browser chrome pushes the screen below the body centre', () => {
    expect(screenCenterOffsetY(getDevice('browser'))).toBeLessThan(0);
    expect(screenCenterOffsetY(getDevice('phone'))).toBe(0);
  });

  it.each(DEVICE_IDS)('%s has a base layout exactly when it has a base', (id) => {
    const spec = getDevice(id);
    expect(baseLayout(spec) === null).toBe(!spec.hasBase);
  });

  it('the laptop base widens the overall bounds', () => {
    const spec = getDevice('laptop');
    expect(spec.hasBase).toBe(true);
    expect(mockupBounds(spec).width).toBeGreaterThan(bodySize(spec).width);
    expect(mockupBounds(spec).height).toBeGreaterThan(bodySize(spec).height);
  });

  it('the laptop base runs forward from the back of the lid', () => {
    const spec = getDevice('laptop');
    const base = baseLayout(spec);
    if (!base) throw new Error('the laptop has a base');
    expect(base.width).toBeGreaterThan(bodySize(spec).width);
    expect(base.centerZ - base.depth / 2).toBeCloseTo(-spec.bodyDepth / 2, 12);
    // The lid rests on the hinge barrel, so the deck sits a lip below its foot.
    expect(base.topY).toBeLessThan(-bodySize(spec).height / 2);
    expect(base.hinge.length).toBeLessThan(bodySize(spec).width);
    expect(base.hinge.length).toBeGreaterThan(0);
  });

  it('the laptop deck holds the keyboard and the trackpad clear of each other', () => {
    const spec = getDevice('laptop');
    const base = baseLayout(spec);
    if (!base) throw new Error('the laptop has a base');
    const rearZ = base.centerZ - base.depth / 2;
    const frontZ = base.centerZ + base.depth / 2;

    for (const feature of [base.well, base.trackpad]) {
      expect(feature.width).toBeGreaterThan(0);
      expect(feature.width).toBeLessThan(base.width);
      expect(feature.centerZ - feature.depth / 2).toBeGreaterThan(rearZ);
      expect(feature.centerZ + feature.depth / 2).toBeLessThan(frontZ);
    }

    // The trackpad belongs in front of the keyboard, on the palm rest.
    expect(base.trackpad.centerZ - base.trackpad.depth / 2).toBeGreaterThan(
      base.well.centerZ + base.well.depth / 2,
    );
    expect(base.trackpad.width).toBeLessThan(base.well.width);
  });

  it('the laptop bounds keep the base inside the frame at every aspect', () => {
    const spec = getDevice('laptop');
    const base = baseLayout(spec);
    if (!base) throw new Error('the laptop has a base');
    const body = bodySize(spec);
    const bounds = mockupBounds(spec);
    // The corners that decide the framing: the top of the lid, and the two ends
    // of the base — the front lip is nearest the camera and so the most
    // magnified, the rear edge hangs the lowest in plain 3D.
    const corners = [
      { x: body.width / 2, y: body.height / 2, z: spec.bodyDepth / 2 },
      { x: base.width / 2, y: base.topY - base.frontThickness, z: base.centerZ + base.depth / 2 },
      { x: base.width / 2, y: base.topY - base.thickness, z: base.centerZ - base.depth / 2 },
    ];

    for (const frameAspect of Object.values(ASPECT_RATIOS)) {
      const distance = fitCameraDistance(bounds, frameAspect, FOV, FIT_MARGIN);
      const visible = visibleSizeAt(distance, frameAspect, FOV);
      for (const corner of corners) {
        // What the perspective divide does to a corner that is not at z = 0.
        const magnified = distance / (distance - corner.z);
        expect(Math.abs(corner.x) * magnified).toBeLessThan(visible.width / 2);
        expect(Math.abs(corner.y) * magnified).toBeLessThan(visible.height / 2);
      }
    }
  });
});
