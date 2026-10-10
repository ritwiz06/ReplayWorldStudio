# Project state

## How to use this file

This is the canonical live project state. It was reconciled against the actual repository on 2026-10-09; keep it current at the end of every session. Source code and recorded checks establish what exists. This file indexes that evidence and does not prove it.

If a maintained project-status file is later created elsewhere, put its exact relative path here and make that file canonical; do not duplicate changing progress in both places.

## Canonical memory locations

- Live project state: this file.
- Decisions: prompts/DECISIONS.md.
- Session history: prompts/SESSION_LOG.md.
- Backlog status: prompts/BACKLOG.md.
- Environment and toolchain record: docs/environment.md.
- Contract conventions: docs/contracts.md. Learning notes: docs/learning/.

## Stable context

- Product: AI-assisted platform for realistic, editable worlds from drawings, photos, videos and specifications.
- First application: factory production-area planning (one small area, ~5-20 equipment instances, one process family).
- Broad platform scope (photo/video, physics, engineering, aging, teams) remains on the roadmap; see EXPANSION_ROADMAP.md.
- Previous HTML concept and planning PDF: not present in this repository; not required.

## Current state (last verified 2026-10-10, America/Phoenix)

| Field | Value |
| --- | --- |
| Active milestone | M1 in progress: WRL-01, WRL-02 and WRL-03 done (2026-10-10); next issue WRL-04. |
| Git / branch / commit | Branch `main`, tracking `origin` = https://github.com/ritwiz06/ReplayWorldStudio. M0 CI gate closed at `28ebce7`; WRL-01 implemented in `a3b1328`; WRL-02 in `9571b49`; WRL-03 in `5cc18c3`. |
| Implemented capabilities | Contracts **v0.4.0** (Pydantic source → JSON Schema → TS types + Ajv): per-axis evidence, catalog assets with source and rights, glTF visuals with declared units, axes, origin, bounds, hash and fit, walkway and keep-clear kinds, a scene edit log that keeps replaced values and evidence, chained migrations from 0.1.0/0.2.0/0.3.0. FastAPI: health, fixtures (`industrial-demo`, `foundation`), catalog file serving confined to `RWS_CATALOG_DIR`, project validation with edit-log, model-file and hash checks, and an upgrade endpoint that returns the migrated project and notes for review. Web: industrial demo (default) with 4 original deterministic glTF models verified before drawing and labelled fallbacks on failure; orbit, top and walk cameras; PBR lighting and shadows; floor markings; inspector with evidence, rights, model file, fit and state; scene picker; file check. **Editing (WRL-03):** one typed command engine with revision checks and reversible snapshots; numeric position/rotation/size fields (m, °); move, rotate and resize handles (one command per drag); catalog placement with a marker; duplicate; remove; undo/redo with shortcuts; per-object and scene edit records; save as JSON download; reopen; unsaved-change guard; reviewed upgrades of older files. Foundation fixture, edited sample, invalid samples and legacy sample kept. |
| Not implemented | Measured frame rate (WRL-04); DXF/PDF import, spatial clearance/collision checks (edits are deliberately unchecked), simulation, AI; server-side project storage. |
| Latest passing checks | Local, WRL-03 working tree (2026-10-10): `pnpm check` exit 0 (contracts, assets and fixtures up to date; ESLint, Ruff, tsc, mypy clean; Vitest 10 + 93; pytest 196; build) and `pnpm test:e2e` 11 passed. GitHub Actions run https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38034359681 on `5cc18c3` (2026-10-10 UTC): success (contracts, byte-identical model and fixture rebuilds, lint, types, Vitest 10 + 93, pytest 196, build). Playwright is not part of CI. |
| CI history | Run 38021553918 (`511b04e`) failed: `astral-sh/setup-uv@v10` has no floating major tag (fixed by the user in `f173510`). Run 38022020880 (`f173510`) failed: pnpm 11.12.0 is a broken upstream release. Run 38022453114 (`28ebce7`, pnpm pinned to 11.11.0) passed. Runs 38022707956 (`d26f00f`, records), 38023211602 (`a3b1328`, WRL-01), 38023333905 (`132437e`, records) 38025828571 (`9571b49`, WRL-02) and 38034359681 (`5cc18c3`, WRL-03) passed. |
| Run commands | Repo root: `uv sync --locked`, `pnpm install --frozen-lockfile`, `pnpm dev:api`, `pnpm dev:web`, `pnpm check`, `pnpm test:e2e:install` (once), `pnpm test:e2e`; upgrade an old file with `uv run python -m replay_world_contracts.migrate OLD.json -o NEW.json`; rebuild models and demo with `pnpm assets:build && pnpm fixtures:build`; regenerate the edited sample with `pnpm --filter @replay-world/web exec vitest run -u src/editing/sample.test.ts`. See README.md. |
| Known blockers | None. |
| Known limitations | Models are illustrative procedural geometry (no textures, not vendor-accurate). Project JSON with glTF visuals needs the same catalog library to open elsewhere (no export bundle yet). Frame rate is not measured, and headless tests render WebGL in software (Playwright runs with 2 workers and 15 s assertion timeouts). Web bundle 1.42 MB (397 kB gzip). Rebuilding models changes hashes (pinned to three r186). Dimensions are always known values (ADR-015). The license check covers syntax only. **Editing:** no clearance, overlap or feasibility checks (M3); edit records have no author or time; undo history is per session (200 steps) and not saved; the revision counts transitions, so undoing to the loaded state still counts as unsaved; the command engine runs in the browser only (the API validates whole documents); the rotate handle turns about Y only (X/Z rotation is numeric) and hides when X/Z are non-zero; resize handles are symmetric (no single-face anchoring); a distant object's handles can crowd, so frame it first; no renaming, parameter or catalog editing; saving is a browser download (no in-place save). The browser cannot check cross-record rules; the API does. R3F logs a `THREE.Clock` deprecation. CI does not run Playwright. `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19. |
| Next issue | WRL-04 - profile visual quality and performance (P1): record reference hardware, scene complexity and measured FPS for the demo, including edited scenes with added instances, and resolve major visual defects. |

## Milestone status

| Gate | Status | Evidence |
| --- | --- | --- |
| M0 | Complete | SET-01/02/03 evidence in BACKLOG.md. CI run https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38022453114 passed on `28ebce7`. |
| M1 | In progress | WRL-01 done (`a3b1328`); WRL-02 done (`9571b49`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38025828571); WRL-03 done (`5cc18c3`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38034359681). WRL-04 (P1) remains. |
| M2 | Not started | - |
| M3 | Not started | - |
| M4 | Not started | - |
| M5 | Not started | - |
| M6 | Not started | - |

## Information still to confirm when relevant

- Available weekly time; permissioned sample drawing; machine dimensions and operating data; model provider and data-routing preference; repository license and visibility; engineering reviewer.
- Reference workstation recorded in docs/environment.md (Apple M3 Pro, 18 GiB, macOS 26.6.2). Graphics performance has not been measured yet (WRL-04).

## End-of-session update

Record active gate, completed issue IDs, remaining items, exact verification evidence, changed decisions, reproduction commands and the next executable action. An unchecked assumption must remain explicit.
