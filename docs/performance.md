# Performance and visual review (WRL-04)

Measured 2026-10-10 on the reference workstation. Every individual run is in [performance-runs.csv](performance-runs.csv), one row per run and window. Reproduce with `pnpm bench` and `pnpm review` (method below). These are rendering measurements of a synthetic scene. They say nothing about engineering accuracy, clearance or feasibility, which the software does not check (M3).

## Result

**M1 target met after the fixes.** Before them, three of the four target criteria were missed: idle cost, hitches on view switches, and two unexplained long frames during interaction. Frame rate itself was never the problem. Every interactive scenario up to 260 objects held the display's 120 Hz.

| M1 target (demo and edited layouts ≤ 60 objects, 1440 × 900 at 2× and 1920 × 1080 at 1×) | Before (`26943d0`) | After (WRL-04) |
| --- | --- | --- |
| Orbit, plan pan, walk and handle drag: frame interval median ≤ 16.7 ms, p95 ≤ 33.3 ms, no frame > 50 ms | median 8.3 ms, worst p95 9.3 ms, but **2 frames > 50 ms** (133 ms walk, 1080p plan pan; no script attribution) in 36,606 frames. **Missed.** | median 8.3 ms, worst p95 9.3 ms, **0 frames > 50 ms** in 36,667. **Met.** |
| First useful scene ≤ 1.5 s, all models ready ≤ 3 s (first visits included) | models ready ≤ 570 ms (median 338 ms). Met. | models ready ≤ 472 ms (median 324 ms); first useful scene ≤ 314 ms. Met. |
| No frame > 50 ms on view switches in a warm session | worst 108 ms (orbit return); 41.7 ms on most first plan-view switches. **Missed.** | worst 33.1 ms; 0 frames > 50 ms (first visits: worst 25.4 ms, was 325 ms). **Met.** |
| Idle scene < 5 % of a CPU core on the page main thread | median 15 %, max 24 % (the canvas redrew at 120 Hz). **Missed.** | median 1.5 %, max 3.1 %; 0 renders per second. **Met.** |

The UI requirements' provisional target, "30 FPS at 1080p for 20 equipment instances and 100 product items", is met for the equipment part: the 30-object layout has 26 equipment instances and runs at 120 Hz at 1920 × 1080. Product items do not exist until M4, so that part cannot be measured yet.

## Reference setup and method

