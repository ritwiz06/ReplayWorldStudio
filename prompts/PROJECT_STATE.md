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
| Active milestone | **M1 complete** (WRL-01 to WRL-04, 2026-10-10). Next: M2, starting with IMP-01. |
| Git / branch / commit | Branch `main`, tracking `origin` = https://github.com/ritwiz06/ReplayWorldStudio. M0 CI gate closed at `28ebce7`; WRL-01 implemented in `a3b1328`; WRL-02 in `9571b49`; WRL-03 in `5cc18c3`; WRL-04 (M1 closed) in `0a929ea`. |
| Implemented capabilities | Contracts **v0.4.0** (Pydantic source → JSON Schema → TS types + Ajv): per-axis evidence, catalog assets with source and rights, glTF visuals with declared units, axes, origin, bounds, hash and fit, walkway and keep-clear kinds, a scene edit log that keeps replaced values and evidence, chained migrations from 0.1.0/0.2.0/0.3.0. FastAPI: health, fixtures (`industrial-demo`, `foundation`), catalog file serving confined to `RWS_CATALOG_DIR`, project validation with edit-log, model-file and hash checks, and an upgrade endpoint that returns the migrated project and notes for review. Web: industrial demo (default) with 4 original deterministic glTF models verified before drawing and labelled fallbacks on failure; orbit, top and walk cameras; PBR lighting and shadows; floor markings; inspector with evidence, rights, model file, fit and state; scene picker; file check. **Editing (WRL-03):** one typed command engine with revision checks and reversible snapshots; numeric position/rotation/size fields (m, °); move, rotate and resize handles (one command per drag); catalog placement with a marker; duplicate; remove; undo/redo with shortcuts; per-object and scene edit records; save as JSON download; reopen; unsaved-change guard; reviewed upgrades of older files. Foundation fixture, edited sample, invalid samples and legacy sample kept. **Rendering (WRL-04):** on demand (no idle cost), stable shaders across views, per-document camera memory, responsive layout down to 1280 px, stretched-model badge; reproducible GPU benchmark `pnpm bench` and visual review `pnpm review` (docs/performance.md). |
| Not implemented | DXF/PDF import, spatial clearance/collision checks (edits are deliberately unchecked), simulation, AI; server-side project storage. |
| Latest passing checks | Local, WRL-04 working tree (2026-10-10): `pnpm check` exit 0 (contracts, assets and fixtures up to date; ESLint, Ruff, tsc, mypy clean; Vitest 10 + 93; pytest 198; build), `pnpm test:e2e` 15 passed, `pnpm test:e2e:smoke` 4 passed. Benchmark: 47 runs per build on the reference machine (docs/performance.md). GitHub Actions https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38040882335 on `0a929ea` (2026-10-10 UTC): success for both jobs: the main job (contracts, byte-identical rebuilds, lint, types, Vitest 10 + 93, pytest 198, build) and browser smoke (4 Playwright tests in software WebGL, 1.1 min). |
| CI history | Run 38021553918 (`511b04e`) failed: `astral-sh/setup-uv@v10` has no floating major tag (fixed by the user in `f173510`). Run 38022020880 (`f173510`) failed: pnpm 11.12.0 is a broken upstream release. Run 38022453114 (`28ebce7`, pnpm pinned to 11.11.0) passed. Runs 38022707956 (`d26f00f`, records), 38023211602 (`a3b1328`, WRL-01), 38023333905 (`132437e`, records) 38025828571 (`9571b49`, WRL-02) and 38034359681 (`5cc18c3`, WRL-03), 38034451537 (`26943d0`, records) and 38040882335 (`0a929ea`, WRL-04; first run with the browser smoke job) passed. |
| Run commands | Repo root: `uv sync --locked`, `pnpm install --frozen-lockfile`, `pnpm dev:api`, `pnpm dev:web`, `pnpm check`, `pnpm test:e2e:install` (once), `pnpm test:e2e`, `pnpm test:e2e:smoke`; rendering benchmark `pnpm bench` and screenshots `pnpm review` (installed Google Chrome, opens a window); upgrade an old file with `uv run python -m replay_world_contracts.migrate OLD.json -o NEW.json`; rebuild models and demo with `pnpm assets:build && pnpm fixtures:build`; regenerate the edited sample with `pnpm --filter @replay-world/web exec vitest run -u src/editing/sample.test.ts`. See README.md. |
| Known blockers | None. |
| Known limitations | Models are illustrative procedural geometry (no textures, not vendor-accurate). Project JSON with glTF visuals needs the same catalog library to open elsewhere (no export bundle yet). Frame rate is measured only on the reference MacBook Pro in Chrome (other GPUs, browsers and full-screen 3024 × 1964 are unmeasured; GPU time per frame is not exposed); the scale limit is about 260–300 objects for 120 Hz and about 1,000 for 40–60 Hz (draw-call bound, no instancing); the plan view samples a hidden shadow map (+0.6 ms per frame at 260 objects, vsync off); at 510 objects the after build orbits at about 72 vs about 90 frames/s (unprofiled). Headless tests render WebGL in software (Playwright runs with 2 workers and 15 s assertion timeouts). Web bundle 1.49 MB JS + CSS (412 kB gzip; one 58–80 ms parse task on load). Rebuilding models changes hashes (pinned to three r186). Dimensions are always known values (ADR-015). The license check covers syntax only. **Editing:** no clearance, overlap or feasibility checks (M3); edit records have no author or time; undo history is per session (200 steps) and not saved; the revision counts transitions, so undoing to the loaded state still counts as unsaved; the command engine runs in the browser only (the API validates whole documents); the rotate handle turns about Y only (X/Z rotation is numeric) and hides when X/Z are non-zero; resize handles are symmetric (no single-face anchoring); a distant object's handles can crowd, so frame it first; no renaming, parameter or catalog editing; saving is a browser download (no in-place save). The browser cannot check cross-record rules; the API does. R3F logs a `THREE.Clock` deprecation. CI runs only the 4 `@smoke` Playwright tests (software WebGL); the full suite is local. `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19. |
| Next issue | IMP-01 - DXF geometry adapter (M2, P0): parse a declared entity subset with units and nested-block scale, warn on unsupported data and unit conflicts, using synthetic DXF fixtures. (IMP-02 then maps equipment onto the M1 editor; IMP-03 adds a calibrated PDF/PNG reference.) |

