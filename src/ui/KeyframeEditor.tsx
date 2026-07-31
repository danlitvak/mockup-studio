import { EASING_IDS, EASING_LABELS, MAX_KEYFRAMES } from '../core/keyframes.ts';
import { useStudio } from '../state/store.ts';
import type { EasingId } from '../core/types.ts';
import { Select, Slider } from './controls.tsx';

/**
 * The keyframe track editor.
 *
 * The playhead is the selection: the keyframe being edited is whichever one
 * sits at the current time, and the chips move the playhead rather than holding
 * a selection of their own. That avoids the alternative, where an index has to
 * be tracked through a list that re-sorts itself whenever a keyframe is moved
 * in time — and it matches how the rest of the editor already works, where the
 * playhead decides what you are looking at.
 */

/** How close the playhead must be to count as sitting on a keyframe. */
const SELECT_EPSILON = 0.002;

const formatTime = (t: number): string => `${Math.round(t * 100)}%`;

export function KeyframeEditor(): React.JSX.Element {
  const keyframes = useStudio((state) => state.project.motion.keyframes);
  const playhead = useStudio((state) => state.playhead);
  const addKeyframe = useStudio((state) => state.addKeyframe);
  const updateKeyframe = useStudio((state) => state.updateKeyframe);
  const removeKeyframe = useStudio((state) => state.removeKeyframe);
  const setPlayhead = useStudio((state) => state.setPlayhead);
  const setPlaying = useStudio((state) => state.setPlaying);

  const selected = keyframes.findIndex((frame) => Math.abs(frame.t - playhead) <= SELECT_EPSILON);
  const current = selected >= 0 ? keyframes[selected] : null;
  const full = keyframes.length >= MAX_KEYFRAMES;

  const goTo = (t: number): void => {
    // Selecting a moment only means anything if the clip stops moving.
    setPlaying(false);
    setPlayhead(t);
  };

  const patch = (change: Parameters<typeof updateKeyframe>[1]): void => {
    if (selected < 0) return;
    updateKeyframe(selected, change);
  };

  return (
    <div className="keyframes">
      <div className="keyframes__track" data-testid="keyframe-chips">
        {keyframes.length === 0 && (
          <p className="panel__note">No poses yet — add one to start the track.</p>
        )}
        {keyframes.map((frame, index) => (
          <button
            key={`${index}-${frame.t}`}
            type="button"
            className={index === selected ? 'chip is-active' : 'chip'}
            aria-pressed={index === selected}
            data-testid="keyframe-chip"
            onClick={() => goTo(frame.t)}
          >
            {formatTime(frame.t)}
          </button>
        ))}
      </div>

      <div className="keyframes__actions">
        <button
          type="button"
          className="button button--block"
          data-testid="keyframe-add"
          disabled={full}
          onClick={() => {
            setPlaying(false);
            addKeyframe();
          }}
        >
          {current ? 'Replace pose here' : 'Add pose at playhead'}
        </button>
        {current && (
          <button
            type="button"
            className="button"
            data-testid="keyframe-delete"
            onClick={() => removeKeyframe(selected)}
          >
            Delete
          </button>
        )}
      </div>

      {full && (
        <p className="panel__note">
          That is the most poses a track can hold. Delete one to add another.
        </p>
      )}

      {current ? (
        <div className="keyframes__editor" data-testid="keyframe-editor">
          <Slider
            label="Time"
            value={current.t}
            min={0}
            max={1}
            step={0.01}
            testId="keyframe-time"
            format={formatTime}
            onChange={(t) => {
              // The playhead follows, so the keyframe stays selected as it moves.
              patch({ t });
              setPlayhead(t);
            }}
          />
          <Slider
            label="Offset X"
            value={current.x}
            min={-3}
            max={3}
            step={0.01}
            testId="keyframe-x"
            format={(v) => v.toFixed(2)}
            onChange={(x) => patch({ x })}
          />
          <Slider
            label="Offset Y"
            value={current.y}
            min={-3}
            max={3}
            step={0.01}
            testId="keyframe-y"
            format={(v) => v.toFixed(2)}
            onChange={(y) => patch({ y })}
          />
          <Slider
            label="Depth"
            value={current.z}
            min={-3}
            max={3}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(z) => patch({ z })}
          />
          <Slider
            label="Rotate X"
            value={current.rotationX}
            min={-180}
            max={180}
            step={1}
            format={(v) => `${Math.round(v)}°`}
            onChange={(rotationX) => patch({ rotationX })}
          />
          <Slider
            label="Rotate Y"
            value={current.rotationY}
            min={-180}
            max={180}
            step={1}
            testId="keyframe-rotate-y"
            format={(v) => `${Math.round(v)}°`}
            onChange={(rotationY) => patch({ rotationY })}
          />
          <Slider
            label="Rotate Z"
            value={current.rotationZ}
            min={-180}
            max={180}
            step={1}
            format={(v) => `${Math.round(v)}°`}
            onChange={(rotationZ) => patch({ rotationZ })}
          />
          <Slider
            label="Scale"
            value={current.scale}
            min={0.2}
            max={2}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(scale) => patch({ scale })}
          />
          <Select<EasingId>
            label="Ease into this pose"
            value={current.easing}
            testId="keyframe-easing"
            options={EASING_IDS.map((id) => ({ value: id, label: EASING_LABELS[id] }))}
            onChange={(easing) => patch({ easing })}
          />
        </div>
      ) : (
        keyframes.length > 0 && (
          <p className="panel__note">
            Move the playhead onto a pose to edit it, or add one where you are.
          </p>
        )
      )}
    </div>
  );
}
