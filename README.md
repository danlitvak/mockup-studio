# Mockup Studio

A local-first 3D mockup video studio. Drop in a screenshot or a screen recording, place it in a
device scene, and export a product video — entirely in the browser, on your own machine.

A personal, local-first take on [freemockup.video](https://www.freemockup.video/).

## What "local-first" means here

- **Nothing is uploaded.** Media is decoded, rendered, and encoded in the browser. There is no
  backend, no API key, and no telemetry. An end-to-end test asserts that no external request is
  made after the page loads.
- **Your projects live on your machine.** Projects and their media blobs are stored in IndexedDB,
  reopened on launch, and swept for orphans when media is replaced or removed.
- **It works offline.** A service worker precaches the build, so after the first visit the app runs
  with no network at all.
- **No account, no watermark, no export limit.**

## Features

| Area | What you get |
| --- | --- |
| Import | PNG, JPEG, WebP, AVIF, GIF, MP4, WebM — drag anywhere or pick a file |
| Devices | Phone, tablet, laptop, browser window, bare screen — all generated procedurally, no model assets |
| Fit | `Fill` crops to the screen, `Contain` letterboxes — defaults per device shape |
| Scene | Body colour, scale, three rotation axes, X/Y offset, drop shadow, light intensity |
| Background | Gradient (any angle), solid, or transparent, plus six presets |
| Motion | `still`, `float`, `spin`, `orbit`, `pan` (seamless loops) and `tilt-in`, `push-in`, `flip-in` (one-shot intros) |
| Output | 16:9, 9:16, 1:1, 4:5, 21:9 at 720p/1080p/1440p/4K, 24/30/60 fps, up to 60s |
| Export | MP4 (H.264) or WebM (VP9), plus single-frame PNG |
| Editor | Live preview, timeline scrubbing, spacebar playback, light/dark theme, project library |

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

```bash
npm run build        # production build into dist/
npm run preview      # serve the build
```

To run it as a real local app, `npm run build` and serve `dist/` from any static server — or install
it as a PWA from the browser's address bar and it will launch in its own window, offline.

## Tests

```bash
npm run typecheck    # tsc, strict
npm run test         # unit tests (Vitest)
npm run test:e2e     # end-to-end in real Chromium (Playwright)
npm run check        # all of the above, in order
```

**226 unit tests** cover the pure core — motion, framing, fit, gradients, project migration, export
planning. **28 end-to-end tests** drive a real browser: they read pixels back off the WebGL canvas to
prove the scene actually changed, and they encode real video files and decode them again to check
dimensions and duration.

Three properties worth calling out, because they are the ones that are easy to get subtly wrong:

- **Seamless loops.** Cyclic presets satisfy `f(0) == f(1)` modulo a full turn, and frame `i` of `N`
  maps to `t = i/N` — never `i/(N-1)` — so the last frame stops short of repeating the first.
- **Intros land at rest.** One-shot presets satisfy `f(1) == restingPose` exactly. The e2e suite
  checks this through the real renderer: a `tilt-in` at `t = 1` is pixel-identical to a `still` render.
- **Saves cannot clobber each other.** Writes are serialised through a single chain, and each write
  reads the project at the moment it runs rather than capturing a snapshot when it was queued.
  Without both, two in-flight writes for the same project — an import flushing while a rename is
  still debounced — can land out of order and silently undo the newer edit. IndexedDB gives no
  cross-transaction ordering guarantee, so this has to be handled in the store.

## Architecture

```
src/
  core/       Pure, DOM-free logic — the entire test surface lives here
    types.ts        Project schema
    project.ts      Defaults, tolerant migration, clamping
    motion.ts       evaluateMotion(motion, scene, t) -> Transform
    framing.ts      Aspect/resolution maths, camera fit, frame timing
    devices.ts      Device geometry specs
    fit.ts          cover/contain rect maths
    easing.ts       Easing curves
    gradient.ts     CSS-style gradient endpoints
    export-config.ts Bitrate planning, filenames
  render/     Three.js — consumes core, owns no state
  export/     Deterministic frame loop + mediabunny encoding
  storage/    IndexedDB
  state/      Zustand store, debounced write-behind
  ui/         React components
```

The key design decision: **the scene is a pure function of `(project, t)`**. Preview and export both
call `stage.renderFrame(t)`, so the exported video is what you saw. Export does not capture the
preview in real time — it renders each frame deterministically and seeks the source video to the
matching timestamp, so a busy machine cannot drop or duplicate frames.

Because the interesting logic is DOM-free, most of it is testable in plain Node. Three.js only ever
consumes values that were already computed and checked.

## Notes and limits

- **H.264 support varies.** Some Chromium builds ship without a proprietary encoder. The app probes
  `VideoEncoder.isConfigSupported` for the chosen container *and* frame size, marks unavailable
  formats in the UI, and offers a one-click switch instead of failing after a long render. VP9/WebM
  is available essentially everywhere.
- **Transparent backgrounds.** Video has no alpha channel here, so a transparent background exports
  as black. Use the PNG frame export to keep transparency. The UI says so in place.
- **Export is slower than realtime**, deliberately — see above. A 5s 1080p clip takes a few seconds;
  4K takes longer.
- **Resolution tiers use the short edge**, so "4K" is 3840×2160 landscape and 2160×3840 portrait.
  Ultra-wide at 4K is scaled to stay inside encoder limits.

## Licence

Private, for personal use.
