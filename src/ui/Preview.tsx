import { useEffect, useRef } from 'react';
import { ASPECT_RATIOS } from '../core/framing.ts';
import { effectiveDuration } from '../core/project.ts';
import { Stage } from '../render/stage.ts';
import { useStudio } from '../state/store.ts';
import { Dropzone } from './Dropzone.tsx';

/**
 * The live preview.
 *
 * The render loop reads the latest project straight from the store rather than
 * through props, so dragging a slider updates the canvas on the next frame
 * without a React re-render in between.
 */
export function Preview(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const lastTickRef = useRef<number>(0);

  const media = useStudio((state) => state.media);
  const aspect = useStudio((state) => state.project.output.aspect);
  const hasMedia = useStudio((state) => state.media !== null);
  const mediaLoading = useStudio((state) => state.mediaLoading);
  const isTransparent = useStudio((state) => state.project.scene.background.kind === 'transparent');

  // Create the stage once and tear it down with the component.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = new Stage(canvas);
    stageRef.current = stage;
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  // Keep the drawing buffer matched to the element's on-screen size.
  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;

    const applySize = () => {
      const stage = stageRef.current;
      if (!stage) return;
      const ratio = ASPECT_RATIOS[aspect];
      const bounds = frame.getBoundingClientRect();
      // Letterbox the output aspect inside whatever space the layout gives us.
      const width = Math.min(bounds.width, bounds.height * ratio);
      const height = width / ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      stage.setSize(width, height, Math.min(window.devicePixelRatio || 1, 2));
    };

    applySize();
    const observer = new ResizeObserver(applySize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [aspect]);

  useEffect(() => {
    stageRef.current?.setMedia(media?.source ?? null);
  }, [media]);

  // The render loop. Runs for the life of the component and pulls state on
  // demand, which keeps playback smooth while controls are being dragged.
  useEffect(() => {
    let raf = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const stage = stageRef.current;
      if (!stage) return;

      const state = useStudio.getState();
      const duration = effectiveDuration(state.project);
      const previous = lastTickRef.current || now;
      const delta = Math.min((now - previous) / 1000, 0.25);
      lastTickRef.current = now;

      let playhead = state.playhead;
      if (state.playing && !state.exportJob) {
        playhead = (state.playhead + delta / duration) % 1;
        useStudio.setState({ playhead });
      }

      const video = state.media?.video ?? null;
      if (video) {
        const wanted = playhead * duration;
        if (state.playing && !state.exportJob) {
          if (video.paused) void video.play().catch(() => undefined);
          // Nudge the element back in step if it drifts or the loop wrapped.
          if (Math.abs(video.currentTime - wanted) > 0.2) video.currentTime = wanted;
        } else {
          if (!video.paused) video.pause();
          if (Math.abs(video.currentTime - wanted) > 0.01) video.currentTime = wanted;
        }
      }

      stage.setProject(state.project);
      stage.renderFrame(playhead);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="preview">
      <div className="preview__frame" ref={frameRef}>
        <canvas
          ref={canvasRef}
          className={isTransparent ? 'preview__canvas preview__canvas--checker' : 'preview__canvas'}
          data-testid="preview-canvas"
        />
        {!hasMedia && !mediaLoading && <Dropzone />}
        {mediaLoading && (
          <div className="preview__overlay">
            <div className="spinner" aria-label="Loading media" />
          </div>
        )}
      </div>
    </div>
  );
}
