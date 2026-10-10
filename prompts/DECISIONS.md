# Architecture decisions - proposed baseline

These are planning decisions to validate during implementation, not historical implementation claims.

| ID | Proposal | Rationale | Revisit when |
| --- | --- | --- | --- |
| ADR-001 | Factory planning first; reusable world contracts | A concrete workflow with broader reuse | Domain-specific assumptions leak into core records |
| ADR-002 | Browser editor + local Python API | Accessible UI near CAD/simulation tooling | Reference scene cannot meet quality/performance targets |
| ADR-003 | Versioned world/process records | Reproducible edits and experiments | Contract migration becomes necessary |
| ADR-004 | DXF first, manual PDF/PNG reference | Deterministic geometry before uncertain perception | Held-out import results justify assisted OCR |
| ADR-005 | SimPy separate from geometry and rigid physics | Each model answers a defined question | A validated coupling use case appears |
| ADR-006 | Local-first storage and optional AI provider | Useful without cloud dependencies | Team deployment is funded and scoped |
| ADR-007 | AI emits bounded typed commands | Inspectable actions and grounded results | A missing command is supported by a concrete use case |
| ADR-008 | No exact dependency versions in the plan | Resolve compatible stable versions during setup | Lockfile and environment record are created |

Open decisions: weekly effort, hardware, source drawing access, equipment data, AI-provider/privacy preferences, project license, repository visibility, and external engineering review.


## Maintaining decisions

Reconcile these proposals with the actual repository. If there is an existing decision record, use it and point PROJECT_STATE.md to its location. Record adoption or changes based on evidence, not merely on the presence of this file.

For a new decision, append: ID, date, status, context, options considered, decision, rationale, consequences, evidence and revisit trigger. Do not claim a proposed tool has been installed or validated.


## Decision log

### ADR-009 - Workspace tooling and exact versions (resolves ADR-008)

- Date: 2026-10-09. Status: adopted.
- Context: ADR-008 deferred exact versions to setup. The workstation had pnpm 11.12.0, uv 0.12.18, Node 22.23.1 and Python 3.14.7.
- Options considered: npm/pip-tools; pnpm + uv workspaces; Docker-first.
- Decision: pnpm workspace (`apps/*`, `packages/*`) and uv workspace (`packages/contracts`, `services/api`). Exact direct versions in every manifest; full trees in `pnpm-lock.yaml` and `uv.lock`. Runtimes pinned via `.node-version`, `.python-version` and `packageManager`. Docker is not used.
- Rationale: both tools were already installed, both are fast, and both lock and verify (`--frozen-lockfile`, `--locked`).
- Consequences: contributors need pnpm and uv. Python 3.14 is the only supported interpreter (`>=3.14,<3.15`).
- Evidence: clean-copy install plus `pnpm check` passed (SESSION_LOG 2026-10-09). Versions are listed in docs/environment.md.
- Revisit when: a dependency lacks Python 3.14 wheels, or CI on Linux disagrees with macOS.
- Status updates: ADR-002 (browser + local Python API) and ADR-003 (versioned records) are now implemented in their minimal M0 form.
- Update (2026-10-10): pnpm pinned to **11.11.0**, because 11.12.0 is a broken upstream release that `pnpm/action-setup` refuses to install. The lockfile is unchanged. `astral-sh/setup-uv` is pinned to the exact tag `v10.3.0` because no `v10` major tag exists.

### ADR-010 - One contract pipeline: Pydantic → JSON Schema → TypeScript + Ajv

- Date: 2026-10-09. Status: adopted.
- Context: Python and TypeScript must agree on units, IDs and evidence without hand-maintained duplicates.
- Options considered: hand-written TS interfaces; zod as source with Python generated; OpenAPI → openapi-typescript; Pydantic → JSON Schema bundle → json-schema-to-typescript, with Ajv for runtime checks.
- Decision: the Pydantic models in `packages/contracts/python` are the source. `scripts/contracts.mjs` writes `schema/contracts.schema.json` and `ts/generated/contracts.ts`. Both are committed, and `pnpm contracts:check` fails on drift. The browser validates API data with Ajv against the same bundle.
- Rationale: the API already depends on Pydantic. A JSON Schema bundle can be validated at runtime in the browser, not only used for type generation. Committed outputs keep diffs reviewable.
- Consequences: two export adjustments (no field titles; Ajv-compatible discriminators). `$ref` fields must not carry descriptions. Cross-field rules (unique IDs, uncertainty ordering) exist only in Pydantic.
- Evidence: tests in `packages/contracts/tests/test_schema.py` and `packages/contracts/ts/validate.test.ts`.
- Revisit when: contracts need rules JSON Schema cannot express on the client, or OpenAPI clients are generated for other consumers.

