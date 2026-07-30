import { effectiveDuration } from '../core/project.ts';
import { useStudio } from '../state/store.ts';

export function Timeline(): React.JSX.Element {
  const playing = useStudio((state) => state.playing);
  const playhead = useStudio((state) => state.playhead);
  const setPlaying = useStudio((state) => state.setPlaying);
  const setPlayhead = useStudio((state) => state.setPlayhead);
  const duration = useStudio((state) => effectiveDuration(state.project));
  const disabled = useStudio((state) => state.exportJob !== null);

  return (
    <div className="timeline">
      <button
        type="button"
        className="button button--icon"
        aria-label={playing ? 'Pause' : 'Play'}
        data-testid="play-toggle"
        disabled={disabled}
        onClick={() => setPlaying(!playing)}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
            <rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
          </svg>
        )}
      </button>

      <input
        type="range"
        className="timeline__scrub"
        min={0}
        max={1}
        step={0.001}
        value={playhead}
        disabled={disabled}
        aria-label="Playhead"
        data-testid="scrubber"
        onChange={(event) => {
          setPlaying(false);
          setPlayhead(Number(event.target.value));
        }}
      />

      <span className="timeline__time" data-testid="timecode">
        {(playhead * duration).toFixed(2)}s / {duration.toFixed(2)}s
      </span>
    </div>
  );
}
