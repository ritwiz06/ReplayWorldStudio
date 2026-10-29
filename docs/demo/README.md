# REL-01 demo: the same shift before and after a layout change

Both files here use only the repository's **synthetic sample**: a made-up hall drawn as a DXF (`fixtures/drawings/layout-checks-mm.dxf`) and its example shift. Every operating value is an example assumption. No third-party drawing, photo or plan was used, and none appears in either file.

| File | What it is |
| --- | --- |
| [`run-a-day-before-after-demo.mp4`](run-a-day-before-after-demo.mp4) | A 79 s screen recording of the real app: H.264 MP4, 1440 × 900, 25 fps, about 14 MB. |
| [`sample-factory-hall-synthetic-run-0c9d70a92abb83.zip`](sample-factory-hall-synthetic-run-0c9d70a92abb83.zip) | The evidence bundle exported during the recording (36 KB). The name ends with the edited run's event fingerprint. |

## What the recording shows

The captions say "Synthetic example · results under stated assumptions" throughout, and describe each step:

| Time | Step |
| --- | --- |
| 0:00 | The app as `pnpm start` serves it, with the sample. |
| 0:05 | **Run a day**: the example shift plays on the hall as drawn. |
| 0:15 | **Show the example**, step 1: the run as drawn completes 102 batches. |
| 0:22 | Step 2: Machine B is moved into the aisle (one undoable edit), so the run is marked as made for the old layout. |
| 0:29 | Step 3: the same process and seed, run again. A route is blocked. |
| 0:37 | Step 4: the comparison names the cause. Rack A (material) ↔ Mixer narrows to 0.50 m between Rack A and Machine B, and the path needs 0.80 m. Output goes from 102 to 0. |
| 0:49 | **Export this run**: the review lists the bundle's contents. The sample's drawing is part of the repository, so it is selected. The ZIP is saved (36 KB), and the project is not changed. |
| 0:59 | Step 5: undo the move and run again. 102 batches, with the same events as the first run (fingerprint `0e2f103ae1a2eb`). |
| 1:10 | A fresh session opens the ZIP. Every file is checked against its manifest, and **Run both layouts again** reports **Reproduced**. Each row is the same: engine, fingerprints, outcomes, blocked routes, event counts, completed and unfinished, each event log event by event, and the explanation. |

## How it was made

```bash
pnpm --filter @replay-world/web exec playwright test -c playwright.demo.config.ts
swift scripts/demo/frames-to-mp4.swift apps/web/test-results/demo-frames docs/demo/run-a-day-before-after-demo.mp4 25 1500000
```

- **The app:**
  - the production build that `pnpm start` serves, on 127.0.0.1;
  - no `.env`, so no Voyager key and no AI;
  - a temporary source library.
- **The capture:**
  - the installed Google Chrome, headless, rendering WebGL on the GPU;
  - the frames are Chrome's own screencast of the page;
  - the captions are an overlay added by the script (`apps/web/e2e/demo/record-demo.spec.ts`). They never take clicks, and every number on screen is the app's own.
- **The encoding:** macOS AVFoundation (`scripts/demo/frames-to-mp4.swift`), with no ffmpeg. Each output frame shows the latest captured frame at its time, so the video plays at the speed it was recorded.
- **The check:** `scripts/demo/stills.swift` decodes stills from the MP4 at chosen seconds. They were checked at 3 s to 74 s for legibility and for captions clear of the toolbar, the playback bar and the side panels.

## Try rearranging a workshop

[`workshop-rearranging.mp4`](workshop-rearranging.mp4) is a 65 s uninterrupted recording of the real app (1440 × 900, 25 fps, about 8 MB). It has no captions, and no state is injected. A script drives the mouse through the interface the way a first-time visitor would: one real drag of the Move handle, and clicks on the buttons the card offers. Everything on screen is the app's own output on the layout as it is.

The visitor:
1. opens **Try rearranging a workshop**;
2. drags the assembly bench;
3. presses **Move it to the outlined spot**: the route to packing is blocked (0.57 m wide, and a frame needs 0.70 m);
4. presses **Run before and after**: 166 → 0 frames;
5. nudges the bench twice toward the front wall: "too close to tell", then "it fits";
6. runs before and after again: 166 → 174 frames;
7. exports the comparison and saves the project.

The workshop is synthetic. `fixtures/drawings/workshop-mm.dxf` is made by `scripts/build_dxf_fixtures.py`. It is imported with the same code as an upload and reviewed, then drawn with in-house catalog models. `fixtures/scenes/workshop.json` is built by `apps/web/src/examples/workshop.ts`. The shift's times, workers and breaks are made-up example assumptions.

Stills from the app at 1440 × 900 and 1280 × 800 are in [`workshop/`](workshop/):
- `0-first-screen`
- `1-starting-layout`
- `2-problematic-change`
- `3-corrected-result`

**Clicks and waiting** ([`workshop/recording-timing.json`](workshop/recording-timing.json)): 9 clicks and 1 drag. 8.6 s in all is spent waiting for the app (each wait is from an action until its result shows); the longest is 2.1 s, for the blocked before-and-after run. These numbers come from a scripted run on one Mac. This is not a user study.

