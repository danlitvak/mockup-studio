import { useState } from 'react';
import { MAX_PRESET_NAME, presetKey } from '../core/presets.ts';
import { useStudio } from '../state/store.ts';
import { Field } from './controls.tsx';

/**
 * Save the current motion under a name, and pick it again later.
 *
 * Presets hold a whole motion configuration rather than a reference to one of
 * the built-in presets, so a saved entry keeps working even if the built-in it
 * started from is later changed.
 */
export function MotionPresets(): React.JSX.Element {
  const presets = useStudio((state) => state.motionPresets);
  const savePreset = useStudio((state) => state.saveMotionPreset);
  const applyPreset = useStudio((state) => state.applyMotionPreset);
  const removeMotionPreset = useStudio((state) => state.removeMotionPreset);

  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');

  const trimmed = name.trim();
  // Saving under a name that already exists replaces it, so say so rather than
  // letting the list silently change under the user.
  const replaces = presets.some((preset) => presetKey(preset.name) === presetKey(trimmed));

  const onSave = (): void => {
    if (!trimmed) return;
    void savePreset(trimmed);
    setName('');
  };

  return (
    <div className="presets">
      {presets.length > 0 && (
        <Field label="Saved motion">
          <div className="presets__row">
            <select
              className="select"
              value={selected}
              data-testid="preset-select"
              aria-label="Apply a saved motion preset"
              onChange={(event) => {
                const id = event.target.value;
                setSelected(id);
                if (id) applyPreset(id);
              }}
            >
              <option value="">Choose…</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button"
              data-testid="preset-delete"
              disabled={!selected}
              onClick={() => {
                void removeMotionPreset(selected);
                setSelected('');
              }}
            >
              Delete
            </button>
          </div>
        </Field>
      )}

      <Field label="Save current motion">
        <div className="presets__row">
          <input
            className="text-input"
            value={name}
            maxLength={MAX_PRESET_NAME}
            placeholder="Name this motion"
            data-testid="preset-name"
            aria-label="Name for the saved motion preset"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSave();
              }
            }}
          />
          <button
            type="button"
            className="button"
            data-testid="preset-save"
            disabled={!trimmed}
            onClick={onSave}
          >
            {replaces ? 'Replace' : 'Save'}
          </button>
        </div>
      </Field>
    </div>
  );
}
