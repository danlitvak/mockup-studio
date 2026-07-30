import { DEVICE_IDS } from './devices.ts';
import { ASPECT_IDS, RESOLUTION_IDS } from './framing.ts';
import { MOTION_IDS } from './motion.ts';
import { QUALITY_IDS } from './export-config.ts';
import type {
  AspectId,
  Background,
  DeviceId,
  ExportFormat,
  FitMode,
  MediaRef,
  MotionId,
  MotionSettings,
  Project,
  QualityId,
  ResolutionId,
  SceneSettings,
  OutputSettings,
} from './types.ts';

export const SCHEMA_VERSION = 1;

export const FPS_OPTIONS = [24, 30, 60] as const;
export const MIN_DURATION = 0.5;
export const MAX_DURATION = 60;

/* -------------------------------------------------------------------------- */
/* Tolerant coercion                                                           */
/* -------------------------------------------------------------------------- */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const str = (v: unknown, fallback: string, maxLen = 200): string => {
  if (typeof v !== 'string') return fallback;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, maxLen) : fallback;
};

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/** Accepts `#rgb`, `#rrggbb`, or the same without the hash. */
export const hexColor = (v: unknown, fallback: string): string => {
  if (typeof v === 'string') {
    const raw = v.trim().replace(/^#/, '');
    if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
    if (/^[0-9a-f]{3}$/i.test(raw)) {
      const chars = raw.toLowerCase().split('');
      return `#${chars.map((c) => c + c).join('')}`;
    }
  }
  return fallback;
};

const nearestFps = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 30;
  let best: number = FPS_OPTIONS[0];
  for (const option of FPS_OPTIONS) {
    if (Math.abs(option - n) < Math.abs(best - n)) best = option;
  }
  return best;
};

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

export const defaultBackground = (): Background => ({
  kind: 'gradient',
  color: '#1b2735',
  color2: '#0b0f17',
  angle: 160,
});

export const defaultScene = (): SceneSettings => ({
  device: 'phone',
  deviceColor: '#1c1d21',
  screenFit: 'cover',
  background: defaultBackground(),
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotationX: -6,
  rotationY: 18,
  rotationZ: 0,
  shadow: true,
  shadowStrength: 0.55,
  lightIntensity: 1,
});

export const defaultMotion = (): MotionSettings => ({
  preset: 'float',
  amount: 1,
  speed: 1,
  loop: true,
});

export const defaultOutput = (): OutputSettings => ({
  aspect: '16:9',
  resolution: '1080p',
  fps: 30,
  duration: 5,
  format: 'mp4',
  quality: 'high',
});

export function createProject(name = 'Untitled mockup'): Project {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    media: null,
    scene: defaultScene(),
    motion: defaultMotion(),
    output: defaultOutput(),
  };
}

/* -------------------------------------------------------------------------- */
/* Migration                                                                   */
/* -------------------------------------------------------------------------- */

function migrateBackground(raw: unknown): Background {
  const d = defaultBackground();
  if (!isRecord(raw)) return d;
  return {
    kind: oneOf(raw.kind, ['solid', 'gradient', 'transparent'] as const, d.kind),
    color: hexColor(raw.color, d.color),
    color2: hexColor(raw.color2, d.color2),
    angle: num(raw.angle, d.angle, 0, 360),
  };
}

function migrateScene(raw: unknown): SceneSettings {
  const d = defaultScene();
  if (!isRecord(raw)) return d;
  return {
    device: oneOf<DeviceId>(raw.device, DEVICE_IDS, d.device),
    deviceColor: hexColor(raw.deviceColor, d.deviceColor),
    screenFit: oneOf<FitMode>(raw.screenFit, ['cover', 'contain'] as const, d.screenFit),
    background: migrateBackground(raw.background),
    scale: num(raw.scale, d.scale, 0.2, 3),
    offsetX: num(raw.offsetX, d.offsetX, -1, 1),
    offsetY: num(raw.offsetY, d.offsetY, -1, 1),
    rotationX: num(raw.rotationX, d.rotationX, -180, 180),
    rotationY: num(raw.rotationY, d.rotationY, -180, 180),
    rotationZ: num(raw.rotationZ, d.rotationZ, -180, 180),
    shadow: bool(raw.shadow, d.shadow),
    shadowStrength: num(raw.shadowStrength, d.shadowStrength, 0, 1),
    lightIntensity: num(raw.lightIntensity, d.lightIntensity, 0, 2),
  };
}

function migrateMotion(raw: unknown): MotionSettings {
  const d = defaultMotion();
  if (!isRecord(raw)) return d;
  return {
    preset: oneOf<MotionId>(raw.preset, MOTION_IDS, d.preset),
    amount: num(raw.amount, d.amount, 0, 2),
    speed: num(raw.speed, d.speed, 0.25, 6),
    loop: bool(raw.loop, d.loop),
  };
}

function migrateOutput(raw: unknown): OutputSettings {
  const d = defaultOutput();
  if (!isRecord(raw)) return d;
  return {
    aspect: oneOf<AspectId>(raw.aspect, ASPECT_IDS, d.aspect),
    resolution: oneOf<ResolutionId>(raw.resolution, RESOLUTION_IDS, d.resolution),
    fps: nearestFps(raw.fps),
    duration: num(raw.duration, d.duration, MIN_DURATION, MAX_DURATION),
    format: oneOf<ExportFormat>(raw.format, ['mp4', 'webm'] as const, d.format),
    quality: oneOf<QualityId>(raw.quality, QUALITY_IDS, d.quality),
  };
}

function migrateMedia(raw: unknown): MediaRef | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id, '');
  if (!id) return null;
  const kind = oneOf(raw.kind, ['image', 'video'] as const, 'image');
  return {
    id,
    kind,
    name: str(raw.name, 'media'),
    mime: str(raw.mime, kind === 'video' ? 'video/mp4' : 'image/png'),
    width: num(raw.width, 1, 1, 100_000),
    height: num(raw.height, 1, 1, 100_000),
    duration: num(raw.duration, 0, 0, 24 * 3600),
  };
}

/**
 * Turn anything that claims to be a project into a valid one.
 *
 * This is the only entry point for data coming off disk or out of an imported
 * file, so it has to assume the input is arbitrary: fields are coerced and
 * clamped rather than trusted, and unknown enum values fall back to defaults.
 */
export function migrateProject(raw: unknown): Project {
  const now = Date.now();
  if (!isRecord(raw)) return createProject();

  const createdAt = num(raw.createdAt, now, 0, Number.MAX_SAFE_INTEGER);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: str(raw.id, newId(), 128),
    name: str(raw.name, 'Untitled mockup', 120),
    createdAt,
    updatedAt: num(raw.updatedAt, createdAt, 0, Number.MAX_SAFE_INTEGER),
    media: migrateMedia(raw.media),
    scene: migrateScene(raw.scene),
    motion: migrateMotion(raw.motion),
    output: migrateOutput(raw.output),
  };
}

/** Re-run coercion over a live project — used before saving and exporting. */
export const normalizeProject = (project: Project): Project => migrateProject(project);

/**
 * Effective clip length. A video shorter than the requested duration should
 * not export frozen tail frames, so the clip follows the media when it is
 * shorter and the user has not asked for something longer than the source.
 */
export function effectiveDuration(project: Project): number {
  const requested = project.output.duration;
  const media = project.media;
  if (media && media.kind === 'video' && media.duration > 0) {
    return Math.min(requested, Math.max(MIN_DURATION, media.duration));
  }
  return requested;
}
