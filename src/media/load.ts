import { newId } from '../core/project.ts';
import type { MediaRef } from '../core/types.ts';
import type { MediaSource } from '../render/screen.ts';

export interface LoadedMedia {
  ref: MediaRef;
  source: MediaSource;
  blob: Blob;
  /** Present for video; must be revoked on release. */
  objectUrl: string | null;
  /** The element to seek during export. Null for stills. */
  video: HTMLVideoElement | null;
}

export class MediaError extends Error {}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'];

export const ACCEPT_ATTRIBUTE = 'image/*,video/*';

export function isSupportedType(type: string): boolean {
  return type.startsWith('image/') || type.startsWith('video/');
}

/** Decode a still into an ImageBitmap, which draws faster than an <img>. */
async function loadImage(blob: Blob): Promise<{ source: MediaSource; width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    // Safari and older engines reject some types here; fall back to an <img>.
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { source: image, width: image.naturalWidth, height: image.naturalHeight };
    } catch {
      throw new MediaError('That image could not be decoded.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Prepare a video element for frame-accurate scrubbing.
 *
 * Export seeks this element frame by frame rather than playing it in real
 * time, so metadata has to be loaded before anything else can proceed.
 */
function loadVideo(blob: Blob): Promise<{ video: HTMLVideoElement; url: string }> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      cleanup();
      if (!video.videoWidth || !video.videoHeight) {
        URL.revokeObjectURL(url);
        reject(new MediaError('That video has no visible track.'));
        return;
      }
      resolve({ video, url });
    };
    const onError = () => {
      cleanup();
      URL.revokeObjectURL(url);
      reject(
        new MediaError(
          'That video could not be decoded. Try an MP4 (H.264) or WebM file.',
        ),
      );
    };
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', onError);
  });
}

/** Turn a blob into something the renderer can draw, plus its metadata. */
export async function loadMedia(blob: Blob, name: string, id = newId()): Promise<LoadedMedia> {
  const mime = blob.type || (name.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'image/png');

  if (mime.startsWith('video/')) {
    const { video, url } = await loadVideo(blob);
    return {
      ref: {
        id,
        kind: 'video',
        name,
        mime,
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
      },
      source: video,
      blob,
      objectUrl: url,
      video,
    };
  }

  if (!mime.startsWith('image/') && !IMAGE_TYPES.includes(mime)) {
    throw new MediaError('Only images and videos can be used as a screen.');
  }

  const { source, width, height } = await loadImage(blob);
  return {
    ref: { id, kind: 'image', name, mime, width, height, duration: 0 },
    source,
    blob,
    objectUrl: null,
    video: null,
  };
}

export async function loadMediaFromFile(file: File): Promise<LoadedMedia> {
  if (!isSupportedType(file.type) && file.type !== '') {
    throw new MediaError(`${file.type || 'That file type'} is not supported.`);
  }
  return loadMedia(file, file.name);
}

export function releaseMedia(media: LoadedMedia | null): void {
  if (!media) return;
  if (media.objectUrl) URL.revokeObjectURL(media.objectUrl);
  if (media.video) {
    media.video.pause();
    media.video.removeAttribute('src');
    media.video.load();
  }
  if (typeof ImageBitmap !== 'undefined' && media.source instanceof ImageBitmap) {
    media.source.close();
  }
}

/**
 * Seek a video and wait until the frame is actually available.
 *
 * `seeked` can fire before the new frame is decoded, so where the browser
 * offers `requestVideoFrameCallback` we wait for that instead — otherwise an
 * export can capture the previous frame.
 */
export function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.001)));

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      resolve();
    };

    const onSeeked = () => {
      const withFrameCallback = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      if (typeof withFrameCallback.requestVideoFrameCallback === 'function') {
        withFrameCallback.requestVideoFrameCallback(() => finish());
        // The callback only fires for a new frame; if the seek landed on the
        // frame already displayed it never comes, so the timeout below wins.
      } else {
        finish();
      }
    };

    // Never hang an export on a stalled decoder.
    const timer = setTimeout(finish, 400);
    video.addEventListener('seeked', onSeeked);

    if (Math.abs(video.currentTime - target) < 1e-4) {
      finish();
      return;
    }
    video.currentTime = target;
  });
}
