import { describe, expect, it } from 'vitest';
import { lightRig, tintForWarmth } from '../../src/core/lighting.ts';
import { defaultScene, migrateProject } from '../../src/core/project.ts';
import type { SceneSettings, Vec3 } from '../../src/core/types.ts';

const scene = (over: Partial<SceneSettings> = {}): SceneSettings => ({ ...defaultScene(), ...over });

const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);

describe('light placement', () => {
  it('keeps every lamp the same distance out, whatever the angle', () => {
    const first = lightRig(scene({ lightAngle: 0, lightElevation: 0 }));
    const radius = length(first.key);
    for (const angle of [0, 45, 90, 180, 270, 359]) {
      for (const elevation of [-60, 0, 31, 85]) {
        const rig = lightRig(scene({ lightAngle: angle, lightElevation: elevation }));
        for (const lamp of [rig.key, rig.fill, rig.rim]) {
          expect(length(lamp)).toBeCloseTo(radius, 6);
        }
      }
    }
  });

  it('puts the key light in front at the default angle', () => {
    const rig = lightRig(scene());
    // The camera looks down +z, so a key light the viewer can see the effect of
    // has to be on that side.
    expect(rig.key.z).toBeGreaterThan(0);
    expect(rig.key.y).toBeGreaterThan(0);
  });

  it('sweeps the key light round as the angle turns', () => {
    const front = lightRig(scene({ lightAngle: 0 })).key;
    const right = lightRig(scene({ lightAngle: 90 })).key;
    const back = lightRig(scene({ lightAngle: 180 })).key;
    expect(front.z).toBeGreaterThan(0);
    expect(right.x).toBeGreaterThan(Math.abs(right.z));
    expect(back.z).toBeLessThan(0);
  });

  it('wraps rather than jumping at the seam', () => {
    const before = lightRig(scene({ lightAngle: 359 })).key;
    const after = lightRig(scene({ lightAngle: 0 })).key;
    // A degree apart should be a degree apart, not a whole turn.
    expect(Math.hypot(before.x - after.x, before.y - after.y, before.z - after.z)).toBeLessThan(0.3);
  });

  it('raises the key light with elevation', () => {
    const low = lightRig(scene({ lightElevation: -30 })).key;
    const high = lightRig(scene({ lightElevation: 80 })).key;
    expect(low.y).toBeLessThan(0);
    expect(high.y).toBeGreaterThan(low.y);
  });

  it('keeps the rig together — the fill and rim follow the key round', () => {
    const a = lightRig(scene({ lightAngle: 0 }));
    const b = lightRig(scene({ lightAngle: 90 }));
    // Everything moved, rather than only the key.
    expect(b.fill).not.toEqual(a.fill);
    expect(b.rim).not.toEqual(a.rim);
  });
});

