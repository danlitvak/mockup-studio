import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Prefer a Chromium that is already on the machine.
 *
 * Sandboxed CI images often ship a browser build that does not match the one
 * this Playwright version would download, and the download is usually blocked
 * anyway. Falling back to `undefined` lets Playwright resolve its own — on a
 * normal machine that means `npx playwright install chromium`.
 */
const PREINSTALLED_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sandboxChrome = existsSync(PREINSTALLED_CHROME);
const executablePath = sandboxChrome ? PREINSTALLED_CHROME : undefined;

/**
 * The scene needs WebGL. A headless sandbox has no GPU, so it has to fall back
 * to SwiftShader — but forcing software rendering on a real machine only makes
 * the suite slower, so those flags are applied only where they are needed.
 */
const gpuArgs = sandboxChrome
  ? [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
    ]
  : [];

export default defineConfig({
  testDir: './tests/e2e',
  // Rendering and encoding a real clip is not fast; give each test room.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: gpuArgs,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run preview -- --port ${PORT} --host 127.0.0.1 --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
