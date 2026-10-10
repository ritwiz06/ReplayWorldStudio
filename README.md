# Replay World Studio

An AI-assisted platform for turning drawings, photos, videos and specifications into realistic, editable worlds you can walk through, change and simulate. **Factory production-area planning is the first application**; the world contracts are kept generic so later applications can reuse them.

> **Status: Milestone M0 (foundation).** This repository currently contains a typed web/API foundation and a synthetic test scene. It is **not** yet a factory planner, CAD importer, simulator or AI assistant. See [What exists today](#what-exists-today).

## What exists today

| Area | Implemented (M0) | Planned (not built) |
| --- | --- | --- |
| Contracts | Versioned Project / Scene / Object / Parameter models in SI units, right-handed Y-up world, explicit source-to-world transform, provenance on every value, explicit *unknown* parameters | Catalog assets, process graph, scenarios, runs, findings (M1–M4) |
| API | `GET /health`, `GET /api/v1/fixtures/foundation`, `POST /api/v1/projects/validate`; loopback-only; CORS limited to dev origins | Project storage, commands/undo, import and simulation jobs |
| Web | Editor shell, 3D viewport (orbit), object list, evidence inspector, API health, scene-file check | Realistic assets, walk/top views, editing, drawing overlay, playback |
| Import | — | DXF (M2), calibrated PDF/PNG reference (M2) |
| Checks | Spatial: none. Operational: none. | Footprint/clearance/route checks (M3), discrete-event production (M4) |
| AI | — (no model, no mock) | Typed command proposals with grounding (M5) |

The scene you see is the **foundation fixture**: labelled placeholder boxes that prove units, coordinates and schema handling. Its values are synthetic and are not engineering data.

## Prerequisites

| Tool | Version used | Notes |
| --- | --- | --- |
| Node.js | 22.23.1 (`.node-version`; ≥ 22.12 required by Vite 8 / Vitest 5) | |
| pnpm | 11.11.0 (pinned via `packageManager`) | Any pnpm ≥ 10 switches to the pinned version automatically; `corepack enable` also works. 11.12.0 is a broken upstream release - do not use it. |
| uv | 0.12.18 (≥ 0.12 required) | Manages Python and the virtual environment |
| Python | 3.14 (`.python-version`) | uv downloads it if missing |
| Chromium for Playwright | build 1248 (headless shell) | Only for the browser smoke test |

No GPU, Docker, cloud account or API key is needed.

## Setup

Run from the repository root:

```bash
uv sync --locked                 # Python 3.14 venv in .venv with locked dependencies
pnpm install --frozen-lockfile   # Node workspace with locked dependencies
pnpm test:e2e:install           # once: Playwright's pinned headless Chromium (~200 MB)
cp .env.example .env             # optional; defaults work without it
```

## Run

Two terminals, both from the repository root:

```bash
pnpm dev:api    # FastAPI on http://127.0.0.1:8000 (auto-reload)
pnpm dev:web    # Vite on   http://127.0.0.1:5173
```

Open <http://127.0.0.1:5173>. You should see **API online**, **Scene loaded · 6 objects**, the foundation-fixture banner, and the units bar (`m · s · kg · rad`, right-handed, +Y up). Select an object to see its dimensions and the evidence behind each value.

To see input rejection, click **Open scene file…** and choose `fixtures/invalid/negative-dimension.json`. The API rejects it, names `/scene/objects/4/dimensions/width_m`, and the current scene stays loaded.

API docs (OpenAPI) are served at <http://127.0.0.1:8000/docs> while the API runs.

## Checks

| Command (repo root) | What it verifies |
| --- | --- |
| `pnpm contracts:check` | Committed JSON Schema and TypeScript types match the Pydantic models |
| `pnpm lint` | ESLint (TS/React) and Ruff (lint + format) |
| `pnpm typecheck` | `tsc -b` for every TS package, and `mypy --strict` |
| `pnpm test` | Vitest (contracts, API client, renderer placement) and pytest (contracts, transforms, API) |
| `pnpm build` | Production build of the web app |
| `pnpm check` | All of the above, in that order (what CI runs) |
| `pnpm test:e2e` | Playwright: starts its own API (port 8010) and web server (port 5180), then runs the browser smoke path |

After changing a model in `packages/contracts/python/replay_world_contracts/models.py`, run `pnpm contracts:generate` and commit the regenerated files.

## Repository layout

```
apps/web/              React + TypeScript + Vite editor; React Three Fiber viewport; Playwright e2e
services/api/          FastAPI service (replay_world_api)
packages/contracts/    Contract source of truth (Pydantic) + generated JSON Schema and TS types + Ajv validators
fixtures/              Synthetic scenes and invalid samples used by every test layer
assets/catalog/        Future licensed equipment assets and metadata (empty in M0)
scripts/               Contract generation / drift check
docs/                  Environment record, contract conventions, learning notes
prompts/               Project context, milestones, backlog, decisions and session log
.github/workflows/     CI (lint, types, contracts, tests, build)
```

## Conventions that matter

- **Units:** metres, seconds, kilograms, radians internally. Display formatting is a UI concern.
- **World frame:** right-handed, +Y up, floor in the X-Z plane (identical to Three.js, so no conversion is applied when rendering).
- **Object placement:** `position_m` is the bottom-centre of the object's bounding box; `dimensions` are measured along the object's local axes before rotation.
- **Evidence:** every known value carries an origin (`measured`, `user_supplied`, `supplier`, `inferred`, `default`) and a review status. Unknown values are `{"state": "unknown", "reason": ...}` and never carry a substitute number.
- **One schema source:** Pydantic models → JSON Schema → TypeScript types and browser validation. Details in [docs/contracts.md](docs/contracts.md).

## Data care

Keep credentials, customer drawings, model weights and run outputs out of commits (see `.gitignore`). Use synthetic or permissioned inputs in `fixtures/`. The API binds to `127.0.0.1` by default; do not expose it without a deliberate decision. Uploaded document content is data, never instructions.

## Project records

- Current state: [prompts/PROJECT_STATE.md](prompts/PROJECT_STATE.md)
- Backlog: [prompts/BACKLOG.md](prompts/BACKLOG.md) · Milestones: [prompts/MILESTONES.md](prompts/MILESTONES.md)
- Decisions: [prompts/DECISIONS.md](prompts/DECISIONS.md) · Session log: [prompts/SESSION_LOG.md](prompts/SESSION_LOG.md)
- Environment record: [docs/environment.md](docs/environment.md)

No license has been chosen yet; do not assume one.
