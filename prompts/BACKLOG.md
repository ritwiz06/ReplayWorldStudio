# Backlog

Baseline copied from the project plan and revised on 2026-10-10 (ADR-030). Rows marked "Baseline status: planned" are not started; rows with a "Status" line record verified progress. If a newer live backlog exists, use it and record its path in PROJECT_STATE.md.

P0 is required for its milestone; P1 is negotiable while preserving the workflow; P2 is expansion. Dependencies are planning prerequisites, not evidence that a gate has passed.

## M0

### SET-01 - Inspect repository and environment

- Priority: P0
- Dependencies: None
- Status: **done** (2026-10-09)
- Done when: Record branch, status, remotes, OS and tool versions without overwriting files.
- Evidence: docs/environment.md records the directory contents (only `prompts/`), the absence of any Git repository (no branch, status or remotes to record; `git init` not run, ADR-012), OS, CPU, GPU, memory, browsers and tool versions. No existing file was overwritten except the live records this kit designates.

### SET-02 - Create typed web/API baseline

- Priority: P0
- Dependencies: SET-01
- Status: **done** (2026-10-09)
- Done when: Browser health flow and malformed-input rejection work from documented setup.
- Evidence: `pnpm test:e2e` 4/4 passed against the real API and Vite servers. Covered: API online and fixture loaded with units and evidence; contract-breaking response shown with its path, then recovered by Retry; unreachable API reported; negative-dimension, duplicate-ID and non-JSON files rejected with locations while the current scene is kept. `services/api/tests/test_api.py` covers 422 paths, no input echo, CORS allow/deny and loopback defaults. Manual curl: dev servers listen only on 127.0.0.1.

### SET-03 - Establish contracts, docs and CI

- Priority: P0
- Dependencies: SET-02
- Status: **done** (local 2026-10-09; CI 2026-10-10)
- Done when: Schema check, build and smoke workflow pass; exact dependency versions are locked.
- Evidence: `pnpm check` exit 0 (contracts:check, lint, typecheck, Vitest 19, pytest 48, build) in the working tree and in a clean copy installed from `uv.lock` / `pnpm-lock.yaml` with `--locked` / `--frozen-lockfile`. Direct versions are exact in every manifest. `.github/workflows/ci.yml` runs the same commands. After two setup failures (no `setup-uv@v10` major tag; broken pnpm 11.12.0), CI run 38022453114 passed on `28ebce7`: https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38022453114. Docs: README.md, docs/environment.md, docs/contracts.md, docs/learning/M0-foundation.md.

## M1

### WRL-01 - Define world and asset records

- Priority: P0
- Dependencies: SET-03
- Status: **done** (2026-10-10, commit `a3b1328`)
- Done when: Units, transforms, stable IDs and asset provenance round-trip correctly.
- Evidence:
  - Contract 0.2.0 adds per-axis `Length` evidence, embedded `CatalogAsset` records with explicit source and SPDX-style rights, `SceneObject.asset_id` with validated references, and an explicit 0.1.0 → 0.2.0 migration with a CLI (ADR-015..017).
  - Round-trip tests: exact fixture round-trip; awkward floats, `-0.0`, π/7 rotation and punctuated IDs survive bit-for-bit; asset provenance and rights round-trip; the legacy upgrade preserves every value.
  - Rejection tests: non-positive or string lengths; missing per-axis evidence; the old flat shape; uncertainty outside the value or reaching 0; non-SI units; non-finite values; unstable object and asset IDs; dangling asset references; kind mismatches; duplicate asset IDs; free-text licenses; NOASSERTION claiming redistribution; uncited vendor sources; legacy version.
  - Local: `pnpm check` exit 0 (pytest 97, Vitest 10 + 17); `pnpm test:e2e` 4 passed, including the inspector's per-axis evidence and asset rights and the legacy and dangling-reference rejections.
  - CI run https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38023211602 succeeded on `a3b1328`.

### WRL-02 - Build industrial scene and cameras

