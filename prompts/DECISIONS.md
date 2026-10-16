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
- Update (same day): the second CI run (`06de497`, docs only) failed. The idle-render test hit Playwright's default 30 s test timeout during its final drag, because every frame is rendered in software on the runner while another worker runs the edit test. It had passed the first time at 31.5 s, already at the limit. Fix: a 60 s test timeout when `CI` is set, and a 4-step drag. Damping still provides the renders the assertion needs. A rerun of `fec1e13` then failed differently: the scene rendered twice in the "idle" window because, without a GPU, the first frames took longer than the fixed 1.5 s settle. The test now waits until the render count is unchanged for 1 s (up to 30 s) before asserting 1.5 s of silence. On the old code it still fails, because rendering never stops. A third attempt then showed the remaining two renders were real: every 10 s API health poll stored a new state object, re-rendering the app, and the scene drew one frame. `useHealth` now keeps the previous state when the result is unchanged. The test's idle window is 11 s, so it always spans a poll; it fails without the fix and passes with it.
- Revisit when: the smoke job flakes again, or the full suite proves stable enough on CI to run entirely.

### Update to ADR-021 (2026-10-10, WRL-04)

- Camera memory (the last orbit, plan and walk pose) is now kept per loaded document, not per project ID. Opening a saved or edited copy of the same project, or a different layout with the same ID, frames it afresh instead of reusing the previous document's views (regression test: "frames a newly opened document afresh").
- Resize knobs sit 20 px outside their faces on a short stem, so the knobs of small or distant objects no longer merge into one cluster.

### ADR-030 - Guided creation before drawing import; simulation split into supported models

- Date: 2026-10-10. Status: adopted (user-approved product direction).
- Context: M1 is complete. The user broadened the direction: factory planning is the first example of a general editable-world platform, and the most important gap is that people without CAD skills cannot add or change objects that the catalog lacks. The previous plan went straight to DXF import (old M2, 32-48 h).
- Options considered:
  1. Keep DXF import as M2 and add guided creation later (serves CAD users first; a project lead still cannot add a missing object).
  2. Guided creation and described custom objects first, then general image import, then DXF (chosen).
  3. Image import first (the most general source, but it needs the object review and generation path that guided creation builds, and its feasibility is unknown).
- Decision: new M2 = guided creation and described objects (GEN-01..03); M3 = one image to an editable world (IMG-01..03); M4 = drawing import (IMP-01..03, unchanged scope, same world model); M5 spatial checks; simulation is split into explicit supported models, each a gate of its own: production events (M6, SIM-01..04), rigid-body interactions (M7, PHY-01..02), and later validated structural (ENG-01) and chemical (CHEM-01) cases; M8 AI across the workflow (AI-01 re-scoped, because GEN-01 builds the provider boundary); M9 evaluation and release. Completed M0/M1 records and all existing issue IDs are preserved; milestones were re-estimated (MILESTONES.md) and the old DXF-only M2 and its estimate are kept only as a superseded baseline.
- Rationale: an object proposed from words, an image or a drawing needs the same typed proposal, review of stated versus inferred facts, provisional model and command path. Building that once, for the simplest input (text), de-risks IMG and IMP. Splitting simulation by model keeps each claim tied to a model that can support it.
- Consequences: the M2-M9 estimate is 296-468 h (355-560 h with contingency), uncalibrated because M0/M1 hours were not tracked. M3 needs a feasibility timebox before its estimate is trusted. ADR-004 ("DXF first") is superseded for ordering; its reasoning (deterministic geometry before uncertain perception) still governs how imported geometry is reviewed.
- Revisit when: GEN-03 or the IMG-01 feasibility study shows that proposal quality cannot meet a usable gate, or the user changes the priority.

### ADR-031 - Generated objects come from a bounded geometry specification built by our own generator

- Date: 2026-10-10. Status: adopted (GEN-01, contract 0.5.0).
- Context: users must be able to add an object the catalog lacks, from a description or by hand, without CAD skills. Any model must still follow the catalog rules: metres, bottom-centre origin, verified bounds, content hash, provenance. Language-model output must never run as code.
- Options considered:
  - representation: let the model write three.js or Python code (fast to prototype, but executes model output); have the model pick one of a few parametric templates (safe but narrow); a bounded, data-only specification of approved shapes, parts, placements and materials (chosen).
  - where to build: in the browser with the existing three.js kit (instant preview, but the server would have to accept and validate client-made GLBs); on the server in Python (the server is the only author of model files; one generator for preview, storage and rebuilds).
- Decision:
  - **Specification.** `GeometrySpec` / `GeometryDraft` (`rws-geometry/1`):
    - up to 40 axis-aligned parts, each filling its own box;
    - 5 approved shapes and 30 approved PBR materials;
    - parts' union equal to the envelope within 0.1 mm (the same as the glTF origin tolerance);
    - coordinates bounded to 100 m.
  - **Generator.** `replay_world_api.objects` (`rws-object-generator/1`): pure standard-library Python; meshes on a micron grid; a deterministic GLB writer; an independent reader that rejects anything else.
  - **Storage.** Models are stored content-addressed at `generated/<sha256>.glb` in the catalog library (git-ignored).
  - **Fitting.** The API fits drafts by scaling parts per axis, so a typed size never distorts the record.
  - **Previews.** A preview returns the bytes; the browser verifies them like any catalog model.
- Rationale: data cannot do anything except describe geometry, so prompt injection cannot reach code execution. One server-side author means one set of bytes per specification. That makes the hash meaningful and lets a project rebuild a missing model from its own record.
- Consequences:
  - Generated models are coarse: axis-aligned solids, no curves beyond cylinders, frustums and spheres, no slanted or articulated parts, no textures.
  - The appearance depends on how well the model lays out parts.
  - Generator changes alter hashes. The restore endpoint then reports `mismatch` and writes nothing.
  - The curated catalog keeps its three.js generator (ADR-020); the two are deliberately separate.
- Evidence: `services/api/tests/test_object_generator.py` (76 tests: watertight primitives with exact bounds, winding, determinism, reader rejections, safe storage); the three.js cross-check (Box3 equals the envelope to < 1e-7 m).
- Revisit when: GEN-02 needs editable versions, or real objects need slanted or curved parts.

### ADR-032 - ASU Voyager behind the local API; validated, grounded proposals; key only on the server

- Date: 2026-10-10. Status: adopted (user-selected provider).
- Context: the user approved ASU Voyager (OpenAI-compatible, `https://openai.rc.asu.edu/v1`) and asked to start with `qwen3-235b-a22b-instruct-2507`, keep the model configurable, test schema adherence for real, and keep the key out of the browser, Git, fixtures and logs.
- Options considered: call the provider from the browser (exposes the key); a local model (not selected by the user); the local API as the only caller (chosen). For structure: free text plus parsing; `json_object`; strict `json_schema` with vLLM's guided decoding; tool calls. All four were probed live; all returned valid JSON for a small schema.
- Decision:
  - **Request.** The API sends `response_format: json_schema` (strict, temperature 0), with self-contained schemas generated from Pydantic.
  - **Validation.** It validates every answer with Pydantic (`extra="forbid"`) and retries once, listing the problems.
  - **Checks.** It then applies deterministic checks:
    - a "stated" size must be found, with its unit, in the user's words, otherwise it becomes an estimate to confirm;
    - an estimate follows the model's own parts (no stretching to a second guess);
    - a move needs its distance, unit and direction in the request, and a turn its angle and direction, otherwise the user is asked;
    - a target must exist; "the selected …" must fit the selection; words that fit several objects get a question.
  - **Unknowns.** Mass, strength, chemical composition and operating behaviour are always recorded as unknown; mentioned masses and rates are listed as not modelled.
  - **Configuration.** The key is read from the process environment or the root `.env` (`RWS_*`/`VOYAGER_*` names only), kept in a `repr=False` field, and sent only in the `Authorization` header. `VOYAGER_MODEL` and `VOYAGER_BASE_URL` are configurable.
  - **Offline tests.** A `recorded` provider replays saved live answers (`fixtures/assist/recorded/`, refreshed by `scripts/evaluate_assist.py --record`) for tests and the browser suite. It is labelled "recorded … not live AI" everywhere it appears.
