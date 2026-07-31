import { expect, test, type Page } from '@playwright/test';
import type { MotionId } from '../../src/core/types.ts';
import { openApp } from './helpers.ts';

/**
 * Saved motion presets.
 *
 * These assert through the store rather than the DOM wherever the question is
 * "what is the motion now", because that is the thing the renderer actually
 * reads; the picker is only how the user gets there.
 */

interface MotionSnapshot {
  preset: MotionId;
  amount: number;
  speed: number;
  loop: boolean;
}

const motionOf = async (page: Page): Promise<MotionSnapshot> =>
  page.evaluate(() => {
    const store = window.__studio;
    if (!store) throw new Error('store is not exposed on window');
    const { preset, amount, speed, loop } = store.getState().project.motion;
    return { preset, amount, speed, loop };
  });

const presetNames = async (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const store = window.__studio;
    if (!store) throw new Error('store is not exposed on window');
    return store.getState().motionPresets.map((preset) => preset.name);
  });

const setMotion = async (page: Page, motion: Partial<MotionSnapshot>): Promise<void> => {
  await page.evaluate((patch) => {
    window.__studio?.getState().patchMotion(patch);
  }, motion);
};

const savePresetNamed = async (page: Page, name: string): Promise<void> => {
  await page.getByTestId('preset-name').fill(name);
  await page.getByTestId('preset-save').click();
  await expect
    .poll(async () => (await presetNames(page)).includes(name))
    .toBe(true);
};

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test.describe('motion presets', () => {
  test('saves the current motion and applies it again later', async ({ page }) => {
    await setMotion(page, { preset: 'orbit', amount: 1.4, speed: 3, loop: true });
    await savePresetNamed(page, 'Slow orbit');

    // Move the motion well away from what was saved.
    await setMotion(page, { preset: 'still', amount: 0.2, speed: 1, loop: false });
    expect((await motionOf(page)).preset).toBe('still');

    await page.getByTestId('preset-select').selectOption({ label: 'Slow orbit' });

    await expect.poll(async () => await motionOf(page)).toEqual({
      preset: 'orbit',
      amount: 1.4,
      speed: 3,
      loop: true,
    });
  });

  test('presets survive a reload', async ({ page }) => {
    await setMotion(page, { preset: 'spin', amount: 0.8, speed: 2, loop: true });
    await savePresetNamed(page, 'Kept');

    await page.reload();
    await page.locator('.app[data-hydrated="true"]').waitFor();

    expect(await presetNames(page)).toContain('Kept');

    // And it is the motion that was saved, not just the name.
    await setMotion(page, { preset: 'still' });
    await page.getByTestId('preset-select').selectOption({ label: 'Kept' });
    await expect.poll(async () => (await motionOf(page)).preset).toBe('spin');
  });

  test('saving under an existing name replaces rather than duplicating', async ({ page }) => {
    await setMotion(page, { preset: 'float' });
    await savePresetNamed(page, 'Reused');

    await setMotion(page, { preset: 'pan' });
    // The button says so before it is pressed.
    await page.getByTestId('preset-name').fill('reused');
    await expect(page.getByTestId('preset-save')).toHaveText('Replace');
    await page.getByTestId('preset-save').click();

    await expect.poll(async () => (await presetNames(page)).length).toBe(1);

    await setMotion(page, { preset: 'still' });
    await page.getByTestId('preset-select').selectOption({ index: 1 });
    await expect.poll(async () => (await motionOf(page)).preset).toBe('pan');
  });

  test('a preset can be deleted', async ({ page }) => {
    await savePresetNamed(page, 'Temporary');
    await page.getByTestId('preset-select').selectOption({ label: 'Temporary' });
    await page.getByTestId('preset-delete').click();

    await expect.poll(async () => await presetNames(page)).toEqual([]);
    // With none left, the picker goes away entirely.
    await expect(page.getByTestId('preset-select')).toBeHidden();
  });

  test('the save button is inert until the preset has a name', async ({ page }) => {
    await expect(page.getByTestId('preset-save')).toBeDisabled();
    await page.getByTestId('preset-name').fill('   ');
    await expect(page.getByTestId('preset-save')).toBeDisabled();
    await page.getByTestId('preset-name').fill('Real name');
    await expect(page.getByTestId('preset-save')).toBeEnabled();
  });
});
