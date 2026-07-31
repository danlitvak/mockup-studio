/**
 * Project data model.
 *
 * Everything in here is plain, serialisable data: a project is fully described
 * by this object plus one media blob. That is what makes the app local-first —
 * the document is the source of truth and it lives on the user's machine.
 */

import type { FitMode } from './fit.ts';

export type { FitMode };

export type DeviceId = 'phone' | 'tablet' | 'laptop' | 'browser' | 'screen';

export type MotionId =
  | 'still'
  | 'float'
  | 'spin'
  | 'orbit'
  | 'pan'
  | 'tilt-in'
  | 'push-in'
  | 'flip-in';

export type BackgroundKind = 'solid' | 'gradient' | 'transparent';

export type AspectId = '16:9' | '9:16' | '1:1' | '4:5' | '21:9';

export type ResolutionId = '720p' | '1080p' | '1440p' | '4k';

export type QualityId = 'low' | 'medium' | 'high' | 'very-high';

export type ExportFormat = 'mp4' | 'webm';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Background {
  kind: BackgroundKind;
  /** Base colour, or gradient start. `#rrggbb`. */
  color: string;
  /** Gradient end colour. `#rrggbb`. */
  color2: string;
  /** Gradient angle in degrees, 0 = bottom-to-top. */
  angle: number;
}

/** What is cut out of the top of a phone screen. */
export type ScreenCutout = 'none' | 'notch' | 'island';

export interface SceneSettings {
  device: DeviceId;
  /** Device body colour, `#rrggbb`. */
  deviceColor: string;
  /** How the source media is placed inside the device screen. */
  screenFit: FitMode;
  background: Background;
  /** Uniform device scale multiplier. */
  scale: number;
  /** Horizontal offset as a fraction of frame width. */
  offsetX: number;
  /** Vertical offset as a fraction of frame height. */
  offsetY: number;
  /** Static base pose, in degrees. Motion is layered on top of this. */
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  shadow: boolean;
  /** 0..1 */
  shadowStrength: number;
  /** 0 is a tight contact shadow, 1 a wide diffuse one. */
  shadowSoftness: number;

  /* Lighting. The rig is derived from one angle — see core/lighting.ts. */

  /** Overall light level, 0..2. Scales every lamp in the rig. */
  lightIntensity: number;
  /** Where the key light sits around the device, in degrees. */
  lightAngle: number;
  /** How high the key light sits, in degrees. */
  lightElevation: number;
  /** -1 cool, 0 neutral, 1 warm. */
  lightWarmth: number;
  /** Lifts the shaded side of the device, 0..2. */
  fillIntensity: number;
  /** How much of the surround the body reflects, 0..2. */
  reflectionIntensity: number;
  /** Sky/environment fill, 0..2. */
  ambientIntensity: number;

  /* Materials. */

  /** How metallic the body reads, 0..1. */
  bodyMetalness: number;
  /** 0 is a mirror, 1 is matte. */
  bodyRoughness: number;
  /** Strength of the glass sheen across the screen, 0..1. */
  screenGlare: number;

  /** Only drawn on devices whose spec has a cutout. */
  screenCutout: ScreenCutout;
}

export type MotionMode = 'preset' | 'keyframes';

export type EasingId = 'linear' | 'ease-in-out' | 'ease-out' | 'ease-in' | 'back';

/**
 * One pose on the keyframe track.
 *
 * Every channel is an offset from the resting pose rather than an absolute
 * value, which is the same convention the built-in presets follow. It means the
 * scene's own rotation, scale and offset controls keep working underneath a
 * keyframed animation instead of being overridden by it.
 */
export interface Keyframe {
  /** Normalised time along the clip, 0..1. */
  t: number;
  /** Position offset, in scene units. */
  x: number;
  y: number;
  z: number;
  /** Rotation offset, in degrees. */
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  /** Scale multiplier applied on top of the scene's scale. */
  scale: number;
  /** How the track eases *into* this keyframe from the one before it. */
  easing: EasingId;
}

export interface MotionSettings {
  /**
   * Which description of the motion is in charge. Held explicitly rather than
   * inferred from whether `keyframes` is empty, so that switching back to a
   * preset does not mean throwing the keyframe track away.
   */
  mode: MotionMode;
  preset: MotionId;
  /** Intensity multiplier, 0..2. */
  amount: number;
  /** Number of cycles across the clip for looping presets; quantised to an integer. */
  speed: number;
  /** Whether the motion should tile seamlessly — applies to both modes. */
  loop: boolean;
  /** Poses along the clip, sorted by time. Only used in `keyframes` mode. */
  keyframes: Keyframe[];
}

export interface OutputSettings {
  aspect: AspectId;
  resolution: ResolutionId;
  fps: number;
  /** Clip length in seconds. */
  duration: number;
  format: ExportFormat;
  quality: QualityId;
}

export interface MediaRef {
  id: string;
  kind: 'image' | 'video';
  name: string;
  mime: string;
  width: number;
  height: number;
  /** Seconds; 0 for stills. */
  duration: number;
}

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  media: MediaRef | null;
  scene: SceneSettings;
  motion: MotionSettings;
  output: OutputSettings;
}

/** A resolved transform for one moment in time. Rotations are radians. */
export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: number;
}
