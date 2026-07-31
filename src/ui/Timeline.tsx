import { usesKeyframes } from '../core/motion.ts';
import { effectiveDuration } from '../core/project.ts';
import { useStudio } from '../state/store.ts';

const NO_KEYFRAMES: never[] = [];

export function Timeline(): React.JSX.Element {
  const playing = useStudio((state) => state.playing);
  const playhead = useStudio((state) => state.playhead);
  // Only marked while the track is what is actually driving the motion; a
  // stale track kept behind a preset should not litter the timeline. The empty
  // case returns one shared array so the selector result stays referentially
  // stable and does not re-render on every store change.
  const keyframes = useStudio((state) =>
    usesKeyframes(state.project.motion) ? state.project.motion.keyframes : NO_KEYFRAMES,
  );
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

      {/* The scrubber and the markers share a stacking context so a marker can
          sit at the same fraction along as the playhead it refers to. */}
      <div className="timeline__scrubber">
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
        {keyframes.length > 0 && (
          <div className="timeline__markers" aria-hidden="true" data-testid="timeline-markers">
            {keyframes.map((frame, index) => (
              <span
                key={`${index}-${frame.t}`}
                className="timeline__marker"
                style={{ '--marker-fraction': frame.t } as React.CSSProperties}
              />
            ))}
          </div>
        )}
      </div>

      <span className="timeline__time" data-testid="timecode">
        {(playhead * duration).toFixed(2)}s / {duration.toFixed(2)}s
      </span>
    </div>
  );
}
