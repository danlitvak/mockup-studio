import { describe, expect, it } from 'vitest';
import {
  DEVICE_IDS,
  bodySize,
  getDevice,
  isDeviceId,
  mockupBounds,
  screenCenterOffsetY,
  screenSize,
} from '../../src/core/devices.ts';

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

  it('the laptop base widens the overall bounds', () => {
    const spec = getDevice('laptop');
    expect(spec.hasBase).toBe(true);
    expect(mockupBounds(spec).width).toBeGreaterThan(bodySize(spec).width);
  });
});
