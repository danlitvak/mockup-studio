import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { detectContainer, phoneScreenshot } from './fixtures.ts';
import { resetStorage, snapshot } from './helpers.ts';

type Format = 'mp4' | 'webm';

/** Prefer whichever container this browser can actually encode. */
const pickFormat = (support: { mp4: boolean; webm: boolean }): Format =>
  support.webm ? 'webm' : 'mp4';

/** Keep renders small so a full encode still finishes quickly under test. */
const useFastOutput = async (page: Page, format: Format) => {
  await page.evaluate<void, Format>((chosen) => {
    window.__studio?.getState().patchOutput({
      resolution: '720p',
      aspect: '16:9',
      fps: 24,
      duration: 1,
      format: chosen,
      quality: 'medium',
    });
  }, format);
};

const importScreenshot = async (page: Page) => {
  await page.setInputFiles('[data-testid="file-input"]', {
    name: 'screen.png',
    mimeType: 'image/png',
    buffer: phoneScreenshot(),
  });
  await expect(page.getByTestId('dropzone')).toBeHidden();
};

/** Probe once so the suite can skip codec paths this browser cannot run. */
const encodableFormats = async (page: Page) =>
  page.evaluate(async () => {
    const probe = async (codec: string) => {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec,
          width: 1280,
          height: 720,
          bitrate: 4e6,
        });
        return Boolean(support.supported);
      } catch {
        return false;
      }
    };
    return { mp4: await probe('avc1.42001f'), webm: await probe('vp09.00.10.08') };
  });

test.beforeEach(async ({ page }) => {
  await resetStorage(page);
  await page.goto('/');
  await expect(page.locator('.app')).toHaveAttribute('data-hydrated', 'true');
});

