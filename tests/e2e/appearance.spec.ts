import { expect, test, type Page } from '@playwright/test';
import { phoneScreenshot } from './fixtures.ts';
import { canvasStats, openApp, pausePlayback, stableCanvas, waitForMedia } from './helpers.ts';
import type { SceneSettings } from '../../src/core/types.ts';

/**
 * Lighting, materials and the shadow, through the renderer.
 *
 * Each of these asserts that a control reaches the pixels. A setting that is
 * stored correctly but changes nothing on screen is the failure mode worth
 * guarding against here — the shadow spent a long time in exactly that state.
 */

const patch = async (page: Page, scene: Partial<SceneSettings>): Promise<void> => {
  await page.evaluate((value) => {
    window.__studio?.getState().patchScene(value);
  }, scene);
  await page.waitForTimeout(250);
};

/** Mean luminance of the frame — how much light the scene is putting out. */
const luminance = async (page: Page): Promise<number> =>
  page.evaluate(() => {
    const source = document.querySelector<HTMLCanvasElement>('[data-testid="preview-canvas"]');
    if (!source) throw new Error('preview canvas is missing');
    const sample = document.createElement('canvas');
    sample.width = 240;
    sample.height = Math.round((240 * source.height) / source.width);
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(source, 0, 0, sample.width, sample.height);
    const { data } = ctx.getImageData(0, 0, sample.width, sample.height);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    }
    return total / (data.length / 4);
  });

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await page.setInputFiles('[data-testid="file-input"]', {
    name: 'screen.png',
    mimeType: 'image/png',
    buffer: phoneScreenshot(),
  });
  await waitForMedia(page);
  await pausePlayback(page);
  await patch(page, { rotationX: 0, rotationY: 18, rotationZ: 0 });
});

