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
