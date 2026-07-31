import { create } from 'zustand';
import { createProject, effectiveDuration, normalizeProject } from '../core/project.ts';
import type {
  MotionSettings,
  OutputSettings,
  Project,
  SceneSettings,
} from '../core/types.ts';
import { defaultFitFor } from '../core/fit.ts';
import { getDevice } from '../core/devices.ts';
import { MediaError, loadMedia, loadMediaFromFile, releaseMedia, type LoadedMedia } from '../media/load.ts';
import * as db from '../storage/db.ts';

export type Theme = 'light' | 'dark';

export interface ExportJob {
  frame: number;
  total: number;
  phase: 'rendering' | 'finalizing';
}

export interface Notice {
  kind: 'error' | 'info';
  message: string;
}

interface StudioState {
  project: Project;
  media: LoadedMedia | null;
  mediaLoading: boolean;
  notice: Notice | null;
  playing: boolean;
  /** Normalised playhead, 0..1. */
  playhead: number;
  theme: Theme;
  exportJob: ExportJob | null;
  library: Project[];
  storageAvailable: boolean;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  patchScene: (patch: Partial<SceneSettings>) => void;
  patchMotion: (patch: Partial<MotionSettings>) => void;
  patchOutput: (patch: Partial<OutputSettings>) => void;
  setDevice: (device: SceneSettings['device']) => void;
  rename: (name: string) => void;
  importFile: (file: File) => Promise<void>;
  clearMedia: () => void;
  newProject: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  refreshLibrary: () => Promise<void>;
  setPlaying: (playing: boolean) => void;
  setPlayhead: (playhead: number) => void;
  setTheme: (theme: Theme) => void;
  setExportJob: (job: ExportJob | null) => void;
  notify: (notice: Notice | null) => void;
}

const THEME_KEY = 'mockup-studio:theme';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage can be unavailable; the default is fine.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Debounced write-behind so dragging a slider does not hammer IndexedDB.
 *
 * `flushSave` exists because several operations are only correct once the
 * current project is actually on disk — most importantly garbage collection,
 * which would otherwise sweep a blob whose owning project is still sitting in
 * the debounce window.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

/**
 * Writes are serialised through one chain, and each write reads the project
 * from the store at the moment it runs rather than capturing a snapshot when
 * it was queued.
 *
 * Both details matter. Two writes for the same project can otherwise be in
 * flight at once — an import flushing while a rename is debounced, say — and
 * because IndexedDB gives no ordering guarantee across transactions, the older
 * snapshot can land last and silently undo the newer edit.
 */
let saveChain: Promise<void> = Promise.resolve();

function scheduleSave(): void {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), 400);
}

function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dirty) return saveChain;
  dirty = false;

  saveChain = saveChain.then(async () => {
    // Read late: whatever the project looks like now is what belongs on disk.
    const project = useStudio.getState().project;
    try {
      await db.saveProject(project);
      await useStudio.getState().refreshLibrary();
    } catch (error) {
      console.warn('[storage] save failed', error);
    }
  });
  return saveChain;
}

/** Persist the current project, then drop any media no project still points at. */
async function persistThenCollect(): Promise<void> {
  await flushSave();
  await db.collectGarbage().catch(() => 0);
}

// A tab can be closed mid-debounce; don't lose the last few edits.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushSave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave();
  });
}

