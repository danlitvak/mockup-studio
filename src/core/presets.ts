import { migrateMotion, newId } from './project.ts';
import type { MotionSettings } from './types.ts';

/**
 * Motion configurations the user has named and kept.
 *
 * A preset stores the whole `MotionSettings` object rather than a copy of the
 * fields that happen to exist today. Anything motion gains later is therefore
 * carried by presets that were saved before it existed, without a migration and
 * without this file having to know what was added.
 */

export interface MotionPreset {
  id: string;
  name: string;
  createdAt: number;
  motion: MotionSettings;
}

export const MAX_PRESET_NAME = 60;

/**
 * How many presets are kept.
 *
 * Not a storage limit — presets are tiny. It stops a runaway caller from
 * growing the list without bound, and keeps the picker a usable length.
 */
export const MAX_PRESETS = 50;

export const DEFAULT_PRESET_NAME = 'Custom motion';

/**
 * Presets are identified by name for the purpose of saving: saving twice under
 * one name replaces, rather than quietly accumulating near-duplicates that are
 * impossible to tell apart in a list.
 */
export const presetKey = (name: string): string => name.trim().toLowerCase();

/** Trim and bound a user-supplied name, falling back rather than rejecting. */
export function cleanPresetName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PRESET_NAME;
  const trimmed = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_PRESET_NAME);
  return trimmed || DEFAULT_PRESET_NAME;
}

export function createMotionPreset(name: string, motion: MotionSettings): MotionPreset {
  return {
    id: newId(),
    name: cleanPresetName(name),
    createdAt: Date.now(),
    // Coerced on the way in as well as out: a preset saved from a live project
    // should not be able to carry a value the project itself would have clamped.
    motion: migrateMotion(motion),
    };
}

/**
 * Turn anything that claims to be a preset into a valid one, or `null`.
 *
 * Like the project migration, this assumes the input is arbitrary — it is read
 * straight off disk, where an older or hand-edited record can be anything.
 */
export function migrateMotionPreset(raw: unknown): MotionPreset | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.slice(0, 128) : '';
  if (!id) return null;

  const createdAt =
    typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
      ? record.createdAt
      : 0;

  return {
    id,
    name: cleanPresetName(record.name),
    createdAt,
    motion: migrateMotion(record.motion),
  };
}

/** Newest first, which is the order the picker shows them in. */
const byNewest = (a: MotionPreset, b: MotionPreset): number => b.createdAt - a.createdAt;

export function sortPresets(presets: readonly MotionPreset[]): MotionPreset[] {
  return [...presets].sort(byNewest);
}

/**
 * Add a preset, replacing any existing one with the same name.
 *
 * The replacement keeps the original's id so anything already pointing at that
 * preset keeps working, and takes the new timestamp so it sorts as freshly
 * saved — saving over a preset is an edit, not a new thing.
 */
export function upsertPreset(
  presets: readonly MotionPreset[],
  preset: MotionPreset,
): MotionPreset[] {
  const key = presetKey(preset.name);
  const existing = presets.find((candidate) => presetKey(candidate.name) === key);
  const merged: MotionPreset = existing ? { ...preset, id: existing.id } : preset;
  const rest = presets.filter((candidate) => presetKey(candidate.name) !== key);
  return sortPresets([merged, ...rest]).slice(0, MAX_PRESETS);
}

export function removePreset(
  presets: readonly MotionPreset[],
  id: string,
): MotionPreset[] {
  return presets.filter((preset) => preset.id !== id);
}