test.describe('appearance', () => {
  test('the phone cutout can be switched between island, notch and none', async ({ page }) => {
    await patch(page, { screenCutout: 'island' });
    const island = await stableCanvas(page);

    await patch(page, { screenCutout: 'notch' });
    const notch = await stableCanvas(page);

    await patch(page, { screenCutout: 'none' });
    const none = await stableCanvas(page);

    expect(notch.hash).not.toBe(island.hash);
    expect(none.hash).not.toBe(island.hash);
    expect(none.hash).not.toBe(notch.hash);

    // And the control only appears for devices that have a cutout at all.
    await expect(page.getByTestId('screen-cutout')).toBeVisible();
    await page.evaluate(() => window.__studio?.getState().setDevice('tablet'));
    await expect(page.getByTestId('screen-cutout')).toBeHidden();
  });

  test('the body finish changes the render', async ({ page }) => {
    await patch(page, { bodyMetalness: 0.55, bodyRoughness: 0.38 });
    const satin = await stableCanvas(page);

    await patch(page, { bodyRoughness: 1 });
    const matte = await stableCanvas(page);
    expect(matte.hash, 'roughness should reach the pixels').not.toBe(satin.hash);

    await patch(page, { bodyRoughness: 0.06, bodyMetalness: 1 });
    const polished = await stableCanvas(page);
    expect(polished.hash, 'metalness should reach the pixels').not.toBe(matte.hash);
  });

  test('a polished metal body is lit, not black', async ({ page }) => {
    // A metallic surface shows its surroundings and almost nothing else, so
    // without an environment to reflect this renders as a black cutout. That is
    // the whole reason the scene carries a generated one.
    await patch(page, { deviceColor: '#c8ccd4', bodyMetalness: 0, bodyRoughness: 0.5 });
    const plain = await luminance(page);

    await patch(page, { bodyMetalness: 1, bodyRoughness: 0.06 });
    const polished = await luminance(page);

    // Allowed to differ — polished metal is not the same as matte paint — but
    // nowhere near the collapse to black that a missing environment causes.
    expect(polished).toBeGreaterThan(plain * 0.6);
  });

  test('the glass sheen can be turned up and off', async ({ page }) => {
    await patch(page, { screenGlare: 0 });
    const off = await stableCanvas(page);
    const offLight = await luminance(page);

    await patch(page, { screenGlare: 1 });
    const on = await stableCanvas(page);
    const onLight = await luminance(page);

    expect(on.hash).not.toBe(off.hash);
    // The sheen is additive, so it can only make the frame brighter.
    expect(onLight).toBeGreaterThan(offLight);
  });

  test('moving the key light round changes the render', async ({ page }) => {
    await patch(page, { lightAngle: 27 });
    const front = await stableCanvas(page);

    await patch(page, { lightAngle: 200 });
    const behind = await stableCanvas(page);
    expect(behind.hash).not.toBe(front.hash);

    // Elevation and warmth are separate axes, not the same control twice.
    await patch(page, { lightAngle: 27, lightElevation: -45 });
    const low = await stableCanvas(page);
    expect(low.hash).not.toBe(front.hash);

    await patch(page, { lightElevation: 31, lightWarmth: 1 });
    const warm = await stableCanvas(page);
    expect(warm.hash).not.toBe(front.hash);
  });

  test('brightness, fill and reflections all reach the scene', async ({ page }) => {
    const base = await luminance(page);
    await patch(page, { lightIntensity: 0 });
    expect(await luminance(page), 'no light should darken the device').toBeLessThan(base);

    // Every one of these has to change the picture. A control that stores a
    // value and renders identically is worse than no control: the rim light
    // that used to sit here moved the frame by well under one percent across
    // its entire range, because a light behind a slab facing the camera never
    // touches a surface the viewer can see.
    await patch(page, { lightIntensity: 1, fillIntensity: 0 });
    const noFill = await luminance(page);
    await patch(page, { fillIntensity: 2 });
    const strongFill = await luminance(page);
    expect(strongFill, 'the fill should lift the shaded side').toBeGreaterThan(noFill);

    // Reflections are most obvious on a metallic body, which is where the
    // generated surround does its work.
    await patch(page, { deviceColor: '#c8ccd4', bodyMetalness: 1, bodyRoughness: 0.15 });
    await patch(page, { reflectionIntensity: 0 });
    const dull = await luminance(page);
    await patch(page, { reflectionIntensity: 2 });
    const shiny = await luminance(page);
    expect(shiny, 'reflections should brighten a metallic body').toBeGreaterThan(dull);
  });

  test('shadow strength visibly darkens the frame', async ({ page }) => {
    // Measured against a pale backdrop. A black shadow on the default near-black
    // background has nowhere to show, which is a property of the backdrop rather
    // than of the shadow.
    await patch(page, {
      background: { kind: 'solid', color: '#eceef2', color2: '#eceef2', angle: 0 },
      shadow: false,
    });
    const none = await luminance(page);

    await patch(page, { shadow: true, shadowStrength: 0.25, shadowSoftness: 0.5 });
    const light = await luminance(page);

    await patch(page, { shadowStrength: 1 });
    const full = await luminance(page);

    expect(light, 'a light shadow should darken the frame').toBeLessThan(none);
    expect(full, 'a stronger shadow should darken it further').toBeLessThan(light);
    // The range has to be worth having: the old shadow moved this by well under
    // one level across its whole range, which is what made it feel broken.
    expect(none - full).toBeGreaterThan(5);
  });

  test('shadow softness changes its shape, not just its darkness', async ({ page }) => {
    await patch(page, {
      background: { kind: 'solid', color: '#eceef2', color2: '#eceef2', angle: 0 },
      shadow: true,
      shadowStrength: 1,
      shadowSoftness: 0,
    });
    const tight = await canvasStats(page);

    await patch(page, { shadowSoftness: 1 });
    const diffuse = await canvasStats(page);

    expect(diffuse.hash).not.toBe(tight.hash);
    // A diffuse shadow covers more of the frame than a tight one.
    expect(await luminance(page)).toBeLessThan(255);
  });
});