export const useStudio = create<StudioState>((set, get) => {
  const touch = (project: Project): Project => {
    scheduleSave();
    return { ...project, updatedAt: Date.now() };
  };

  return {
    project: createProject(),
    media: null,
    mediaLoading: false,
    notice: null,
    playing: true,
    playhead: 0,
    theme: 'dark',
    exportJob: null,
    library: [],
    storageAvailable: true,
    hydrated: false,

    async hydrate() {
      const theme = readTheme();
      document.documentElement.dataset.theme = theme;
      set({ theme });

      const available = await db.isStorageAvailable();
      if (!available) {
        set({
          storageAvailable: false,
          hydrated: true,
          notice: {
            kind: 'info',
            message: 'Storage is unavailable, so projects will not be saved between visits.',
          },
        });
        return;
      }

      void db.requestPersistence();
      const projects = await db.listProjects();

      if (projects.length === 0) {
        const project = get().project;
        await db.saveProject(project);
        set({ library: [project], hydrated: true });
        return;
      }

      const mostRecent = projects[0]!;
      set({ project: mostRecent, library: projects, hydrated: true });
      await get().openProject(mostRecent.id);
    },

    patchScene(patch) {
      set((state) => ({
        project: touch({ ...state.project, scene: { ...state.project.scene, ...patch } }),
      }));
    },

    patchMotion(patch) {
      set((state) => ({
        project: touch({ ...state.project, motion: { ...state.project.motion, ...patch } }),
      }));
    },

    patchOutput(patch) {
      set((state) => ({
        project: touch({ ...state.project, output: { ...state.project.output, ...patch } }),
      }));
    },

    /** Switching device also switches the sensible default fit for its shape. */
    setDevice(device) {
      set((state) => ({
        project: touch({
          ...state.project,
          scene: {
            ...state.project.scene,
            device,
            screenFit: defaultFitFor(getDevice(device).defaultFill),
          },
        }),
      }));
    },

    rename(name) {
      set((state) => ({ project: touch({ ...state.project, name }) }));
    },

    async importFile(file) {
      set({ mediaLoading: true, notice: null });
      try {
        const loaded = await loadMediaFromFile(file);
        releaseMedia(get().media);

        await db.putMedia({
          id: loaded.ref.id,
          blob: loaded.blob,
          name: loaded.ref.name,
          mime: loaded.ref.mime,
        });

        set((state) => {
          const output = { ...state.project.output };
          // Match the clip to a short recording so the tail is not frozen.
          if (loaded.ref.kind === 'video' && loaded.ref.duration > 0) {
            output.duration = Math.min(Math.max(loaded.ref.duration, 0.5), 60);
          }
          return {
            media: loaded,
            mediaLoading: false,
            playhead: 0,
            project: touch({ ...state.project, media: loaded.ref, output }),
          };
        });
        // The new reference must reach disk before orphans are swept,
        // otherwise the blob we just wrote looks unreferenced.
        await persistThenCollect();
      } catch (error) {
        const message =
          error instanceof MediaError
            ? error.message
            : 'That file could not be opened. Try a PNG, JPEG, MP4, or WebM.';
        set({ mediaLoading: false, notice: { kind: 'error', message } });
      }
    },

    clearMedia() {
      releaseMedia(get().media);
      set((state) => ({
        media: null,
        project: touch({ ...state.project, media: null }),
      }));
      void persistThenCollect();
    },

    async newProject() {
      // Commit whatever the user was working on before switching away from it.
      await flushSave();
      releaseMedia(get().media);
      const project = createProject();
      await db.saveProject(project).catch(() => undefined);
      set({ project, media: null, playhead: 0, notice: null });
      await get().refreshLibrary();
    },

    async openProject(id) {
      await flushSave();
      const stored = await db.getProject(id);
      if (!stored) return;

      releaseMedia(get().media);
      set({ project: stored, media: null, playhead: 0, notice: null });

      const ref = stored.media;
      if (!ref) return;

      set({ mediaLoading: true });
      try {
        const blob = await db.getMedia(ref.id);
        if (!blob) {
          set({
            mediaLoading: false,
            notice: { kind: 'info', message: 'The media for this project is no longer stored.' },
            project: normalizeProject({ ...stored, media: null }),
          });
          return;
        }
        const loaded = await loadMedia(blob.blob, blob.name, ref.id);
        set({ media: loaded, mediaLoading: false });
      } catch {
        set({
          mediaLoading: false,
          notice: { kind: 'error', message: 'The stored media could not be reopened.' },
        });
      }
    },

    async removeProject(id) {
      await db.deleteProject(id);
      const remaining = await db.listProjects();
      set({ library: remaining });
      if (get().project.id === id) {
        if (remaining[0]) {
          await get().openProject(remaining[0].id);
        } else {
          await get().newProject();
        }
      }
    },

    async refreshLibrary() {
      if (!get().storageAvailable) return;
      set({ library: await db.listProjects() });
    },

    setPlaying(playing) {
      set({ playing });
    },

    setPlayhead(playhead) {
      set({ playhead: Math.min(1, Math.max(0, playhead)) });
    },

    setTheme(theme) {
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        // Not fatal — the theme just will not persist.
      }
      set({ theme });
    },

    setExportJob(exportJob) {
      set({ exportJob });
    },

    notify(notice) {
      set({ notice });
    },
  };
});

/** Clip length in seconds for the current project. */
export const useDuration = (): number => useStudio((state) => effectiveDuration(state.project));

declare global {
  interface Window {
    __studio?: typeof useStudio;
  }
}

// Exposed so end-to-end tests can drive and inspect the app without depending
// on the exact shape of the DOM. Harmless in production and handy in the
// console when debugging a scene.
if (typeof window !== 'undefined') {
  window.__studio = useStudio;
}