describe('intensity', () => {
  it('scales every lamp by the overall brightness', () => {
    const full = lightRig(scene({ lightIntensity: 1 })).intensities;
    const half = lightRig(scene({ lightIntensity: 0.5 })).intensities;
    expect(half.key).toBeCloseTo(full.key / 2, 6);
    expect(half.fill).toBeCloseTo(full.fill / 2, 6);
    expect(half.rim).toBeCloseTo(full.rim / 2, 6);
    expect(half.ambient).toBeCloseTo(full.ambient / 2, 6);
  });

  it('lets the fill and ambient be set on top of the overall level', () => {
    const base = lightRig(scene()).intensities;
    expect(lightRig(scene({ fillIntensity: 0 })).intensities.fill).toBe(0);
    expect(lightRig(scene({ fillIntensity: 2 })).intensities.fill).toBeCloseTo(base.fill * 2, 6);
    expect(lightRig(scene({ ambientIntensity: 0 })).intensities.ambient).toBe(0);
  });

  it('keeps the fill on the camera side, where it can actually fill', () => {
    // These devices are slabs facing the viewer, so only a light with a
    // component toward the camera reaches a surface anyone can see. A fill
    // swung round behind lights nothing and the control would read as broken.
    for (const angle of [0, 45, 90, 180, 270, 330]) {
      const rig = lightRig(scene({ lightAngle: angle }));
      expect(rig.fill.z, `fill should stay in front at ${angle} degrees`).toBeGreaterThan(0);
    }
  });

  it('never returns a negative intensity', () => {
    const rig = lightRig(scene({ lightIntensity: -5, fillIntensity: -5, ambientIntensity: -5 }));
    for (const value of Object.values(rig.intensities)) expect(value).toBeGreaterThanOrEqual(0);
  });

  it('survives values that are not numbers at all', () => {
    const broken = lightRig(
      scene({
        lightIntensity: NaN,
        lightAngle: NaN,
        lightElevation: NaN,
        fillIntensity: NaN,
        ambientIntensity: NaN,
      }),
    );
    for (const value of Object.values(broken.intensities)) expect(Number.isFinite(value)).toBe(true);
    for (const lamp of [broken.key, broken.fill, broken.rim]) {
      expect(Number.isFinite(length(lamp))).toBe(true);
    }
  });
});

describe('warmth', () => {
  it('is neutral in the middle and tints either way', () => {
    expect(tintForWarmth(0)).toBe('#ffffff');
    const warm = tintForWarmth(1);
    const cool = tintForWarmth(-1);
    // Warm means more red than blue; cool the other way round.
    expect(Number.parseInt(warm.slice(1, 3), 16)).toBeGreaterThan(
      Number.parseInt(warm.slice(5, 7), 16),
    );
    expect(Number.parseInt(cool.slice(5, 7), 16)).toBeGreaterThan(
      Number.parseInt(cool.slice(1, 3), 16),
    );
  });

  it('always produces a valid hex colour', () => {
    for (const w of [-2, -1, -0.5, 0, 0.5, 1, 2, NaN]) {
      expect(tintForWarmth(w)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('leans the fill against the key, so a warm scene does not go all orange', () => {
    const rig = lightRig(scene({ lightWarmth: 1 }));
    expect(rig.keyColor).not.toBe(rig.fillColor);
    expect(Number.parseInt(rig.fillColor.slice(5, 7), 16)).toBeGreaterThan(
      Number.parseInt(rig.fillColor.slice(1, 3), 16),
    );
  });
});

describe('migration of the new scene fields', () => {
  const sceneOf = (raw: unknown): SceneSettings => migrateProject({ scene: raw }).scene;

  it('fills in defaults for a project saved before any of this existed', () => {
    const old = sceneOf({ device: 'phone', deviceColor: '#1c1d21', lightIntensity: 1 });
    expect(old.lightAngle).toBe(defaultScene().lightAngle);
    expect(old.bodyMetalness).toBe(defaultScene().bodyMetalness);
    expect(old.screenCutout).toBe('island');
    expect(old.shadowSoftness).toBe(defaultScene().shadowSoftness);
  });

  it('wraps the light angle rather than clamping it', () => {
    expect(sceneOf({ lightAngle: 370 }).lightAngle).toBeCloseTo(10, 6);
    expect(sceneOf({ lightAngle: -90 }).lightAngle).toBeCloseTo(270, 6);
    expect(sceneOf({ lightAngle: 720 }).lightAngle).toBeCloseTo(0, 6);
  });

  it('clamps the finish and glare into range', () => {
    const clamped = sceneOf({ bodyMetalness: 9, bodyRoughness: -3, screenGlare: 4 });
    expect(clamped.bodyMetalness).toBe(1);
    expect(clamped.bodyRoughness).toBeGreaterThan(0);
    expect(clamped.screenGlare).toBe(1);
  });

  it('rejects an unknown cutout', () => {
    expect(sceneOf({ screenCutout: 'hole-punch' }).screenCutout).toBe('island');
  });
});
