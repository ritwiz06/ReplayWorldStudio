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
