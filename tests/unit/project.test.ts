import { describe, expect, it } from 'vitest';
import {
  MAX_DURATION,
  MIN_DURATION,
  SCHEMA_VERSION,
  createProject,
  effectiveDuration,
  hexColor,
  migrateProject,
  newId,
  normalizeProject,
} from '../../src/core/project.ts';
import type { Project } from '../../src/core/types.ts';

describe('createProject', () => {
  it('produces a valid, current-schema project', () => {
    const project = createProject();
    expect(project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(project.id).toBeTruthy();
    expect(project.media).toBeNull();
    expect(project.output.fps).toBe(30);
    expect(project.scene.device).toBe('phone');
  });

  it('gives every project a distinct id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
  });

  it('accepts a custom name', () => {
    expect(createProject('Launch clip').name).toBe('Launch clip');
  });
});

describe('hexColor', () => {
  it('normalises valid colours', () => {
    expect(hexColor('#AABBCC', '#000000')).toBe('#aabbcc');
    expect(hexColor('aabbcc', '#000000')).toBe('#aabbcc');
    expect(hexColor('#abc', '#000000')).toBe('#aabbcc');
    expect(hexColor('  #FFF  ', '#000000')).toBe('#ffffff');
  });

  it('falls back on anything invalid', () => {
    for (const bad of ['red', '#12345', '#gggggg', '', null, undefined, 42, {}]) {
      expect(hexColor(bad, '#123456')).toBe('#123456');
    }
  });
});