- Priority: P0
- Dependencies: WRL-01
- Status: **done** (2026-10-10, commit `9571b49`)
- Done when: Walk/top/orbit views and coherent lighting work with dimensioned catalog assets.
- Evidence:
  - Contract 0.3.0 `GltfVisual` (ADR-018, ADR-022).
  - Four original deterministic GLB models (ADR-020): conveyor, machine cell, cabinet, pallet; 3–14k triangles and 5–13 PBR materials each.
  - A 15-object industrial demo, labelled synthetic and loaded by default; three conveyors share one model, as do the two cells, two cabinets and two pallets.
  - Catalog-library resolution and verification (ADR-019).
  - Orbit, top and walk cameras (ADR-021).
  - Tests:
    - Vitest: every demo instance's drawn model fills its recorded box to 0.1 mm and rests on the floor; rotated and stretched instances; hash, invalid-glTF, bounds, 404, unsafe and offline failures; framing, plan orientation and scale bar; walking, collision and floor limits.
    - pytest: glTF field validation, symlink and unsafe paths, missing and altered files on open, an independent GLB parse matching the manifest and fixture.
    - Playwright: demo load, all three modes with the selection kept, labelled fallbacks with actionable errors and retry, unsafe or unavailable paths in opened files.
  - Local `pnpm check` exit 0 (pytest 161, Vitest 10 + 52) and `pnpm test:e2e` 8 passed, also from a fresh clone of `9571b49`. Screenshots inspected at 1440×900 and 1600×960.
  - CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38025828571 succeeded on `9571b49`, including byte-identical model rebuilds on Linux.
  - Frame-rate performance is **not** measured; that is WRL-04.

### WRL-03 - Implement object editing and undo

- Priority: P0
- Dependencies: WRL-02
- Status: **done** (2026-10-10, commit `5cc18c3`)
- Done when: Numeric and gizmo edits agree; undo and save/reload preserve the model.
- Evidence:
  - **One typed command path (ADR-023).** `set_transform`, `set_dimensions`, `add_instance`, `duplicate_object` and `remove_object` are checked against the base revision and then every value, all or nothing. The engine returns reversible snapshots, and the revision advances by one per edit, undo and redo.
  - **Contract 0.4.0 (ADR-024).** The scene edit log keeps the previous transform and the previous value and evidence of each edited axis. Pydantic checks that the log describes the scene.
  - **Upgrades.** `POST /api/v1/projects/upgrade` with an in-browser review of the notes (ADR-025).
  - **Save and reopen.** Save as a JSON download, reopen through the API file check, and an unsaved-change guard (ADR-026).
  - **UI.**
    - Inspector fields in metres and degrees; move arrows and floor disc, yaw ring, and face handles that commit one command per drag.
    - Catalog placement with a marker, duplicate, remove, and Undo/Redo controls with shortcuts and disabled states.
    - Edit records per object and per scene.
    - "Edited layout - not checked" labels.
  - **Tests:**
    - Vitest (10 + 93): command validation, conflicts, inverses for every command, grouped drags, redo invalidation, the history limit, provenance on edited axes, add/duplicate/remove and ID retirement, shared units, handle equals typed value, JSON round trip, the upgrade client, and the TS-generated sample `fixtures/edited/foundation-edited.json`.
    - pytest (196): edit-log validity and 11 rejection cases on that sample, the 0.3.0 → 0.4.0 step and the full chain, the upgrade endpoint (0.1.0/0.2.0/0.3.0, unknown version, malformed, invalid after upgrade, model hash), and the API accepting the browser-written sample.
    - Playwright (11): one test edits → undo/redo → save → reopen with byte-identical re-save; one covers unsaved-change protection; one covers upgrade review and rejected unknown, failed and inconsistent files.
  - **Local runs:** `pnpm check` exit 0; `pnpm test:e2e` 11 passed.
  - **Screenshot:** `apps/web/test-results/edited-scene.png` (reopened file with a conveyor resized to a 73 % model stretch and the warning shown), plus session screenshots of handles in orbit and top view, placement, and both dialogs.
  - CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38034359681 succeeded on `5cc18c3`. It covered contracts, byte-identical model and fixture rebuilds, lint, types, Vitest 10 + 93 (including the edited sample reproduced byte-for-byte on Linux), pytest 196 and the build. Playwright is not part of CI; it was run locally.
  - Spatial clearance and feasibility are deliberately **not** checked (M3).

### WRL-04 - Profile visual quality and performance

