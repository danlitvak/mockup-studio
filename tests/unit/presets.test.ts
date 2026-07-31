import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET_NAME,
  MAX_PRESETS,
  MAX_PRESET_NAME,
  cleanPresetName,
  createMotionPreset,
  migrateMotionPreset,
  presetKey,
  removePreset,
  sortPresets,
  upsertPreset,
  type MotionPreset,
} from '../../src/core/presets.ts';
import { MOTION_IDS } from '../../src/core/motion.ts';
import { defaultMotion } from '../../src/core/project.ts';
import type { MotionSettings } from '../../src/core/types.ts';

const motion = (over: Partial<MotionSettings> = {}): MotionSettings => ({
  ...defaultMotion(),
  ...over,
});

/** Build a preset with a fixed timestamp, since ordering is by creation time. */
const preset = (name: string, createdAt: number, over: Partial<MotionSettings> = {}): MotionPreset => ({
  id: `id-${name}-${createdAt}`,
  name,
  createdAt,
  motion: motion(over),
});

describe('preset names', () => {
  it('trims, collapses whitespace and bounds the length', () => {
    expect(cleanPresetName('  Slow   drift  ')).toBe('Slow drift');
    expect(cleanPresetName('x'.repeat(500))).toHaveLength(MAX_PRESET_NAME);
  });

  it('falls back rather than accepting an empty or non-string name', () => {
    for (const input of ['', '   ', null, undefined, 42, {}, []]) {
      expect(cleanPresetName(input)).toBe(DEFAULT_PRESET_NAME);
    }
  });

  it('matches names ignoring case and surrounding space', () => {
    expect(presetKey('  Drift ')).toBe(presetKey('drift'));
    expect(presetKey('Drift')).not.toBe(presetKey('Drifting'));
  });
});

describe('creating a preset', () => {
  it('captures the motion it was given', () => {
    const created = createMotionPreset('Spinner', motion({ preset: 'spin', speed: 3 }));
    expect(created.motion.preset).toBe('spin');
    expect(created.motion.speed).toBe(3);
    expect(created.name).toBe('Spinner');
    expect(created.id).toBeTruthy();
  });

  it('clamps motion on the way in, so a preset cannot hold an illegal value', () => {
    // The same coercion the project applies — a preset must not be a way to
    // smuggle a value past it.
    const created = createMotionPreset('Wild', motion({ amount: 99, speed: -5 }));
    expect(created.motion.amount).toBeLessThanOrEqual(2);
    expect(created.motion.speed).toBeGreaterThanOrEqual(0.25);
  });

  it('is independent of the settings object it was built from', () => {
    const source = motion({ amount: 1 });
    const created = createMotionPreset('Snapshot', source);
    source.amount = 0;
    expect(created.motion.amount).toBe(1);
  });
});

describe('migrating a stored preset', () => {
  it('rejects anything without an id', () => {
    for (const input of [null, undefined, 42, 'preset', [], {}, { name: 'x' }]) {
      expect(migrateMotionPreset(input)).toBeNull();
    }
  });

  it('fills in a usable preset from a partial record', () => {
    const migrated = migrateMotionPreset({ id: 'abc' });
    expect(migrated).not.toBeNull();
    expect(migrated!.id).toBe('abc');
    expect(migrated!.name).toBe(DEFAULT_PRESET_NAME);
    expect(migrated!.motion).toEqual(defaultMotion());
  });

  it('coerces a nonsense motion into the legal range', () => {
    const migrated = migrateMotionPreset({
      id: 'abc',
      name: 'Broken',
      motion: { preset: 'not-a-preset', amount: 'lots', speed: null, loop: 'yes' },
    });

    // Asserted as ranges rather than against the defaults, because the two are
    // not the same thing: `Number(null)` is 0, which is finite, so a null
    // numeric clamps to the nearest legal value instead of falling back. What
    // matters is that nothing illegal survives.
    const { preset, amount, speed, loop } = migrated!.motion;
    expect(MOTION_IDS).toContain(preset);
    expect(amount).toBeGreaterThanOrEqual(0);
    expect(amount).toBeLessThanOrEqual(2);
    expect(speed).toBeGreaterThanOrEqual(0.25);
    expect(speed).toBeLessThanOrEqual(6);
    expect(typeof loop).toBe('boolean');
  });

  it('round-trips a preset it created', () => {
    const created = createMotionPreset('Round trip', motion({ preset: 'orbit', amount: 1.5 }));
    expect(migrateMotionPreset(JSON.parse(JSON.stringify(created)))).toEqual(created);
  });
});

describe('the preset list', () => {
  it('keeps the newest first', () => {
    const sorted = sortPresets([preset('old', 1), preset('new', 3), preset('mid', 2)]);
    expect(sorted.map((p) => p.name)).toEqual(['new', 'mid', 'old']);
  });

  it('adds a new preset at the front', () => {
    const list = upsertPreset([preset('old', 1)], preset('fresh', 5));
    expect(list.map((p) => p.name)).toEqual(['fresh', 'old']);
  });

  it('replaces rather than duplicating a name, ignoring case', () => {
    const existing = preset('Drift', 1, { preset: 'float' });
    const list = upsertPreset([existing], preset('  drift  ', 9, { preset: 'spin' }));
    expect(list).toHaveLength(1);
    expect(list[0]!.motion.preset).toBe('spin');
  });

  it('keeps the replaced preset id, so references to it survive', () => {
    const existing = preset('Drift', 1);
    const list = upsertPreset([existing], preset('Drift', 9, { preset: 'spin' }));
    expect(list[0]!.id).toBe(existing.id);
  });

  it('never grows past the cap', () => {
    let list: MotionPreset[] = [];
    for (let i = 0; i < MAX_PRESETS + 12; i += 1) {
      list = upsertPreset(list, preset(`p${i}`, i));
    }
    expect(list).toHaveLength(MAX_PRESETS);
    // The cap drops the oldest, not the newest.
    expect(list[0]!.name).toBe(`p${MAX_PRESETS + 11}`);
  });

  it('does not mutate the list it was given', () => {
    const original = [preset('one', 1)];
    const copy = [...original];
    upsertPreset(original, preset('two', 2));
    removePreset(original, original[0]!.id);
    sortPresets(original);
    expect(original).toEqual(copy);
  });

  it('removes by id and ignores an unknown one', () => {
    const list = [preset('one', 1), preset('two', 2)];
    expect(removePreset(list, list[0]!.id).map((p) => p.name)).toEqual(['two']);
    expect(removePreset(list, 'nope')).toHaveLength(2);
  });
});