describe('migrateProject', () => {
  it('rebuilds a project from nothing', () => {
    for (const junk of [null, undefined, 42, 'nope', [], true]) {
      const project = migrateProject(junk);
      expect(project.schemaVersion).toBe(SCHEMA_VERSION);
      expect(project.scene.device).toBe('phone');
    }
  });

  it('keeps the fields it recognises', () => {
    const project = migrateProject({
      id: 'abc',
      name: 'Kept',
      scene: { device: 'laptop', deviceColor: '#ff0000' },
      motion: { preset: 'spin', speed: 2 },
      output: { aspect: '9:16', resolution: '4k', format: 'webm' },
    });
    expect(project.id).toBe('abc');
    expect(project.name).toBe('Kept');
    expect(project.scene.device).toBe('laptop');
    expect(project.scene.deviceColor).toBe('#ff0000');
    expect(project.motion.preset).toBe('spin');
    expect(project.motion.speed).toBe(2);
    expect(project.output.aspect).toBe('9:16');
    expect(project.output.resolution).toBe('4k');
    expect(project.output.format).toBe('webm');
  });

  it('replaces unknown enum values with defaults', () => {
    const project = migrateProject({
      scene: { device: 'smartfridge' },
      motion: { preset: 'teleport' },
      output: { aspect: '3:2', resolution: '8k', format: 'avi', quality: 'ultra' },
    });
    expect(project.scene.device).toBe('phone');
    expect(project.motion.preset).toBe('float');
    expect(project.output.aspect).toBe('16:9');
    expect(project.output.resolution).toBe('1080p');
    expect(project.output.format).toBe('mp4');
    expect(project.output.quality).toBe('high');
  });

  it('coerces the screen fit mode', () => {
    expect(migrateProject({ scene: { screenFit: 'contain' } }).scene.screenFit).toBe('contain');
    expect(migrateProject({ scene: { screenFit: 'stretch' } }).scene.screenFit).toBe('cover');
    expect(migrateProject({ scene: {} }).scene.screenFit).toBe('cover');
  });

  it('clamps out-of-range numbers', () => {
    const project = migrateProject({
      scene: {
        scale: 99,
        offsetX: -50,
        offsetY: 50,
        rotationY: 900,
        shadowStrength: 7,
        lightIntensity: -3,
      },
      motion: { amount: 100, speed: -5 },
      output: { duration: 9999 },
    });
    expect(project.scene.scale).toBe(3);
    expect(project.scene.offsetX).toBe(-1);
    expect(project.scene.offsetY).toBe(1);
    expect(project.scene.rotationY).toBe(180);
    expect(project.scene.shadowStrength).toBe(1);
    expect(project.scene.lightIntensity).toBe(0);
    expect(project.motion.amount).toBe(2);
    expect(project.motion.speed).toBe(0.25);
    expect(project.output.duration).toBe(MAX_DURATION);
  });

  it('rejects NaN and Infinity', () => {
    const project = migrateProject({
      scene: { scale: Number.NaN, rotationX: Number.POSITIVE_INFINITY },
      output: { duration: Number.NaN, fps: Number.NaN },
    });
    expect(Number.isFinite(project.scene.scale)).toBe(true);
    expect(project.scene.scale).toBe(1);
    // Infinity is corrupt input rather than "a very large angle", so it falls
    // back to the default instead of clamping to the range limit.
    expect(project.scene.rotationX).toBe(-6);
    expect(project.output.duration).toBe(5);
    expect(project.output.fps).toBe(30);
  });

  it('snaps frame rate to a supported value', () => {
    expect(migrateProject({ output: { fps: 25 } }).output.fps).toBe(24);
    expect(migrateProject({ output: { fps: 29.97 } }).output.fps).toBe(30);
    expect(migrateProject({ output: { fps: 120 } }).output.fps).toBe(60);
  });

  it('enforces the minimum duration', () => {
    expect(migrateProject({ output: { duration: 0 } }).output.duration).toBe(MIN_DURATION);
  });

  it('drops a media reference with no id', () => {
    expect(migrateProject({ media: { kind: 'video', name: 'x' } }).media).toBeNull();
    expect(migrateProject({ media: 'not-an-object' }).media).toBeNull();
  });

  it('keeps a well-formed media reference', () => {
    const media = migrateProject({
      media: {
        id: 'm1',
        kind: 'video',
        name: 'demo.mp4',
        mime: 'video/mp4',
        width: 1920,
        height: 1080,
        duration: 12,
      },
    }).media;
    expect(media).toEqual({
      id: 'm1',
      kind: 'video',
      name: 'demo.mp4',
      mime: 'video/mp4',
      width: 1920,
      height: 1080,
      duration: 12,
    });
  });

  it('is idempotent', () => {
    const once = migrateProject({ scene: { device: 'tablet' }, output: { fps: 47 } });
    const twice = migrateProject(once);
    expect({ ...twice, updatedAt: 0 }).toEqual({ ...once, updatedAt: 0 });
  });

  it('round-trips a real project through JSON unchanged', () => {
    const original = createProject('Round trip');
    const restored = migrateProject(JSON.parse(JSON.stringify(original)));
    expect(restored).toEqual(original);
  });

  it('ignores prototype-polluting keys', () => {
    const project = migrateProject(
      JSON.parse('{"__proto__":{"polluted":true},"name":"safe"}') as unknown,
    );
    expect(project.name).toBe('safe');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('normalizeProject is migrateProject over a live object', () => {
    const project = createProject();
    expect(normalizeProject(project)).toEqual(project);
  });
});

describe('effectiveDuration', () => {
  const withMedia = (kind: 'image' | 'video', duration: number, requested: number): Project => {
    const project = createProject();
    project.output.duration = requested;
    project.media = {
      id: 'm',
      kind,
      name: 'x',
      mime: kind === 'video' ? 'video/mp4' : 'image/png',
      width: 100,
      height: 100,
      duration,
    };
    return project;
  };

  it('uses the requested duration for stills', () => {
    expect(effectiveDuration(withMedia('image', 0, 8))).toBe(8);
  });

  it('uses the requested duration when there is no media', () => {
    const project = createProject();
    project.output.duration = 7;
    expect(effectiveDuration(project)).toBe(7);
  });

  it('shortens the clip to a video that runs out early', () => {
    expect(effectiveDuration(withMedia('video', 3, 10))).toBe(3);
  });

  it('keeps the requested duration when the video is longer', () => {
    expect(effectiveDuration(withMedia('video', 30, 6))).toBe(6);
  });

  it('never drops below the minimum duration', () => {
    expect(effectiveDuration(withMedia('video', 0.05, 10))).toBe(MIN_DURATION);
  });
});
