import { useRef } from 'react';
import { DEVICE_IDS, getDevice } from '../core/devices.ts';
import { ASPECT_IDS, RESOLUTION_IDS, RESOLUTION_LABELS, resolveResolution } from '../core/framing.ts';
import { MOTION_IDS, MOTION_LABELS, isCyclic } from '../core/motion.ts';
import { QUALITY_IDS, QUALITY_LABELS, bitrateFor, estimateBytes, formatBytes } from '../core/export-config.ts';
import { FPS_OPTIONS, MAX_DURATION, MIN_DURATION, effectiveDuration } from '../core/project.ts';
import { ACCEPT_ATTRIBUTE } from '../media/load.ts';
import { useStudio } from '../state/store.ts';
import type {
  AspectId,
  DeviceId,
  MotionId,
  MotionMode,
  QualityId,
  ResolutionId,
  ScreenCutout,
} from '../core/types.ts';
import { ColorInput, Panel, Segmented, Select, Slider, Toggle } from './controls.tsx';
import { ExportPanel } from './ExportPanel.tsx';
import { KeyframeEditor } from './KeyframeEditor.tsx';
import { MotionPresets } from './MotionPresets.tsx';
import { useFormatSupport } from './useFormatSupport.ts';

const BACKGROUND_PRESETS = [
  { color: '#1b2735', color2: '#0b0f17', angle: 160 },
  { color: '#4f46e5', color2: '#0ea5e9', angle: 145 },
  { color: '#f97316', color2: '#db2777', angle: 135 },
  { color: '#0f766e', color2: '#052e2b', angle: 150 },
  { color: '#f5f5f4', color2: '#d6d3d1', angle: 165 },
  { color: '#111827', color2: '#374151', angle: 200 },
];