- **Hardware and browser:** MacBook Pro, Apple M3 Pro (18 GiB, integrated 18-core GPU), macOS 26.6.2, built-in Liquid Retina XDR display at 120 Hz. Google Chrome 154.0.8037.98, WebGL 2 via `ANGLE Metal Renderer: Apple M3 Pro`, hardware acceleration verified through CDP (`webgl: enabled`, `gpu_compositing: enabled`), AC power, Low Power Mode off. Details: [environment.md](environment.md#reference-measurement-setup-wrl-04).
- **Viewports:** 1440 × 900 CSS px at DPR 2 (canvas 848 × 820 CSS px, drawing buffer 1696 × 1640) and 1920 × 1080 at DPR 1.
- **Build:** production `vite build` and `vite preview`, local API. A fresh browser per scene, so run 1 is a first visit with empty caches; runs 2 and later use new contexts (cold HTTP cache, warm GPU shader cache).
- **Scenes:**
  - `demo-15`: the 15-object industrial demo, 11 equipment instances.
  - `demo+N`: the demo plus N catalog instances on an extended floor, with the editor's edit records (`scripts/build_benchmark_scenes.py`, labelled "Synthetic benchmark layout"). N = 15 gives 30 objects (26 equipment), then 60, 120, 260, 510 and 1,010 objects. The four catalog models cycle.
- **Each run, in order:**
  1. Load, and open the benchmark file if any.
  2. *frame-all*: press H and wait 1.5 s.
  3. *idle*: 4 s with no input.
  4. *orbit*: 4 s drag at about 60 pointer events per second.
  5. *switch-top*: press 2 and wait 1.5 s.
  6. *top-pan*: 4 s drag.
  7. *switch-walk*, then *walk*: 4 s holding W, S and E.
  8. *switch-orbit*.
  9. *handle-drag*: the move-disc handle of the filling cell, dragged in a circle for 4 s, then released. Each run checks that the release committed exactly one revision.
- **Runs:** 5 each for 15 and 30 objects, 3 each for 60–260 objects and for the 1080p pass, 2 each for 510 and 1,010 objects, plus a vsync-off pass of 3 runs per scene (15–260 objects). That is 47 runs per build.
- **Measures:**
  - frame interval: the time between `requestAnimationFrame` callbacks (median, p95, p99, max, and frames over 33 or 50 ms);
  - long animation frames (Chrome's LoAF API, with script attribution);
  - renders per second, plus draw calls and triangles per rendered frame (from three.js `renderer.info` via the `__THREE_DEVTOOLS__` hook; no app code);
  - page main-thread busy time (CDP `Performance.getMetrics` TaskDuration per wall second);
  - CPU time of Chrome's GPU and renderer processes (CDP `SystemInfo.getProcessInfo`);
  - JS heap (CDP) and process RSS (`ps`);
  - load milestones: *first useful scene* is the first frame after the viewport reports a loaded scene and the canvas has drawn; *all models ready* is the first frame drawn after all four models are verified.
- **Not measured:** GPU time per frame (the WebGL timer query is unavailable in Chrome), energy, other browsers and GPUs, and full-screen 3024 × 1964. Headless Playwright results are behavioural only and never reported as frame rates.
- **Caveats:**
  - At 120 Hz a frame interval cannot show headroom below 8.33 ms; the vsync-off pass (`--disable-gpu-vsync --disable-frame-rate-limit`) shows cost per frame for interactions only.
  - The *first useful scene* mark was refined after the baseline so that it no longer waits for an extra frame. Load is therefore compared on *all models ready*, which has the same definition in both builds.
  - The after-build benchmark predates one CSS change (plan-label width).

## Before and after: 15 and 30 objects (1440 × 900 at 2×, 120 Hz)

Medians are the median over runs; *worst p95* and *max* are the worst over runs. *Main* is the page main thread and *GPU proc* is Chrome's GPU process, both as CPU per wall second (100 % = one core).

| Scene | Window | Median ms (before → after) | Worst p95 ms | Max ms | Frames > 50 ms | Renders/s | Main % | GPU proc % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 15 objects | idle | 8.3 → 8.3 | 9.3 → 9.0 | 9.4 → 9.4 | 0 → 0 | 120 → **0** | **10 → 2** | **13 → 3** |
| | orbit | 8.3 → 8.3 | 9.1 → 9.1 | 25.0 → 41.7 | 0 → 0 | 120 → 119 | 19 → 22 | 19 → 21 |
| | plan pan | 8.3 → 8.3 | 9.2 → 9.0 | 9.4 → 9.4 | 0 → 0 | 120 → 119 | 20 → 19 | 29 → 30 |
| | walk | 8.3 → 8.3 | 9.3 → 9.1 | **133.4 → 9.4** | **1 → 0** | 120 → 120 | 16 → 18 | 21 → 24 |
| | handle drag | 8.3 → 8.3 | 9.0 → 8.9 | 9.4 → 10.4 | 0 → 0 | 120 → 40 | 30 → 24 | 20 → 11 |
| | switch to plan | 8.3 → 8.3 | 9.3 → 9.1 | **41.7 → 16.8** | 0 → 0 | 120 → 1 | 20 → 3 | 25 → 3 |
| | switch to walk | 8.3 → 8.3 | 9.3 → 9.3 | **325.0 → 16.3** | **2 → 0** | 120 → 1 | 14 → 3 | 16 → 3 |
| | switch to orbit | 8.3 → 8.3 | 9.3 → 9.1 | **108.3 → 10.5** | **1 → 0** | 120 → 1 | 15 → 3 | 20 → 4 |
| 30 objects | idle | 8.3 → 8.3 | 9.2 → 9.2 | 9.4 → 9.5 | 0 → 0 | 120 → **0** | **11 → 2** | **12 → 3** |
| | orbit | 8.3 → 8.3 | 8.9 → 8.9 | 9.5 → 9.4 | 0 → 0 | 120 → 119 | 16 → 25 | 13 → 21 |
| | plan pan | 8.3 → 8.3 | 9.2 → 9.1 | 9.4 → 9.4 | 0 → 0 | 120 → 119 | 19 → 21 | 33 → 35 |
| | walk | 8.3 → 8.3 | 9.2 → 9.0 | 9.4 → 9.5 | 0 → 0 | 120 → 120 | 19 → 12 | 23 → 19 |
| | handle drag | 8.3 → 8.3 | 8.9 → 9.2 | 9.4 → 9.4 | 0 → 0 | 120 → 40 | 29 → 19 | 19 → 9 |
| | switch to plan | 8.3 → 8.3 | 9.0 → 9.2 | **41.7 → 9.4** | 0 → 0 | 120 → 1 | 10 → 2 | 10 → 3 |

Interaction CPU is unchanged within run-to-run spread: orbit used 13–29 % of the main thread per run before and 21–26 % after. The handle drag now renders only on pointer events (about 40 per second in this harness), which looks the same because the object only moves when the pointer does. One 41.7 ms frame during a 15-object orbit (after) carries no script attribution and stays under the 50 ms criterion.

**Load** (all models ready, ms from navigation; median, with range over runs in brackets):

| Scene | Before: first visit, then repeat | After: first visit, then repeat |
| --- | --- | --- |
| 15 objects | 408; 351 (338–359) | 335; 322 (315–324) |
| 30 objects | 337; 322 (319–340) | 314; 330 (299–371) |
| 1080p, 15 objects | 570; 399 (389–409) | 321; 322 (320–323) |

The only long task during load is parsing and running the 1.49 MB bundle (58–80 ms, one task). The fixture and four models arrive within about 220 ms on localhost. Opening a 30-object benchmark file (API validation plus rendering) takes 25–64 ms.

## Scale: how many objects the reference machine sustains

1440 × 900 at 2×, vsync on. Draw calls per rendered frame in the orbit overview include the shadow pass (about 17 per placed equipment instance). Triangles per frame include both passes.

| Objects (equipment) | Draw calls | Triangles | Orbit median / worst p95 (before → after) | Orbit main thread (before → after) | Idle main thread (before → after) | Frames > 50 ms, all windows |
| --- | --- | --- | --- | --- | --- | --- |
| 15 (11) | 181 | 0.14 M | 8.3 / 9.1 → 8.3 / 9.1 | 19 → 22 % | 10 → 2 % | 4 → 0 |
| 30 (26) | 455 | 0.37 M | 8.3 / 8.9 → 8.3 / 8.9 | 16 → 25 % | 11 → 2 % | 0 → 0 |
| 60 (56) | 976 | 0.83 M | 8.3 / 9.1 → 8.3 / 9.2 | 31 → 30 % | 22 → 1 % | 0 → 0 |
| 120 (116) | 2,041 | 1.76 M | 8.3 / 9.1 → 8.3 / 8.9 | 48 → 40 % | 36 → 2 % | 0 → 0 |
| 260 (256) | 4,525 | 3.93 M | 8.3 / 9.2 → 8.3 / 9.1 | 88 → 70 % | 74 → 1 % | 1 → 0 |
| 510 (506) | 8,290 | 7.24 M | 8.4 / 16.8 → 16.6 / 16.8 | 100 → 99 % | 100 → 1 % | 0 → 0 |
| 1,010 (1,006) | 13,300 | 11.7 M | 24.7 / 25.4 → 16.7 / 25.1 | 100 → 99 % | 100 → 1 % | 13 → 4 |

- **Scale limit.** The page main thread is the bottleneck: three.js scene traversal and WebGL calls cost about 1.2 µs per draw call. Orbiting stays at 120 Hz up to about 260–300 objects. At about 500 objects it runs at 60–90 Hz, and at about 1,000 objects at 40–60 Hz with occasional hitches. The plan view stays at 120 Hz at all sizes because it draws no shadow pass.
- **Headroom.** With vsync off, orbit frames cost 2.2 ms (15 objects), 3.0 ms (120) and 5.8 ms (260).
- **At 510 objects** the after build orbits at about 72 rendered frames per second against about 90 before, from two runs each, with the main thread saturated in both. With vsync off at 260 objects the after build costs +7 % per orbit frame (inside the before range of 5.3–5.9 ms) and +18 % per plan-view frame. The plan-view part is the known cost of keeping shadow sampling in that view. The rest is not attributed and was not profiled further, because it lies far outside the M1 target.
- **If larger layouts matter:** instancing identical models (InstancedMesh per asset material) or merging each instance's meshes would cut draw calls 10–20×. A cheaper shadow pass (fewer casters, or a static shadow map) would also help.

## Scene complexity, bundle and memory

| | 15 objects | 30 objects | 120 objects | 1,010 objects |
| --- | --- | --- | --- | --- |
| Instances (equipment) | 15 (11) | 30 (26) | 120 (116) | 1,010 (1,006) |
| Visible meshes / scene triangles | 90 / 69 k | 229 / 187 k | 1,033 / 882 k | 9,049 / 7.8 M |
| Unique materials / geometries / shader programs | 47 / 47 / 13 | 47 / 47 / 13 | 47 / 47 / 13 | 47 / 47 / 13 |
| Material textures (GPU textures incl. environment and shadow) | 1 (12) | 1 (12) | 1 (12) | 1 (12) |
| JS heap (after) | 17 MB | 21 MB | 28 MB | 65 MB |
| Process RSS: renderer / GPU (after) | 546 / 145 MB | 490 / 139 MB | 586 / 176 MB | 701 / 221 MB |
| DOM nodes | 796 | 979 | 2,061 | 12,698 |

- **Downloads:** web bundle 1.49 MB JS + CSS (412 kB gzip); four catalog models 671 kB in total. Instances share each model's geometry and materials, so complexity grows in meshes and draw calls, not in materials or programs.
- **Memory caveat:** RSS includes shared mappings. CDP's JS heap figure is the reliable memory measure here, and the browser exposes no GPU memory figure.

## Visual review

Default demo and an edited layout (demo + 15, one conveyor stretched to 3.6 m), plus a 120-object layout, in orbit, plan and walk at 1440 × 900 and 1280 × 800, in the same Chrome (`pnpm review`). Downscaled before/after pairs are in [visual-review/](visual-review/). The full sets regenerate under `bench-results/review-*/`.

| Issue found | Fix | Screenshots (`docs/visual-review/`) |
| --- | --- | --- |
| At 1280 px the top bar overflowed: buttons wrapped onto two lines outside the 52 px bar and the project name vanished | Nothing in the bar wraps; below 1600 px the wordmark and long labels shorten ("Save", "Demo", "Open…", "15 objects"; accessible names unchanged), and below 1300 px Undo/Redo show glyphs | `1280x800-demo-orbit-{before,after}.jpg` |
| The camera toolbar covered the "not verified engineering data" banner at narrower widths | Notices now sit below the toolbar at every width | `1280x800-demo-orbit-*`, `1280x800-edited-top-*` |
| Resize handles of a small or distant object merged into one cluster (0.8 m cabinet in the overview) | Knobs sit 20 px outside their faces on a stem | `1440x900-demo-handles-resize-small-*` |
| Opening another file of the same project kept the previous document's camera: the plan view showed a quarter of a 52 m layout | Camera memory is kept per loaded document | `1440x900-large-top-*` |
| Plan labels were cut to a few letters ("Guard…", "Belt conveyo…"), hiding the "(3)" that tells added instances apart, and drew over the scale bar and orientation dial | Labels may use two lines inside their footprint; UI overlays stack above 3D labels | `1440x900-edited-top-*` |
| A stretched model was flagged only after selecting it | "Model stretched 20 %" badge in the object list | `1440x900-edited-top-after.jpg` (list), `1440x900-edited-orbit-*` |
| Object list items wrapped to 4–5 lines (about 5 objects visible) | Badge on the name row, details on full-width lines (3 lines) | any pair |
| First switch to the plan view stalled (25–50 ms) | No visible change intended: same lights and fog in every view (ADR-027). The plan view looks the same | `1440x900-demo-top-*` |

**Reviewed and found adequate, so not changed:** equipment readability, lighting and shadows in orbit and walk (shadow resolution softens visibly on the 52 m floor of the 120-object layout); framing ("Frame all" leaves margin around the whole area, by design); selection outline and label; walkway and keep-clear markings (no z-fighting seen); the stretch warning in the inspector; the walk HUD. Below 1280 px the side panels leave a narrow viewport; 1280 × 720 is the smallest window reviewed.

## Changes made (WRL-04)

1. **On-demand rendering** (ADR-027). The canvas renders only when the camera, scene, selection or handles change. Camera animations, walking, commands and lighting changes request frames, and probes report the final state. After the benchmark, CI exposed one remaining idle frame every 10 s: each API health poll stored a new state object, re-rendering the whole app. The hook now keeps the previous state when nothing changed. That is at most one frame per 10 s, below the resolution of the 4 s idle windows, so the after numbers stand.
2. **Stable shaders across views.** The plan view hides shadows with `shadow.intensity = 0`, pauses shadow-map updates, and keeps fog attached with its range pushed out, so switching views never recompiles materials. Cost: the plan view samples a hidden shadow map, about +0.6 ms per frame at 260 objects with vsync off and invisible at 120 Hz.
3. **Per-document camera memory**, separated resize knobs, a responsive top bar and overlays, a stretched-model badge, a compact object list, and two-line plan labels.
4. **Regression tests** for the four defects that had a precise failure (`e2e/regressions.spec.ts`), each confirmed to fail on the old code and pass on the new one:
   - an idle scene is not re-rendered: an 11 s window that spans a health poll, after waiting for rendering to settle;
   - camera framing after opening another document;
   - knob separation;
   - the 1280 px layout.

   A stretched-badge assertion was added to the edit test.

## Reproduce

```bash
pnpm bench -- --scenes 0,15 --runs 5 --label main              # 15 and 30 objects
pnpm bench -- --scenes 45,105,245 --runs 3 --label scale       # 60–260 objects
pnpm bench -- --scenes 0,15,45,105,245 --runs 3 --uncapped --label uncapped
pnpm bench -- --scenes 0,15 --runs 3 --viewport 1920x1080@1 --label 1080p
pnpm bench -- --scenes 495,995 --runs 2 --label stress
pnpm review -- --stage after
```

Each benchmark opens a visible Chrome window for several minutes; leave the machine otherwise idle, on AC power. Results go to `bench-results/<label>/results.json` and `summary.md`.