- Priority: P1
- Dependencies: WRL-03
- Status: **done** (2026-10-10; commit `0a929ea`, CI fixes `fec1e13`, `1f15c4e` and `d84599b`); closes M1
- Done when: Record reference hardware, scene complexity and FPS; resolve major visual defects.
- Evidence (full report: docs/performance.md; every run: docs/performance-runs.csv):
  - **Reference and method (ADR-028).** MacBook Pro M3 Pro, Chrome 154 with hardware WebGL (ANGLE Metal) verified through CDP, 120 Hz, AC power. Runs at 1440 × 900 @2 and 1920 × 1080 @1 with production builds, through the reproducible `pnpm bench` harness.
  - **Coverage.** 47 runs per build:
    - demo (15 objects), and generated edited layouts of 30, 60, 120, 260, 510 and 1,010 objects (`scripts/build_benchmark_scenes.py`, labelled synthetic);
    - load, idle, orbit, plan pan, walk, handle drag and view switches;
    - frame intervals (median, p95, p99, long frames), long-animation-frame entries, renders/s, draw calls and triangles, main-thread and GPU-process CPU, memory.
  - **Before.** Interaction held 120 Hz up to 260 objects (p95 ≤ 9.3 ms), but:
    - an idle scene redrew at 120 Hz (main thread 10 % at 15 objects, up to 74 % at 260);
    - first switches to the plan view stalled 25–50 ms;
    - unexplained 108–325 ms stalls appeared on view switches.

    Three of the four M1 target criteria were missed.
  - **Fixes:**
    - on-demand rendering;
    - stable shader configuration across views (ADR-027);
    - per-document camera memory;
    - separated resize knobs;
    - responsive top bar and overlays;
    - stretched-model badge;
    - compact object list;
    - two-line plan labels.
  - **After** (same runs):
    - idle main thread 1–3 %, GPU process 1–3 %, 0 renders/s at every size;
    - no frame over 50 ms in any interaction or view switch at ≤ 60 objects (worst switch 33 ms);
    - interaction unchanged at median 8.3 ms, p95 ≤ 9.3 ms;
    - all models ready ≤ 472 ms.

    **M1 target met.**
  - **Scale limit.** 120 Hz up to about 260–300 objects; about 500 objects at 60–90 Hz; about 1,000 objects at 40–60 Hz. The page main thread is the bottleneck, at about 17 draw calls per equipment instance.
  - **Visual review.** Before/after pairs in docs/visual-review/.
  - **Tests:**
    - `e2e/regressions.spec.ts`: 4 tests, each failing on the old code and passing on the new;
    - a stretch-badge assertion;
    - `tests/test_benchmark_scenes.py`;
    - local `pnpm check` exit 0 (Vitest 10 + 93, pytest 198) and `pnpm test:e2e` 15 passed.
  - **CI.** New `browser-smoke` job: 4 `@smoke` Playwright tests in software WebGL (ADR-029). CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38040882335 succeeded on `0a929ea`: the main job (Vitest 10 + 93, pytest 198, build) and browser smoke (4 passed in 1.1 min). The smoke job then exposed a software-WebGL timeout, a settle race, and a real idle frame every 10 s from health polls (fixed). The final commit `d84599b` passed CI three times in a row (https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38042331665, attempts 1–3).


## Reprioritisation (2026-10-10, ADR-030)

After M1 the user approved guided creation and described custom objects as the next priority, then general image-to-editable-world import. DXF import (IMP-01) stays planned and feeds the same world model. Simulation is split into explicit supported models: production events (SIM), rigid-body interactions (PHY), and later validated structural (ENG) and chemical (CHEM) cases. Issue IDs and acceptance definitions below are unchanged except where a row says "Re-scoped"; new issues have new IDs. Milestone numbers follow MILESTONES.md.

## M2 - Guided creation and described objects

### GEN-01 - Describe, generate and place a custom object; one language edit