export function Inspector(): React.JSX.Element {
  const project = useStudio((state) => state.project);
  const media = useStudio((state) => state.media);
  const patchScene = useStudio((state) => state.patchScene);
  const patchMotion = useStudio((state) => state.patchMotion);
  const patchOutput = useStudio((state) => state.patchOutput);
  const setDevice = useStudio((state) => state.setDevice);
  const importFile = useStudio((state) => state.importFile);
  const clearMedia = useStudio((state) => state.clearMedia);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { scene, motion, output } = project;
  const frame = resolveResolution(output.aspect, output.resolution);
  const duration = effectiveDuration(project);
  const bitrate = bitrateFor(frame.width, frame.height, output.fps, output.quality);
  const estimate = estimateBytes(bitrate, duration);
  const formatSupport = useFormatSupport(frame.width, frame.height);

  return (
    <div className="inspector">
      <Panel
        title="Screen"
        action={
          media ? (
            <button type="button" className="button button--ghost" onClick={clearMedia}>
              Remove
            </button>
          ) : null
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="visually-hidden"
          data-testid="inspector-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = '';
          }}
        />
        {media ? (
          <div className="media-summary">
            <p className="media-summary__name" title={media.ref.name}>
              {media.ref.name}
            </p>
            <p className="media-summary__meta">
              {media.ref.width}×{media.ref.height}
              {media.ref.kind === 'video' && ` · ${media.ref.duration.toFixed(1)}s`}
            </p>
          </div>
        ) : (
          <p className="panel__empty">No screen yet.</p>
        )}
        <button type="button" className="button button--block" onClick={() => inputRef.current?.click()}>
          {media ? 'Replace file' : 'Choose a file'}
        </button>
        <Segmented
          label="Fit"
          value={scene.screenFit}
          testId="fit-control"
          options={[
            { value: 'cover', label: 'Fill' },
            { value: 'contain', label: 'Contain' },
          ]}
          onChange={(screenFit) => patchScene({ screenFit })}
        />
      </Panel>

      <Panel title="Device">
        <Select<DeviceId>
          label="Model"
          value={scene.device}
          testId="device-select"
          options={DEVICE_IDS.map((id) => ({ value: id, label: getDevice(id).label }))}
          onChange={setDevice}
        />
        <ColorInput
          label="Body colour"
          value={scene.deviceColor}
          testId="device-color"
          onChange={(deviceColor) => patchScene({ deviceColor })}
        />
        <Slider
          label="Scale"
          value={scene.scale}
          min={0.2}
          max={3}
          step={0.01}
          testId="scale-slider"
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(scale) => patchScene({ scale })}
        />
        <Slider
          label="Rotate Y"
          value={scene.rotationY}
          min={-180}
          max={180}
          step={1}
          testId="rotate-y"
          format={(v) => `${Math.round(v)}°`}
          onChange={(rotationY) => patchScene({ rotationY })}
        />
        <Slider
          label="Rotate X"
          value={scene.rotationX}
          min={-180}
          max={180}
          step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={(rotationX) => patchScene({ rotationX })}
        />
        <Slider
          label="Rotate Z"
          value={scene.rotationZ}
          min={-180}
          max={180}
          step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={(rotationZ) => patchScene({ rotationZ })}
        />
        <Slider
          label="Offset X"
          value={scene.offsetX}
          min={-1}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(offsetX) => patchScene({ offsetX })}
        />
        <Slider
          label="Offset Y"
          value={scene.offsetY}
          min={-1}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(offsetY) => patchScene({ offsetY })}
        />
      </Panel>

      <Panel title="Background">
        <Segmented
          label="Type"
          value={scene.background.kind}
          testId="background-kind"
          options={[
            { value: 'gradient', label: 'Gradient' },
            { value: 'solid', label: 'Solid' },
            { value: 'transparent', label: 'None' },
          ]}
          onChange={(kind) => patchScene({ background: { ...scene.background, kind } })}
        />
        {scene.background.kind !== 'transparent' && (
          <>
            <div className="swatches" role="group" aria-label="Background presets">
              {BACKGROUND_PRESETS.map((preset) => (
                <button
                  key={`${preset.color}${preset.color2}`}
                  type="button"
                  className="swatch"
                  aria-label={`Preset ${preset.color} to ${preset.color2}`}
                  style={{
                    background: `linear-gradient(${preset.angle}deg, ${preset.color}, ${preset.color2})`,
                  }}
                  onClick={() =>
                    patchScene({ background: { ...scene.background, ...preset } })
                  }
                />
              ))}
            </div>
            <ColorInput
              label={scene.background.kind === 'gradient' ? 'From' : 'Colour'}
              value={scene.background.color}
              testId="background-color"
              onChange={(color) => patchScene({ background: { ...scene.background, color } })}
            />
          </>
        )}
        {scene.background.kind === 'gradient' && (
          <>
            <ColorInput
              label="To"
              value={scene.background.color2}
              onChange={(color2) => patchScene({ background: { ...scene.background, color2 } })}
            />
            <Slider
              label="Angle"
              value={scene.background.angle}
              min={0}
              max={360}
              step={1}
              format={(v) => `${Math.round(v)}°`}
              onChange={(angle) => patchScene({ background: { ...scene.background, angle } })}
            />
          </>
        )}
        <Toggle
          label="Drop shadow"
          checked={scene.shadow}
          testId="shadow-toggle"
          onChange={(shadow) => patchScene({ shadow })}
        />
        {scene.shadow && (
          <>
            <Slider
              label="Shadow strength"
              value={scene.shadowStrength}
              min={0}
              max={1}
              step={0.01}
              testId="shadow-strength"
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(shadowStrength) => patchScene({ shadowStrength })}
            />
            <Slider
              label="Shadow softness"
              value={scene.shadowSoftness}
              min={0}
              max={1}
              step={0.01}
              testId="shadow-softness"
              format={(v) => (v < 0.34 ? 'Tight' : v < 0.67 ? 'Medium' : 'Diffuse')}
              onChange={(shadowSoftness) => patchScene({ shadowSoftness })}
            />
          </>
        )}
      </Panel>

      <Panel title="Light">
        <Slider
          label="Brightness"
          value={scene.lightIntensity}
          min={0}
          max={2}
          step={0.01}
          testId="light-intensity"
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(lightIntensity) => patchScene({ lightIntensity })}
        />
        <Slider
          label="Direction"
          value={scene.lightAngle}
          min={0}
          max={359}
          step={1}
          testId="light-angle"
          format={(v) => `${Math.round(v)}°`}
          onChange={(lightAngle) => patchScene({ lightAngle })}
        />
        <Slider
          label="Height"
          value={scene.lightElevation}
          min={-60}
          max={85}
          step={1}
          testId="light-elevation"
          format={(v) => `${Math.round(v)}°`}
          onChange={(lightElevation) => patchScene({ lightElevation })}
        />
        <Slider
          label="Warmth"
          value={scene.lightWarmth}
          min={-1}
          max={1}
          step={0.01}
          testId="light-warmth"
          format={(v) => (v < -0.05 ? 'Cool' : v > 0.05 ? 'Warm' : 'Neutral')}
          onChange={(lightWarmth) => patchScene({ lightWarmth })}
        />
        <Slider
          label="Fill"
          value={scene.fillIntensity}
          min={0}
          max={2}
          step={0.01}
          testId="light-fill"
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(fillIntensity) => patchScene({ fillIntensity })}
        />
        <Slider
          label="Ambient"
          value={scene.ambientIntensity}
          min={0}
          max={2}
          step={0.01}
          testId="light-ambient"
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(ambientIntensity) => patchScene({ ambientIntensity })}
        />
        <Slider
          label="Reflections"
          value={scene.reflectionIntensity}
          min={0}
          max={2}
          step={0.01}
          testId="light-reflections"
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(reflectionIntensity) => patchScene({ reflectionIntensity })}
        />
        <p className="panel__note">
          The fill follows the direction, so the whole rig turns together.
          Reflections matter most on a metallic body.
        </p>
      </Panel>

      <Panel title="Material">
        <Slider
          label="Metallic"
          value={scene.bodyMetalness}
          min={0}
          max={1}
          step={0.01}
          testId="body-metalness"
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(bodyMetalness) => patchScene({ bodyMetalness })}
        />
        <Slider
          label="Roughness"
          value={scene.bodyRoughness}
          min={0.02}
          max={1}
          step={0.01}
          testId="body-roughness"
          format={(v) => (v < 0.2 ? 'Polished' : v < 0.6 ? 'Satin' : 'Matte')}
          onChange={(bodyRoughness) => patchScene({ bodyRoughness })}
        />
        <Slider
          label="Screen glass"
          value={scene.screenGlare}
          min={0}
          max={1}
          step={0.01}
          testId="screen-glare"
          format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
          onChange={(screenGlare) => patchScene({ screenGlare })}
        />
        {getDevice(scene.device).hasNotch && (
          <Segmented<ScreenCutout>
            label="Cutout"
            value={scene.screenCutout}
            testId="screen-cutout"
            options={[
              { value: 'island', label: 'Island' },
              { value: 'notch', label: 'Notch' },
              { value: 'none', label: 'None' },
            ]}
            onChange={(screenCutout) => patchScene({ screenCutout })}
          />
        )}
      </Panel>

      <Panel title="Motion">
        <Segmented<MotionMode>
          label="Source"
          value={motion.mode}
          testId="motion-mode"
          options={[
            { value: 'preset', label: 'Preset' },
            { value: 'keyframes', label: 'Keyframes' },
          ]}
          onChange={(mode) => patchMotion({ mode })}
        />

        {motion.mode === 'preset' ? (
          <>
            <Select<MotionId>
              label="Preset"
              value={motion.preset}
              testId="motion-select"
              options={MOTION_IDS.map((id) => ({ value: id, label: MOTION_LABELS[id] }))}
              onChange={(preset) => patchMotion({ preset })}
            />
            <Slider
              label="Amount"
              value={motion.amount}
              min={0}
              max={2}
              step={0.01}
              testId="motion-amount"
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(amount) => patchMotion({ amount })}
            />
            {isCyclic(motion.preset) && (
              <Slider
                label="Cycles"
                value={motion.speed}
                min={1}
                max={6}
                step={motion.loop ? 1 : 0.25}
                format={(v) => `${motion.loop ? Math.round(v) : v.toFixed(2)}×`}
                onChange={(speed) => patchMotion({ speed })}
              />
            )}
            {!isCyclic(motion.preset) && (
              <p className="panel__note">A one-shot intro — it settles into the resting pose.</p>
            )}
          </>
        ) : (
          <KeyframeEditor />
        )}

        {/* Looping applies to both sources, so it sits outside the switch —
            except for one-shot presets, which have nothing to loop. */}
        {(motion.mode === 'keyframes' || isCyclic(motion.preset)) && (
          <Toggle
            label="Seamless loop"
            checked={motion.loop}
            testId="loop-toggle"
            onChange={(loop) => patchMotion({ loop })}
          />
        )}

        <MotionPresets />
      </Panel>

      <Panel title="Output">
        <Select<AspectId>
          label="Aspect"
          value={output.aspect}
          testId="aspect-select"
          options={ASPECT_IDS.map((id) => ({ value: id, label: id }))}
          onChange={(aspect) => patchOutput({ aspect })}
        />
        <Select<ResolutionId>
          label="Resolution"
          value={output.resolution}
          testId="resolution-select"
          options={RESOLUTION_IDS.map((id) => ({ value: id, label: RESOLUTION_LABELS[id] }))}
          onChange={(resolution) => patchOutput({ resolution })}
        />
        <Segmented
          label="Frame rate"
          value={String(output.fps)}
          options={FPS_OPTIONS.map((fps) => ({ value: String(fps), label: `${fps}` }))}
          onChange={(value) => patchOutput({ fps: Number(value) })}
        />
        <Slider
          label="Duration"
          value={output.duration}
          min={MIN_DURATION}
          max={MAX_DURATION}
          step={0.5}
          testId="duration-slider"
          format={(v) => `${v.toFixed(1)}s`}
          onChange={(value) => patchOutput({ duration: value })}
        />
        <Segmented
          label="Format"
          value={output.format}
          testId="format-control"
          options={[
            { value: 'mp4', label: formatSupport.mp4 === false ? 'MP4 ✕' : 'MP4' },
            { value: 'webm', label: formatSupport.webm === false ? 'WebM ✕' : 'WebM' },
          ]}
          onChange={(format) => patchOutput({ format })}
        />
        {formatSupport[output.format] === false && (
          <p className="panel__note panel__note--warn" data-testid="format-unsupported">
            This browser cannot encode {output.format.toUpperCase()} at {frame.width}×
            {frame.height}.{' '}
            {formatSupport[output.format === 'mp4' ? 'webm' : 'mp4'] === true && (
              <button
                type="button"
                className="link-button"
                data-testid="switch-format"
                onClick={() => patchOutput({ format: output.format === 'mp4' ? 'webm' : 'mp4' })}
              >
                Switch to {output.format === 'mp4' ? 'WebM' : 'MP4'}
              </button>
            )}
          </p>
        )}
        <Select<QualityId>
          label="Quality"
          value={output.quality}
          testId="quality-select"
          options={QUALITY_IDS.map((id) => ({ value: id, label: QUALITY_LABELS[id] }))}
          onChange={(quality) => patchOutput({ quality })}
        />
        <p className="panel__note" data-testid="output-summary">
          {frame.width}×{frame.height} · {duration.toFixed(1)}s · ~{formatBytes(estimate)}
        </p>
        {scene.background.kind === 'transparent' && (
          <p className="panel__note panel__note--warn">
            Video has no alpha channel — a transparent background exports as black. Use the PNG
            frame export to keep transparency.
          </p>
        )}
      </Panel>

      <ExportPanel />
    </div>
  );
}
