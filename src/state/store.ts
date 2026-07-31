import { create } from 'zustand';
import { clamp01 } from '../core/easing.ts';
import {
  MAX_KEYFRAMES,
  defaultKeyframe,
  sampleKeyframes,
  sortKeyframes,
} from '../core/keyframes.ts';
import {
  createMotionPreset,
  presetKey,
  removePreset,
  upsertPreset,
  type MotionPreset,
} from '../core/presets.ts';
import { createProject, effectiveDuration, normalizeProject } from '../core/project.ts';
import type {
  Keyframe,
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
  /** Motion configurations the user has saved, newest first. */
  motionPresets: MotionPreset[];
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
  /** Add a pose at the playhead, capturing where the device is right now. */
  addKeyframe: () => void;
  updateKeyframe: (index: number, patch: Partial<Keyframe>) => void;
  removeKeyframe: (index: number) => void;
  saveMotionPreset: (name: string) => Promise<void>;
  applyMotionPreset: (id: string) => void;
  removeMotionPreset: (id: string) => Promise<void>;
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
    motionPresets: [],
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
      // Presets are independent of any project, so a failure to read them must
      // not stop the editor opening.
      set({ motionPresets: await db.listMotionPresets().catch(() => []) });
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

    /**
     * Add a pose at the playhead.
     *
     * The new keyframe captures where the device already is at that instant,
     * so adding one never makes the animation jump — it just gives the user a
     * handle on a moment that was previously being interpolated through. On an
     * empty track that means the resting pose, which is zero offsets.
     */
    addKeyframe() {
      set((state) => {
        const { motion } = state.project;
        if (motion.keyframes.length >= MAX_KEYFRAMES) return {};

        const t = clamp01(state.playhead);
        const pose = sampleKeyframes(motion.keyframes, t, motion.loop);
        const keyframe: Keyframe = { ...defaultKeyframe(t), ...(pose ?? {}), t };

        // Replace rather than stack when one already sits at this instant:
        // two keyframes at the same time make the earlier unreachable.
        const kept = motion.keyframes.filter((existing) => Math.abs(existing.t - t) > 1e-4);
        return {
          project: touch({
            ...state.project,
            motion: {
              ...motion,
              mode: 'keyframes',
              keyframes: sortKeyframes([...kept, keyframe]),
            },
          }),
        };
      });
    },

    updateKeyframe(index, patch) {
      set((state) => {
        const { motion } = state.project;
        const current = motion.keyframes[index];
        if (!current) return {};
        const next = { ...current, ...patch };
        // Moving a keyframe in time can reorder the track, and evaluation
        // depends on that order.
        return {
          project: touch({
            ...state.project,
            motion: {
              ...motion,
              keyframes: sortKeyframes(
                motion.keyframes.map((frame, i) => (i === index ? next : frame)),
              ),
            },
          }),
        };
      });
    },

    removeKeyframe(index) {
      set((state) => {
        const { motion } = state.project;
        if (!motion.keyframes[index]) return {};
        return {
          project: touch({
            ...state.project,
            motion: {
              ...motion,
              keyframes: motion.keyframes.filter((_, i) => i !== index),
            },
          }),
        };
      });
    },

    /**
     * Keep the current motion under a name.
     *
     * The list is updated first and persisted second, so the picker responds
     * immediately and a storage failure costs the write rather than the edit.
     * Saving over an existing name replaces it — see `upsertPreset`.
     */
    async saveMotionPreset(name) {
      const preset = createMotionPreset(name, get().project.motion);
      const presets = upsertPreset(get().motionPresets, preset);
      // `upsertPreset` reuses the id of a preset it replaced, so the record
      // written here overwrites that row rather than orphaning it. It also
      // guarantees exactly one entry per name, which is what makes this lookup
      // exact.
      const saved = presets.find(
        (candidate) => presetKey(candidate.name) === presetKey(preset.name),
      );
      set({ motionPresets: presets });
      if (!get().storageAvailable || !saved) return;
      try {
        await db.saveMotionPreset(saved);
      } catch (error) {
        console.warn('[storage] could not save the motion preset', error);
      }
    },

    applyMotionPreset(id) {
      const preset = get().motionPresets.find((candidate) => candidate.id === id);
      if (!preset) return;
      // Straight through patchMotion, so this is saved and clamped exactly like
      // any other motion edit.
      get().patchMotion(preset.motion);
    },

    async removeMotionPreset(id) {
      set({ motionPresets: removePreset(get().motionPresets, id) });
      if (!get().storageAvailable) return;
      try {
        await db.deleteMotionPreset(id);
      } catch (error) {
        console.warn('[storage] could not delete the motion preset', error);
      }
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
