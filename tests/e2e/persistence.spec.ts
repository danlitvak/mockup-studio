import { expect, test } from '@playwright/test';
import { phoneScreenshot } from './fixtures.ts';
import { openApp, pausePlayback, snapshot, stableCanvas, waitForMedia } from './helpers.ts';

const ready = async (page: import('@playwright/test').Page) => {
  await expect(page.locator('.app')).toHaveAttribute('data-hydrated', 'true');
};

const importScreenshot = async (page: import('@playwright/test').Page, name = 'screen.png') => {
  await page.setInputFiles('[data-testid="file-input"]', {
    name,
    mimeType: 'image/png',
    buffer: phoneScreenshot(),
  });
  await waitForMedia(page);
};

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test.describe('local-first persistence', () => {
  test('a project and its media survive a reload', async ({ page }) => {
    await importScreenshot(page);
    await page.getByTestId('device-select').selectOption('tablet');
    await page.getByTestId('motion-select').selectOption('orbit');
    await page.getByTestId('aspect-select').selectOption('9:16');
    await page.getByTestId('project-name').fill('Launch clip');

    // Give the debounced write-behind time to land.
    await page.waitForTimeout(900);
    const before = await snapshot(page);

    await page.reload();
    await ready(page);
    // Media is read back out of IndexedDB and re-decoded.
    await waitForMedia(page);

    const after = await snapshot(page);
    expect(after.projectId).toBe(before.projectId);
    expect(after.name).toBe('Launch clip');
    expect(after.device).toBe('tablet');
    expect(after.motionPreset).toBe('orbit');
    expect(after.aspect).toBe('9:16');
    expect(after.mediaRef?.name).toBe('screen.png');
    expect(after.hasLoadedMedia, 'the stored blob should be reloaded').toBe(true);

    await pausePlayback(page);
    const stats = await stableCanvas(page);
    expect(stats.uniquePixels).toBeGreaterThan(5);
  });

  test('nothing is requested from the network after the first load', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.host !== '127.0.0.1:4173' && url.protocol !== 'blob:' && url.protocol !== 'data:') {
        external.push(request.url());
      }
    });

    await importScreenshot(page);
    await page.getByTestId('device-select').selectOption('laptop');
    await page.waitForTimeout(600);

    expect(external, 'media must never leave the machine').toEqual([]);
  });

  test('creating a new project keeps the old one in the library', async ({ page }) => {
    await page.getByTestId('project-name').fill('First');
    await page.waitForTimeout(700);
    const first = await snapshot(page);

    await page.getByTestId('new-project').click();
    await page.waitForTimeout(500);
    const second = await snapshot(page);
    expect(second.projectId).not.toBe(first.projectId);

    await page.getByTestId('open-library').click();
    const library = page.getByTestId('library');
    await expect(library).toBeVisible();
    await expect(library.getByText('First')).toBeVisible();
    expect((await snapshot(page)).libraryIds.length).toBeGreaterThanOrEqual(2);
  });

  test('switching projects restores each one’s own media', async ({ page }) => {
    await importScreenshot(page, 'first-shot.png');
    await page.getByTestId('project-name').fill('With media');
    await page.waitForTimeout(800);
    const withMedia = await snapshot(page);

    await page.getByTestId('new-project').click();
    await page.getByTestId('project-name').fill('Empty');
    await page.waitForTimeout(800);
    expect((await snapshot(page)).mediaRef).toBeNull();
    await expect(page.getByTestId('dropzone')).toBeVisible();

    await page.getByTestId('open-library').click();
    await page.getByTestId('library').getByText('With media').click();
    await expect(page.getByTestId('library')).toBeHidden();
    await waitForMedia(page);

    const reopened = await snapshot(page);
    expect(reopened.projectId).toBe(withMedia.projectId);
    expect(reopened.mediaRef?.name).toBe('first-shot.png');
    expect(reopened.hasLoadedMedia).toBe(true);
  });

  test('deleting a project removes it from the library', async ({ page }) => {
    await page.getByTestId('project-name').fill('Doomed');
    await page.waitForTimeout(700);
    await page.getByTestId('new-project').click();
    await page.waitForTimeout(500);

    await page.getByTestId('open-library').click();
    const library = page.getByTestId('library');
    await expect(library.getByText('Doomed')).toBeVisible();

    await library.getByRole('button', { name: 'Delete Doomed' }).click();
    await expect(library.getByText('Doomed')).toBeHidden();

    await page.reload();
    await ready(page);
    await page.getByTestId('open-library').click();
    await expect(page.getByTestId('library').getByText('Doomed')).toBeHidden();
  });

  test('media blobs are stored on the device and reused, not re-uploaded', async ({ page }) => {
    await importScreenshot(page);
    await page.waitForTimeout(800);

    const stored = await page.evaluate(async () => {
      const open = indexedDB.open('mockup-studio');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const media = await new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction('media').objectStore('media').getAll();
        request.onsuccess = () => resolve(request.result as unknown[]);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return media.map((entry) => {
        const record = entry as { id: string; name: string; blob: Blob };
        return { id: record.id, name: record.name, size: record.blob.size, type: record.blob.type };
      });
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('screen.png');
    expect(stored[0]?.size).toBeGreaterThan(100);
    expect(stored[0]?.type).toBe('image/png');
  });

  test('removing media from a project sweeps the orphaned blob', async ({ page }) => {
    await importScreenshot(page);
    await page.waitForTimeout(800);

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('dropzone')).toBeVisible();
    await page.waitForTimeout(800);

    const remaining = await page.evaluate(async () => {
      const open = indexedDB.open('mockup-studio');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const count = await new Promise<number>((resolve, reject) => {
        const request = db.transaction('media').objectStore('media').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return count;
    });

    expect(remaining, 'unreferenced media should not linger on disk').toBe(0);
  });
});