- Rationale: guided decoding made every live answer schema-valid, but the live runs showed it does not make answers *true*. The model converted "2 km" into "2 m" when its unit list lacked km, picked one of two cabinets for "the cabinet", marked a cylinder without an axis, and gave a depth its own parts did not match. Each of these was caught by a deterministic check, not by the schema.
- Consequences:
  - A detailed object proposal takes about 50-85 s with this model (about 1,500 output tokens at about 20 tokens/s, measured with and without guidance), so the provider timeout is 150 s; edits take about 4-10 s. Without schema guidance, 0 of 9 edit answers matched the schema even after a retry (objects stayed valid thanks to the prompt's complete example), so guidance stays on. The UI shows progress and can cancel.
  - Requests send the description, or the edit request plus object IDs, names, kinds, positions and sizes; nothing else.
  - CI never calls the provider.
- Evidence: docs/assist.md, docs/assist-evaluation/, `services/api/tests/test_assist.py` and `test_assist_recorded.py`.
- Revisit when: GEN-03 compares models (a faster model may suffice), Voyager changes the model, or the provider is unavailable for long periods.

### ADR-033 - Schema 0.5.0: generated assets record how they were made

- Date: 2026-10-10. Status: adopted.
- Decision:
  - `AssetSource.kind` gains `generated`.
  - `CatalogAsset.generation` records the method (described or builder), description, language model, generator version, specification, stated and inferred facts, mentions that are not modelled, and the four unknown properties. It is required exactly for generated sources.
  - A generated asset's visual must live under `generated/`, and its nominal dimensions must equal the specification envelope.
  - Dimension evidence is assigned by the API: stated → `user_supplied`/confirmed, citing the user's words; confirmed estimate → `inferred`/confirmed; typed → `user_supplied`/confirmed. Unconfirmed estimates are refused.
  - Migration 0.4.0 → 0.5.0 adds `generation: null`.
  - The assist request and response models are in the contract bundle, so the browser validates them with Ajv.
- Rationale: a saved project must say that an object is a provisional picture, what the user said, which model inferred the rest, and what is unknown. It must also be able to rebuild its own model files.
- Evidence: `test_migrations.py` (0.4.0 step and refusal), `test_assist.py` (asset evidence, restore), `test_object_generator.py` (a generated asset validates).

### ADR-034 - Language edits resolve in the browser through the command engine

- Date: 2026-10-10. Status: adopted (GEN-01). Partly realises ADR-007.
- Context: an edit request must show the exact change before it applies, use the existing validation (target, units, limits, revision), and leave the project unchanged when rejected. The command engine is TypeScript-only (ADR-023).
- Options considered: let the model output coordinates (it would do arithmetic and could fabricate); move the command engine to the API (a large change before AI-01 needs it); have the model output a typed *intent* (action, target, direction, distance and unit as written) and resolve it in the browser (chosen).
- Decision:
  - The API returns an `EditIntent`.
  - The browser converts units, maps plan directions to world axes (left −X, right +X, back −Z, forward +Z, up/down ±Y) and computes the new transform on the 1 mm / 0.1° grid.
  - It then dry-runs `applyCommand` against the revision the request was made for and shows the exact before and after values.
  - **Apply** executes the same command with that base revision, so an intervening change is a conflict. Undo works as for any edit.
  - In GEN-01 only move and turn are supported; anything else is refused with a message.
- Consequences: "left" means −X in the plan, not the camera's left; the card says so. The command schema is still not part of the API contract (ADR-023's revisit trigger remains for AI-01).
- Evidence: `editIntent.test.ts`, the e2e "changing the scene with words" tests.

### ADR-035 - A guided start for first-time users; the editor stays one click away

- Date: 2026-10-10. Status: adopted (GEN-01).
- Decision:
  - **Start panel.** A modal start panel opens on the first visit (remembered in `localStorage`, reopened with **Start**). It offers Explore the demo, Describe an object and Open a project, plus a **Build an object by hand** link and **Go to the full editor**. Image import is shown as "Coming next (IMG-01)" without any action.
  - **Describe flow.** It shows a name, a sentence, a verified preview, a size list (stated, estimated or entered, with confirmation), part chips (mentioned ones highlighted) and one "Not known" line. Schema, provenance and file details sit behind **Details**.
  - **Change bar.** A change bar at the bottom of the viewport handles language edits.
  - **Tests.** Existing browser tests start with the panel dismissed (Playwright `storageState`), and the benchmark scripts set the same flag.
- Rationale: a project lead can describe, inspect and place an object without learning the inspector, while every value stays traceable.
- Evidence: e2e "first visit" tests; timed task observations in docs/assist.md (not a usability study).

### Update to ADR-035 (2026-10-14, IMG-01)

- **Start from a photo** is now a working choice in the start panel (it opens the photo import; ADR-036). It is disabled, with a message, when the local API is not reachable. The other choices are unchanged.

### ADR-036 - IMG-01: a vision model proposes objects; geometry is computed in code or entered by the user

- Date: 2026-10-14. Status: adopted (IMG-01).
- Context: IMG-01 must turn one permitted image into a reviewed, editable world. The candidate model was `qwen3-vl-32b-instruct` on ASU Voyager; its behaviour on images was unknown and the text model's GEN-01 results could not be assumed to carry over. Voyager's text-to-image and video models are not image-to-3D services. The feasibility check measured every part of the vision model's answer against a render with known ground truth and against public-domain photos (docs/image-import.md).
- Options considered:
  - trust the model's floor geometry (floor contact points, floor rectangles, view type, room boundary, sizes): measured 0.4–1.0 m floor error for its contact points, and rectangles that were axis-aligned boxes or invented;
  - a single-image depth or 3D reconstruction service: none was available or verified on Voyager, and its text-to-image and video models do not do this;
  - the model proposes only what it sees (objects, image boxes, labels, appearance, facing, visible text) and deterministic code plus the user supply the geometry (chosen).
- Decision:
  - **Provider.** `qwen3-vl-32b-instruct` through ASU Voyager, behind the local API like GEN-01 (ADR-032): `POST /api/v1/assist/image-proposals`, `response_format: json_schema`, Pydantic validation with one retry. The model ID is configurable (`VOYAGER_VISION_MODEL`).
  - **What the model supplies:** distinct objects, their image boxes and labels (editable), whether they stand on the floor, and visible text.
  - **What code computes:**
    - the floor contact point is the bottom-centre of the box; the model's own point is used only when the box is cut off at the bottom, with a note;
    - the shape family comes from the label's head noun, not from the model's template choice;
    - which side is visible comes from the outline (its floor span compared with the label's typical width and depth), overriding a contradicting facing;
    - a colour is taken from the pixels inside the outline when it is clearly coloured and not the floor or wall; greys are left to the model.
  - **Not trusted:** the model's floor rectangles (only a starting position for the user's corners), view type and room boundary (unused), and sizes (only their proportions, for hidden sides).
  - **Text in the image is content.** It is recorded as `visible_text`, and the system prompt says it is never an instruction.
  - **Consent.** Before anything is sent, the panel says what goes where. Only a browser re-encode is sent (JPEG, at most 1600 px, no metadata; the API refuses copies over 4 MB or 2048 px). **Mark objects myself** skips the model.
  - **Supported image type:** one indoor room or work area with a visible floor, upright camera at roughly eye height or above, containing a floor rectangle with four visible corners and a known width; JPEG, PNG or WebP by content; at most 15 MB and 50 megapixels, at least 64 px a side; up to 30 proposed objects and 60 stored observations. Outdoor scenes, close-ups, photos without such a rectangle, several photos, walls and textured geometry are left to IMG-02/03.
  - The start-panel entry is now active (Update to ADR-035 above).