## Milestone status

| Gate | Status | Evidence |
| --- | --- | --- |
| M0 | Complete | SET-01/02/03 evidence in BACKLOG.md. CI run https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38022453114 passed on `28ebce7`. |
| M1 | **Complete** (2026-10-10) | Exit evidence per MILESTONES.md: coherent industrial scene and catalog metadata (WRL-01 `a3b1328`, WRL-02 `9571b49`); reliable editing and save/reload (WRL-03 `5cc18c3`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38034359681); graphics benchmark with the M1 target met (WRL-04, docs/performance.md); learning note docs/learning/M1-world-and-assets.md. |
| M2 | Not started | - |
| M3 | Not started | - |
| M4 | Not started | - |
| M5 | Not started | - |
| M6 | Not started | - |

## Information still to confirm when relevant

- Available weekly time; permissioned sample drawing; machine dimensions and operating data; model provider and data-routing preference; repository license and visibility; engineering reviewer.
- Reference workstation and measurement setup recorded in docs/environment.md (Apple M3 Pro, 18 GiB, macOS 26.6.2, Chrome 154, 120 Hz). Performance on other machines and browsers is unmeasured.

## End-of-session update

Record active gate, completed issue IDs, remaining items, exact verification evidence, changed decisions, reproduction commands and the next executable action. An unchecked assumption must remain explicit.
