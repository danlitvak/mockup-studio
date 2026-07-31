import { expect, test } from '@playwright/test';
import { phoneScreenshot, wideScreenshot } from './fixtures.ts';
import {
  canvasStats,
  openApp,
  pausePlayback,
  snapshot,
  stableCanvas,
  waitForMedia,
} from './helpers.ts';

const importScreenshot = async (
  page: import('@playwright/test').Page,
  buffer: Buffer = phoneScreenshot(),
  name = 'screen.png',
) => {
  await page.setInputFiles('[data-testid="file-input"]', {
    name,
    mimeType: 'image/png',
    buffer,
  });
  await waitForMedia(page);
};

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test.describe('editor', () => {
  test('renders a scene before any media is imported', async ({ page }) => {
    await expect(page.getByTestId('dropzone')).toBeVisible();
    await pausePlayback(page);

    const stats = await stableCanvas(page);
    expect(stats.width, 'canvas should have a real drawing buffer').toBeGreaterThan(100);
    // The default gradient plus a lit device gives plenty of distinct colours;
    // a blank or failed WebGL context would give one or two.
    expect(stats.uniquePixels, 'the scene should actually be drawn').toBeGreaterThan(5);
  });

  test('imports a screenshot and puts it on the device', async ({ page }) => {
    await pausePlayback(page);
    const before = await stableCanvas(page);

    await importScreenshot(page);
    await pausePlayback(page);
    const after = await stableCanvas(page);

    expect(after.hash, 'the canvas should change once media is applied').not.toBe(before.hash);

    const state = await snapshot(page);
    expect(state.mediaRef?.kind).toBe('image');
    expect(state.mediaRef?.name).toBe('screen.png');
    expect(state.hasLoadedMedia).toBe(true);
    await expect(page.getByText('screen.png')).toBeVisible();
    await expect(page.getByText('540×1170')).toBeVisible();
  });

  test('rejects a file that is not an image or video', async ({ page }) => {
    await page.setInputFiles('[data-testid="file-input"]', {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not media'),
    });
    await expect(page.getByTestId('toast')).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText('not supported');
    expect((await snapshot(page)).mediaRef).toBeNull();
  });

  test('switching device changes the render and the default fit', async ({ page }) => {
    await importScreenshot(page);
    await pausePlayback(page);
    const asPhone = await stableCanvas(page);
    expect((await snapshot(page)).screenFit).toBe('cover');

    await page.getByTestId('device-select').selectOption('browser');
    await pausePlayback(page);
    const asBrowser = await stableCanvas(page);

    expect(asBrowser.hash).not.toBe(asPhone.hash);
    const state = await snapshot(page);
    expect(state.device).toBe('browser');
    // A browser window should contain a portrait screenshot rather than crop it.
    expect(state.screenFit).toBe('contain');
  });

  test('every device renders without error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await importScreenshot(page);
    const hashes = new Set<string>();

    for (const device of ['phone', 'tablet', 'laptop', 'browser', 'screen']) {
      await page.getByTestId('device-select').selectOption(device);
      await pausePlayback(page);
      const stats = await stableCanvas(page);
      expect(stats.uniquePixels, `${device} should render content`).toBeGreaterThan(5);
      hashes.add(stats.hash);
    }

    expect(errors, 'no page errors while switching devices').toEqual([]);
    expect(hashes.size, 'each device should look different').toBe(5);
  });

  test('fit control switches between filling and containing', async ({ page }) => {
    // A wide capture on a portrait phone is the case where fit matters most.
    await importScreenshot(page, wideScreenshot(), 'wide.png');
    await pausePlayback(page);
    const cover = await stableCanvas(page);

    await page.getByTestId('fit-control').locator('[data-value="contain"]').click();
    await pausePlayback(page);
    const contain = await stableCanvas(page);

    expect(contain.hash).not.toBe(cover.hash);
    expect((await snapshot(page)).screenFit).toBe('contain');
  });

  test('background controls change the backdrop', async ({ page }) => {
    await pausePlayback(page);
    const gradient = await stableCanvas(page);

    await page.getByTestId('background-kind').locator('[data-value="solid"]').click();
    await pausePlayback(page);
    const solid = await stableCanvas(page);
    expect(solid.hash).not.toBe(gradient.hash);

    await page.getByTestId('background-kind').locator('[data-value="transparent"]').click();
    await pausePlayback(page);
    const transparent = await stableCanvas(page);
    expect(transparent.hash).not.toBe(solid.hash);
    await expect(page.locator('.preview__canvas--checker')).toBeVisible();
  });

  test('motion presets animate and one-shot intros end at rest', async ({ page }) => {
    await importScreenshot(page);

    await page.getByTestId('motion-select').selectOption('spin');
    await pausePlayback(page);

    // Same project, two different points on the timeline: the pose must differ.
    await page.evaluate(() => window.__studio?.getState().setPlayhead(0));
    const atStart = await stableCanvas(page);
    await page.evaluate(() => window.__studio?.getState().setPlayhead(0.3));
    const midway = await stableCanvas(page);
    expect(midway.hash).not.toBe(atStart.hash);

    // A one-shot intro resolves to the resting pose, so its final frame must
    // match a still render of the same scene.
    await page.getByTestId('motion-select').selectOption('tilt-in');
    await page.evaluate(() => window.__studio?.getState().setPlayhead(1));
    const introEnd = await stableCanvas(page);
    await page.getByTestId('motion-select').selectOption('still');
    await page.evaluate(() => window.__studio?.getState().setPlayhead(0.5));
    const resting = await stableCanvas(page);
    expect(introEnd.hash).toBe(resting.hash);
  });

  test('changing aspect resizes the preview', async ({ page }) => {
    await pausePlayback(page);
    const landscape = await stableCanvas(page);
    expect(landscape.width).toBeGreaterThan(landscape.height);

    await page.getByTestId('aspect-select').selectOption('9:16');
    await page.waitForTimeout(300);
    const portrait = await canvasStats(page);
    expect(portrait.height).toBeGreaterThan(portrait.width);
  });

  test('output summary reflects the chosen aspect and resolution', async ({ page }) => {
    await page.getByTestId('aspect-select').selectOption('16:9');
    await page.getByTestId('resolution-select').selectOption('4k');
    await expect(page.getByTestId('output-summary')).toContainText('3840×2160');

    await page.getByTestId('aspect-select').selectOption('9:16');
    await expect(page.getByTestId('output-summary')).toContainText('2160×3840');
  });

  test('playback runs and can be paused', async ({ page }) => {
    await importScreenshot(page);
    expect((await snapshot(page)).playing).toBe(true);

    await page.waitForTimeout(400);
    expect((await snapshot(page)).playhead).toBeGreaterThan(0);

    await page.getByTestId('play-toggle').click();
    expect((await snapshot(page)).playing).toBe(false);

    const paused = (await snapshot(page)).playhead;
    await page.waitForTimeout(400);
    expect((await snapshot(page)).playhead).toBe(paused);
  });

  test('clicking the preview toggles playback', async ({ page }) => {
    await importScreenshot(page);
    const before = (await snapshot(page)).playing;

    await page.getByTestId('preview-canvas').click();
    expect((await snapshot(page)).playing).toBe(!before);

    await page.getByTestId('preview-canvas').click();
    expect((await snapshot(page)).playing).toBe(before);

    // The click leaves the canvas focused, which is exactly where a control
    // that also claimed Space would toggle twice and look inert.
    await page.keyboard.press('Space');
    expect((await snapshot(page)).playing).toBe(!before);
  });

  test('scrubbing pauses playback and moves the playhead', async ({ page }) => {
    await importScreenshot(page);
    await page.getByTestId('scrubber').fill('0.6');
    const state = await snapshot(page);
    expect(state.playing).toBe(false);
    expect(state.playhead).toBeCloseTo(0.6, 2);
    await expect(page.getByTestId('timecode')).toContainText('/');
  });

  test('theme toggle switches and persists', async ({ page }) => {
    const initial = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.getByTestId('theme-toggle').click();
    const toggled = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(toggled).not.toBe(initial);

    await page.reload();
    await expect(page.locator('.app')).toHaveAttribute('data-hydrated', 'true');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(toggled);
  });

  test('space toggles playback', async ({ page }) => {
    await importScreenshot(page);
    const before = (await snapshot(page)).playing;
    await page.locator('.preview__frame').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Space');
    expect((await snapshot(page)).playing).toBe(!before);
  });
});