test.describe('export', () => {
  test('renders and encodes a real video file', async ({ page }) => {
    const support = await encodableFormats(page);
    const format = pickFormat(support);
    test.skip(!support.webm && !support.mp4, 'no video encoder available in this browser');

    await importScreenshot(page);
    await useFastOutput(page, format);

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('export-video').click();
    await expect(page.getByTestId('export-progress')).toBeVisible();

    const download = await downloadPromise;
    const path = await download.path();
    expect(path, 'the export should produce a file on disk').toBeTruthy();

    const bytes = await readFile(path);
    expect(detectContainer(bytes), 'the file should be a real container').toBe(format);
    expect(bytes.length, 'a 1s clip should not be a stub').toBeGreaterThan(2000);
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));

    // A container header is not proof of a playable file — decode it.
    const decoded = await page.evaluate(async (base64) => {
      const binary = atob(base64);
      const buffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) buffer[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([buffer]));
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;

      const result = await new Promise<{
        width: number;
        height: number;
        duration: number;
      } | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 20_000);
        video.addEventListener('loadeddata', () => {
          clearTimeout(timer);
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
          });
        });
        video.addEventListener('error', () => {
          clearTimeout(timer);
          resolve(null);
        });
      });

      URL.revokeObjectURL(url);
      return result;
    }, bytes.toString('base64'));

    expect(decoded, 'the exported file should decode').not.toBeNull();
    expect(decoded!.width).toBe(1280);
    expect(decoded!.height).toBe(720);
    // 24 frames at 24fps, allowing for container timestamp rounding.
    expect(decoded!.duration).toBeGreaterThan(0.7);
    expect(decoded!.duration).toBeLessThan(1.4);

    expect(errors).toEqual([]);
    await expect(page.getByTestId('toast')).toContainText('1280×720');
    await expect(page.getByTestId('toast')).toContainText('24 frames');
  });

  test('exports a vertical 4K clip at the right dimensions', async ({ page }) => {
    const support = await encodableFormats(page);
    const format = pickFormat(support);
    test.skip(!support.webm && !support.mp4, 'no video encoder available');

    await importScreenshot(page);
    await page.evaluate<void, Format>((chosen) => {
      window.__studio?.getState().patchOutput({
        resolution: '4k',
        aspect: '9:16',
        fps: 24,
        duration: 0.5,
        format: chosen,
        quality: 'low',
      });
    }, format);

    const downloadPromise = page.waitForEvent('download', { timeout: 150_000 });
    await page.getByTestId('export-video').click();
    const download = await downloadPromise;
    const bytes = await readFile((await download.path())!);
    expect(detectContainer(bytes)).toBe(format);

    // Vertical 4K means 2160 wide by 3840 tall, not the other way round.
    await expect(page.getByTestId('toast')).toContainText('2160×3840');
  });

  test('shows progress and can be cancelled mid-render', async ({ page }) => {
    const support = await encodableFormats(page);
    test.skip(!support.webm && !support.mp4, 'no video encoder available');

    await importScreenshot(page);
    await page.evaluate<void, Format>((chosen) => {
      window.__studio?.getState().patchOutput({
        resolution: '1080p',
        fps: 30,
        duration: 20,
        format: chosen,
        quality: 'high',
      });
    }, pickFormat(support));

    await page.getByTestId('export-video').click();
    const progress = page.getByTestId('export-progress');
    await expect(progress).toBeVisible();
    await expect(progress).toContainText('Rendering frame');

    // Playback is suspended while frames are being rendered.
    expect((await snapshot(page)).playing).toBe(false);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(progress).toBeHidden();
    await expect(page.getByTestId('toast')).toContainText('cancelled');
    await expect(page.getByTestId('export-video')).toBeVisible();
  });

  test('exports the current frame as a PNG', async ({ page }) => {
    await importScreenshot(page);
    await useFastOutput(page, 'webm');
    await page.getByTestId('scrubber').fill('0.4');

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('export-frame').click();
    const download = await downloadPromise;

    const bytes = await readFile((await download.path())!);
    expect(detectContainer(bytes)).toBe('png');
    expect(download.suggestedFilename()).toMatch(/\.png$/);

    // Confirm the PNG header carries the requested frame size.
    expect(bytes.readUInt32BE(16)).toBe(1280);
    expect(bytes.readUInt32BE(20)).toBe(720);
  });

  test('an unsupported codec is reported before rendering starts', async ({ page }) => {
    const support = await encodableFormats(page);
    test.skip(support.mp4, 'this browser can encode H.264, so there is no failure to show');

    await importScreenshot(page);
    await useFastOutput(page, 'mp4');

    // The format control should already be flagging the problem.
    await expect(page.getByTestId('format-unsupported')).toBeVisible();
    await expect(page.getByTestId('format-unsupported')).toContainText('cannot encode MP4');

    await page.getByTestId('export-video').click();
    await expect(page.getByTestId('toast')).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText('cannot encode MP4');
    // It must fail fast rather than render frames it can never encode.
    await expect(page.getByTestId('export-progress')).toBeHidden();

    // And the offered escape hatch must work.
    await page.getByTestId('switch-format').click();
    expect((await snapshot(page)).format).toBe('webm');
    await expect(page.getByTestId('format-unsupported')).toBeHidden();
  });

  test('an exported clip can be imported back as source media', async ({ page }) => {
    const support = await encodableFormats(page);
    const format = pickFormat(support);
    test.skip(!support.webm && !support.mp4, 'no video encoder available');

    await importScreenshot(page);
    await useFastOutput(page, format);

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('export-video').click();
    const download = await downloadPromise;
    const bytes = await readFile((await download.path())!);

    // Feed the app its own output — this exercises the whole video path:
    // decode, metadata, seeking, and drawing a moving texture.
    await page.setInputFiles('[data-testid="inspector-file-input"]', {
      name: `roundtrip.${format}`,
      mimeType: format === 'mp4' ? 'video/mp4' : 'video/webm',
      buffer: bytes,
    });

    await expect(page.getByText(`roundtrip.${format}`)).toBeVisible({ timeout: 30_000 });
    const state = await snapshot(page);
    expect(state.mediaRef?.kind).toBe('video');
    expect(state.mediaRef?.duration).toBeGreaterThan(0.5);
    // Clip length follows the imported recording.
    expect(state.duration).toBeLessThan(2);
  });
});
