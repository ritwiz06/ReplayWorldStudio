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
