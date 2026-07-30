import { expect, test } from '@playwright/test';

/**
 * Confirms the browser can actually do the two things the app depends on:
 * render WebGL and encode video. If either is missing the rest of the suite's
 * failures would be misleading, so this runs first and reports plainly.
 */
test('the browser supports WebGL and video encoding', async ({ page }) => {
  await page.goto('/');

  const report = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');

    const probe = async (codec: string, width: number, height: number) => {
      if (typeof VideoEncoder === 'undefined') return false;
      try {
        const support = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 5e6 });
        return Boolean(support.supported);
      } catch {
        return false;
      }
    };

    return {
      webgl: Boolean(gl),
      renderer: gl
        ? String((gl as WebGLRenderingContext).getParameter((gl as WebGLRenderingContext).RENDERER))
        : null,
      videoEncoder: typeof VideoEncoder !== 'undefined',
      avc1080: await probe('avc1.42001f', 1920, 1080),
      avc4k: await probe('avc1.640033', 3840, 2160),
      vp91080: await probe('vp09.00.10.08', 1920, 1080),
      vp94k: await probe('vp09.00.51.08', 3840, 2160),
    };
  });

  console.log('[capabilities]', JSON.stringify(report, null, 2));

  expect(report.webgl, 'WebGL must be available to render the scene').toBe(true);
  expect(report.videoEncoder, 'WebCodecs VideoEncoder must exist').toBe(true);
  expect(
    report.avc1080 || report.vp91080,
    'at least one of H.264 or VP9 must be encodable at 1080p',
  ).toBe(true);
});
