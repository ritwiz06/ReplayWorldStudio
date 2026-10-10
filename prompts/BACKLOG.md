# Backlog

Baseline copied from the project plan. Rows marked "Baseline status: planned" are not started; rows with a "Status" line record verified progress. If a newer live backlog exists, use it and record its path in PROJECT_STATE.md.

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
- Status: **done** (2026-10-10, local; commit and CI recorded below once pushed)
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
  - **CI.** New `browser-smoke` job: 4 `@smoke` Playwright tests in software WebGL (ADR-029).

## M2

### IMP-01 - Build DXF geometry adapter

- Priority: P0
- Dependencies: WRL-01
- Baseline status: planned; reconcile with actual repository
- Done when: Parse declared entity subset; warn on unsupported data and nested-unit conflicts.
- Evidence: not recorded by this package

### IMP-02 - Review scale and map equipment

- Priority: P0
- Dependencies: IMP-01,WRL-03
- Baseline status: planned; reconcile with actual repository
- Done when: Overlay aligns with known measurements; user can correct mappings and dimensions.
- Evidence: not recorded by this package

### IMP-03 - Add calibrated PDF/PNG reference

- Priority: P1
- Dependencies: WRL-03
- Baseline status: planned; reconcile with actual repository
- Done when: Manual scale and object placement persist; inferred values remain labeled.
- Evidence: not recorded by this package

## M3

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

## M4

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

## M5

### AI-01 - Implement provider and command boundary

- Priority: P0
- Dependencies: SIM-04
- Baseline status: planned; reconcile with actual repository
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

## M6

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

### PHY-01 - Bounded rigid-body experiment

- Priority: P2
- Dependencies: REL-01
- Baseline status: planned; reconcile with actual repository
- Done when: Model scope, contact fixtures and integration limits are documented.
- Evidence: not recorded by this package

### CAP-01 - Multi-view reconstruction investigation

- Priority: P2
- Dependencies: REL-01
- Baseline status: planned; reconcile with actual repository
- Done when: Geometry, separability and scale are evaluated on held-out captures.
- Evidence: not recorded by this package

### ENG-01 - One validated engineering effect

- Priority: P2
- Dependencies: PHY-01
- Baseline status: planned; reconcile with actual repository
- Done when: A specific solver/model is compared with analytical and measured reference cases.
- Evidence: not recorded by this package
