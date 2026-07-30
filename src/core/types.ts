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
  /** Ambient/environment light intensity, 0..2. */
  lightIntensity: number;
}

export interface MotionSettings {
  preset: MotionId;
  /** Intensity multiplier, 0..2. */
  amount: number;
  /** Number of cycles across the clip for looping presets; quantised to an integer. */
  speed: number;
  /** Whether looping presets should tile seamlessly. */
  loop: boolean;
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
