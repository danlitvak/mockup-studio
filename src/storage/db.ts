import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { migrateMotionPreset, type MotionPreset } from '../core/presets.ts';
import { migrateProject } from '../core/project.ts';
import type { Project } from '../core/types.ts';

/**
 * Local-first storage.
 *
 * Projects and their media live in IndexedDB on the user's machine. There is
 * no server and no sync: nothing here ever leaves the browser.
 */

export interface StoredMedia {
  id: string;
  blob: Blob;
  name: string;
  mime: string;
}

interface StudioDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: { updatedAt: number };
  };
  media: {
    key: string;
    value: StoredMedia;
  };
  motionPresets: {
    key: string;
    value: MotionPreset;
  };
}

const DB_NAME = 'mockup-studio';
/** Bumped to 2 when saved motion presets were added. */
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<StudioDB>> | null = null;

function getDB(): Promise<IDBPDatabase<StudioDB>> {
  if (!dbPromise) {
    dbPromise = openDB<StudioDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          const store = db.createObjectStore('projects', { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('media')) {
          db.createObjectStore('media', { keyPath: 'id' });
        }
        // Guarded rather than versioned so the same block serves a database
        // being created from nothing and one being upgraded from version 1.
        if (!db.objectStoreNames.contains('motionPresets')) {
          db.createObjectStore('motionPresets', { keyPath: 'id' });
        }
      },
      blocked() {
        console.warn('[storage] another tab is holding an older database version open');
      },
    });
  }
  return dbPromise;
}

/** True when persistence is usable — private-mode browsers can refuse it. */
export async function isStorageAvailable(): Promise<boolean> {
  try {
    await getDB();
    return true;
  } catch {
    return false;
  }
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('projects', 'updatedAt');
  // Newest first.
  return all.map(migrateProject).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | null> {
  const db = await getDB();
  const raw = await db.get('projects', id);
  return raw ? migrateProject(raw) : null;
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDB();
  await db.put('projects', { ...project, updatedAt: Date.now() });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB();
  const project = await db.get('projects', id);
  await db.delete('projects', id);
  if (project?.media) await collectGarbage();
}

export async function putMedia(media: StoredMedia): Promise<void> {
  const db = await getDB();
  await db.put('media', media);
}

export async function getMedia(id: string): Promise<StoredMedia | null> {
  const db = await getDB();
  return (await db.get('media', id)) ?? null;
}

/**
 * Drop media blobs no project references any more.
 *
 * Media is the expensive part of the store — a few screen recordings can be
 * hundreds of megabytes — so orphans are swept rather than left to accumulate.
 */
export async function collectGarbage(): Promise<number> {
  const db = await getDB();
  const projects = await db.getAll('projects');
  const referenced = new Set(
    projects.map((project) => project.media?.id).filter((id): id is string => Boolean(id)),
  );
  const mediaKeys = await db.getAllKeys('media');
  let removed = 0;
  for (const key of mediaKeys) {
    if (!referenced.has(key)) {
      await db.delete('media', key);
      removed += 1;
    }
  }
  return removed;
}

export async function listMotionPresets(): Promise<MotionPreset[]> {
  const db = await getDB();
  const all = await db.getAll('motionPresets');
  // A record that will not coerce is dropped rather than allowed to break the
  // whole list, which is the same bargain the project migration makes.
  return all
    .map(migrateMotionPreset)
    .filter((preset): preset is MotionPreset => preset !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveMotionPreset(preset: MotionPreset): Promise<void> {
  const db = await getDB();
  await db.put('motionPresets', preset);
}

export async function deleteMotionPreset(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('motionPresets', id);
}

export interface StorageUsage {
  usage: number;
  quota: number;
}

export async function estimateUsage(): Promise<StorageUsage | null> {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}

/**
 * Ask the browser to keep this origin's data through storage pressure.
 * Best-effort: a refusal is not an error, the app just carries on.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