- Priority: P0
- Dependencies: WRL-03
- Status: **done** (2026-10-10, commit `8a3f70e`; CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38070077194 passed)
- Done when:
  - A guided entry offers Explore demo, Describe an object and Open a project; the detailed editor stays available; image import is shown as upcoming, not as a working action.
  - An ordinary-language description returns a typed proposal (name, parts, approximate appearance, width/height/depth) that marks which facts the user stated and which were inferred; stated values are checked against the user's words; dimensions that matter are confirmed before placement; mass, strength, chemistry and operating behaviour stay unknown.
  - An original provisional model is generated from a bounded geometry specification (approved shapes, parts, placements, materials; no executed model output), with verified metre bounds, bottom-centre origin, catalog hash and file checks; meaningfully different descriptions give visibly different models; preview, correction, placement through the edit-command path, undo, save, reopen and missing-model handling work.
  - ASU Voyager is the server-side provider (key only in a local environment variable; model ID configurable); its output quality and schema adherence are tested live; a manual builder uses the same specification when the provider is unavailable.
  - One bounded language edit (for example "move the selected cabinet 1 metre left") shows the exact change before it is applied, resolves target, units and revision through the command validation, asks for clarification when ambiguous, and leaves the project unchanged when rejected.
  - A first-time user can describe, inspect and place an object without opening schema or provenance panels; evidence stays behind "Details". Representative tasks are timed and reported as observations only.
- Evidence (details: docs/assist.md, ADR-031..035):
  - **Guided entry.** A start panel with Explore the demo, Describe an object and Open a project (all working, e2e), Build by hand, Go to the full editor, and "Start from a photo - Coming next (IMG-01)" with no action. It reopens from **Start**.
  - **Proposals.** `POST /api/v1/assist/object-proposals` returns a typed `ObjectProposalResult` (contract 0.5.0) with:
    - name, category, appearance, parts and W/H/D, each marked stated (and found in the words) or inferred, with confirmation required;
    - stated, inferred and not-modelled facts;
    - mass, strength, chemical composition and operating behaviour always unknown.
  - **Generator.** A bounded geometry specification (40 parts, 5 shapes, 30 materials) is built by the API's deterministic pure-Python generator and stored as `generated/<sha256>.glb`. It is verified by an independent GLB reader, by the existing hash and file checks on validate, and by the browser's hash and bounds check before drawing. Placement uses `add_generated_instance` (one undo step). Save, reopen, and rebuilding a missing model from the project's own record (hash must match) are covered in e2e.
  - **Live provider.** ASU Voyager `qwen3-235b-a22b-instruct-2507`, live on 2026-10-10. Three guided runs: the final prompt `gen-01.5` gave 16/16 outcomes as expected and 16/16 first answers schema-valid (median 59.5 s per object, 8.8 s per edit). Without guidance, 0/9 edit answers were valid. Three substantially different descriptions (conveyor, tank, workbench) gave three different, valid, hash-pinned models.
  - **Key handling.** The key is server-only (`.env`; never in the bundle, the repo, logs or responses, checked by searching for its value).
  - **Language edit.** "move the selected cabinet 1 metre left" shows `x -2.000 → -3.000 m` before Apply. "the cabinet" asks which one; a selection mismatch asks; "2 km" is refused by the command engine with the project unchanged (e2e). One undo reverts it.
  - **Builder.** The object builder works with the assistant off (e2e).
  - **Timed tasks** (observations): describe and place 6–8 steps, 65–75 s (58–72 s of it the model); language move 4 steps, 7.5 s; builder 6 steps, 6.8 s.
  - **Checks:** `pnpm check` exit 0 (Vitest 10 + 107, pytest 332, build); `pnpm test:e2e` 20 passed; `pnpm test:e2e:smoke` 6 passed (with `CI=1`).
  - **CI** https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38070077194 succeeded on `8a3f70e`. The main job ran Vitest 10 + 107 and pytest 332; its pinned sha256 values for the three described models matched on Linux, so the generator is byte-identical across platforms. Browser smoke passed 6 tests in software WebGL (1.8 min).

### GEN-02 - Correct and reuse generated objects after placement

- Priority: P1
- Dependencies: GEN-01
- Baseline status: planned
- Done when: A placed generated object's specification can be reopened, corrected (size, parts, materials) and rebuilt as a new asset version; instances can be switched to the new version with one undoable command; the previous version and its record remain in the project.
- Evidence: not recorded

### GEN-03 - Evaluate described objects and language edits

