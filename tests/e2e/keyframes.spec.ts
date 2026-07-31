import { expect, test, type Page } from '@playwright/test';
import { phoneScreenshot } from './fixtures.ts';
import { canvasStats, openApp, pausePlayback, stableCanvas, waitForMedia } from './helpers.ts';

/**
 * The keyframe track, through the real renderer.
 *
 * The point of these is that the track reaches the scene, not merely the store:
 * the unit tests already prove the interpolation, so what is left to check is
 * that a pose set here actually changes what is drawn, and that a looping track
 * still starts and ends on the same frame.
 */

const trackTimes = async (page: Page): Promise<number[]> =>
  page.evaluate(() => {
    const store = window.__studio;
    if (!store) throw new Error('store is not exposed on window');
    return store.getState().project.motion.keyframes.map((frame) => frame.t);
  });

const setPlayhead = async (page: Page, t: number): Promise<void> => {
  await page.evaluate((value) => {
    const store = window.__studio;
    store?.getState().setPlaying(false);
    store?.getState().setPlayhead(value);
  }, t);
  await page.waitForTimeout(150);
};

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await page.setInputFiles('[data-testid="file-input"]', {
    name: 'screen.png',
    mimeType: 'image/png',
    buffer: phoneScreenshot(),
  });
  await waitForMedia(page);
  await pausePlayback(page);
  await page.getByTestId('motion-mode').getByRole('button', { name: 'Keyframes' }).click();
});

test.describe('keyframes', () => {
  test('adding poses builds a track and marks the timeline', async ({ page }) => {
    await expect(page.getByTestId('timeline-markers')).toBeHidden();

    await setPlayhead(page, 0);
    await page.getByTestId('keyframe-add').click();
    await setPlayhead(page, 0.5);
    await page.getByTestId('keyframe-add').click();

    expect(await trackTimes(page)).toEqual([0, 0.5]);
    await expect(page.getByTestId('keyframe-chip')).toHaveCount(2);
    // The track is now what drives the motion, so the timeline shows it.
    await expect(page.getByTestId('timeline-markers').locator('.timeline__marker')).toHaveCount(2);
  });

  test('a keyframed pose changes what is rendered', async ({ page }) => {
    await setPlayhead(page, 0);
    await page.getByTestId('keyframe-add').click();
    await setPlayhead(page, 1);
    await page.getByTestId('keyframe-add').click();

    // Sampled midway, where both poses contribute. Note that the end of the
    // clip is the wrong place to look: the track loops by default, so t = 1
    // deliberately wraps round to the pose at t = 0 and a change to the last
    // keyframe would correctly show nothing there.
    await setPlayhead(page, 0.5);
    const before = await stableCanvas(page);

    // Swing the end pose well away from rest.
    await page.getByTestId('keyframe-chip').last().click();
    await page.getByTestId('keyframe-rotate-y').fill('120');
    await page.getByTestId('keyframe-y').fill('1.5');

    await setPlayhead(page, 0.5);
    const after = await stableCanvas(page);

    expect(after.hash, 'the scene should follow the keyframed pose').not.toBe(before.hash);
  });

  test('the pose is interpolated between keyframes', async ({ page }) => {
    await setPlayhead(page, 0);
    await page.getByTestId('keyframe-add').click();
    await setPlayhead(page, 1);
    await page.getByTestId('keyframe-add').click();
    await page.getByTestId('keyframe-rotate-y').fill('120');

    await setPlayhead(page, 0);
    const start = await canvasStats(page);
    await setPlayhead(page, 0.5);
    const middle = await canvasStats(page);
    await setPlayhead(page, 1);
    const end = await canvasStats(page);

    // Halfway is its own pose, not either endpoint.
    expect(middle.hash).not.toBe(start.hash);
    expect(middle.hash).not.toBe(end.hash);
  });

  test('a looping track starts and ends on the same frame', async ({ page }) => {
    await setPlayhead(page, 0);
    await page.getByTestId('keyframe-add').click();
    await setPlayhead(page, 0.5);
    await page.getByTestId('keyframe-add').click();
    await page.getByTestId('keyframe-rotate-y').fill('90');

    await page.evaluate(() => window.__studio?.getState().patchMotion({ loop: true }));

    await setPlayhead(page, 0);
    const first = await canvasStats(page);
    await setPlayhead(page, 1);
    const last = await canvasStats(page);

    // This is the seamless-loop guarantee, checked through the renderer rather
    // than only in the maths.
    expect(last.hash, 'a looping track must return to its start pose').toBe(first.hash);
  });

  test('the playhead selects which pose is being edited', async ({ page }) => {
    await setPlayhead(page, 0.25);
    await page.getByTestId('keyframe-add').click();
    await setPlayhead(page, 0.75);
    await page.getByTestId('keyframe-add').click();

    // Sitting on the second pose, the editor is open on it.
    await expect(page.getByTestId('keyframe-editor')).toBeVisible();
    await expect(page.getByTestId('keyframe-time')).toHaveValue('0.75');

    // Move off both poses and there is nothing to edit.
    await setPlayhead(page, 0.5);
    await expect(page.getByTestId('keyframe-editor')).toBeHidden();

    // Clicking a chip goes back to that pose.
    await page.getByTestId('keyframe-chip').first().click();
    await expect(page.getByTestId('keyframe-time')).toHaveValue('0.25');
  });

  test('a pose can be deleted, and the track reverts to the preset when empty', async ({ page }) => {
    await setPlayhead(page, 0.4);
    await page.getByTestId('keyframe-add').click();
    expect(await trackTimes(page)).toEqual([0.4]);

    await page.getByTestId('keyframe-delete').click();
    expect(await trackTimes(page)).toEqual([]);
    // Still in keyframes mode, but with nothing to play the preset takes over
    // again rather than the device freezing.
    await expect(page.getByTestId('timeline-markers')).toBeHidden();
  });

  test('switching back to a preset keeps the track for later', async ({ page }) => {
    await setPlayhead(page, 0.3);
    await page.getByTestId('keyframe-add').click();

    await page.getByTestId('motion-mode').getByRole('button', { name: 'Preset' }).click();
    await expect(page.getByTestId('motion-select')).toBeVisible();
    // The track is still there — the mode is a choice, not a deletion.
    expect(await trackTimes(page)).toEqual([0.3]);

    await page.getByTestId('motion-mode').getByRole('button', { name: 'Keyframes' }).click();
    await expect(page.getByTestId('keyframe-chip')).toHaveCount(1);
  });

  test('a keyframed project survives a reload', async ({ page }) => {
    await setPlayhead(page, 0.6);
    await page.getByTestId('keyframe-add').click();
    await page.getByTestId('keyframe-rotate-y').fill('45');

    // Let the debounced write land before reloading.
    await page.waitForTimeout(700);
    await page.reload();
    await page.locator('.app[data-hydrated="true"]').waitFor();

    const motion = await page.evaluate(() => {
      const store = window.__studio;
      if (!store) throw new Error('store is not exposed on window');
      return store.getState().project.motion;
    });
    expect(motion.mode).toBe('keyframes');
    expect(motion.keyframes).toHaveLength(1);
    expect(motion.keyframes[0]!.rotationY).toBe(45);
  });
});
