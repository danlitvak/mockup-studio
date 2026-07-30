import type { Page } from '@playwright/test';

/**
 * Read the preview canvas back as pixels.
 *
 * The renderer keeps `preserveDrawingBuffer` on, so the WebGL canvas can be
 * sampled directly. Tests use this to prove the scene actually changed rather
 * than only asserting that a control moved.
 */
export async function canvasStats(page: Page): Promise<{
  hash: string;
  uniquePixels: number;
  width: number;
  height: number;
}> {
  return page.evaluate(() => {
    const source = document.querySelector<HTMLCanvasElement>('[data-testid="preview-canvas"]');
    if (!source) throw new Error('preview canvas is missing');

    // Downsample so the comparison is stable across antialiasing noise.
    const sample = document.createElement('canvas');
    sample.width = 48;
    sample.height = 48;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(source, 0, 0, sample.width, sample.height);

    const { data } = ctx.getImageData(0, 0, sample.width, sample.height);
    const seen = new Set<number>();
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 4) {
      // Quantise to blunt tiny renderer differences.
      const r = data[i]! & 0xf0;
      const g = data[i + 1]! & 0xf0;
      const b = data[i + 2]! & 0xf0;
      seen.add((r << 16) | (g << 8) | b);
      hash = Math.imul(hash ^ r, 16777619);
      hash = Math.imul(hash ^ g, 16777619);
      hash = Math.imul(hash ^ b, 16777619);
    }

    return {
      hash: (hash >>> 0).toString(16),
      uniquePixels: seen.size,
      width: source.width,
      height: source.height,
    };
  });
}

/** Wait until the canvas settles, then snapshot it. Motion is paused first. */
export async function stableCanvas(page: Page): Promise<Awaited<ReturnType<typeof canvasStats>>> {
  await page.waitForTimeout(250);
  return canvasStats(page);
}

/** Pause playback so pixel comparisons are not racing the animation. */
export async function pausePlayback(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__studio;
    store?.getState().setPlaying(false);
    store?.getState().setPlayhead(0);
  });
}

/** The parts of the store the e2e suite reads. */
export interface StudioSnapshot {
  projectId: string;
  name: string;
  mediaRef: { id: string; kind: string; name: string; duration: number } | null;
  hasLoadedMedia: boolean;
  device: string;
  screenFit: string;
  motionPreset: string;
  loop: boolean;
  aspect: string;
  format: string;
  duration: number;
  playing: boolean;
  playhead: number;
  libraryIds: string[];
  hydrated: boolean;
}

/** A serialisable snapshot of app state, for assertions the DOM does not expose. */
export async function snapshot(page: Page): Promise<StudioSnapshot> {
  return page.evaluate(() => {
    const store = window.__studio;
    if (!store) throw new Error('store is not exposed on window');
    const s = store.getState();
    return {
      projectId: s.project.id,
      name: s.project.name,
      mediaRef: s.project.media
        ? {
            id: s.project.media.id,
            kind: s.project.media.kind,
            name: s.project.media.name,
            duration: s.project.media.duration,
          }
        : null,
      hasLoadedMedia: s.media !== null,
      device: s.project.scene.device,
      screenFit: s.project.scene.screenFit,
      motionPreset: s.project.motion.preset,
      loop: s.project.motion.loop,
      aspect: s.project.output.aspect,
      format: s.project.output.format,
      duration: s.project.output.duration,
      playing: s.playing,
      playhead: s.playhead,
      libraryIds: s.library.map((project) => project.id),
      hydrated: s.hydrated,
    };
  });
}

/** Clear all local state so each spec starts from a known-empty machine. */
export async function resetStorage(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    const databases = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      databases
        .map((entry) => entry.name)
        .filter((name): name is string => Boolean(name))
        .map(
          (name) =>
            new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase(name);
              request.onsuccess = () => resolve();
              request.onerror = () => resolve();
              request.onblocked = () => resolve();
            }),
        ),
    );
  });
}