- Priority: P0
- Dependencies: GEN-01
- Baseline status: planned
- Done when: A held-out set (at least 30 descriptions and 30 edit requests, including ambiguous, unsupported, missing-value and hostile-text cases) reports schema adherence, grounding of stated values, correct clarifications, unintended changes, visual distinctness review and manual correction time, for at least two candidate models; failures are categorised; the chosen default model is justified by the results.
- Evidence: not recorded

## M3 - Image to editable world

### IMG-01 - One image to a reviewed, editable world

- Priority: P0
- Dependencies: GEN-01
- Baseline status: planned (next after GEN-01)
- Done when: A user supplies one permitted image; a vision-capable model (candidate `qwen3-vl-32b-instruct`, tested on actual image inputs at the start of the issue) proposes the objects it can see with approximate floor positions and sizes; the user sets scale from one known dimension; each object is accepted, corrected or rejected and becomes a generated or catalog instance placed through the command path, with "inferred from image" evidence and occluded or unseen parts labelled; the image is stored as a source with its hash. Text-to-image or video-generation models are not used as image-to-3D services.
- Evidence: not recorded

### IMG-02 - Multi-object layout and occlusion review

- Priority: P1
- Dependencies: IMG-01
- Baseline status: planned
- Done when: Several objects from one image keep their relative layout; overlaps and occlusions are listed for review; corrections are recorded; nothing hidden is presented as seen.
- Evidence: not recorded

### IMG-03 - Evaluate image import on held-out images

- Priority: P0
- Dependencies: IMG-01
- Baseline status: planned
- Done when: Object precision and recall, scale error against measured references, and manual correction time are reported on held-out, permissioned images, split by scene type; failure cases are kept.
- Evidence: not recorded

## M4 - Drawing import

### IMP-01 - Build DXF geometry adapter

- Priority: P0
- Dependencies: WRL-01
- Baseline status: planned; reconcile with actual repository
- Done when: Parse declared entity subset; warn on unsupported data and nested-unit conflicts.
- Note (2026-10-10): unchanged in scope; it feeds the same world model and source records that described and image objects use.
- Evidence: not recorded by this package

### IMP-02 - Review scale and map equipment

- Priority: P0
- Dependencies: IMP-01,WRL-03
- Baseline status: planned; reconcile with actual repository
- Done when: Overlay aligns with known measurements; user can correct mappings and dimensions.
- Note (2026-10-10): mapped equipment can use catalog assets or GEN-01 generated objects; reuse the GEN-01 review flow where it fits.
- Evidence: not recorded by this package

### IMP-03 - Add calibrated PDF/PNG reference

- Priority: P1
- Dependencies: WRL-03
- Baseline status: planned; reconcile with actual repository
- Done when: Manual scale and object placement persist; inferred values remain labeled.
- Evidence: not recorded by this package

## M5 - Spatial checks

### GEO-01 - Check footprints and service areas

- Priority: P0
- Dependencies: IMP-02
- Baseline status: planned; reconcile with actual repository
- Done when: Labeled overlap/clearance fixtures pass with explicit tolerances.
- Evidence: not recorded by this package

### GEO-02 - Check specified routes and envelopes

- Priority: P0
- Dependencies: GEO-01
- Baseline status: planned; reconcile with actual repository
- Done when: Seeded route obstruction is highlighted; unmodeled vehicle kinematics remain explicit.
- Evidence: not recorded by this package

## M6 - Production-event simulation and comparison

Supported model: production events (discrete-event queues and resources). It does not model motion, contact or forces.

### SIM-01 - Define process graph and templates

- Priority: P0
- Dependencies: WRL-01
- Baseline status: planned; reconcile with actual repository
- Done when: Required timing, buffer and routing fields validate; missing inputs are actionable.
- Evidence: not recorded by this package

### SIM-02 - Implement event-based production

- Priority: P0
- Dependencies: SIM-01
- Baseline status: planned; reconcile with actual repository
- Done when: Known-answer counts, finite buffers, downtime and conservation checks pass.
- Evidence: not recorded by this package

### SIM-03 - Persist jobs, events and playback

