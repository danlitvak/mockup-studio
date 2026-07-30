import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeVideo,
} from 'mediabunny';
import { bitrateFor, codecFor, exportFilename, mimeFor } from '../core/export-config.ts';
import { frameCount, resolveResolution, timeForFrame } from '../core/framing.ts';
import { isCyclic } from '../core/motion.ts';
import { effectiveDuration } from '../core/project.ts';
import type { ExportFormat, Project } from '../core/types.ts';
import { seekVideo } from '../media/load.ts';
import type { MediaSource } from '../render/screen.ts';
import { Stage } from '../render/stage.ts';

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportCancelled';
  }
}

export class ExportUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportUnsupported';
  }
}

export interface ExportProgress {
  frame: number;
  total: number;
  phase: 'rendering' | 'finalizing';
}

export interface ExportRequest {
  project: Project;
  media: MediaSource | null;
  /** Present when the media is a video, so frames can be seeked exactly. */
  video: HTMLVideoElement | null;
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  frames: number;
  durationSeconds: number;
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new ExportCancelled();
};

/** Yield to the event loop so progress paints and cancel clicks land. */
const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Does this browser support the requested container/codec at this size?
 * Checked up front so a 4K export fails in a second rather than at frame 300.
 */
export async function canExport(
  format: ExportFormat,
  width: number,
  height: number,
): Promise<boolean> {
  try {
    return await canEncodeVideo(codecFor(format), { width, height });
  } catch {
    return false;
  }
}

/**
 * Render and encode the whole clip.
 *
 * Frames are produced deterministically rather than captured in real time:
 * the scene is drawn at an exact `t`, the source video is seeked to the
 * matching timestamp, and only then is the frame handed to the encoder. That
 * costs wall-clock time but means the output never drops or duplicates frames
 * on a busy machine.
 */
export async function exportVideo(request: ExportRequest): Promise<ExportResult> {
  const { project, media, video, onProgress, signal } = request;
  const { width, height } = resolveResolution(project.output.aspect, project.output.resolution);
  const duration = effectiveDuration(project);
  const fps = project.output.fps;
  const total = frameCount(duration, fps);
  const seamless = isCyclic(project.motion.preset) && project.motion.loop;
  const format = project.output.format;
  const bitrate = bitrateFor(width, height, fps, project.output.quality);

  if (!(await canExport(format, width, height))) {
    throw new ExportUnsupported(
      `This browser cannot encode ${format.toUpperCase()} at ${width}×${height}. Try a lower resolution or the other format.`,
    );
  }

  // Export renders offscreen so the live preview keeps its own canvas.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const stage = new Stage(canvas);
  const target = new BufferTarget();
  const output = new Output({
    format: format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target,
  });

  try {
    stage.setSize(width, height, 1);
    stage.setProject(project);
    stage.setMedia(media);

    const source = new CanvasSource(canvas, {
      codec: codecFor(format),
      quality: new Quality({ bitrate, bitrateMode: 'variable' }),
      keyFrameInterval: 2,
    });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();

    for (let frame = 0; frame < total; frame += 1) {
      throwIfAborted(signal);

      const t = timeForFrame(frame, total, seamless);

      if (video) {
        await seekVideo(video, t * duration);
        stage.invalidateScreen();
      }

      stage.renderFrame(t);
      await source.add(frame / fps, 1 / fps);

      onProgress?.({ frame: frame + 1, total, phase: 'rendering' });
      // Every few frames is enough to keep the UI responsive without
      // meaningfully slowing the export.
      if (frame % 5 === 4) await breathe();
    }

    throwIfAborted(signal);
    onProgress?.({ frame: total, total, phase: 'finalizing' });
    await output.finalize();

    const buffer = target.buffer;
    if (!buffer) throw new Error('The encoder produced no output.');

    return {
      blob: new Blob([buffer], { type: mimeFor(format) }),
      filename: exportFilename(project.name, format),
      width,
      height,
      frames: total,
      durationSeconds: total / fps,
    };
  } catch (error) {
    if (output.state === 'started' || output.state === 'pending') {
      await output.cancel().catch(() => undefined);
    }
    throw error;
  } finally {
    stage.dispose();
  }
}

/** Render a single frame as a PNG — handy for a poster image or a still ad. */
export async function exportFrame(
  project: Project,
  media: MediaSource | null,
  video: HTMLVideoElement | null,
  t: number,
): Promise<{ blob: Blob; filename: string }> {
  const { width, height } = resolveResolution(project.output.aspect, project.output.resolution);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const stage = new Stage(canvas);
  try {
    stage.setSize(width, height, 1);
    stage.setProject(project);
    stage.setMedia(media);

    if (video) {
      await seekVideo(video, t * effectiveDuration(project));
      stage.invalidateScreen();
    }
    stage.renderFrame(t);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) throw new Error('Could not read the rendered frame.');

    return {
      blob,
      filename: exportFilename(project.name, 'mp4').replace(/\.mp4$/, '.png'),
    };
  } finally {
    stage.dispose();
  }
}

/** Hand a finished file to the user. No upload, no round trip. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before dropping the URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
