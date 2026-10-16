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
- Status: **done** (2026-10-15; `cedfee3`; CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38797542923 green). GEN-03 remains open, so M2 is not complete.
- Done when: A placed generated object's specification can be reopened, corrected (size, parts, materials) and rebuilt as a new asset version; instances can be switched to the new version with one undoable command; the previous version and its record remain in the project.
- Note (2026-10-14): still open after IMG-01. Objects created from a photo are generated assets (method `photo`); IMG-01 reviews them before creation, and afterwards only the generic editing (move, rotate, resize) applies, so GEN-02 should cover them too.
- Evidence (details: docs/assist.md, docs/contracts.md, ADR-039..041):
  - **Journey.** Select an object whose asset is generated (described, builder or photo) → Inspector **Improve model…** → the dialog reopens the exact recorded specification. It shows the current version (rebuilt from its specification; same sha256 as the stored file) and the proposed one side by side. The user asks for a change in words or changes it by hand without AI (colour per material group, overall width/height/depth, the full part list). A plain-words change list follows; a proposed size change must be confirmed. **Only this object** or **All N objects that use <asset>** lists exactly which objects change and how each axis is handled. **Apply** builds the revision as a new asset (a failed build changes nothing) and runs one revision-checked `revise_asset` command. Undo/redo, save and reopen ("accepted by API"; both model files present and hash-checked) work. A missing generated file is rebuilt only when the rebuild gives the recorded hash (the GEN-01 restore path).
  - **Versions.** Every accepted revision is a new, immutable catalog asset (`asset-gen-<slug>-<sha8>`, its own specification, its own `generated/<sha256>.glb`, name "<base> (vN)"); no file is overwritten and the previous asset stays in the catalog unchanged. `generation.revision` records `revises`, `version` (the original is 1, not recorded), the instruction (null when changed by hand), the language model that proposed the change (null when by hand), the changes in plain words and what cannot be represented. The original generation fields (method, description, original drafting or vision model, stated/inferred facts) are kept unchanged, so the original description or photo observation stays distinct from later corrections. Project validation requires `revises` to be a generated asset in the catalog with version + 1 (ADR-039).
  - **Instances.** One `asset_revised` record switches one or all instances in one step; either every chosen object changes or none (an object no longer using the old asset, or a stale revision, is a conflict and nothing changes). An axis that equalled the old nominal (value and evidence) follows the new nominal; an object's own (edited or measured) axis is kept and the model is stretched to it, unless the user ticks "use <new size> instead". Undo restores the exact asset references, dimensions and catalog (unit-tested) (ADR-040).
  - **Evidence.** Per overall dimension: kept (value and evidence copied exactly, so a colour or part change never turns an image-inferred size into a measured one), entered (`user_supplied`, confirmed, citing the previous value) or proposed (`inferred`, confirmed, citing the model and instruction). The API refuses "kept" for a changed axis, "proposed" for an unchanged one, unconfirmed proposals and an identical model.
  - **Proposals.** `POST /api/v1/assist/model-revisions` (Voyager `qwen3-235b-a22b-instruct-2507`, prompt `gen-02.2`, schema-guided; 503 when off) sends the instruction and the model's part list only. Deterministic checks: size kept unless the instruction mentions a size or length; an "open" request whose proposal still has one part filling ≥ 50 % of the envelope is refused (nothing changed); an identical proposal is refused; curved/slanted/rotated surfaces, holes/perforations, textures/printing and moving/hinged parts are listed as not represented when asked for; a box part covering the whole end of a larger box part trims the larger one (overlap separation); other face-sharing overlaps are reported (ADR-041). The dialog says "The shape generator cannot show: … These are not imitated in the model."
  - **Contract 0.7.0.** `AssetRevision`, `AssetGeneration.revision`, `AssetRevised`/`RevisedInstance`, `FloorRectangle.size_basis`, `GeneratedAssetRevisionRequest`, `ModelRevisionProposalRequest`/`Result`; migration 0.6.0 → 0.7.0. New route `POST /api/v1/catalog/generated-assets/revisions`.
  - **Live provider** (2026-10-15; docs/assist-evaluation/gen-02.1.json, gen-02.2.json). Final prompt `gen-02.2`: cabinet → open bookshelf 75.9 s, 2 → 9 parts, largest part share 0.947 → 0.047, shelves 0.02 m (top and bottom boards still 0.1 m); blue cabinet with a red top 36.9 s (the top still overlapped the body; now trimmed by overlap separation); photo pallet ("make this a wooden pallet with cardboard boxes stacked on top of it instead of one solid block") 29.4 s, 1 → 3 parts, largest share 1.0 → 0.117; photo machine guard: a long instruction timed out at 150 s, a shorter one took 106.2 s, 4 → 12 parts (four yellow posts and four clear panels; the grey body kept full height). Every successful answer was schema-valid on the first attempt.
  - **Live browser demonstration** (2026-10-15, dev servers, the user's key; the factory photo analysis replayed from its recording, the revisions live): pallet proposal 42.3 s (a wooden pallet with 4 cardboard boxes), machine proposal 110.4 s (then the body recoloured white by hand, shown as "then adjusted by you"); both applied (scene revision 2), saved, reopened "accepted by API", models 7/7 verified. The pallet became clearly more recognisable; the machine improved only modestly (posts and clear panels around a full-height white body, not the photo's white lower cabinet with a yellow guard above it). Screenshots: docs/gen-02/*.jpg.
  - **Recorded, not live.** `fixtures/assist/recorded/revision-*.json` replay the live answers in pytest and e2e and are labelled not live AI. Cases: `scripts/model_revision_cases.json`; script `scripts/evaluate_model_revisions.py`.
  - **IMG-01 audit (scale size basis).** The classroom example's 1.52 m table width was an assumption, but the scale step tagged any entered size "measured by you" and recorded "Measured by the user: …". The scale step now asks "How do you know these sizes?" (measured or known exactly / an assumption) and Create stays disabled until it is answered. An assumed side is recorded as "Assumed by the user: a typical <side> for the <feature>, not measured", `user_supplied` but unreviewed, with `size_basis: assumed`; 0.6.0 projects become `not_stated` (Update to ADR-037).
  - **Tests:** `packages/contracts/tests/test_asset_revisions.py` (11), `services/api/tests/test_revisions.py` (29), recorded revision replays in `test_assist_recorded.py`; Vitest `revisionDraft.test.ts` and `commands.test.ts` (selected only, all instances, measured size kept or adopted, stale-revision and wrong-asset conflicts, undo/redo exactness, change lists, evidence bases); Playwright `e2e/improve.spec.ts` (2 tests, one `@smoke`): a described object by hand with two instances (one with a measured width), an invalid specification (build error shown, Apply disabled), a failed build (nothing changed), the all-instances update keeping the measured width, undo/redo, save with both versions and evidence, reopen, missing new GLB refused then rebuilt with the recorded hash; and a photo-made object with a recorded proposal (cancel, propose, apply to its only instance, photo link and photo-inferred evidence kept).
  - **Checks (local, 2026-10-15):** `pnpm check` exit 0 (contracts, assets and fixtures up to date; ESLint, Ruff, tsc, mypy clean; Vitest 10 + 145; pytest 598; build); `pnpm test:e2e` 24 passed. The smoke set is now 8 tests.
  - **Known limits:** no openings within a single part (open structures only from separate panels); no slanted or curved surfaces beyond cylinders, frustums and spheres; no rotated parts; no hinges, doors or moving parts; no textures, labels or wire mesh (clear panels stand in for guards; mesh is reported, not imitated); no photo textures; panel proportions depend on the model (0.1 m top and bottom boards); fitting can rescale parts slightly, which the change list reports as "resized or moved"; proposals take about 30–110 s.
  - **CI:** https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38797542923 on `cedfee3`: success for both jobs (pytest 598; browser smoke 8 passed).

### GEN-03 - Evaluate described objects and language edits

- Priority: P0
- Dependencies: GEN-01
- Status: **done** (2026-10-15; results commit `142dcb8`; CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38812815362 green). The chosen default fails two revision gates, so M2 is **not** complete; GEN-04 is the corrective task.
- Done when: A held-out set (at least 30 descriptions and 30 edit requests, including ambiguous, unsupported, missing-value and hostile-text cases) reports schema adherence, grounding of stated values, correct clarifications, unintended changes, visual distinctness review and manual correction time, for at least two candidate models; failures are categorised; the chosen default model is justified by the results.
- Note (2026-10-15, after GEN-02): still open, so M2 is not complete. The held-out set should also include model-revision instructions (the `gen-02.x` cases in `scripts/model_revision_cases.json` are development cases, not held out): open structures, colour and part changes, size changes, unrepresentable requests and photo-made objects, reporting outcome, size kept or changed as asked, largest-part share for "open" requests, overlaps, not-represented listing, latency and a visual review.
- Evidence (full report: docs/assist-evaluation/gen-03/report.md; Update to ADR-032, ADR-042):
  - **Frozen before any run.** The held-out set (32 descriptions, 31 edits on a new packing-room scene, 22 revisions of 16 models, 9 made from photos) and the pre-registered gates (docs/assist-evaluation/gen-03/criteria.md) were committed and pushed in `435095a`; neither was changed after the run. The tooling was committed in `0aa5a21` (CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38805487436 green) while the run was in progress.
  - **Live run.** One run on 2026-10-15, 20:31:53–21:38:23 UTC (66.5 min): 170 requests, baseline `qwen3-235b-a22b-instruct-2507` and candidate `qwen3-30b-a3b-instruct-2507`, through the API endpoints in-process (same prompts `gen-01.5`/`gen-02.2`, schemas, one retry, 150 s timeout), sequential, models alternating per case. Not restarted or duplicated. Live results only; no recorded answers were used.
  - **Blind visual review.** Renders labelled Option 1/2 at random; the key was opened after scoring. The reviewer was the assistant running the evaluation, not an independent person or a participant.
  - **Baseline against the gates:**
    - safety (prompt or key leaks, hostile requests followed, extreme edits applied, unintended scene changes): all 0 ✓;
    - stated sizes retained 30/30 ✓; silently changed 0 ✓; invented physical facts 0 ✓;
    - descriptions: outcome 31/32 ✓; visual review mean 1.32 with 3/25 zeros ✓;
    - edits: outcome 30/31 ✓; exact proposals 14/14 ✓;
    - revisions: outcome **17/22 (77 %) ✗** (gate 85 %); requested change present 10/11 ✓; size kept or changed as asked 15/15 ✓; open requests with largest part < 50 % 2/2 ✓; **unrepresentable listed in `not_represented` 1/3 ✗** (gate 80 %; 3/3 counting the refusal messages, which is not the gate's wording); visual review mean 1.67 ✓;
    - waiting medians 43.4 / 6.4 / 49.0 s for descriptions / edits / revisions ✓ (p95 83.3 / 16.4 / 128.2 s); 1 timeout (r04, 150 s) of 85 requests ✓.
  - **Candidate rejected** by the pre-registered rule (replace the baseline only if every gate passes and no quality measure is more than 10 points worse; speed never decides). It failed four gates: description outcomes 27/32 (84 %), visual review mean 1.00 with 5/23 zeros, exact edits 14/15 (93 %), unrepresentable listing 0/3; and it rated "clearly recognisable" on 22 points fewer descriptions. It was 3–5 times faster (medians 9.7 / 1.8 / 12.3 s vs 43.4 / 6.4 / 49.0 s). **The default stays `qwen3-235b-a22b-instruct-2507`.**
  - **Failures categorised** (report.md, with case IDs): unrecognisable or crude geometry (neither model drew pallet-truck forks); parts hidden inside another part (diagnostic, not a gate: 8/25 baseline, 11/23 candidate proposals); floating or protruding parts; refusals instead of doing the representable part of a mixed revision (r16–r18); wrong outcomes (baseline d27, e13; candidate refused the four vague descriptions and guessed e14); timeouts and cut-off answers; unrelated parts changed.
  - **Correction effort** (the reviewer's count of fixes before use, not a timed study): baseline 17 fixes for 25 objects and 3 for 15 revisions; candidate 24 for 23 and 10 for 17.
  - **GEN-02 baselines re-examined:** revision wait median 49 s, p95 128 s and one 150 s timeout for the default (candidate median 12 s); the machine-guard failure did not recur with fresh wording (r06 baseline scored 2).
  - **Tooling:** `scripts/evaluate_gen03.py` (runner; resume keeps recorded errors unless `--retry-errors`; atomic writes), `scripts/score_gen03.py`, `scripts/unblind_gen03_review.py`, `apps/web/src/assist/editScoring.ts` (+ test), `apps/web/scripts/assist/{score-gen03-edits.ts,render-gen03.ts,run-ts.mjs}`; `tests/test_gen03_evaluation.py` (7). Two tooling faults found on first use after the run and fixed before scoring and review: the edit scorer needed a Vite-based launcher (`run-ts.mjs`) to load app modules, and the render script drew both options concurrently on one canvas (both sheets showed the same picture; now sequential). Blinding was not affected.
  - **Results:** docs/assist-evaluation/gen-03/{results/*.json, edit-scores.json, scores.json, review.json, report.md, renders/*.jpg}.
  - **Checks (local):** `pnpm check` exit 0 (Vitest 10 + 150, pytest 605; re-run after the last tooling edits). CI for the results commit: `142dcb8` (CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38812815362 green).
  - **Not shown:** physical properties of provisional geometry; waiting times are scripted, one request at a time; correction effort is not a user study (no participants).

### GEN-04 - Honest partial revisions

- Priority: P0
- Dependencies: GEN-02, GEN-03
- Status: **closed with its last criterion not met** (2026-10-15; the first three criteria are met; the frozen set fails 2 of 8 gates, carried to GEN-05; feature `61a653b`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38821169936 green; frozen set `1f8d31b`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38822490229 green; results `9251ea3`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38844690308 green). Failing gates: timeouts 2/20 and visual mean 1.15. M2 is **not** complete.
- Done when:
  - When an instruction mixes representable and unrepresentable requests, the revision does the representable part and lists the rest in `not_represented`; "unsupported" is kept for instructions with nothing representable in them.
  - When the answer is "unsupported" because of unrepresentable features, those features are copied into `not_represented`.
  - Revision answers have a bounded part budget so they finish well inside the 150 s timeout.
  - Developed on the four GEN-02 development cases plus new development cases, never on the GEN-03 held-out set. Then a fresh, frozen set of at least 15 revision instructions (5 mixed-representability, 5 open structures, 5 colour or part changes) is run once on the default model and passes the same GEN-03 revision gates.
- Note (2026-10-15): from the GEN-03 report. The default failed revision outcomes (17/22, 77 %) and unrepresentable listing in the field (1/3); r16–r18 were refused as "unsupported" instead of doing the representable part, and r04 timed out at 150 s. Hidden parts in object proposals (8/25, a diagnostic) are the next visual fix after this issue, not a gate.
- Evidence (full report: docs/assist-evaluation/gen-04/report.md; ADR-043):
  - **Behaviour.**
    - Three outcomes: a partial proposal that draws the drawable part, `unsupported` with nothing drawable, and `already_satisfied` with no new version.
    - `not_represented` is filled for partial and unsupported outcomes. It is grounded in the user's words: model entries that share no word with the instruction are dropped, and the instruction's own clauses for movement, properties, curves, holes and printing are added.
    - The dialog lists what is not shown before **Apply the drawable part to this object**. The app's own check notes are listed apart.
    - A colour is never offered for a material property.
    - Refusals and no-ops change neither scene nor catalog. Sizes, evidence, photo links, immutable versions, one-step undo and the all-or-nothing `revise_asset` checks are unchanged.
  - **Bounded answers.**
    - Prompt `gen-04.3` asks for changes only (remove, change, add, repeat). Unmentioned parts are kept exactly.
    - More than 40 parts is an explicit limitation; nothing is cut silently.
    - The openness guard gives one feedback retry.
    - The API response changed (`already_satisfied`, `partial`); the project schema stays 0.7.0.
  - **Development** (GEN-02 cases plus new development cases; never GEN-03 held-out answers): docs/assist-evaluation/gen-04.1–3.json.
    - On the four GEN-02 cases (single runs): answers 10,317 → 7,083 characters (−31 %); waits 248.4 → 179.0 s (−28 %); throughput unchanged at about 32–35 characters per second.
    - The twelve-cubby development case still takes 143 s and draws fewer bins than asked.
  - **Frozen set** (committed in `1f8d31b` before the run): 20 new cases (5 mixed, 3 unsupported, 5 open, 5 colour or part, 2 already satisfied; 10 on photo-made objects).
  - **Run:** one sequential live pass on the default model only, with no repeats and no diagnostic retries.
  - **Gates:**
    - outcomes 18/20 ✓;
    - change present 12/13 ✓;
    - size 13/13 ✓;
    - open 3/3 ✓;
    - unrepresentable listed 8/8 ✓;
    - waiting median 39.4 s ✓ (p95 150.2 s);
    - **timeouts 2/20 ✗** (o04: the openness retry after a solid 31 s first answer; o05: no first answer within 150 s). Both ran while the computer running the script was asleep (about 42 and 45 min of real time). A separate diagnostic retry answered in 85.6 s and 55.8 s; the frozen result is unchanged;
    - **visual mean 1.15 ✗** (13 proposals; grey cushions sunk into a grey seat, a red button hidden inside its box, a floating grey stack light, crate sides without gaps).
  - **Diagnostics:** leaks 0; first attempt valid 18/20; unrelated parts kept exactly 4/7 (fitting rescales); wrong but grounded listings in o03 ("open-top") and c01 ("red cushion").
  - **Tests:**
    - `services/api/tests/test_revisions.py` (39): mixed, wholly unsupported, already satisfied, unrelated parts kept, unknown ids, the part limit, repeat, the openness retry, and colour not offered as a property;
    - recorded replays in `test_assist_recorded.py`;
    - `tests/test_gen04_evaluation.py` (8);
    - `e2e/improve.spec.ts` (3 tests): the partial review, Apply, save and undo, and refusals and no-ops that change nothing.
  - **Checks (local, 2026-10-15):** `pnpm check` exit 0; pytest 628; `pnpm test:e2e` 25 passed.
  - **Screenshots:** docs/gen-04/improve-partial.jpg (recorded development answer) and improve-unsupported.jpg (fixed test answer).

### GEN-05 - Visible and time-bounded revisions

- Priority: P0
- Dependencies: GEN-04
- Status: **closed with its last criterion not met** (2026-10-16). Every other criterion is met, but the frozen visual review mean is 1.10, against the 1.2 gate. That failure is carried to GEN-06, and M2 is **not** complete. Commits: feature `586eb71` (CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38850522476 green); pilot, check fixes and frozen set `7e7c473` (CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38851270841 green); results `30d6138` (CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38853334042 green).
- Done when:
  - Added parts are checked for being hidden, buried, floating, too small or out of view, and for colour. One shared retry, within one 150 s budget for the whole request; what remains is shown before Apply.
  - Cancellation stops further provider work, and a late answer cannot change the project.
  - Evaluation runs keep the host awake and record wall-clock and request-timer time; a pause is reported as a run fault.
  - A fresh frozen set (never the GEN-03 or GEN-04 sets) passes the same revision gates, including ≤ 5 % timeouts and a visual mean ≥ 1.2.
- Evidence (full report: docs/assist-evaluation/gen-05/report.md; ADR-044):
  - **Checks** (`assist/visibility.py`), exact for every approved shape:
    - hidden (≥ 95 % inside other opaque parts);
    - buried (≥ 40 % in a part of the same material);
    - floating (no touch chain to the floor or a kept part; hanging or mounted parts exempt);
    - too small (a requested part, no size given, under 4 % of the object's largest side and under 12 px);
    - unseen (under 15 % in a 200 × 150 z-buffer of the generator's meshes from the dialog's camera; requested parts only; same-label copies together; structure judged against the rear-left view too);
    - solid slats.
  - **Colours:**
    - named colours are honoured, and a texture that cannot be shown is listed;
    - an unnamed addition that blends into a kept part gets an approved contrasting finish;
    - glass stays transparent.
  - **Retry and budget.** One shared retry, within one budget (each call's timeout is what is left; a retry only if the remaining time covers the first attempt). After the budget, the first answer is shown with its problems; never an unchecked model.
  - **Before Apply.** `problems` in the response; "Not clearly shown" and "Apply despite these problems" in the dialog; the problems are kept on the version's change list. Cancelling a request (a client disconnect) stops further calls.
  - **Development** (bounded live runs; GEN-04 failures used as regressions, never as the new set), docs/assist-evaluation/gen-05.1.json:
    - fixed by the retry: the stop button and the cable tray;
    - recoloured: the cushions;
    - still reported: the stack light (an 11 cm gap) and the crate's top slats.

    Three regression answers are recorded for offline replay.
  - **Pilot** (three new development examples through the whole path, docs/assist-evaluation/gen-05-pilot/). It found and fixed two gaps:
    - tiny additions were not reported;
    - a tangent touch on a round lid was missed (and parts of the starting model are now treated as supported).
  - **Frozen set** (`7e7c473`, before any live call): 22 cases (6 visible additions, 5 open, 3 transparent, 3 explicit colours, 4 partial, 1 already satisfied; 10 on photo-made objects).
  - **Run:** one sequential pass, 18.1 min, host kept awake, no run faults, no repeats.
  - **Gates:**
    - outcomes 21/22 ✓;
    - change 19/20 ✓;
    - size 20/20 ✓;
    - open 2/2 ✓;
    - listed 5/5 ✓;
    - median 39.6 s ✓ (p95 105.7 s, max 108.6 s);
    - timeouts 0/22 ✓;
    - **visual mean 1.10 ✗**: two 7, one 8, zero 5. The zeros were the clear side panels and the glass back panel (invisible, with no warning), "armrests dark blue" (missed), and a bracket behind and a valve under (both warned).
  - **Diagnostics:** retries 7/22, none cut by the budget; 6 of the 7 still ended with a problem listed; o04 failed with HTTP 502 (unusable answer twice).
  - **Tests:**
    - `services/api/tests/test_visibility.py` (19): every shape; hidden, buried, floating, framed and suspended parts; tiny, unseen and slats; requested vs unspecified colour; one shared retry; exhausted budget; retry timeout; cancellation; recorded replays;
    - `tests/test_gen05_evaluation.py` (4);
    - `e2e/improve.spec.ts` (4): problems shown before Apply and kept on the version; a late answer after Cancel changes nothing.

### GEN-06 - Recognisable additions in the preview

- Priority: P0
- Dependencies: GEN-05
- Status: **done** (2026-10-16; `03448ed`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38862406247 green). Its own acceptance evidence exists, below. The fresh frozen evaluation is GEN-08's.
- Done when:
  - Glass and clear plastic are recognisable in the preview: a visible edge, or a minimum opacity. This is a versioned generator change, and existing models stay rebuildable. The visibility check counts perceptual contrast, not raw pixels.
  - A requested small item with no size given is scaled deterministically up to a minimum visible size, and the change list says so.
  - A colour phrase after "and" takes the clause's verb.
  - A second preview angle is offered when an addition is placed behind or under something.
  - The touch tolerance scales with part size.
  - A fresh frozen set (never the GEN-03, GEN-04 or GEN-05 sets) passes the same revision gates, including a visual mean ≥ 1.2.
- Note (2026-10-16): from the GEN-05 report. Every automatic gate passes; the visual mean is 1.10 (t02 and t03 invisible transparent panels, e03 colour missed, p03 and p04 out of view, several small items).
- Evidence (ADR-045):
  - **Transparent parts.** Glass and clear plastic get mid-tone edges and stop writing depth, in the dialog preview and the placed scene (`apps/web/src/scene/modelLoader.ts`, after verification; GLB bytes unchanged). Coincident faces resolve deterministically.
    - The checks judge the composited picture (edges against what is behind, and the surface shift), never raw pixels.
    - Inspected in the browser from three views and in the placed scene: docs/gen-07/inspect (glass top, glass back panel, clear side panels; equivalents of GEN-05 t01–t03).
  - **Small parts.** A requested part with no size given is enlarged about its contact face to 5 % of the object's largest side (at most 12 cm and 3×), only inside the recorded size, and listed as an estimate.
    - A stated size is never changed, and assembly pieces are left as drawn.
    - Examples: the GEN-05 pilot status light 2 → 6 cm; the GEN-05 v03 lamp 6 → 10 cm; the v01 button 9 → 11 cm.
  - **Touch tolerance** depends on the parts: the GEN-05 o05 slats (1.65 cm from their posts) are no longer called floating, while the detached stack light (11 cm) still is.
  - **Colour clauses** carry the verb across "and" (in either order); "red and white" gives one part two colours and lists the second; GEN-05 e03 now draws the blue armrests and lists only the fabric texture.
  - **Versioning.** Rebuilds dispatch on the recorded generator version, and unknown versions are refused.
    - All 33 models built in the GEN-04 and GEN-05 runs rebuild byte-identically.
    - A project saved by the pre-GEN-06 code (fixtures/legacy/generated-0.7.0-pre-gen06.json, made from a `0849030` worktree) validates, rebuilds its missing file to its recorded hash and reopens, in pytest and in the browser.
    - A new asset of the same specification has the same hash.
  - **Tests:** `services/api/tests/test_recognisable.py` (reproducibility, composited glass, explicit and inferred sizes, assemblies, touch tolerance, colour clauses); `test_visibility.py`; Vitest `src/scene/views.test.ts`.
  - **Development probes** (bounded, live; docs/assist-evaluation/gen-05.1.json): stop button and stack light fixed by the retry; the tray under the top opens on the low view and is honestly warned about; glass top clear; cushions recoloured for contrast.
  - **Remaining visual failures:** on a light background glass still reads faintly (the dialog is dark); enlarged items stay modest by design (at most 12 cm); a part placed where the user asked but hidden from every view is warned about, not fixed.

### GEN-07 - Beginner-friendly revision review

- Priority: P0
- Dependencies: GEN-06
- Status: **done** (2026-10-16; `03448ed`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38862406247 green).
- Done when:
  - **Views.** The Improve dialog keeps a clear before/after comparison and the "Not clearly shown" honesty. A second camera angle (behind, below) is one click away when requested parts are hidden from the main view. The first view is chosen deterministically to show the requested change, and there is an obvious way back to the standard view.
  - **Highlights.** A part a warning refers to is highlighted in the preview only, never in the generated GLB or the project's data.
  - **Plain explanations.** The dialog says what was drawn, what was enlarged as an estimate, what cannot be depicted and what remains hard to see. Measured or entered sizes stay distinct from visual choices.
  - **Informed Apply.** "Apply despite these problems" shows the unresolved issue beside the action. Refusal, cancellation and already-satisfied outcomes create no version and no scene edit.
  - **Browser tests** cover an older saved model, a photo-made model and a described model: improve, inspect two angles, apply, undo, save, reopen, and rebuild a missing file.
  - **Inspection.** Screenshots at the desktop reference sizes and at 1280 px are inspected (keyboard access, modal layering, labels, clear and glass rendering, warning placement), and the issues found are fixed.
- Acceptance evidence: browser tests; inspected screenshots in docs/gen-07/; scripted task steps (not a user study).
- Evidence:
  - **Views.** Standard, from behind and low, one click each, shared by both previews.
    - The first view is chosen deterministically by the API to show the requested additions (for example the bracket behind the screen opens from behind, and the valve under the tank opens on the low view).
    - "Back to the standard view" is one click.
  - **Highlights.** Parts a warning names are outlined in orange in the preview only, with "Show it" per warning. The browser test checks that nothing of the preview (edges, outlines) reaches the saved version.
  - **Plain explanations:** "Enlarged as an estimate (… visual choices, not measurements)", "Colours chosen by the app", "Partial: … Not shown, and not imitated", "Not clearly shown". The overall-size evidence is unchanged.
  - **Informed Apply.** The unresolved problems are repeated beside "Apply despite these problems". Problems and visual choices are kept on the version's change list. Refusals, cancellation and already-satisfied answers still create no version (`e2e/improve.spec.ts`).
  - **Browser tests:** `e2e/review.spec.ts` (3 journeys: the pre-GEN-06 saved model, a photo-made model, a described model). Each asks with the keyboard, inspects two angles, applies, undoes, redoes, saves, reopens and rebuilds a missing file to its recorded hash.
  - **Inspection:** screenshots at 1440 × 900 (the desktop reference) and 1280 × 800 in docs/gen-07/inspect. Issues found and fixed:
    - the placed-scene shot needed "frame selection";
    - a recoloured armrest flickered on faces it shares with the seat (now resolved deterministically);
    - the warning text now names the view that shows the part.
  - **Scripted steps** (not a user study; no participants): to see an addition placed behind or under the object takes 0 extra actions (the dialog opens on that view), another angle 1 click, and back 1 click. Before GEN-07 it needed orbit dragging with no guidance.

### GEN-08 - Revision evaluation and the M2 decision

- Priority: P0
- Dependencies: GEN-06, GEN-07
- Status: **done** (2026-10-16; frozen set `51d052d`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38864115875 green; results `802e924`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38871322207 green). **M2 closes**: every pre-registered gate passes, narrowly on the visual review.
- Done when:
  - **Pilot.** The whole live → score → render → blind-review path is first run on a few new development cases, and tooling faults are fixed before anything is frozen.
  - **Frozen set.** A new set of at least 24 revisions, with its scoring rules, is committed before any live call. It covers transparent parts, small named additions, explicit colour phrases, occluded placements, open structures, partial requests, photo-made objects and stated dimensions.
  - **Rules fixed in advance.** How a provider error and an honestly warned problem affect each metric. The visual review uses what the user sees on opening the updated dialog; a separate score from the fixed GEN-05 camera is reported for context and labelled as a different method.
  - **One run.** The set is run once, sequentially, on the default model, with the host awake and wall time, request time, retries, provider calls and run faults recorded.
  - **Blind review and report.** Scored and reviewed blind before the key is opened. Reported against the established revision gates, safety and provenance checks.
  - **The M2 decision**, documented: M2 closes only if every applicable gate passes.
- Acceptance evidence: docs/assist-evaluation/gen-08/ (criteria committed before the run, results, review, scores, report).
- Evidence (docs/assist-evaluation/gen-08/report.md):
  - **Pilot.** Three new development cases ran through the whole path before the freeze, and two renderer faults were fixed (a moiré grid; downscaled sheets).
  - **Frozen set** (`51d052d`, before any live call): 26 cases on targets no development case touched (4 transparent, 4 small additions, 4 colour phrases, 4 occluded, 3 open, 3 partial, 3 stated sizes, 1 already satisfied; 13 photo-made). The rules for provider errors (wrong outcome; 0 in the visual mean) and for warned problems (no change to the visual score) were fixed in advance.
  - **Run:** one sequential pass, 15.0 min, 26 requests, 32 provider calls, 6 shared retries, none cut by the budget, host kept awake, no run faults.
  - **Gates:**
    - outcomes 26/26;
    - change 25/25;
    - size (envelope and stated part sizes) 25/25;
    - open 3/3;
    - listed 5/5;
    - median 29.5 s (p95 83.0 s);
    - timeouts 0/26;
    - safety and provenance clean;
    - **visual mean, dialog method, 1.24 ≥ 1.2** (2: 10, 1: 11, 0: 4).
  - **Context, a different method:** the fixed GEN-05 camera, 1.08.
  - **Honesty:** 6 of the 15 weak sheets carried a warning. Misleading and unwarned: t2 (a glass door over the still-solid body) and p3 (kept panel and light left floating).
  - **Beginner corrections without a parts specification:** colour per group, overall sizes, rephrasing or starting over, the three views, scope. Moving or removing one part still needs the parts list.

### GEN-09 - Misleading-but-unwarned revisions

- Priority: P1
- Dependencies: GEN-08
- Baseline status: planned (added 2026-10-16 after GEN-08; quality work after M2) → in progress (engineering done; independent review pending)
- Done when:
  - A transparent part in front of a solid part of the same object is warned about.
  - Kept parts left floating by a revision, and unrelated parts changed by fitting or overlap separation, are warned about.
  - Edges on light surfaces are made readable, so the check's edge threshold matches what people notice.
  - Simple one-part actions (remove, move, resize) are available without the parts list.
  - The visual review is repeated by an independent reviewer, or as a small user study, on a fresh set.
- Note (2026-10-16): from the GEN-08 report. t2 (glass door over a solid body) and p3 (floating kept panel) looked done but were not, and carried no warning; 9 of 15 weak sheets were unwarned.
- Status (2026-10-16): **engineering done** (`c8f2273`; test fix `1309a75`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38944976643 green; the first run, 38944397980, failed on one mypy error in the new scorer test, which the fix resolves); **open on the last criterion: independent review pending.** No reviewer has been contacted; a blinded packet is ready. The criterion closes only when a real independent review is scored and recorded.
- Evidence (docs/assist.md "Misleading results warned, and one part at a time"; ADR-046):
  - **Glass over a solid body** (`backed_glass`): a transparent part added or made, at least 15 % of the object's face, in front of a kept solid part of the same material and size that covers ≥ 70 % of it within 3 cm, when the request asks to see through. Warned, never deleted. Exempt: glass asked for as a cover or protection, glass over a screen, a body rebuilt as panels.
  - **Kept parts left floating** (`floating_kept`): kept parts that were held up before and reach no floor-standing part after; parts held through other parts and parts the request says hang are exempt. Grouped into one sentence.
  - **Unrelated changes** (`unrelated_change`): kept parts compared by id; the proposal's own unmentioned changes said per change in plain words; fitting changes collected into one sentence; a shared re-centring said once (adjustment `recentred`); a requested resize explained once (adjustment `scaled`); under 2 cm not reported.
  - **Edges:** dark `#0e2f47` outline under a light `#8fd0ff` core (3.5 / 1.6 px, screen space); edges at 12° so rounded glass gets edges. Display only; GLB bytes and recorded hashes unchanged (the legacy pre-GEN-06 fixture still rebuilds to its hash). The API's outline check uses the same colours.
  - **One part at a time:** click or choose a part, set its centre or size in metres, or remove it. Exact change lines, a live preview, a confirmation beside Apply when the overall size changes (recorded as entered only when confirmed), one immutable version and one undoable command. The full parts list stays under Details.
  - **Regressions:** the GEN-08 t2 and p3 answers replayed offline through the whole path (`tests/test_misleading.py`, 15 tests; `e2e/gen09-regressions.spec.ts`, 12 browser tests at 1440 × 900 and 1280 × 800). They are warned, fixed by hand and applied. The controls stay quiet: glass as a cover; a beacon mounted on a post.
  - **Part actions:** browser tests on a described conveyor and a photo-made pallet (`e2e/review.spec.ts`): pick → resize → move or remove → confirm → apply → undo → redo → save → reopen → rebuild a missing model.
  - **Screenshots:** docs/gen-09/inspect/ (the dialog, Show it, the fixed dialog, and the placed glass on the light floor; part-action confirmation).
  - **Independent review packet:** docs/assist-evaluation/gen-09-review-packet/. It holds the 25 GEN-08 dialog sheets reshuffled with old numbers cropped, instructions, a rubric and an answers template. The key is kept apart; `scripts/score_gen09_review.py` scores a returned file. **Pending.**
  - Note (2026-10-16, IMG-03): the reshuffled GEN-08 packet can introduce the rubric to a reviewer, but it is not fresh material. A claimed fresh independent review needs new sheets (for example GEN-09 dialog renders made for the purpose) and a real reviewer. Nobody has been contacted and no review exists; the criterion stays open.
  - **Checks:** `pnpm check` exit 0 (pytest 721 + tooling tests; Vitest 158; contracts 10).

## M3 - Image to editable world

### IMG-01 - One image to a reviewed, editable world

- Priority: P0
- Dependencies: GEN-01
- Status: **done** (2026-10-14; `e756edf`; CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38638851329 green). Supported case bounded by the feasibility check (below). GEN-02 and GEN-03 remain open, so M2 is not complete.
- Done when: A user supplies one permitted image; a vision-capable model (candidate `qwen3-vl-32b-instruct`, tested on actual image inputs at the start of the issue) proposes the objects it can see with approximate floor positions and sizes; the user sets scale from one known dimension; each object is accepted, corrected or rejected and becomes a generated or catalog instance placed through the command path, with "inferred from image" evidence and occluded or unseen parts labelled; the image is stored as a source with its hash. Text-to-image or video-generation models are not used as image-to-3D services.
- Evidence (details: docs/image-import.md, ADR-036..038):
  - **Feasibility and supported case.** `qwen3-vl-32b-instruct` on ASU Voyager accepts images and returns schema-valid JSON with `json_schema` guidance (not without it). It finds and names objects well (box IoU 0.81–0.94 on the render's visible machines, conveyors and pallet) but its floor points (0.4–1.0 m error), floor rectangles, view type and sizes are unreliable, so geometry is computed in code or entered by the user (ADR-036). Supported: one indoor photo with a visible floor and a floor rectangle whose four corners are visible and whose width the user knows; JPEG, PNG or WebP, at most 15 MB and 50 megapixels.
  - **Guided path.** **Start from a photo** in the start panel (previously "Coming next") opens: choose → ready (where the photo would be sent, **Analyse with ASU Voyager** or **Mark objects myself**) → analysing (elapsed time, **Cancel**) → failed (**Try again**) → review tabs **Objects**, **Scale**, **Layout** → **Create the 3D world**. The open project is untouched until Create, which goes through the unsaved-changes guard.
  - **Proposals.** `POST /api/v1/assist/image-proposals` returns an `ImageProposalResult` (contract 0.6.0). Each object can be accepted, rejected (small items on furniture are suggested for rejection), re-boxed, given a new floor point, relabelled or re-sized; missed objects can be drawn by hand. Every size and the facing are tagged *from the photo, approximate*, *hidden: a guess* or *entered by you*.
  - **Scale.** Four corners and a measured width (optionally depth); the reconstructed camera, lens basis (`from_rectangle`, `from_sides` or `assumed`) and every warning are shown, and each footprint is drawn back onto the photo (ADR-037).
  - **World.** Each accepted object becomes a provisional generated model (GEN-01 generator, method `photo`) placed through the command path, with a floor slab and the scale reference. Photo-derived axes are `inferred`/unreviewed citing the photo and observation; typed values are `user_supplied`/confirmed. The source photo sits beside the 3D view with outlines linked to the objects, and **View from the photo's camera** matches the photo's viewpoint. Orbit, top, walk, editing, undo, save and reopen work as for any project.
  - **Source photo.** Stored unchanged by sha256 in the local source library (`POST /api/v1/sources/photos`, 409 on a hash mismatch) and recorded as a `photo` source with its calibration and every observation. A missing photo is refused on open with **Attach the original photo…** or **Open without the photo**; nothing is substituted (ADR-038).
  - **Live provider** (2026-10-14, final prompt `img-01.2`): 5 photos, 7–22 objects each, 29.5–81.2 s (161.5 s for the sign, whose first answer failed validation and the retry was valid); the injected sign was recorded as text and not obeyed. Live browser journeys: classroom (analysis 100.0 s, 23 objects, assumed 1.52 m table width, one desk moved, saved, reopened "accepted by API", 23/23 models verified) and factory render (32.6 s, 7 objects, 6 m × 1.8 m walkway, lens 70° solved from the two sides, camera at the render's position, one machine moved, saved, reopened). Factory placements against ground truth: centres within 0.25 m, visible widths within 12 %, heights within 11 %; hidden depths about half the true value for the machine cells.
  - **Recorded, not live.** `fixtures/assist/recorded/image-*.json` replay the `img-01.2` answers in pytest and e2e; the UI labels them "Offline test provider … Not live AI", and their latencies are not measurements.
  - **Tests:** `services/api/tests/test_images.py` (42), `test_photo_api.py` (25), `test_photos.py` (140), recorded image replays in `test_assist_recorded.py`; Vitest `src/photo/{floor,world,colour}.test.ts`; Playwright `e2e/photo.spec.ts` (2 tests, one `@smoke`).
  - **Checks (local, 2026-10-14):** `pnpm check` exit 0 (contracts up to date; ESLint, Ruff, tsc, mypy clean; Vitest 10 + 138; pytest 551; build); `pnpm test:e2e` 22 passed. The smoke set is now 7 tests.
  - **Screenshots:** docs/img-01/*.jpg (classroom and factory render: proposal, scale, layout, world, photo-camera view, walk, reopened).
  - **Known failures** (docs/image-import.md): generic shape families, no textures; approximate colours (dark shadowed chairs stay grey or black); hidden depths are guesses; no walls, windows or room boundary; group outlines ("table with chairs") need tightening; the render's two control cabinets were missed; far objects near the horizon are uncertain; a fully visible floor rectangle is required; labels and counts vary between live runs; 25–100 s analysis.
  - **CI:** https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38638851329 on `e756edf`: success for both jobs (pytest 551; browser smoke 7 passed, including the photo journey).

### IMG-02 - Multi-object layout and occlusion review

- Priority: P1
- Dependencies: IMG-01
- Baseline status: planned → done (2026-10-16)
- Done when: Several objects from one image keep their relative layout; overlaps and occlusions are listed for review; corrections are recorded; nothing hidden is presented as seen.
- Note (2026-10-14, after IMG-01): IMG-01 already places several objects from one photo with their relative layout, marks hidden sides as guesses and records every observation (accepted or rejected). Left out of IMG-01 and open here or in IMG-03: outdoor scenes, close-ups, photos without a usable floor rectangle, several photos of one place, walls and room boundaries, textured or photo-matched geometry, and automatic scale without a user measurement. IMG-01's known failures this issue should address: no walls or room boundary; hidden depths guessed (about half the true depth for deep machine cells); group outlines ("table with chairs"); generic shapes and approximate colours; missed objects behind others.
- Note (2026-10-15, after GEN-02): a photo-made object can now be improved after creation with **Improve model…** (in words or by hand), as a new version that keeps the photo link and the photo-inferred evidence of unchanged sizes. This helps with generic shapes (the live pallet became a pallet with stacked cartons) but not with geometry the generator cannot depict (no openings within a part, slanted or curved surfaces, mesh or textures); the machine guard improved only modestly. The scale step now records whether the rectangle's size was measured or assumed (`size_basis`).
- Status: **done** (2026-10-16; `b1d8b48`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38951067041 green, both jobs), as a vertical slice on IMG-01's known failures: a table grouped with its chairs, objects partly hidden, uncertain hidden depth. The supported input is unchanged: one indoor photo with a visible floor and a user-calibrated rectangle. Walls and room boundaries, and several photos of one place, are not part of it and remain open for a later issue. Held-out accuracy is IMG-03.
- Evidence (docs/image-import.md "Reviewing several objects (IMG-02)"; ADR-047; screenshots docs/img-02/):
  - **Contract 0.8.0.** `PhotoObservation` gains `visibility` (`visible`, `partly_visible`, `added`, `not_recorded`), `decision` `split`/`merged`, `derived_from`, `replaced_by` and `corrections`, with cross-record checks. Up to 80 observations. Migration 0.7.0 → 0.8.0 claims nothing (`not_recorded`). Rebuilding missing generated models upgrades an older file first. An upgrade refused only for missing models or a missing photo now offers the same recovery as a current file: a regression caught by the legacy pre-GEN-06 journey and fixed.
  - **Objects:** split (pieces named from "X with Ys", shape families from the label), merge (the kept outline unchanged), undo for both, add a missed object, visibility per object. Every result is linked to its observation; corrections are recorded in words; split, merged and rejected observations are all kept.
  - **Occlusion:** per-axis sources from the photo, partly hidden (an estimate, may be larger), hidden (a guess), not seen (an estimate) or entered. An added object is never recorded as observed, and only the user can add one.
  - **Layout:** photo overlaps (one in front of another, not a 3D problem; mark the one behind partly visible) and 3D footprint intersections listed apart and explained, with seats under tables listed as probably fine. Position, footprint and facing are editable and everything is rechecked at once. A typed position drives the size estimate; the photo's own position stays on record.
  - **Demonstrated** (recorded answers, offline; `e2e/photo-review.spec.ts`, 3 tests, one `@smoke`):
    - classroom: split, merge, two added objects, clashes from guessed depths fixed in the layout; 24 objects created; identical observations, corrections and evidence after edit, undo and redo, save, reopen and re-attaching a missing photo;
    - factory render: the missed cabinet behind the centre machine added and placed by typed position. From its drawn base it landed 5.1 m short, the hidden-depth failure stated. A conveyor/machine clash fixed. Identical after reopening;
    - manual only: no model call.
  - **Tests:** contracts (migration and cross-record rules), `tests/test_recognisable.py` (older project rebuilt through the API); Vitest `src/photo/{corrections,layoutChecks}.test.ts`.
  - **Checks:** `pnpm check` exit 0 (pytest 735; Vitest 167; contracts 10); `pnpm test:e2e` 46 passed, 15 skipped; the smoke set 10 passed.

### IMG-03 - Evaluate image import on held-out images

- Priority: P0
- Dependencies: IMG-01
- Baseline status: planned → in progress (2026-10-16; infrastructure and synthetic stratum done; real stratum missing)
- Done when: Object precision and recall, scale error against measured references, and manual correction time are reported on held-out, permissioned images, split by scene type; failure cases are kept.
- Note (2026-10-14, after IMG-01): IMG-01 measured placement only against one render with known ground truth and five development photos (docs/assist-evaluation/img-01.*.json). No real photo of a measured site exists yet, so scale error against a measured reference is still unmeasured; held-out photos and a second vision model are needed.
- Status (2026-10-16): **open: the real, measured stratum is missing.**
  - The evaluation path is built, and a synthetic held-out stratum has been run once.
  - **Missing input:** at least 6 permissioned photos of real indoor sites, from at least 3 scene types, with 40 or more counted objects. Each needs a measured floor rectangle and check length, and measured object positions and sizes (docs/assist-evaluation/img-03/protocol.md).
  - Synthetic results never close IMG-03 (criteria.md).
- Evidence (docs/assist-evaluation/img-03/; ADR-048):
  - **Infrastructure** (`7807e9c`):
    - annotation format `rws-img03-annotation/1` and validator: real versus synthetic; method and tolerance per measurement; typical or photo-derived values refused; unpublishable photos kept local, outside the repository;
    - synthetic scenes built and rendered with exact ground truth;
    - live runner;
    - scorer with known-answer tests: units, similar cabinets, a group outline, a partly hidden object, a near-horizon floor point;
    - review sheets;
    - a browser cross-check that the scored world is the dialog's world;
    - the analysis's notes on a corrected object marked as pre-edit findings.
  - **Freeze** (`f44536c`, before any held-out call; CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38979438108 green):
    - 8 held-out renders in 4 scene types: 68 counted objects, 31 partly visible, 10 near the horizon;
    - criteria (matching, three worlds, metres, strata, effort, thresholds), capture protocol, inventory;
    - development probes: `glm-4-5v` failed; `llama4-scout-17b` passed.
  - **Scorer and runner fixes** found on the first scores, before reporting (`99400d7`): a review index shift, manual-baseline scope, a runner crash.
  - **Browser inspection and records** (`2adcb11`, `ae9d2b8`; CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38981574341 green, both jobs). `tests/test_img03_runner.py` covers the runner with a stub provider; it fails on the runner as it was during the run.
  - **Results** (`7777b75`, synthetic only), `qwen3-vl-32b-instruct`:
    - **detection:** precision 0.978 (45/46); recall 0.662 (45/68: 10 lost to a 150 s timeout, 11 inside another outline, 2 poor outlines);
    - **reviewed world, not near the horizon:** centre error median 0.17 m, p90 0.65 m; visible width 6 %; near-horizon median 0.69 m, flagged 10/10;
    - **effort:** about 9 corrections per photo against 21.5 by hand (keystroke-level estimate 36 s against 110 s; not measured);
    - **recall would fail** the pre-registered threshold even on exact geometry.
  - **Paired model:** `llama4-scout-17b` found 3/34. The default stays.
  - **Worst failures:**
    - hidden base, 4.31 m (initial proposal);
    - objects set facing the camera, median 18.7° (post hoc);
    - split pieces keeping a group's size guess, +314 to +386 % depth.
  - **The 5.1 m cabinet** is reported as a development example in the hidden-base category.
  - **Smallest fix named, not made:** take the chosen shape family's proportions for hand-drawn objects and split pieces.
  - **Browser inspection** (docs/assist-evaluation/img-03/browser/; held-out answers replayed only to view them):
    - the hidden-base cabinets look right from the photo's camera, and nothing warns about them;
    - one outline around two twin racks, or two twin pallets, gets no split suggestion.

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