- Priority: P0
- Dependencies: SIM-02
- Baseline status: planned; reconcile with actual repository
- Done when: Cancel/restart handling is clear; playback speed does not change results.
- Evidence: not recorded by this package

### SIM-04 - Compare scenario variants

- Priority: P0
- Dependencies: SIM-03,GEO-02
- Baseline status: planned; reconcile with actual repository
- Done when: Independent revisions, paired assumptions and changed metrics export correctly.
- Evidence: not recorded by this package

## M7 - Rigid-body interactions

Supported model: rigid bodies with stated mass, friction and restitution at a fixed step. It does not model deformation, stress, failure or production output.

### PHY-01 - Bounded rigid-body experiment

- Priority: P1 (re-scoped 2026-10-10: moved from Later/P2 into M7)
- Dependencies: REL-01 → re-scoped: WRL-03 and PHY-02
- Baseline status: planned; reconcile with actual repository
- Done when: Model scope, contact fixtures and integration limits are documented.
- Evidence: not recorded by this package

### PHY-02 - Rigid-body inputs with evidence

- Priority: P0
- Dependencies: WRL-01
- Baseline status: planned
- Done when: Mass, friction and restitution are entered, supplied or measured with provenance; generated or image objects never receive them by inference from appearance; an experiment refuses to run while a required input is unknown and says which.
- Evidence: not recorded

## M8 - AI assistance across the workflow

### AI-01 - Implement provider and command boundary

- Priority: P0
- Dependencies: SIM-04 → re-scoped: GEN-01
- Baseline status: re-scoped (2026-10-10). GEN-01 implements the provider boundary (ASU Voyager, server-side key, typed and validated proposals) for object proposals and one move/rotate edit. AI-01 remains for the rest of the command set (resize, add, duplicate, remove, scenario actions) and its held-out evaluation.
- Done when: Real provider emits typed proposals; invalid or unsupported actions cannot mutate state.
- Evidence: not recorded by this package

### AI-02 - Ground explanations and queries

- Priority: P0
- Dependencies: AI-01
- Baseline status: planned; reconcile with actual repository
- Done when: Every numerical statement has a scene or run reference; missing data is stated.
- Evidence: not recorded by this package

### AI-03 - Evaluate bounded alternative search

- Priority: P1
- Dependencies: AI-02
- Baseline status: planned; reconcile with actual repository
- Done when: Compare candidate layouts against explicit constraints without claiming global optimality.
- Evidence: not recorded by this package

## M9 - Evaluation and release

### QA-01 - Run held-out benchmark and user tasks

- Priority: P0
- Dependencies: AI-02
- Baseline status: planned; reconcile with actual repository
- Done when: Report all cases, failures, manual corrections and applicability limits.
- Evidence: not recorded by this package

### REL-01 - Export project and record demo

- Priority: P0
- Dependencies: QA-01
- Baseline status: planned; reconcile with actual repository
- Done when: A fresh environment reproduces the flagship workflow and can read the exported evidence.
- Evidence: not recorded by this package

## Later

### TEAM-01 - Shared project pilot

- Priority: P2
- Dependencies: REL-01
- Baseline status: planned; reconcile with actual repository
- Done when: Authentication, roles, version conflicts, backup/restore and remote data routing are verified.
- Evidence: not recorded by this package

### CAP-01 - Multi-view reconstruction investigation

- Priority: P2
- Dependencies: REL-01 → re-scoped: IMG-03
- Baseline status: planned; reconcile with actual repository
- Done when: Geometry, separability and scale are evaluated on held-out captures.
- Evidence: not recorded by this package

### ENG-01 - One validated engineering effect

- Priority: P2
- Dependencies: PHY-01
- Baseline status: planned; reconcile with actual repository
- Done when: A specific solver/model is compared with analytical and measured reference cases.
- Note (2026-10-10): this is the "validated structural" simulation case; it can also start from verified CAD without M7.
- Evidence: not recorded by this package

### CHEM-01 - One validated chemical or aging mechanism

- Priority: P2
- Dependencies: ENG-01 (a domain model and evidence, not merely its completion)
- Baseline status: planned
- Done when: One mechanism on one material under defined exposure conditions is calibrated against data, with uncertainty and sensitivity reported; no general "years later" prediction is offered.
- Evidence: not recorded
