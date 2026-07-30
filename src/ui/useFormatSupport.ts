import { useEffect, useState } from 'react';
import { canExport } from '../export/video.ts';
import type { ExportFormat } from '../core/types.ts';

export type FormatSupport = Record<ExportFormat, boolean | null>;

const UNKNOWN: FormatSupport = { mp4: null, webm: null };

/**
 * Which containers this browser can actually encode at the chosen size.
 *
 * Support is not universal — Chromium builds without proprietary codecs cannot
 * encode H.264 at all, and some encoders refuse 4K. Asking up front lets the UI
 * say so before the user waits through a render that was never going to work.
 */
export function useFormatSupport(width: number, height: number): FormatSupport {
  const [support, setSupport] = useState<FormatSupport>(UNKNOWN);

  useEffect(() => {
    let cancelled = false;
    setSupport(UNKNOWN);

    void (async () => {
      const [mp4, webm] = await Promise.all([
        canExport('mp4', width, height),
        canExport('webm', width, height),
      ]);
      if (!cancelled) setSupport({ mp4, webm });
    })();

    return () => {
      cancelled = true;
    };
  }, [width, height]);

  return support;
}