### ADR-011 - TypeScript 6.0.3 instead of 7.0.2

- Date: 2026-10-09. Status: adopted.
- Context: TypeScript 7.0.2 (the native compiler) is the newest release. typescript-eslint 8.71.1 declares `typescript >=4.8.4 <6.1.0`.
- Options considered: TS 7 without typed linting; TS 7 with an unsupported peer; TS 6.0.3.
- Decision: TypeScript 6.0.3 everywhere.
- Consequences: no native-compiler speed-up yet.
- Revisit when: typescript-eslint supports TypeScript 7.

### ADR-012 - Do not create a Git repository on the user's behalf

- Date: 2026-10-09. Status: adopted for this session; needs a user decision.
- Context: the project context and rules say the repository is already initialised and forbid rerunning `git init`. The directory has no `.git` anywhere in its path.
- Options considered: run `git init` locally; stop and ask; build the foundation and record the discrepancy.
- Decision: build and verify M0 without Git, record the discrepancy (docs/environment.md), and leave repository creation to the user. The user may want to clone an existing remote instead.
- Consequences: no commits or branch history. The CI workflow has not run. Lockfiles and ignore rules are ready for the first commit.
- Revisit when: the user initialises or clones the repository. Then run `git status` to confirm `.gitignore` excludes `.venv`, `node_modules`, `dist`, `test-results` and `.env`.
- Outcome (2026-10-10): resolved. The user created the repository (`main` → `origin` https://github.com/ritwiz06/ReplayWorldStudio). The initial commit `511b04e` contains no ignored artefacts (`.venv`, `node_modules`, `dist`, `test-results`, `.env` absent).

### ADR-013 - Contract conventions for placement, plans and unknowns

- Date: 2026-10-09. Status: adopted (contract 0.1.0).
- Decision: `position_m` is the bounding-box bottom-centre. Rotation is Euler `XYZ` in radians with Three.js semantics. The plan → world convention is `plan_xy_to_world_x_neg_z`, followed by rotation about +Y and then translation. Parameters are a closed `known | unknown` union, and unknowns carry a reason, never a number. Dimensions carry one origin for the whole box. Models are strict, closed, frozen and finite.
- Options considered: centre-of-box origin (rejected: floor placement becomes height-dependent); quaternions (deferred: less readable for numeric editing); nullable `value` with an optional origin (rejected: allows inconsistent states, which a union cannot); per-axis provenance (deferred to WRL-01).
- Evidence: transform, placement and contract tests (see docs/contracts.md).
- Revisit when: WRL-01 adds catalog assets, or M2 imports nested DXF blocks with their own units.

### ADR-014 - Browser calls the API cross-origin with an explicit CORS allow-list

- Date: 2026-10-09. Status: adopted.
- Options considered: Vite dev proxy (same origin, no CORS); direct calls with a CORS allow-list.
- Decision: the browser calls `VITE_API_BASE_URL` (default `http://127.0.0.1:8000`). The API allows only the origins in `RWS_CORS_ORIGINS` (default: the Vite dev and preview origins) and refuses `*`. Both servers bind to 127.0.0.1.
- Rationale: the same request path works in dev, preview and tests, and the CORS boundary is exercised and tested rather than hidden by a proxy.
- Revisit when: the app is served from the API origin or deployed.

### ADR-015 - Per-axis dimension evidence; dimensions stay required

- Date: 2026-10-10. Status: adopted (contract 0.2.0, WRL-01). Supersedes the "one origin per box" part of ADR-013.
- Context: 0.1.0 gave a box a single origin, so a footprint measured from a plan and an assumed height had to be collapsed into the weaker label, losing honest information.
- Options considered:
  1. Keep one origin per box and explain it in text (status quo; loses information).
  2. Per-axis `Length` records, each with value, origin, source, review status and uncertainty.
  3. Per-axis records that may also be `unknown`.
- Decision: option 2. `Dimensions = {width, height, depth}`, each a `Length` (`value_m` > 0, `origin`, `source_ref`, `review_status`, `uncertainty_m` with lower bound > 0 that contains the value).
- Rationale: it represents a measured footprint plus an inferred height exactly. Option 3 would make every renderer, bounds and clearance consumer handle missing extents before any import produces them.
- Consequences: placed objects always have three extents. An unestablished axis must be `default` with an explanation, and the UI shows it as a placeholder. Units (metres), frame, bottom-centre placement and parameter known/unknown rules are unchanged.
- Evidence: `test_measured_footprint_and_inferred_height_stay_distinct`, per-axis rejection tests, the e2e inspector assertions, and the inspector screenshot.
- Revisit when: M2 imports footprint-only geometry, where unknown heights may need option 3 and an "input missing" state in M3 checks.

### ADR-016 - Catalog asset records embedded in the project, with explicit source and rights

- Date: 2026-10-10. Status: adopted (contract 0.2.0, WRL-01).
- Context: equipment must be matched to reusable models or clearly provisional assets, with provenance and license known before anything is redistributed.
- Options considered:
  - catalog location: a shared library file referenced by path, or embedded in the project;
  - license representation: free text, or an SPDX identifier with `LicenseRef-*` and `NOASSERTION`;
  - visual types: add glTF now, or only when it can be rendered.
- Decision: `Project.catalog: list[CatalogAsset]`, embedded so projects are self-contained. Each asset has a stable `id`, `kind`, `visual`, per-axis `nominal_dimensions`, `source {kind, author, reference}` and `rights {license, redistribution, attribution, terms_ref}`. `SceneObject.asset_id` is a catalog ID or `null` (scene geometry). The API validates unique asset IDs, resolution of every reference and kind match. `NOASSERTION` forces `redistribution: unknown`. Vendor and third-party sources must cite a reference. `visual` is `placeholder_box` only. The 0.1.0 `representation` field is removed.
- Rationale: SPDX identifiers are machine-checkable and standard, and `NOASSERTION` states "unknown" explicitly instead of omitting it. Adding a glTF type now would describe a renderer that does not exist.
- Consequences: the license check covers identifier syntax only, not membership of the SPDX list. Instances keep their own dimensions, and nominal-versus-instance differences are shown, not reconciled. The fixture's synthetic assets declare `NOASSERTION` because no project license is chosen.
- Evidence: reference, rights and source tests in `packages/contracts/tests/test_models.py`; API test for dangling references; e2e asset section and dangling-file rejection.
- Revisit when: WRL-02 adds glTF visuals, a shared multi-project library is needed, or the project license is chosen.

### ADR-017 - Schema 0.2.0: strict current model, explicit migration for 0.1.0

- Date: 2026-10-10. Status: adopted.
- Context: 0.2.0 changes the dimension shape and adds `catalog` and `asset_id`, a breaking change. Only repository fixtures exist in 0.1.0, because no persistence exists yet.
- Options considered:
  1. Accept both versions in `Project` (a union or defaults).
  2. Reject 0.1.0 with no upgrade path.
  3. Strict 0.2.0 model plus an explicit, lossless, tested migration.
  4. Auto-upgrade inside the API's open/validate path.
- Decision: option 3. The version bump is minor because the contract is pre-1.0. `upgrade_document` maps 0.1.0 → 0.2.0: the box evidence is copied to each axis (never strengthened), `representation` becomes `asset_id: null`, and an empty catalog is added. Unknown versions are refused. The command `python -m replay_world_contracts.migrate` validates its output, prints notes and never modifies the input. The API answers 0.1.0 with a single actionable 422 issue at `/schema_version`. Package versions were bumped to 0.2.0.
- Rationale: one current shape keeps every consumer simple, and upgrades stay visible and auditable. Option 4 would hide a transformation behind an endpoint before persistence exists to justify it.
- Evidence: `packages/contracts/tests/test_migrations.py` (validity, value preservation, no input mutation, refusal cases, CLI) and the API legacy test; `fixtures/legacy/foundation-scene-0.1.0.json`.
- Revisit when: WRL-03 adds save/reload. The loader should then call `upgrade_document` and show its notes before the first save.

### ADR-018 - glTF visuals declare their conventions and are scaled to recorded dimensions

- Date: 2026-10-10. Status: adopted (contract 0.3.0, WRL-02).
- Context: equipment must look like equipment, yet the physical dimensions must stay the recorded evidence. A model's own size must never become the dimension.
- Options considered:
  - fit: render the model at its authored size (instances that differ would misstate their footprint); scale uniformly (footprint wrong on at least one axis); scale per axis to the recorded box.
  - conventions: infer them from the file, or declare and check them.
- Decision: `GltfVisual` declares `uri`, `sha256`, `metres_per_model_unit`, `up_axis: +Y`, `front_axis: +Z`, `origin: bottom_centre`, `model_bounds_m`, `fit: scale_to_dimensions` and `max_fit_distortion`. Validators require the bottom-centre origin (0.1 mm) and nominal dimensions equal to the model extents (1 mm). The renderer scales per axis so the drawn bounds equal the instance's recorded dimensions, and the inspector flags distortion beyond the tolerance.
- Rationale: footprint fidelity is what spatial review needs. Declared, checked conventions make each model's relation to metres auditable.
- Consequences: large dimension differences stretch the model, which is shown, not hidden. Models must be authored or re-exported to the conventions.
- Evidence: `apps/web/src/scene/modelLoader.test.ts` (every demo instance fills its recorded box to 0.1 mm; rotation; stretch flag), `packages/contracts/tests/test_gltf_visual.py`, and the screenshots.
- Revisit when: a non-box footprint (L-shaped cells) or articulated models are needed.

### ADR-019 - One catalog library, content-pinned references, no silent substitutes

- Date: 2026-10-10. Status: adopted.
- Context: a project file opened from elsewhere names model files, and a path must not reach outside the library or load a different file.
- Options considered: URLs; embedding models in the project (data URIs); library-relative paths with a hash.
- Decision:
  - Visuals name a library-relative `.glb` path, restricted by pattern, plus a sha256.
  - The API serves `GET /api/v1/catalog/files/{uri}` only for pattern-valid paths that resolve, after following symlinks, inside `RWS_CATALOG_DIR`.
  - `POST /api/v1/projects/validate` rejects missing files and hash mismatches with located issues.
  - The browser re-hashes the bytes and checks parse and bounds before drawing; failures show a labelled fallback at the recorded size plus an actionable notice.
  - Validation error paths drop Pydantic union tags so they point into the submitted document.
- Rationale: content pinning makes "the same model" verifiable, and failures are visible and fixable instead of silently substituted.
- Consequences: project JSON is not self-contained (the portability limits are documented in docs/contracts.md); an export bundle (REL-01) must package models. Rebuilding models changes their hashes, so fixtures must be regenerated.
- Evidence: `services/api/tests/test_catalog_files.py` (symlink escape, unsafe paths, missing file, hash mismatch) and the e2e failed-load and unsafe-path tests.
- Revisit when: shared libraries or remote asset stores are introduced.

### ADR-020 - Original, procedurally generated, reproducible equipment models

- Date: 2026-10-10. Status: adopted.
- Context: the demo needs at least three recognisable models with clear authorship and rights. No license has been chosen for the project, and none may be assigned on the owner's behalf.
- Options considered: download CC0 or vendor models (third-party terms, provenance burden); hand-model in Blender (not reproducible in CI); generate procedurally in-repo with three.js and `GLTFExporter`.
- Decision: `apps/web/scripts/catalog` builds 4 models (belt conveyor, guarded machine cell, electrical cabinet, pallet with cartons). Each is made of rounded solids and cylinders with PBR materials, merged into one mesh per material, and recentred to the bottom-centre. The script writes deterministic GLBs and a manifest; `pnpm assets:check` in CI requires byte-identical rebuilds. The demo fixture is generated from the manifest (`pnpm fixtures:build`). Catalog rights are `NOASSERTION` / `unknown`, with authorship recorded as in-house procedural (AI-assisted).
- Rationale: no third-party rights questions; fully reproducible; hashes are stable.
- Consequences: the models are illustrative, not photoreal or vendor-accurate (no textures or bevelled CAD detail), and three.js upgrades may change hashes. A real project needs vendor or measured models with recorded licenses.
- Revisit when: the owner chooses a license, or vendor models are supplied.

### ADR-021 - Three camera modes with per-mode memory and a stable selection

- Date: 2026-10-10. Status: adopted.
- Decision:
  - **Orbit:** drei OrbitControls. Framing uses a binary search for the closest distance at which every box corner stays within the margin of the view, and transitions are animated.
  - **Top:** an orthographic camera with up = world −Z (plan up) and +X right, using MapControls with rotation disabled. It shows a scale bar from the live zoom and an orientation dial that explicitly is not geographic north. Shadows are off. Labels are clamped to each object's on-screen footprint so they never overlap.
  - **Walk:** a custom controller at 1.60 m eye height, 1.4 m/s (×2.5 with Shift). It stays on floor slabs and slides along equipment and structure footprints (0.25 m body radius). Drag to look, with no pointer lock, so `Esc` and the UI always work. `R` resets and `F` stands in front of the selection.
  - The selection lives outside the camera. Each mode keeps its last pose per project, and commands issued before a mode mounted are ignored, so returning to a mode restores it.
- Options considered: pointer-lock first-person controls (unreliable in tests and harder to exit); camera-controls (less control over the plan orientation and framing tests).
- Evidence: `cameras.test.ts`, `walk.test.ts`, and the e2e camera-mode test (framing, plan, walk movement, collision, reset, exit, restored orbit view).
- Revisit when: WRL-03 editing needs gizmo-aware controls, or WRL-04 profiling shows frame-time problems.

### ADR-022 - Schema 0.3.0 is additive; migrations chain

- Date: 2026-10-10. Status: adopted.
- Decision: 0.3.0 adds the glTF visual, the `walkway`/`keep_clear` kinds, the `demonstration` fixture label and `ValidationReport.model_file_count`. ADR-017 still applies: the model is strict about the current version. Migration steps run in sequence (0.1.0 → 0.2.0 → 0.3.0), and the 0.2.0 → 0.3.0 step changes only the version. The API answers 0.1.0 and 0.2.0 documents with one actionable upgrade message.
- Evidence: `test_migrations.py` (step order, 0.2.0 version-only step, CLI notes).

### ADR-023 - One typed command path; revisions advance on every edit, undo and redo

- Date: 2026-10-10. Status: adopted (WRL-03).
- Context: numeric fields, 3D handles, catalog placement, duplicate and remove must all change the project the same way, be reversible, and never apply to a state they were not prepared for. ADR-007 already expects later AI proposals to arrive as bounded typed commands.
- Options considered:
  - mutation: let each UI control change the project directly (no single place to validate or record); typed commands applied by one engine.
  - inverses: per-command inverse functions; before/after snapshots of the affected object.
  - revisions: restore the old number on undo (a state-identity number); advance on every transition.
- Decision:
  - `apps/web/src/editing/commands.ts` defines `set_transform`, `set_dimensions`, `add_instance`, `duplicate_object` and `remove_object`. Each request carries `baseRevision`.
  - The engine checks the revision first, then every value (finite; |coordinate| ≤ 1000 m; |angle| ≤ 360°; 1 mm ≤ length ≤ 1000 m; ID pattern; IDs unique and never reused, including IDs that appear only in the edit log; asset exists). Only then does it build one new project value, and as a final guard it runs the contract schema.
  - A rejected command returns a typed reason and the same project object. Projects are never mutated; tests deep-freeze the fixtures.
  - An accepted command yields an object patch (index, before snapshot, after snapshot) plus an edit record. Undo applies the inverse patch and drops the record; redo re-applies it.
  - `scene.revision` advances by exactly one for every accepted command, undo and redo. A command, undo or redo whose base revision is stale is refused as a conflict.
  - A handle drag captures its base revision on pointer-down, previews without touching the project, and commits one command on release. Esc cancels. Undo and redo are blocked while a handle is held.
  - Undo history lives in the session only and is capped at 200 steps.
- Rationale: a single engine is the only place that validates and records changes. Snapshots make inverses exact by construction (undo of a remove restores the same object at the same index). Restoring old revision numbers would let two different states share a revision after undo and a new edit, so a stale command could pass the check.
- Consequences: the revision counts state transitions, not distinct states. Undoing back to the loaded state still leaves the project at a higher revision, which counts as unsaved. The engine is TypeScript-only for now: the API validates whole documents, not commands.
- Evidence: `commands.test.ts`, `history.test.ts`, `units.test.ts` and the e2e test in `editing.spec.ts`.
- Revisit when: AI-01 needs the API to accept commands (move the command schema into the contract), or TEAM-01 needs concurrent editors.

### ADR-024 - Schema 0.4.0: a scene edit log that keeps the evidence each edit replaced

- Date: 2026-10-10. Status: adopted (contract 0.4.0).
- Context: editing a dimension must mark that axis as user-supplied while keeping the previous value and its evidence, and transform changes need an inspectable record. Both must survive save and reload.
- Options considered: keep records only in the browser (lost on reload); an append-only journal including undo and redo entries (the saved log would carry abandoned experiments and need replaying to be read); a log of the edits in effect, persisted in the project.
- Decision: `Scene.edit_log` is a list of typed records:
  - `object_edited`: `revision`, `object_id`, optional `transform` {before, after}, and per-axis `dimensions` changes {axis, before `Length`, after `Length`};
  - `object_added`: `asset_id`, `duplicate_of`;
  - `object_removed`: the full removed `SceneObject`.

  An edited axis becomes `user_supplied`, `unreviewed`, with no uncertainty and a fixed `source_ref` pointing at the log. An undone edit leaves the log, so record revisions can have gaps.

  Pydantic enforces that the log describes the scene:
  - revisions strictly increase and do not exceed the scene revision;
  - every edit changes something;
  - edited axes are `user_supplied`;
  - removed IDs are never reused;
  - added instances keep their asset and reference catalog assets;
  - edited or added objects either exist or were removed later;
  - the latest recorded transform and axis values equal the scene's.

  The version bump is minor (pre-1.0); migration 0.3.0 → 0.4.0 adds an empty log. JSON Schema and TypeScript were regenerated.
- Rationale: the saved file must say where every value came from, including values a person typed over measured ones, and a log that contradicts its scene would make that untrustworthy.
- Consequences: a value changed outside the editor without a record makes the file invalid (the API says the log no longer describes the scene). Records carry no author or time yet. Added instances copy the catalog's nominal dimensions and evidence; duplicates copy the source's dimensions, evidence, asset and parameters. The synthetic `fixture` label is never removed by edits.
- Evidence: `packages/contracts/tests/test_edit_log.py` (16 tests) on `fixtures/edited/foundation-edited.json`, which the TypeScript engine reproduces byte-for-byte in `sample.test.ts`; the API accepts it, and rejects it when tampered (`services/api/tests/test_upgrade.py`).
- Revisit when: TEAM-01 needs authorship and time, or M2 imports need a record type of their own.

### ADR-025 - Older files are upgraded by the API and reviewed in the browser

- Date: 2026-10-10. Status: adopted. Resolves the WRL-03 follow-up of ADR-017.
- Context: users must be able to open 0.1.0–0.3.0 files, see what the migration changes, and choose to open or save the upgraded copy. Unknown versions and failed migrations must leave the current scene intact.
- Options considered: port the migrations to TypeScript (two implementations to keep equal); accept old versions in `/validate` (hides the transformation); a separate upgrade endpoint that runs the existing Python chain and returns a report.
- Decision: `POST /api/v1/projects/upgrade` runs `upgrade_document` on any JSON object, validates the result (contract and model files), and returns `UpgradeReport {from_version, to_version, notes, project, validation}`. Nothing is stored. Unknown versions give one 422 issue at `/schema_version`; malformed legacy documents give one at the document level; validation errors after the upgrade are located in the upgraded document and prefixed "After upgrading from X". The browser sends any file whose `schema_version` is a different string to this endpoint and shows a review dialog: the notes, Open upgraded project, Download upgraded file (`<name>-0.4.0.json`), Cancel. An opened upgrade counts as unsaved until saved. `/validate` keeps its single actionable message for older versions.
- Rationale: one migration implementation, already tested, and the user sees every change before anything is replaced or written.
- Evidence: `services/api/tests/test_upgrade.py`, `client.test.ts`, the e2e upgrade test.

### ADR-026 - Save as a JSON download; unsaved edits are never replaced silently

- Date: 2026-10-10. Status: adopted (WRL-03).
- Decision:
  - **Save** (button or ⌘/Ctrl+S) downloads the complete project as pretty-printed JSON named `<project-id>-r<revision>.json`.
  - **Dirty state:** the project is dirty whenever its revision differs from the revision last loaded or saved. An opened upgrade counts as dirty until saved.
  - **Guard:** loading a fixture or opening a valid file while dirty first asks Save then continue / Discard changes / Cancel. The question is asked when the replacement is ready, so invalid files never prompt. Closing the tab while dirty triggers the browser's leave warning.
  - **Reopen:** reuses the existing file flow (API validation including model files, then Ajv).
  - **Undo history is not persisted:** the saved edit log is the durable record.
  - **Precision:** numbers are written with JavaScript's shortest round-trip form. The editor never stores `-0`, because JSON would turn it into `0`.
- Options considered: browser storage or an API project store (not needed for a local single-user prototype; REL-01 and TEAM-01 will need real storage); a File System Access API "save in place" (Chromium-only).
- Evidence: the e2e test re-saves a reopened file and gets byte-identical text; the unsaved-changes e2e test covers Cancel, Save then continue, and Discard.
- Revisit when: projects need server-side storage, autosave, or model files bundled with the JSON (REL-01).

### Updates to earlier decisions (2026-10-10, WRL-03)

- ADR-017 / ADR-022: the loader now upgrades older files through the API and shows the notes before anything is replaced or saved (ADR-025). 0.3.0 is now also a legacy version.
- ADR-021: editing handles are custom R3F meshes. Each is drawn at a constant screen size above the scene, and a root event filter puts handle hits first. Grabbing a handle disables the active orbit or map controls until release. The vertical arrow is hidden in the top view, and walk view has no editing. Camera framing, walk obstacles and shadows follow the edited scene. Model loading is keyed on the catalog, so scene edits do not reload models.

### ADR-027 - Render on demand; keep shader configuration identical across views

- Date: 2026-10-10. Status: adopted (WRL-04).
- Context: the WRL-04 benchmark showed the canvas redrawing at the display rate (120 Hz) while nothing changed. On the reference M3 Pro, an idle scene cost 10 % of a CPU core on the page's main thread plus 12–13 % in Chrome's GPU process for the 15-object demo, rising to 74 % plus 51 % at 260 objects. Frame times were never the problem: every scenario up to 260 objects held 120 Hz. Switching to the plan view also stalled for 25–50 ms the first time each session, because toggling shadows and fog changed every material's shader.
- Options considered:
  - idle cost: lower the device pixel ratio or shadow resolution (visual cost; idle CPU still grows with object count); instancing or merging meshes (large change, and draw calls were not limiting at M1 sizes); R3F `frameloop="demand"`, with explicit invalidation where the app animates on its own.
  - plan-view hitch: precompile both shader variants; or never change the variant (keep the light casting shadows at `shadow.intensity = 0`, pause shadow-map updates in the plan view, and keep fog attached with its range pushed out).
- Decision:
  - The canvas renders on demand. Controls, damping and the axis gizmo already request frames (drei).
  - The app requests frames for camera animations, walking (every frame while a key is held, with the first step after a pause using no stale time) and look-drags, view commands, and lighting changes. React prop changes request frames through R3F.
  - Camera and handle probes report on a throttle plus a trailing call after the last frame, so the page (and tests) always see the final state.
  - The plan view keeps the same lights, shadows and fog configuration as the other views and only changes uniforms.
- Rationale: the idle cost is pure waste on a laptop and grows with the layout, while interaction smoothness is unchanged (orbit, pan and walk still render about 119–120 frames per second while moving).
- Consequences:
  - Anything that animates by itself must call `invalidate()`, or it freezes until the next input. New animated features must follow this rule.
  - Handle drags render at the pointer-event rate, which is visually the same as before.
  - The headless e2e suite also became about 3× faster (1.7 min to 36 s).
- Evidence: docs/performance.md (idle main thread 1–2 % and GPU process 1–3 % at 15–260 objects; no frame over 50 ms in any view switch); `e2e/regressions.spec.ts` "renders nothing while the scene is idle".
- Revisit when: continuous animation is needed (M4 playback should request frames only while playing), or draw calls become the limit (instancing; see the scale limit in docs/performance.md).

### ADR-028 - Benchmark method and the M1 performance target

- Date: 2026-10-10. Status: adopted (WRL-04).
- Context: the UI requirements give a provisional target (30 FPS at 1080p for 20 equipment instances and 100 product items) to be measured, not assumed. Headless test browsers render WebGL in software, so their frame times say nothing about real use.
- Decision:
  - **Method.** `pnpm bench` drives the installed Google Chrome, headed, with hardware WebGL verified through CDP, on the reference MacBook Pro. It uses a production build and fresh contexts, with a fresh browser per scene so run 1 is a first visit. Each run measures fixed 4 s windows of paced input (orbit, plan pan, walk, handle drag), idle, frame-all and view switches. For each window it records animation-frame intervals (median, p95, p99, max, frames over 33 and 50 ms), long-animation-frame entries with script attribution, renders per second, draw calls and triangles from `renderer.info`, page main-thread busy time (CDP), and GPU- and renderer-process CPU time (`SystemInfo.getProcessInfo`).
  - **Scenes.** Edited layouts are generated as the demo plus N catalog instances, with the editor's own edit records (`scripts/build_benchmark_scenes.py`, labelled synthetic).
  - **M1 target** on the reference machine, at 1440 × 900 (DPR 2) and 1920 × 1080 (DPR 1), for the demo and edited layouts up to 60 objects:
    1. interaction (orbit, plan pan, walk, handle drag): frame-interval median ≤ 16.7 ms, p95 ≤ 33.3 ms, and no frame over 50 ms;
    2. first useful scene ≤ 1.5 s and all models ready ≤ 3 s after navigation (local servers, first visit included);
    3. no frame over 50 ms when switching views in a warm session;
    4. an idle scene uses < 5 % of a CPU core on the page's main thread.

    Larger layouts (120–1010 objects) are measured to find the scale limit, not held to the target.
- Rationale: the target is stricter than the provisional 30 FPS because the reference hardware comfortably exceeds it, and it adds what users feel (hitches, load, idle cost). "100 product items" cannot be measured before M4 creates product items, so that part stays open.
- Consequences: the target is tied to one machine and Chrome; other GPUs and browsers are unmeasured. CI never reports frame rates.
- Evidence and revisit: docs/performance.md; re-measure when rendering, assets or the reference machine change, and at M4 with product items.

### ADR-029 - A small browser smoke job in CI

- Date: 2026-10-10. Status: adopted (WRL-04). Supersedes "CI does not run Playwright" (M0).
- Context: on-demand rendering made the Playwright suite fast and less dependent on software WebGL speed (36 s locally). Playwright always passes `--enable-unsafe-swiftshader`, so WebGL works on GitHub's GPU-less runners.
- Decision: a separate `browser-smoke` job installs the Chromium headless shell with its system libraries and runs the four `@smoke` tests:
  - the demo loads with verified models;
  - the full edit → undo/redo → save → reopen path;
  - unsaved-change protection;
  - the idle-rendering regression.

  There are no retries, and traces are uploaded on failure. The full suite stays local (`pnpm test:e2e`).
- Rationale: a separate job distinguishes a browser failure from contract or unit failures. The subset covers the workflows that matter most while keeping CI time and flakiness low.
- Consequences: CI checks behaviour in software WebGL only; frame rates come from `pnpm bench` on the reference machine.
- Update (same day): the second CI run (`06de497`, docs only) failed. The idle-render test hit Playwright's default 30 s test timeout during its final drag, because every frame is rendered in software on the runner while another worker runs the edit test. It had passed the first time at 31.5 s, already at the limit. Fix: a 60 s test timeout when `CI` is set, and a 4-step drag. Damping still provides the renders the assertion needs.
- Revisit when: the smoke job flakes again, or the full suite proves stable enough on CI to run entirely.

### Update to ADR-021 (2026-10-10, WRL-04)

- Camera memory (the last orbit, plan and walk pose) is now kept per loaded document, not per project ID. Opening a saved or edited copy of the same project, or a different layout with the same ID, frames it afresh instead of reusing the previous document's views (regression test: "frames a newly opened document afresh").
- Resize knobs sit 20 px outside their faces on a short stem, so the knobs of small or distant objects no longer merge into one cluster.
