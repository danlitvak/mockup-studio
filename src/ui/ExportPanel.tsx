import { useCallback, useRef, useState } from 'react';
import {
  ExportCancelled,
  ExportUnsupported,
  downloadBlob,
  exportFrame,
  exportVideo,
} from '../export/video.ts';
import { useStudio } from '../state/store.ts';
import { Panel } from './controls.tsx';

export function ExportPanel(): React.JSX.Element {
  const exportJob = useStudio((state) => state.exportJob);
  const setExportJob = useStudio((state) => state.setExportJob);
  const notify = useStudio((state) => state.notify);
  const setPlaying = useStudio((state) => state.setPlaying);
  const abortRef = useRef<AbortController | null>(null);
  const [busyFrame, setBusyFrame] = useState(false);

  const runExport = useCallback(async () => {
    const state = useStudio.getState();
    const controller = new AbortController();
    abortRef.current = controller;

    const wasPlaying = state.playing;
    setPlaying(false);
    notify(null);
    setExportJob({ frame: 0, total: 1, phase: 'rendering' });

    try {
      const result = await exportVideo({
        project: state.project,
        media: state.media?.source ?? null,
        video: state.media?.video ?? null,
        signal: controller.signal,
        onProgress: (progress) => setExportJob(progress),
      });
      downloadBlob(result.blob, result.filename);
      notify({
        kind: 'info',
        message: `Exported ${result.filename} — ${result.width}×${result.height}, ${result.frames} frames.`,
      });
    } catch (error) {
      if (error instanceof ExportCancelled) {
        notify({ kind: 'info', message: 'Export cancelled.' });
      } else if (error instanceof ExportUnsupported) {
        notify({ kind: 'error', message: error.message });
      } else {
        notify({
          kind: 'error',
          message: error instanceof Error ? error.message : 'The export failed.',
        });
      }
    } finally {
      abortRef.current = null;
      setExportJob(null);
      setPlaying(wasPlaying);
    }
  }, [notify, setExportJob, setPlaying]);

  const runFrameExport = useCallback(async () => {
    const state = useStudio.getState();
    setBusyFrame(true);
    notify(null);
    try {
      const result = await exportFrame(
        state.project,
        state.media?.source ?? null,
        state.media?.video ?? null,
        state.playhead,
      );
      downloadBlob(result.blob, result.filename);
      notify({ kind: 'info', message: `Saved ${result.filename}.` });
    } catch (error) {
      notify({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not render that frame.',
      });
    } finally {
      setBusyFrame(false);
    }
  }, [notify]);

  const percent = exportJob ? Math.round((exportJob.frame / Math.max(1, exportJob.total)) * 100) : 0;

  return (
    <Panel title="Export">
      {exportJob ? (
        <div className="export-progress" data-testid="export-progress">
          <div className="progress">
            <div className="progress__bar" style={{ width: `${percent}%` }} />
          </div>
          <p className="panel__note">
            {exportJob.phase === 'finalizing'
              ? 'Writing the file…'
              : `Rendering frame ${exportJob.frame} of ${exportJob.total} — ${percent}%`}
          </p>
          <button
            type="button"
            className="button button--block"
            onClick={() => abortRef.current?.abort()}
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="button button--primary button--block"
            data-testid="export-video"
            onClick={() => void runExport()}
          >
            Export video
          </button>
          <button
            type="button"
            className="button button--block"
            data-testid="export-frame"
            disabled={busyFrame}
            onClick={() => void runFrameExport()}
          >
            {busyFrame ? 'Rendering…' : 'Export current frame (PNG)'}
          </button>
          <p className="panel__note">
            Rendered on this machine. Nothing is uploaded, and there is no watermark.
          </p>
        </>
      )}
    </Panel>
  );
}