```bash
pnpm --filter @replay-world/web exec playwright test -c playwright.demo.config.ts e2e/demo/record-demo.spec.ts -g "workshop journey"
swift scripts/demo/frames-to-mp4.swift apps/web/test-results/demo-frames-workshop docs/demo/workshop-rearranging.mp4 25 1000000
UX_SET=workshop pnpm --filter @replay-world/web exec playwright test -c playwright.demo.config.ts e2e/demo/ux-screens.spec.ts
```

## UX-04: one request progressing

[`ux04-one-request.mp4`](ux04-one-request.mp4) is a 30 s recording: H.264, 1440 × 900, 25 fps, 3.5 MB. It uses the synthetic sample, on the chat-first screen. The request's interpretation is a **recorded live answer, replayed**: the app shows "Recorded answers (test)" and "recorded answer" on each card, and the caption says so.

| Time | Step |
| --- | --- |
| 0:00 | The start screen; **Explore example** opens the sample. |
| 0:05 | Typed: "Move Machine B 1 metre right, check its routes, and run the shift again." |
| 0:09 | **Plan: 3 steps.** The proposed position is shown as a ghost, with the walks it lengthens. Nothing has changed yet. |
| 0:15 | **Apply:** the move, the route check ("Yes: its 2 routes still fit."), then the shift. |
| 0:19 | Playing at 120×: "Completed so far" follows the clock; "Whole shift 102 batches". |
| 0:26 | **Undo this request:** the layout is back as it was. The run is marked as made for another layout. |

Made with:

```bash
DEMO_ASSIST=recorded pnpm --filter @replay-world/web exec playwright test -c playwright.demo.config.ts e2e/demo/record-demo.spec.ts -g "UX-04"
swift scripts/demo/frames-to-mp4.swift apps/web/test-results/demo-frames-ux04 docs/demo/ux04-one-request.mp4 25 1000000
```

## UX-05: improve the equipment's look, then one connected request

[`ux05-appearance-and-request.mp4`](ux05-appearance-and-request.mp4) is a 38 s recording: H.264, 1440 × 900, 25 fps, 4.6 MB. It shows only synthetic files: `fixtures/drawings/hall-mm.dxf` and the example factory. Its AI answers are **recorded, replayed** answers, and the app labels them so.

1. The hall's DXF is attached, read on this computer, and its review is answered one question at a time.
2. **Improve equipment appearance:** the Electrical panel is suggested the generic "Electrical cabinet, 800 mm" model; the card says why and how it is fitted. **Use this model**, then **Apply**: one undoable step; ids, sizes, evidence and links unchanged.
3. A fresh session opens the example factory, and its two cabinets get the same model.
4. "Move Machine B 1 metre right, check its routes, and run the shift again." is shown as a plan of three steps and applied step by step. "Why did output change?" is then answered from the comparison of the two runs.

Made with:

```bash
DEMO_ASSIST=recorded pnpm --filter @replay-world/web exec playwright test -c playwright.demo.config.ts e2e/demo/record-demo.spec.ts -g "UX-05"
swift scripts/demo/frames-to-mp4.swift apps/web/test-results/demo-frames-ux05 docs/demo/ux05-appearance-and-request.mp4 25 1000000
```

## ENR-01: a better 3D model of one machine

[`enr01-better-model.mp4`](enr01-better-model.mp4) is a 28 s recording: H.264, 1440 × 900, 25 fps, 3.5 MB. It uses the example factory and the repository's own `guarded-machine-cell.glb`, with no key and no AI.

1. The world starts from its plan, and Machine B is a stand-in.
2. The model file is attached and read on this computer.
3. The review frames Machine B and shows the model fitted inside its recorded space, kept in proportion. A quarter turn and back checks the facing.
4. **Apply** improves the same object, and the shift runs on the unchanged layout.

Made with:

```bash
pnpm --filter @replay-world/web exec playwright test -c playwright.demo.config.ts e2e/demo/record-demo.spec.ts -g "ENR-01"
swift scripts/demo/frames-to-mp4.swift apps/web/test-results/demo-frames-enr01 docs/demo/enr01-better-model.mp4 25 1000000
```

## ENR-01: a photo of one machine

[`enr01-photo-look.mp4`](enr01-photo-look.mp4), 30 s, 1440 × 900, recorded answers (labelled in the app):
1. Machine B, in the world drawn from its plan, is a stand-in at its recorded size.
2. A picture is attached for it (`fixtures/photos/factory-walk.png`, a render made by this repository) and cropped to one cell. Nothing is sent before **Suggest appearance**.
3. The review shows the crop, the current look and the proposal, with what is still wrong. The proposal is a recorded live answer, and a weak one (see [../enr-01/photo.md](../enr-01/photo.md)).
4. **Apply** changes the same object's look, and the shift runs on the unchanged layout.

Made with:

```bash
DEMO_ASSIST=recorded pnpm --filter @replay-world/web exec playwright test -c playwright.demo.config.ts e2e/demo/record-demo.spec.ts -g "photo-look journey"
swift scripts/demo/frames-to-mp4.swift apps/web/test-results/demo-frames-photo docs/demo/enr01-photo-look.mp4 25 1000000
```

## Reproducing the bundle on another computer

You need:
- a checkout of this repository;
- Node.js 22.12 or newer, with pnpm;
- uv (it installs Python 3.14).

No key or account is needed.

```bash
uv sync --locked && pnpm install --frozen-lockfile && pnpm start
```

Then **Open…** the ZIP, and press **Run both layouts again** in the Run tab. Details: [../evidence-bundles.md](../evidence-bundles.md).