- Rationale: in the feasibility runs the model was good at finding and naming objects (box IoU 0.81–0.94 on the render's visible machines, conveyors and pallet) and unreliable at everything metric. Box bottom-centres gave 0.05–0.46 m floor error where the model's own points gave 0.4–1.0 m.
- Consequences:
  - Analysis takes about 25–100 s (161.5 s once, when a retry was needed). Labels and object counts vary between live runs even at temperature 0.
  - Shapes are generic families and colours are approximate. Groups ("table with chairs") still need a tighter box from the user; a note asks for it.
  - CI never calls Voyager. Recorded answers (`fixtures/assist/recorded/image-*.json`) replay in pytest and e2e and are labelled not live AI.
- Evidence: docs/image-import.md; docs/assist-evaluation/img-01.1.json and img-01.2.json (final prompt img-01.2: 1 of 5 analyses needed the retry; the injected sign was reported as text and not obeyed); `services/api/tests/test_images.py`, `test_assist_recorded.py`; `apps/web/src/photo/colour.test.ts`; screenshots in docs/img-01/.
- Revisit when: Voyager offers a verified depth or segmentation model, a faster or better vision model is available (IMG-03 should compare), or IMG-02 widens the supported image type.

### ADR-037 - Scale from one floor rectangle the user measured

- Date: 2026-10-14. Status: adopted (IMG-01).
- Context: one photo cannot establish size by itself, and the model's scale cues were unreliable (ADR-036). The user must set the scale, and every value must say how certain it is.
- Options considered: one known object height or length (no floor mapping; depends on choosing the right object); a floor rectangle with a known width (chosen); an assumed camera height and lens (no measurement at all).
- Decision (`apps/web/src/photo/floor.ts`):
  - **Camera model.** Pinhole, principal point at the photo centre, no lens distortion, no roll.
  - **Floor mapping.** The user drags four corners onto a rectangle on the floor and enters its width (and optionally its depth). A homography maps photo points on the floor to scene metres.
  - **Lens.** Solved from the rectangle's perspective (`from_rectangle`); for a rectangle seen face-on, from its two given sides (`from_sides`); otherwise a 60° vertical view is assumed (`assumed`) with a warning.
  - **Depth.** A depth the user did not give is derived from perspective and marked derived. When both sides are given and the lens came from the rectangle, a disagreement over 25 % is reported.
  - **Objects.** The floor point fixes the object's front on the floor. A box square to the rectangle is fitted to the outline's left, right and top edges, giving the visible width and the height. The hidden side comes from the label's typical proportions and is marked "hidden: a guess".
  - **Evidence.** Values from the photo are `inferred` and unreviewed, citing the photo and observation; values the user types become `user_supplied` and confirmed; the rectangle needs at least one `user_supplied` side.
  - The panel states that one measured length fixes the scale on the floor only: hidden sides, heights and depths stay estimates, and positions far from the rectangle or near the horizon are least certain.
- Rationale: a floor rectangle gives both the floor plane and a scale; it is common in rooms and work areas (rugs, tiles, pallets, walkways, table feet). Squaring objects to the rectangle removed the 37° yaws that per-object facing produced; solving the lens from the two sides recovered the render's 70° lens exactly.
- Consequences: a photo without a fully visible floor rectangle is not supported (the living-room demonstration uses an assumed 2.0 m rug width and is only indicative). A few pixels of corner error change the solved lens noticeably. Hidden depths were about half the true depth for the render's machine cells.
- Evidence: `apps/web/src/photo/floor.test.ts` and `world.test.ts` (the recorded factory answer checked against the render's ground truth); live factory journey: centres within 0.25 m, visible widths within 12 %, heights within 11 % (docs/image-import.md).
- Revisit when: IMG-02 adds several photos of one place, or vanishing-line or wall cues.

### ADR-038 - Schema 0.6.0: photo sources and source photo storage

- Date: 2026-10-14. Status: adopted (IMG-01).
- Context: a project made from a photo must say which photo it came from, how its floor was calibrated and which observation became which object, and reopening it must never show a different photo in its place. Photos can be large and may be private, so they should not be embedded in the project JSON.
- Options considered: embed the photo in the project (large files; the bytes travel wherever the JSON goes); keep only a file name (cannot detect a different or edited file); store the original bytes content-addressed beside the catalog library and record the hash in the project (chosen).
- Decision:
  - **Storage.** The original bytes are stored unchanged at `photos/<sha256>.<jpg|png|webp>` in `RWS_SOURCES_DIR` (default `data/sources`, git-ignored), uploaded with `POST /api/v1/sources/photos?filename=…[&expected_sha256=…]` (streamed, 15 MB cap, format checked by content, idempotent) and served by `GET /api/v1/sources/files/photos/<sha256>.<ext>`.
  - **Contract 0.6.0.** `SourceDocument.kind` gains `photo`; `source_to_world` becomes nullable (null for photos, required otherwise); `image` (`SourceImage`) and `photo_import` (`PhotoImport`: vision model, calibration, observations, visible text) are added. `AssetGeneration.method` gains `photo`. `ValidationReport` gains `photo_file_count` and `missing_source_files`. Details in docs/contracts.md.
  - **Reopening.** Validation refuses a missing photo at `/sources/<i>/image/uri` and an altered one at `/sources/<i>/sha256`. The editor offers **Attach the original photo…** (uploaded with `expected_sha256`; a different file gets 409 and nothing is written) or **Open without the photo** (`missing_sources=allow`; the objects and evidence open and the photo panel says the photo is missing). Nothing is ever substituted.
  - **Migration 0.5.0 → 0.6.0** adds `image: null` and `photo_import: null` to every source and changes nothing else; a 0.5.0 document that already has them is refused as malformed.
- Rationale: the hash makes the reference exact, and keeping the bytes outside the JSON keeps project files small and keeps the photo on the computer where it was imported.
- Consequences: there is no export bundle yet. Opening a photo project elsewhere needs the photo in that machine's source library and the generated models in its catalog library (missing generated models can be rebuilt, as in GEN-01; a missing photo can only be attached or skipped).
- Evidence: `services/api/tests/test_photos.py`, `test_photo_api.py`, `packages/contracts/tests/test_migrations.py`, `test_models.py`; e2e `photo.spec.ts` (save, reopen, missing photo, attach).
- Revisit when: REL-01 adds an export bundle, or projects need server-side storage.

### Update to ADR-037 (2026-10-15, GEN-02)

- **Audit finding.** ADR-037 assumed the user *measured* the rectangle, but the editor recorded every side it was given as measured: the scale step tagged it "measured by you" and the reference's evidence read "Measured by the user: …". The classroom demonstration's 1.52 m table width was an assumption (a standard 60-inch table), so its record overstated what was known.
- **Change.** The scale step now asks **How do you know these sizes?**: "I measured them, or know them exactly (a drawing, a standard tile)" or "They are an assumption (a typical size); the world will say so". **Create the 3D world** stays disabled until it is answered.
  - A measured side stays `user_supplied`/`confirmed` ("Measured by the user: the <feature>'s <side>").
  - An assumed side is `user_supplied` but `unreviewed` ("Assumed by the user: a typical <side> for the <feature>, not measured"), and the panel adds "An assumed length sets the scale, so every size and distance is only as right as that assumption."
  - Contract 0.7.0 records the answer as `FloorRectangle.size_basis` (`measured`, `assumed` or `not_stated`); an assumed side cannot be marked confirmed. Migration 0.6.0 → 0.7.0 gives existing photo projects `not_stated`: 0.6.0 did not ask, so neither claim is made.
- The decision itself (scale from one floor rectangle of known size) is unchanged; "measured" in ADR-037 now reads "measured or assumed, and recorded as which".

### ADR-039 - Generated-asset revisions are new immutable assets with lineage

- Date: 2026-10-15. Status: adopted (GEN-02, contract 0.7.0).
- Context: a placed generated object (described, builder or photo) must be correctable after placement (size, parts, materials) and the correction reusable by other instances, while the previous version and its record stay in the project. Generated models are content-addressed and hash-checked (ADR-031), and a photo object's record must keep distinguishing what the photo showed from what was changed later.
- Options considered:
  - edit the asset in place (rewrite its specification and model file): every instance changes silently, the old file and its hash are lost, and the record could no longer say what the description or photo produced;
  - copy the object's specification into a new, unrelated asset: nothing links the versions, and the original description or observation is lost or duplicated without explanation;
  - a new immutable asset per revision that names the asset it revises (chosen).
- Decision:
  - **New asset.** Every accepted revision is a new catalog asset with its own ID (`asset-gen-<slug>-<sha8>`), its own specification and its own `generated/<sha256>.glb`, named "<base> (vN)". No existing file is overwritten; the previous asset stays in the catalog unchanged.
  - **Lineage.** `AssetGeneration.revision` (`AssetRevision`) records `revises`, `version` (the original is version 1 and records `revision: null`), the `instruction` (null when changed by hand), the `language_model` that proposed the specification change (null when by hand; a model requires an instruction), the `changes` in plain words and what was asked for but is `not_represented`.
  - **Original kept distinct.** The revision copies the original generation fields unchanged (method `described`/`builder`/`photo`, description, the original drafting or vision model, stated and inferred facts), so the original description or photo observation is never confused with a later correction. A photo observation keeps pointing at the same object ID, which now references the revision.
  - **Validation.** Project validation requires `revises` to name a generated asset in the catalog, with `version` one above that asset's version.
  - **Building.** `POST /api/v1/catalog/generated-assets/revisions` fits the edited draft, builds it with the GEN-01 generator and stores it; it refuses a model identical to the current one, and a failed build writes nothing and changes nothing in the project.
  - **Migration 0.6.0 → 0.7.0** adds `revision: null` to every generated asset (and `size_basis: not_stated` to photo scale references, Update to ADR-037) and refuses documents that already have them.
- Rationale: the content hash already makes a model file immutable; making the asset immutable too keeps every version identifiable, hash-checked and rebuildable, and undo only has to restore references.
- Consequences: the catalog grows with each accepted revision, and older versions stay even when no object uses them (unused assets are allowed). There is no command to delete an old version. Each version's model file must be present, or rebuildable with its recorded hash, to open the project.
- Evidence: `packages/contracts/tests/test_asset_revisions.py`, `test_migrations.py`; `services/api/tests/test_revisions.py`; e2e `improve.spec.ts` (both versions saved, reopened and hash-checked; a missing new GLB refused, then rebuilt with the recorded hash; the photo link kept).
- Revisit when: projects need to prune unused versions, or REL-01's export bundle needs to choose which versions to package.

### ADR-040 - One-step instance updates and dimension evidence for revisions

- Date: 2026-10-15. Status: adopted (GEN-02, contract 0.7.0).
- Context: switching instances to a revision must be one undoable step that applies to every chosen object or to none. Instances may have their own sizes (edited, or measured on site) that differ from the asset's nominal size, and a revision must never upgrade the evidence of a size nobody re-established (for example, turning an image-inferred size into a measured one because the colour changed).
- Options considered:
  - one `set_dimensions`-style command per object plus a catalog change: several undo steps, and a partial failure could leave mixed versions;
  - force every instance to the new nominal size: discards measured or edited sizes;
  - one `revise_asset` command recorded as one `asset_revised` edit, with a per-axis rule shown before Apply (chosen).
- Decision:
  - **Record.** `asset_revised` {`revision`, `asset_before`, `asset_after`, `objects`: [{`object_id`, `dimensions`: [`AxisChange` before/after]}]} switches one or all instances in one step. The scene validator follows each object's asset reference through `object_added` and `asset_revised` records and requires it to equal the scene's; both assets must be in the catalog.
  - **All or nothing.** The browser's `revise_asset` command checks every chosen object before changing any. An object that no longer uses the old asset, or a stale scene revision, is a conflict, and nothing changes. Undo restores the exact prior asset references, dimensions and catalog.
  - **Per-instance sizes.** An axis whose value and evidence equal the old asset's nominal follows the new nominal (value and evidence copied). An axis with the object's own value or evidence is kept, and the model is stretched to it, unless the user ticks "use <new size> instead". The dialog lists this per object and axis before Apply.
  - **Evidence of the revised asset's sizes** (per overall dimension, set by the API):
    - `kept`: unchanged; the previous value and evidence are copied exactly;
    - `entered`: typed by the user; `user_supplied`, `confirmed`, "Entered by the user while improving the model (previously X m, origin)";
    - `proposed`: changed by the language model and confirmed by the user; `inferred`, `confirmed`, citing the model and the instruction.

    The API refuses `kept` for a changed axis, `proposed` for an unchanged axis, and an unconfirmed proposal.
  - Unlike `object_edited`, an `asset_revised` axis's `after` need not be `user_supplied`: following a revised nominal keeps the evidence that nominal has, which may be `inferred`.
- Rationale: one record keeps undo exact and the log readable; copying evidence instead of re-labelling it keeps a photo estimate an estimate.
- Consequences: an object stretched to its own size can look distorted (the existing stretched-model badge applies). Edit records still have no author or time (ADR-024).
- Evidence: `commands.test.ts` and `revisionDraft.test.ts` (selected only, all instances, measured size kept and adopted, stale-revision and wrong-asset conflicts, undo/redo exactness, change lists, evidence bases); `test_asset_revisions.py`; `test_revisions.py`; e2e `improve.spec.ts` (two instances, one with a measured width kept).

### ADR-041 - Bounded revision proposals: representability rules, openness guard, overlap separation

- Date: 2026-10-15. Status: adopted (GEN-02).
- Context: users ask for changes the generator may not be able to depict ("open shelves", "a mesh guard", "rounded corners"). The first live answers showed two failure modes that schema guidance does not catch: an "open" object built from thick or solid blocks, and a part "painted" by burying a thin part inside another (the red top inside the blue body, which renders as flickering faces). A proposal must never imitate an unrepresentable feature or claim an opening it does not have.
- Options considered: let the model rewrite the object from scratch (loses the parts the user did not ask about); accept any schema-valid answer (the failure modes above reach the user); a complete revised parts list from the model, followed by deterministic checks that refuse or repair before the user sees it (chosen).
- Decision:
  - **Provider.** `POST /api/v1/assist/model-revisions`: ASU Voyager `qwen3-235b-a22b-instruct-2507` through the local API, `json_schema`, Pydantic validation with one retry (ADR-032); 503 when no provider is configured. Only the instruction and the model's part list are sent (no photo, no scene). Nothing is built or stored by a proposal.
  - **Prompt `gen-02.2`.** The complete parts list; size kept unless asked; thin panels and slender posts; no overlapping or face-sharing parts; open structures as separate panels with real empty space; features the generator cannot depict listed in `not_representable` and never imitated.
  - **Deterministic checks** (`assist/revisions.py`):
    - the overall size is forced back when the instruction has no length or size words;
    - an "open" request whose proposal still has one part filling ≥ 50 % of the envelope volume is refused (`unsupported`, nothing changed);
    - a proposal identical to the current model is refused;
    - curved, slanted or rotated surfaces, holes or perforations, textures or printing, and moving or hinged parts named in the instruction are added to the not-represented list when the model did not list them;
    - overlap separation: a box part covering the whole end of a larger box part trims the larger one, so the two meet; other face-sharing overlaps are reported, not moved.
  - **Review.** The dialog shows the proposal next to the current version, a plain-words change list, "The shape generator cannot show: … These are not imitated in the model.", and requires confirming a proposed size. The user can adjust a proposal by hand; the dialog then says "then adjusted by you", and the recorded change list adds "Adjusted by the user after the proposal".
- Rationale: in `gen-02.1` the open-shelf answer had 0.1 m shelves and the red top overlapped the body; `gen-02.2` gave 0.02 m shelves but the top still overlapped, which separation now trims. The openness guard keeps a solid block from being presented as open.
- Consequences: proposals take about 30–110 s; a long instruction timed out at 150 s once. Panel proportions depend on the model (0.1 m top and bottom boards). Fitting can rescale parts slightly, reported as "resized or moved". The machine-guard result is only modestly closer to the photo. The checks catch misrepresentation, not ugliness.
- Evidence: docs/assist-evaluation/gen-02.1.json and gen-02.2.json (every successful answer schema-valid on the first attempt); `services/api/tests/test_revisions.py`; recorded replays in `test_assist_recorded.py`; screenshots in docs/gen-02/.
- Revisit when: GEN-03 evaluates revisions on held-out instructions, the generator gains openings or rotated parts, or a faster model is chosen.

### Update to ADR-032 (2026-10-15, GEN-03)

- **Evaluated confirmation.** ADR-032's "revisit when GEN-03 compares models (a faster model may suffice)" has been acted on. `qwen3-235b-a22b-instruct-2507` stays the default for object proposals, edits and model revisions; the decision is unchanged in substance. Evidence: one live run of both models on the frozen GEN-03 held-out set (32 descriptions, 31 edits, 22 revisions; 170 requests; docs/assist-evaluation/gen-03/report.md).
- **`qwen3-30b-a3b-instruct-2507` rejected** by the pre-registered rule (it replaces the baseline only if it passes every gate and is at most 10 points worse on any quality measure; speed alone never decides). It failed four gates:
  - description outcomes 27/32 (84 %; gate 85 %);
  - visual review mean 1.00 with 5/23 zeros (gate ≥ 1.3 with ≤ 15 % zeros);
  - exact edit proposals 14/15 (93 %; gate 95 %);
  - unrepresentable features listed in `not_represented` 0/3 (gate 80 %).

  It also rated "clearly recognisable" on 22 points fewer descriptions than the baseline (5/23 vs 11/25). It was 3–5 times faster (medians 9.7 / 1.8 / 12.3 s for descriptions / edits / revisions, against 43.4 / 6.4 / 49.0 s), which does not decide.
- **The baseline is not cleared everywhere.** It passed every safety, measurement, description, edit and waiting gate, but failed two revision gates (outcomes 17/22; unrepresentable listing 1/3). That is a prompt and check problem for GEN-04, not a reason to change model.
- `VOYAGER_MODEL` stays configurable. Revisit when Voyager offers a new text model, or GEN-04 shows the revision gates cannot be met with this one; any new comparison follows ADR-042.

### ADR-042 - Evaluation rules for assistance models

- Date: 2026-10-15. Status: adopted (GEN-03).
- Context: GEN-03 had to choose a default text model and decide whether M2 can close, from live answers that vary between runs. A comparison set or threshold chosen after seeing results, recorded answers presented as live, or a reviewer who knows which model drew which picture would each make the result unreliable. GEN-04 and later evaluations (IMG-03, AI-01, QA-01) need the same rules.
- Options considered:
  - informal spot checks on development cases (fast, but the prompts were tuned on those cases, so they flatter the shipped model);
  - a held-out set scored after the fact, thresholds chosen with the results in view (open to moving the goalposts);
  - a held-out set and gates frozen and committed before any run, run once live, with a blind visual review (chosen).
- Decision:
  - **Pre-registered.** Cases, measures and gates are written and committed before any model sees the held-out set (GEN-03: `435095a`). A threshold is never changed after results are seen.
  - **Held-out sets are used once.** A set that has been run is never reused for a revised claim; a fix is tested on a fresh, frozen set (GEN-04 does this for revisions). Development and pilot cases come from development sets only.
  - **Live results only.** Reported results come from live calls through the real API endpoints. Recorded answers are for offline tests and are never reported as live.
  - **Blind visual review.** Renders are labelled by option at random; the key stays closed until every sheet is scored, and the reviewer is named.
  - **Run conditions.** Requests run sequentially with models alternating per case, so both see the same load. Future evaluations: a pilot on development cases first (to catch tooling faults), at most 2 requests in flight per model, backing off to 1 on any 429 or rising errors or timeouts, and the concurrency stated with every latency figure.
  - **Diagnostics are not gates.** "Parts hidden inside another part" is reported as a diagnostic, not a pass/fail gate.
- Rationale: in GEN-03 the gates fixed in advance decided both questions: the faster model was rejected on them, and the default's two revision failures keep M2 open instead of being explained away. Blinding keeps the reviewer's knowledge of which model is which out of the visual scores.
- Consequences: an evaluation takes longer (GEN-03's sequential live run took 66.5 min), and every corrective claim needs new cases. Two tooling faults appeared only on first use after the run (the edit scorer's module loading; both render options drawn on one canvas); they were fixed before scoring and did not affect blinding, and a pilot on development cases is meant to catch such faults earlier. The reviewer was the assistant running the evaluation, not an independent person, and correction effort is a reviewer's count, not a timed study; reports say so.
- Evidence: docs/assist-evaluation/gen-03/criteria.md (frozen in `435095a`), README.md (run commands and the pilot and concurrency rules), report.md, review.json; `tests/test_gen03_evaluation.py`.
- Revisit when: an independent reviewer or a user study becomes available, a gate proves unmeasurable, or concurrency is needed and its effect on latency has been measured.

### ADR-043 - Honest partial revisions: three outcomes, grounded limitations, a bounded answer

- Date: 2026-10-15. Status: adopted (GEN-04).
- Context:
  - GEN-03 showed that the default model refused mixed revision instructions as "unsupported" instead of doing the drawable part (r16–r18). It also left `not_represented` empty (1/3 listed). A cubby revision that re-listed every part timed out at 150 s (r04).
  - GEN-03's answers streamed at about 24–50 characters per second. A full re-listing of a 30–40-part object (about 10,000 characters) therefore cannot finish within the timeout.
  - A colour change was also offered for a material property in development ("make it fireproof" became steel).
- Options considered:
  - keep the full parts list and raise the timeout (longer waits, same truncation risk);
  - cut parts silently at a limit (hides requested changes);
  - an answer made of changes only, plus deterministic outcome, listing and limit checks (chosen).
- Decision:
  - **Three outcomes.**
    - `proposal`, which is `partial` when anything requested is listed as not shown;
    - `unsupported`, when nothing is drawable, or when the proposal would misrepresent the object (a colour standing in for a property, a solid block for an open structure, no change at all);
    - `already_satisfied`, when the model already shows the request.

    Only a proposal can be applied. A refusal or a no-op leaves the scene and the catalog untouched, and no identical asset version is created.
  - **Changes, not a full list (prompt `gen-04.3`).** The answer names parts to `remove`, `change` (by id; every field restated), `add`, and `repeat` (one part copied in a row or grid by counts and step). Unmentioned parts are kept byte-identical.
    - An unknown id is an invalid answer and gets one retry.
    - The prompt asks for at most 24 entries; this is not enforced. The API enforces the generator's 40-part limit after expansion: a larger result is an explicit "would need N parts" limitation and nothing changes. Parts are never cut silently.
  - **Grounded limitations.** `not_represented` is filled for partial and unsupported outcomes.
    - A model entry is kept only when it shares a word with the user's instruction; the rest are dropped with a check note.
    - The instruction's own clauses for movement or operation, material properties, curved or slanted surfaces, holes or perforations, and textures or printing are added in the user's words when the model missed them.
    - The dialog lists them in plain language before Apply ("Apply the drawable part to this object").
  - **Openness.** When an "open" proposal keeps a part filling ≥ 50 % of the object, the model is told which part and given one more try. The second answer is judged as it is.
  - **Size.** The recorded size is kept unless the instruction asks for one, and parts are fitted back inside it. Evidence, photo links, immutable versions, one-step undo and the all-or-nothing `revise_asset` checks are unchanged.
  - **Contract.** `ModelRevisionProposalResult` gained `outcome: "already_satisfied"` and `partial`, and the API response changed. Project files did not change (a revision still records `not_represented`), so the project schema stays 0.7.0 with no migration.
- **GEN-03 criteria wording (noted, not edited).** The frozen docs/assist-evaluation/gen-03/criteria.md contains two status statements that conflict:
  - "If neither passes, the baseline stays, GEN-03 and M2 stay open";
  - "GEN-03 closes when this evaluation is complete for both models with failures categorised and the default justified".

  GEN-03 was closed under the second statement; the first statement's M2 consequence was kept. The file stays frozen, and later criteria state closure rules once (docs/assist-evaluation/gen-04/criteria.md).
- Rationale: on the four GEN-02 development cases (single runs, before and after), changes-only answers were 31 % shorter and waits 28 % shorter. Throughput did not change (about 32–35 characters per second), so length is the lever. Grounding keeps the list honest: the user's own clauses are always listed, and the model cannot add requests that were never made.
- Consequences:
  - On the fresh frozen set (docs/assist-evaluation/gen-04/report.md), outcomes rose to 18/20 and listing to 8/8, and every mixed request became a partial proposal.
  - Two gates still fail: timeouts 2/20, both while the computer running the script was asleep; a diagnostic retry answered in 85.6 and 55.8 s and the visual review mean 1.15 (added parts hidden, sunk into a same-material part, floating, or uncoloured). M2 stays open; GEN-05 bounds the total wait and checks that added parts are visible.
  - A grounded but wrong listing can still pass ("open-top" listed although drawn; "red cushion" said to be unavailable).
- Evidence: docs/assist-evaluation/gen-04/{criteria.md (frozen in `1f8d31b`), results/, scores.json, review.json, report.md}; development runs docs/assist-evaluation/gen-04.1–3.json; `services/api/tests/test_revisions.py`, `tests/test_gen04_evaluation.py`, `apps/web/e2e/improve.spec.ts`.
- Revisit when: GEN-05 bounds the wait and checks visibility; the generator gains openings, rotated parts or textures; or a faster model is offered.


### ADR-044 - Visible, time-bounded revisions: checks on additions, one shared retry, one budget

- Date: 2026-10-16. Status: adopted (GEN-05).
- Context: GEN-04's frozen run failed the visual gate (1.15). Added parts were present in the specification but could not be seen: cushions sunk into a seat of the same fabric, a stop button inside its box, a floating stack light, "slatted" sides drawn as single boards, a cable tray hidden under a top. GEN-04's retries could also take a fresh 150 s each (o04 ran 181 s), and the evaluation host slept during two requests unnoticed.
- Options considered:
  - trust the model's own description of what it drew (the failures above were all described as done);
  - a render-based check in the browser (the generator merges parts per material, so part identity is lost there);
  - deterministic geometric and rendered checks in the API on the parts a revision adds, a single shared corrected answer, and one budget (chosen).
- Decision:
  - **Checks on additions** (`assist/visibility.py`, exact membership for every approved shape):
    - hidden (≥ 95 % inside other opaque parts);
    - buried (≥ 40 % inside a part of the same material);
    - floating (no chain of touching parts to the floor or to a part kept from the current model; a part the instruction says hangs or is mounted is exempt);
    - too small (a requested part with no size given, under 4 % of the object's largest side and under 12 pixels);
    - unseen: under 15 % visible in a 200 × 150 z-buffer of the generator's own meshes from the review dialog's default camera. Only parts named by the user's words are judged; copies with the same label are judged together; the object's structure is judged against the rear-left view as well;
    - solid slats, when the user asked for slats or gaps.
  - **Colours.**
    - A colour named for a part is honoured (recoloured if the model did not) and never called unavailable.
    - A texture that cannot be shown ("red fabric") is listed, and the colour is drawn.
    - An unnamed addition that blends into an existing part gets an approved contrasting finish.
    - Glass stays transparent and never hides what is behind it.
  - **One shared retry, one budget.**
    - At most one corrected answer covers every problem: an unusable answer, not open, or additions that cannot be seen.
    - The whole request has one 150 s budget (the provider timeout setting). Each attempt's timeout is what is left, and a retry runs only if the remaining time covers at least the first attempt's duration (and 20 s).
    - If the corrected answer cannot be had, the first answer is shown with its problems. An answer is never accepted without its checks.
    - A problem at a place the user chose ("under the top") is reported but not retried.
  - **Problems before Apply.** The response gained `problems`. The dialog shows "Not clearly shown: …" and "Apply despite these problems". If the user applies anyway, the problems are kept on the version's change list. Project files are unchanged (schema 0.7.0).
  - **Cancellation.** The endpoint watches for the client disconnecting. Cancelling stops further provider calls; a call in flight ends within the budget, and its answer is discarded. The browser ignores any late answer.
  - **Run conditions in evaluations.**
    - The runner keeps the host awake (`caffeinate -i -w <pid>`).
    - It records the request timer and the real clock for every request.
    - A difference over 5 s is a run fault, reported separately; results are never reclassified.
- Rationale: GEN-04's invisible additions were all described by the model as done, so the check has to look at the geometry itself. The render uses the generator's own meshes and the dialog's own camera, so "seen" means what the user will see. One budget with one shared retry bounds the wait, and the dev and frozen runs stayed within it (longest 108.6 s).
- Consequences:
  - On the GEN-05 frozen set (docs/assist-evaluation/gen-05/report.md), every automatic revision gate passes: outcomes 21/22, change 19/20, size 20/20, open 2/2, listing 5/5, median 39.6 s, p95 105.7 s, timeouts 0/22, no run faults.
  - The visual review mean is 1.10, against the 1.2 gate:
    - transparent additions are practically invisible at the generator's 20–25 % opacity, and the pixel-based check does not see that;
    - requested small items stay small;
    - a colour phrase after "and" without its own verb was missed;
    - parts placed behind or under something are warned about, but not visible in the one preview.
  - The retry rarely removed a problem (6 of the 7 retried requests still listed one), so the before-Apply warnings carry most of the honesty. M2 stays open, and GEN-06 is the corrective task.
- Evidence:
  - docs/assist-evaluation/gen-05/{criteria.md (frozen in `7e7c473`), results/, scores.json, review.json, report.md, renders/};
  - the pilot: docs/assist-evaluation/gen-05-pilot/;
  - development: docs/assist-evaluation/gen-05.1.json;
  - tests: `services/api/tests/test_visibility.py`, `tests/test_gen05_evaluation.py`, `apps/web/e2e/improve.spec.ts`.
- Revisit when: GEN-06 makes transparent parts recognisable and enforces visible sizes, a second preview angle is added, or a faster model is offered.

### ADR-045 - Recognisable additions and a beginner-friendly review: viewer edges, composited checks, bounded estimates

- Date: 2026-10-16. Status: adopted (GEN-06, GEN-07).
- Context:
  - GEN-05's frozen visual review (1.10) failed because glass and clear-plastic additions were invisible, small requested items stayed small, one elliptical colour phrase was missed, and parts placed behind or under something could not be seen in the single preview.
  - The checks counted raw pixels, so they never noticed the glass problem.
  - The generator writes GLB files whose sha256 is recorded in every saved project.
- Options considered:
  - change the generator's transparent materials (new GLB bytes, a new generator version, every new hash different);
  - draw readable edges and composite transparency in the viewer, with the checks judging the composited picture (chosen);
  - more preview angles behind an orbit control only (left to the user to find).
- Decision:
  - **Transparency in the viewer, not the file.**
    - Glass and clear plastic get mid-tone blue edges (`#3a8fd6`, readable on light and dark backgrounds) and stop writing depth.
    - Coincident faces resolve deterministically: a later part wins, with a capped polygon offset.
    - Both happen after a model is verified, in the dialog preview and the placed scene alike. GLB bytes and every recorded sha256 are unchanged, so there is no generator version bump.
  - **Versioned rebuilds.** `build_model` takes the generator version an asset records and refuses versions this build cannot reproduce; rebuilds pass the asset's own version. A future output change adds a version and keeps the old path.
  - **Composited checks.** A transparent addition counts as shown from the mean of two shares: edges that show against what is actually behind them, and a surface that shifts its background noticeably (on the dialog's dark ground). Raw pixels never count as "clearly shown". Parts in a colour the user named that blend in are reported.
  - **Bounded estimates, never measurements.**
    - A requested small part with no size given is enlarged about its contact face to 5 % of the object's largest side, at most 12 cm and 3 times its size, only inside the recorded size, and listed as an estimate.
    - A size the user states is never touched. Pieces of one requested assembly are left as drawn.
    - The object's recorded dimensions never change here; a size change still needs the existing confirmation.
  - **Contact.** Two parts touch within 60 % of the thinner part's smallest side, or 1 cm plus 0.6 % of the object's largest side if that is more, and at most 3 cm.
  - **Colour clauses.**
    - The verb carries across "and", whichever clause comes first.
    - "red and white" gives one part two colours: one is drawn, the other listed.
    - "dark blue fabric" draws blue and lists only the texture.
    - Colour words such as "colour" or "finish" never name a part.
  - **Review (GEN-07).**
    - Three views (standard, from behind, low), one click each, shared by both previews. The dialog opens on the view the API judged to show the requested additions best, with "Back to the standard view".
    - Parts a warning names are outlined in the preview only.
    - Estimates are listed apart from measurements, and unresolved problems are repeated beside "Apply despite these problems".
    - The response carries structured problems, adjustments and the first view (response-only; project schema unchanged).
- Rationale: the change to what users see belongs to the viewer, where it costs no reproducibility. The checks must judge the same picture the user gets. Estimates must say they are estimates.
- Consequences:
  - On a light background (the GEN-05 fixed camera) glass still reads faintly; the dialog is dark.
  - Highlights and edges are never written to a file or the project.
  - The inspection harness (`e2e/inspect-revisions.spec.ts`) and the review journeys (`e2e/review.spec.ts`) cover old, photo-made and described models.
- Evidence:
  - `services/api/tests/test_recognisable.py`: 33 recorded GEN-04/05 models rebuild byte-identically; a project saved before GEN-06 validates and rebuilds;
  - `test_visibility.py`;
  - Vitest `views.test.ts`;
  - `e2e/review.spec.ts`;
  - docs/gen-07/inspect/*.jpg.
- Revisit when: the generator gains real transparent-material output (then add a generator version), or a user study shows the views or estimates mislead.
- **Outcome (GEN-08, 2026-10-16).** On the fresh frozen set (`51d052d`), every pre-registered revision gate passes on the default model (visual mean in the dialog 1.24 against 1.2), so M2 closes.
  - The fixed GEN-05 camera, a different viewing method, scored 1.08 for context.
  - Two results look done but are not, with no warning: a glass door over a solid body, and kept parts left floating. A transparent part's edge passing the check does not guarantee a person notices it on a light surface. These are GEN-09.

### ADR-046 - Misleading revisions: kept parts judged too, warned not repaired, one part at a time

- Date: 2026-10-16. Status: adopted (GEN-09).
- Context:
  - GEN-08 passed narrowly. Two results looked done but were not, and carried no warning: a glass door over a body that was still solid (t2), and kept parts left floating inside an open frame (p3).
  - The checks judged only added parts.
  - The viewer's glass edges were 1 px and weak on light surfaces. For rounded glass they were missing altogether, because the 30° edge threshold missed the bevels. The composited check assumed every outline was drawn.
  - Beginners could change colours and overall sizes, but fixing one part needed the parts list.
- Options considered:
  - repair automatically (delete the solid body; drop floating parts);
  - warn plainly, and give a one-part control to fix it (chosen);
  - a further AI call to judge the proposal (more waiting, and not deterministic).
- Decision:
  - **Kept parts are judged too.**
    - Glass in front of a kept solid body is warned about when the request implies seeing in. The body is never removed: it may be structural.
    - Kept parts that lose their support are warned about.
    - Unmentioned parts are compared by stable id, and each change is said in words. Fitting changes are collected into one sentence; a re-centring is said once, and a requested resize explained once as proportional.
    - All of these are deterministic. They feed the existing single shared retry, so there are no new provider calls.
  - **Edges readable everywhere.** A dark outline under a light core, in screen pixels, at a 12° crease angle, so rounded glass is outlined and 32-sided cylinders are not striped. Still display only: no generator version change, and the recorded hashes are unchanged.
  - **One part at a time in the dialog.**
    - Remove, move or resize one part in metres, with exact change lines and a live preview.
    - When the overall size follows a part change, it is confirmed beside Apply before it is recorded as entered. Unchanged axes keep their evidence.
    - Earlier warnings stay, marked as found before your own changes; they are not re-checked.
  - **Independent review is not simulated.** A blinded packet is prepared; until a real independent person scores it, the criterion stays open and the GEN-08 visual pass rests on the assistant's review.
- Consequences:
  - More warnings appear before Apply: the GEN-08 o3 answer now shows floating legs and the unasked changes the proposal made.
  - Warnings can be stale after hand edits; re-checking the edited draft would need a check-only endpoint (not built).
  - The GEN-08 frozen results are not rescored; its t2 and p3 answers are development regressions only.

### ADR-047 - Photo corrections are kept, not overwritten; occlusion is explicit; photo overlap is not 3D overlap

- Date: 2026-10-16. Status: adopted (IMG-02; contract 0.8.0).
- Context:
  - IMG-01's photo review could accept, reject, re-box and add objects.
  - Its known failures were group outlines ("table with chairs"), objects partly hidden behind others, and hidden depths that are guesses (about half the true depth for deep machines).
  - The record kept only accepted or rejected, so a correction such as "this outline was two objects" or "this is the same chair twice" could not be stated or reproduced.
- Options considered:
  - edit observations in place (the original outline lost);
  - keep every observation and record corrections as links and words (chosen);
  - re-ask the vision model (another call, and not deterministic).
- Decision:
  - **Corrections are links, never deletions.** A split outline stays as `split`, and each piece names it in `derived_from`. A duplicate stays as `merged`, with `replaced_by` naming the kept one. Every correction is also written in words (`corrections`). The contract checks the links across records.
  - **Visibility is recorded per object**: visible, partly visible, or added (not seen; only the user can add one). Older files get `not_recorded`, which claims nothing.
    - Sizes on a partly visible object are estimates that may be larger.
    - Every size of an added object is an estimate from the outline the user drew, never an observation.
  - **Two overlaps, kept apart.** Outlines that overlap in the photo are how the camera saw the objects (the one behind is partly hidden). Footprints that overlap on the floor plan are a placement question. Seats under tables are listed as probably fine; others say what usually causes it (a guessed side). No clearance or fitness is checked.
  - **A typed position replaces the photo's.** The size estimate follows from that distance (the outline is fixed), and the photo's own position is kept on record. An object whose base is hidden near the horizon can be metres off from the photo alone.
  - **Older files keep their recovery.** Rebuilding missing generated models accepts an older contract and upgrades it first (lossless). An upgrade refused only for missing models or a missing photo offers the same recovery as a current file.
- Consequences:
  - Saved photo projects are larger (pieces and kept observations), and the observation limit rises to 80.
  - The classroom's tables still come as group outlines from the model; the user splits them.
  - Hidden depths are still estimates; IMG-03 measures accuracy on held-out photos.

### ADR-048 - Image-import accuracy: real measured photos are the only evidence; synthetic renders verify the method

- Date: 2026-10-16. Status: adopted (IMG-03).
- Context:
  - IMG-03 must report precision, recall, scale error and correction effort on held-out, permissioned photos.
  - The permitted photos have no independent measurements: assumed rug and table sizes; unknown positions.
  - The factory render was used in development.
  - No real site has been photographed and measured.
- Options considered:
  - score the existing photos against sizes inferred from them (circular);
  - wait for real photos (idle);
  - build the evaluation now and verify it on known-geometry renders kept as a separate stratum, with a capture protocol for real sites (chosen).
- Decision:
  - **Two strata, never pooled.**
    - Real photos are measured on site, each measurement with a method and tolerance.
    - Renders are exact.
    - The validator refuses typical or photo-derived values. An unpublishable real photo stays local (outside the repository); only its sha256 and anonymised measurements are kept.
  - **Rules frozen before any held-out call.** Detection is matched by outline (IoU ≥ 0.5), with group, duplicate and ignored rules. Three worlds are reported apart: the initial proposal, an idealised photo-only review, and a manual baseline. Errors are in metres in the rectangle's own frame, through the app's code, and a browser cross-check confirms the scored world is the dialog's.
  - **Effort is counted and estimated, never timed** without participants: action counts, and a keystroke-level estimate with declared constants.
  - **IMG-03 and M3 close only on real measured photos** (≥ 6 photos, ≥ 3 scene types, ≥ 40 counted objects) meeting the thresholds.
  - **The default vision model stays `qwen3-vl-32b-instruct`.**
    - `llama4-scout-17b` accepts the same input and schema but localises poorly (3/34).
    - `glm-4-5v` gave no usable answer.
- Consequences:
  - The synthetic result shows the method's limits on exact geometry: recall 0.66, hidden bases, camera-facing orientation, and the split-piece size guess.
  - Product fixes are named, not made, because the held-out set is now used. A fix needs new photos to be judged.
  - The next evidence must come from a real, permissioned, measured site.

### ADR-049 - Product direction locked: "Upload a plan. Walk through it. Change it. See what happens."

- Date: 2026-10-16. Status: adopted (user-approved product direction). Supersedes the ordering and framing of M4 in ADR-030 (drawing import); ADR-030's other decisions stand.
- **Context.**
  - The world model, guided creation (M2) and one-photo import (IMG-01/02) exist.
  - IMG-03 showed that real, measured photos are needed to claim photo-import accuracy, and none exist.
  - The user set the product direction for what comes next.
- **Positioning.**
  - Existing factory products already connect 2D layouts with 3D assets and simulation [S01, S14], so the claim is **not** that 2D-to-3D is new.
  - The distinction is a simple, progressively enriched review experience: one world that a non-CAD manager can upload, walk through, change and compare, and that improves as better evidence arrives.
- **Decision.**
  1. **One world, progressively enriched.** What the user supplies improves the same world; enrichment never resets placement or edits.

     | Supplied | What improves |
     | --- | --- |
     | One floor plan or rough drawing | Floor, equipment footprints, approximate 3D models, walk and top views. Height and appearance are provisional when absent. |
     | A machine photo or 3D model | The matching placeholder gains a better appearance and, where the file supports it, checked geometry. Placement and edits stay intact. |
     | A supplier drawing or specification | Confirmed dimensions, door swing, access area and other documented values replace estimates. |
     | Process information | Cycle times, routes and capacities unlock a production scenario. |
     | Engineering data | Load or motion analyses become possible only when their required inputs and validated models exist. |

  2. **The evidence rule.**
     - The agent never turns a plausible value into a verified one.
     - A clearly marked provisional height may be used so that the first world can be viewed. It is replaced when better evidence arrives.
     - A check that depends on it asks for confirmation, or returns **"height needed"**: a result state of its own, like "input missing". It never passes on a provisional value.
  3. **A small interaction.**
     - The main screen has three actions: **Upload**, **Change something**, **Play or compare**.
     - After upload, the emerging plan is shown at once while the 3D scene builds.
     - The app asks a question only when the answer changes what the user is trying to do: one scale measurement for a unitless drawing, or a machine's height before an overhead-clearance check.
     - No long form.
  4. **One orchestrating agent with bounded tools**, not many visible agents.
     - It identifies files, extracts layout candidates, matches equipment, builds a draft world and proposes changes.
     - Geometry calculations and checks stay deterministic.
     - The user sees a simple result; the source and uncertainty of every value stay available to an engineer.
  5. **"Play" has clear, separate levels.**
     - *Immediately:* explore, move objects, compare layouts, and show geometric conflicts from the dimensions available.
     - *With process data:* material flow, queues, throughput.
     - *With engineering data and validated models:* defined motion, loads or other physical effects.

     A visually realistic world helps review; it does not establish real machine behaviour. Validation and uncertainty are part of credibility [S09].
  6. **First release and growth loop.**
     - The first polished use case is **one production area from one drawing**.
     - Rough images are accepted through a review path that shows lower confidence.
     - Richer formats are supported incrementally; no format or simulation is a launch prerequisite beyond the first.
     - The shareable result is a **private, view-only, interactive before/after scenario**. A manager sends it to an engineer, who can name the missing measurements a decision needs. That is the adoption loop to test.
     - Company drawings are never shared publicly or automatically.
  7. **Targets to measure, never claimed as current performance:**
     - onboarding from one file;
     - a useful first view without a long form;
     - a non-CAD user making and sharing a layout change within minutes.
  8. **M4 is reframed** as **first world from one file → review → enrich the existing world**, and its adapters are built in that order (BACKLOG M4; MILESTONES).
     - The journey's checks ("does the pallet route still fit?") come from GEO-01/02. They follow the review step, before the enrichment that reruns them.
     - DWG, named in the journey, needs a conversion route whose licensing is decided first (IMP-04). Until then the app asks for a DXF export.
  9. **IMG-03's six measured photos are a research evaluation requirement** for claiming photo-import accuracy, **not something a customer must supply to start**. IMG-03 stays open and does not gate M4.
- **Flagship journey** (to build towards; nothing here is current performance):
  1. Upload `Packaging-Line.dwg`; get a walkable draft with named equipment and provisional models.
  2. Move the filling cell and ask "Does the pallet route still fit?"; see the route and the exact dimensions used.
  3. Add `Filling-Cell.step`; the existing cell becomes more detailed without resetting its position or edits.
  4. Add its specification; the height and service area become sourced values; rerun the checks.
- **Consequences.**
  - **New M4 issues:**
    - ONB-01: first world from one file;
    - AGT-01: orchestrating agent;
    - UX-01: three-action main screen;
    - ENR-01/02: enrichment;
    - IMP-04: DWG route;
    - SHR-01: private view-only scenario;
    - UX-02: measured onboarding targets.

    IMP-01..03 keep their IDs, re-scoped to this order.
  - The M4 estimate (32-48 h, DXF import only) no longer describes the scope. It is re-estimated after ONB-01.
  - Implementation starts from a separate prompt; this decision changes records only.
- **Revisit when:**
  - the first one-file journey shows that a useful first view needs more than one question;
  - measured onboarding misses its targets;
  - the user changes the priority.

