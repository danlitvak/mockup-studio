import { expect, test, type Page } from '@playwright/test';
import { squareMarkerScreenshot } from './fixtures.ts';
import { openApp, waitForMedia } from './helpers.ts';

/**
 * The user's media must keep its aspect ratio all the way onto the device
 * screen, whatever route the editor took to get there.
 *
 * This was a real bug, and a subtle one. The screen texture is a 2D canvas that
 * is resized to match each device's screen shape — but a texture's GPU storage
 * is allocated once, from the size of its image at the first upload, and after
 * that only sub-imaged. So every device after the first one rendered the media
 * squeezed into the *first* device's texture shape. The preview was visibly
 * stretched while a fresh export, whose stage is built and sized once, was
 * fine — which is exactly the "what you see is what you get" guarantee this
 * project is built around.
 *
 * Note what is asserted. Checking that the media fills the screen cannot catch
 * this: media drawn with `cover` fills the screen whether or not its aspect
 * survived. A square drawn in the source has to come back out square.
 */

/** Measure the rendered marker's bounding box off the live WebGL canvas. */
async function markerAspect(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const source = document.querySelector<HTMLCanvasElement>('[data-testid="preview-canvas"]');
    if (!source) throw new Error('preview canvas is missing');

    const sample = document.createElement('canvas');
    sample.width = 600;
    sample.height = Math.round((600 * source.height) / source.width);
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(source, 0, 0, sample.width, sample.height);

    const { data } = ctx.getImageData(0, 0, sample.width, sample.height);
    let minX = Infinity;
    let maxX = -1;
    let minY = Infinity;
    let maxY = -1;
    for (let y = 0; y < sample.height; y += 1) {
      for (let x = 0; x < sample.width; x += 1) {
        const i = (y * sample.width + x) * 4;
        // Magenta, with room for antialiasing and the scene's lighting.
        if (data[i]! > 120 && data[i + 1]! < 70 && data[i + 2]! > 120) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return (maxX - minX + 1) / (maxY - minY + 1);
  });
}

/** Put the scene square-on and still, so the measurement is not foreshortened. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__studio;
    if (!store) throw new Error('store is not exposed on window');
    store.getState().setPlaying(false);
    store.getState().setPlayhead(0);
    store.getState().patchMotion({ preset: 'still' });
    store.getState().patchScene({ rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1 });
  });
  await page.waitForTimeout(300);
}

type Step = { device: 'phone' | 'tablet' | 'laptop' | 'browser' | 'screen'; fit: 'cover' | 'contain' };

async function applyStep(page: Page, step: Step): Promise<void> {
  await page.evaluate<void, Step>(({ device, fit }) => {
    const store = window.__studio;
    if (!store) throw new Error('store is not exposed on window');
    // setDevice also resets the fit to that device's default, so the explicit
    // fit has to be applied second.
    store.getState().setDevice(device);
    store.getState().patchScene({ screenFit: fit });
  }, step);
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await page.setInputFiles('[data-testid="file-input"]', {
    name: 'marker.png',
    mimeType: 'image/png',
    buffer: squareMarkerScreenshot(),
  });
  await waitForMedia(page);
  await settle(page);
});

test.describe('screen fit', () => {
  // Each route ends somewhere different, and every one of these was broken.
  // The project opens on the phone, so any route that leaves it is a device
  // change, and the last two cross between landscape shapes.
  const routes: { name: string; steps: Step[] }[] = [
    { name: 'straight to a wide screen', steps: [{ device: 'screen', fit: 'contain' }] },
    {
      name: 'phone then a wide screen',
      steps: [
        { device: 'phone', fit: 'cover' },
        { device: 'screen', fit: 'contain' },
      ],
    },
    {
      name: 'phone with the same fit throughout',
      steps: [
        { device: 'phone', fit: 'contain' },
        { device: 'screen', fit: 'contain' },
      ],
    },
    {
      name: 'phone then a tablet',
      steps: [
        { device: 'phone', fit: 'cover' },
        { device: 'tablet', fit: 'cover' },
      ],
    },
    {
      name: 'screen then a browser frame',
      steps: [
        { device: 'screen', fit: 'contain' },
        { device: 'browser', fit: 'contain' },
      ],
    },
    {
      name: 'every device in turn',
      steps: [
        { device: 'phone', fit: 'cover' },
        { device: 'tablet', fit: 'cover' },
        { device: 'laptop', fit: 'contain' },
        { device: 'browser', fit: 'contain' },
        { device: 'screen', fit: 'contain' },
      ],
    },
  ];

  for (const route of routes) {
    test(`media keeps its aspect ratio — ${route.name}`, async ({ page }) => {
      for (const step of route.steps) await applyStep(page, step);

      const aspect = await markerAspect(page);
      expect(aspect, 'the marker should be visible on the device screen').not.toBeNull();
      // A few percent covers rasterisation of the marker's edges at this
      // sample size; the bug this guards against distorted it by 3-4x.
      expect(aspect!).toBeGreaterThan(0.93);
      expect(aspect!).toBeLessThan(1.07);
    });
  }

  test('a portrait capture is not distorted on a landscape device either', async ({ page }) => {
    // The inverse of the common case: the texture has to grow along the other
    // axis, which is where an allocation sized for the previous device shows up.
    //
    // Note the input this uses. The dropzone's `file-input` only exists while
    // the project has no media, and the shared setup has already imported some,
    // so replacing it has to go through the inspector's own picker.
    await page.setInputFiles('[data-testid="inspector-file-input"]', {
      name: 'tall.png',
      mimeType: 'image/png',
      buffer: squareMarkerScreenshot(720, 1280, 240),
    });
    // `waitForMedia` only checks that *some* media is loaded, and the setup has
    // already loaded some — so wait for this file in particular.
    await page.waitForFunction(() => {
      const store = window.__studio;
      return store?.getState().project.media?.name === 'tall.png';
    });
    await settle(page);

    await applyStep(page, { device: 'screen', fit: 'contain' });

    const aspect = await markerAspect(page);
    expect(aspect, 'the marker should be visible').not.toBeNull();
    expect(aspect!).toBeGreaterThan(0.93);
    expect(aspect!).toBeLessThan(1.07);
  });
});
