# Replay World Studio

An AI-assisted platform for turning drawings, photos, videos and specifications into realistic, editable worlds you can walk through, change and simulate. **Factory production-area planning is the first application**; the world contracts are kept generic so later applications can reuse them.

> **Status: M1 complete; M2 (guided creation) started with GEN-01.** The app opens with a short guided start: **explore the demo**, **describe an object**, or **open a project**. You can describe a missing object in ordinary words ("a guarded conveyor about 2.2 m long with a control screen"). You get a reviewed proposal, an original provisional 3D model at the confirmed size, and a placement you can undo, save and reopen. You can also change the scene with words ("move the selected cabinet 1 metre left") after seeing the exact change. Descriptions go to **ASU Voyager** when a key is configured; the **object builder** works without it. The detailed editor from M1 is unchanged: orbit, plan and walk views; move, rotate, resize, add, duplicate, remove; undo/redo; save and reopen. It is **not** yet a CAD importer, image importer, clearance checker or simulator. Generated models are pictures at a stated size, not product models: their mass, strength, chemistry and behaviour stay unknown. Nothing in the demo, and no layout edited from it, is verified engineering data or checked for clearance or feasibility. See [What exists today](#what-exists-today).

## What exists today

| Area | Implemented (M0) | Planned (not built) |
| --- | --- | --- |
| Contracts (v0.5.0) | Versioned Project / Scene / Object / Parameter models in SI units, right-handed Y-up world, explicit source-to-world transform; per-axis evidence on every dimension; catalog assets with explicit source and license and validated references; glTF visuals with declared units, axes, origin, bounds, hash and fit rule; walkway and keep-clear markings; explicit *unknown* parameters; **a scene edit log** that keeps the transform, value and evidence each edit replaced; **generated catalog assets** with their geometry specification, description, language model and unknown properties (0.5.0); tested migrations from 0.1.0–0.4.0 | Process graph, scenarios, runs, findings (M5–M6) |
| API | `GET /health`; `GET /api/v1/fixtures/{industrial-demo,foundation}`; `GET /api/v1/catalog/files/{path}` (confined to the catalog library); `POST /api/v1/projects/validate` (contract, edit-log, model-file and hash checks; one actionable message for older schema versions); `POST /api/v1/projects/upgrade` (runs the migration chain for review, stores nothing); loopback-only; CORS limited to dev origins | Project storage, import and simulation jobs |
| Web | Industrial demo with 4 original glTF models (verified by hash and bounds before drawing, with labelled fallbacks); orbit, top (plan with scale bar and orientation) and walk cameras; PBR lighting with shadows; floor markings; inspector with evidence, asset rights, model file, fit and load state; **editing** with numeric fields and 3D handles through one command path, catalog placement, duplicate, remove, undo/redo, edit records, save as JSON, reopen, unsaved-change protection and reviewed upgrades of older files; on-demand rendering with a reproducible GPU benchmark (`pnpm bench`) | Drawing overlay, playback, instancing for very large layouts |
| Guided creation (GEN-01) | Start panel; **describe an object** → typed proposal (name, parts, appearance, W/H/D, stated vs inferred, unknowns) → confirm estimated sizes → verified preview → place, undo, save, reopen; **object builder** with the same bounded geometry specification; generated models built by the API's own deterministic generator, stored by sha256 and rebuildable from the project file; **one language edit** (move or turn one object) shown exactly before it is applied | Correcting a placed generated object (GEN-02); evaluation on a held-out set (GEN-03) |
| Import | — | One image to an editable world (IMG-01, M3), DXF (IMP-01, M4), calibrated PDF/PNG reference (M4) |
| Checks | Spatial: none. Operational: none. | Footprint/clearance/route checks (M5), discrete-event production (M6), rigid-body interactions (M7) |
| AI | ASU Voyager (`qwen3-235b-a22b-instruct-2507`, configurable) drafts object proposals and one move/turn edit through the local API. Answers are schema-checked, and stated values are checked against the user's words. Nothing is applied without review. An offline replay of recorded answers is used only by tests and is labelled as such | Full command coverage, grounded explanations and held-out evaluation (M8) |

Both scenes are synthetic: the industrial demo is a labelled demonstration, and the **foundation fixture** is a set of labelled placeholder boxes that prove units, coordinates and schema handling. Their values are not engineering data, and edited or saved copies keep that label.

## Prerequisites

| Tool | Version used | Notes |
| --- | --- | --- |
| Node.js | 22.23.1 (`.node-version`; ≥ 22.12 required by Vite 8 / Vitest 5) | |
| pnpm | 11.11.0 (pinned via `packageManager`) | Any pnpm ≥ 10 switches to the pinned version automatically; `corepack enable` also works. 11.12.0 is a broken upstream release - do not use it. |
| uv | 0.12.18 (≥ 0.12 required) | Manages Python and the virtual environment |
| Python | 3.14 (`.python-version`) | uv downloads it if missing |
| Chromium for Playwright | build 1248 (headless shell) | Only for the browser tests |
| Google Chrome | 154 (installed app) | Only for `pnpm bench` / `pnpm review`, which need hardware-accelerated WebGL |

No GPU, Docker or cloud account is needed. An **ASU Voyager API key is optional**: it enables describing objects and changing them with words. Without it the builder and the editor work as before.

## Setup

Run from the repository root:

```bash
uv sync --locked                 # Python 3.14 venv in .venv with locked dependencies
pnpm install --frozen-lockfile   # Node workspace with locked dependencies
pnpm test:e2e:install           # once: Playwright's pinned headless Chromium (~200 MB)
cp .env.example .env             # optional; defaults work without it
```

### Optional: ASU Voyager for described objects and language edits

1. Get an API key from the ASU Voyager portal. The project uses the OpenAI-compatible endpoint `https://openai.rc.asu.edu/v1`.
2. Put it **only** in the git-ignored `.env` at the repository root: `VOYAGER_API_KEY=...`. Never put a key in `.env.example`, in fixtures, in code or in a commit.
3. Optionally set `VOYAGER_MODEL` (default `qwen3-235b-a22b-instruct-2507`) or `VOYAGER_BASE_URL`.
4. Restart `pnpm dev:api`. <http://127.0.0.1:8000/api/v1/assist/status> then reports `"mode": "live"` and the model, and never shows the key.

Only the local API process reads the key. The browser never receives it, because Vite exposes only `VITE_` names. What is sent: for a description, the description text; for an edit request, the request plus a list of object IDs, names, kinds, positions and sizes. Nothing else from the project is sent. Details, limits and the measured results are in [docs/assist.md](docs/assist.md).

## Run

Two terminals, both from the repository root:

```bash
pnpm dev:api    # FastAPI on http://127.0.0.1:8000 (auto-reload)
pnpm dev:web    # Vite on   http://127.0.0.1:5173
```

Open <http://127.0.0.1:5173>. The app opens on the **industrial demo**: a synthetic packaging line in a 22 × 15 m area, labelled "Synthetic demonstration · not verified engineering data", with **Models 4/4 verified** in the status bar. Use the **Foundation fixture** button in the top bar to switch to the six-box contract fixture. Select an object to see its dimensions, the evidence behind each value, and its catalog asset, model file and rights.

### Create an object without CAD

On a first visit the app shows **What would you like to do?** (reopen it any time with **Start** in the top bar):

- **Explore the demo** closes the panel on the synthetic packaging line.
- **Describe an object**: type what is missing, with any sizes you know, for example *a guarded conveyor about 2.2 m long with a control screen*, then **Draft a proposal**. A detailed proposal usually takes 30–90 s with the default model. You then see:
  - the name, a one-line appearance and a verified 3D preview you can turn;
  - **Size**, where each dimension says whether it came *from your words* (with your words quoted) or is an *estimate - please check*. **Place in scene** stays disabled until you confirm the estimates (**Sizes look right**, or **Looks right** per row) or type your own values;
  - the **parts**, with the ones you mentioned highlighted;
  - **Not known**: mass, strength, material chemistry and how it operates. A generated model is a provisional picture, not a product model.
  
  **Place in scene** stores the model and shows the usual placement marker: click the floor or press `Enter`. One `⌘Z` / `Ctrl+Z` removes it again. **Details** shows the model that drafted it, your words, what was stated or assumed, the checks, the file hash and the specification.
- **Open a project** opens a saved `.json` file through the usual API check.
- **Build an object by hand** (also **Build one…** in the catalog panel) starts from a plain shape: box, cabinet, workbench, tank, conveyor or shelving rack. Change the overall size (the parts scale with it) or each part's shape, material, size and centre, then place it the same way. No language model is involved.
- **Start from a photo** is shown as *Coming next*. Image import is planned (IMG-01) and not available yet.

To **change the scene with words**, type into the bar at the bottom of the 3D view, for example *move the selected cabinet 1 metre left* or *rotate the staged pallet 90 degrees clockwise*, then **Propose**. The card shows the exact change (`x  -2.000 → -3.000 m`) and nothing happens until you press **Apply**. Directions follow the top view: left −X, right +X, back −Z (up the screen), forward +Z. If the words fit several objects, or the selection doesn't match them, you are asked which object. If a value is missing, you are asked for it. A change the editor refuses (for example *2 km* beyond the ±1000 m limit) leaves the scene unchanged. Only moving or turning one object is supported in this version.

A saved project contains each generated object's specification. If you open it on a machine whose catalog library lacks the generated model file, the file is refused with **Rebuild generated models and open**. That rebuilds the exact file and opens the project, and only does so if the rebuilt file's sha256 matches the one recorded.

### Camera controls

| Mode (key) | How to use it |
| --- | --- |
| **Orbit** (`1`) | Drag to orbit, scroll to zoom, right-drag to pan. `F` or **Frame selection** frames the selected object; `H` or **Frame all** shows the whole area. |
| **Top** (`2`) | Orthographic plan with world −Z (plan up) at the top and +X to the right, a scale bar and an orientation dial. Drag to pan, scroll to zoom; `F` and `H` as above. There is no geographic north in the data, so none is shown. |
| **Walk** (`3`) | Eye height 1.60 m, inside the floor area; you cannot walk through equipment. `W A S D` or arrows move, `Q E` or `← →` turn, drag to look, `Shift` moves faster. `F` stands in front of the selection, `R` resets to the start, `Esc` exits to orbit. |

The selection is kept when you change modes, and each mode remembers its last view.

### Editing

Select an object in the list or the viewport. The inspector's **Edit** section shows its position (bottom-centre, metres), rotation (degrees) and size (metres); type a value and press `Enter` (or leave the field) to apply it, or `Esc` to revert. Every field, handle, placement and removal goes through the same typed command path, and each one is a single undo step.

| Control | What it does |
| --- | --- |
| **Select** `V` / **Move** `M` / **Rotate** `R` / **Resize** `S` | Edit tool for the selected object (orbit and top views). Move: red/green/blue arrows move along world X/Y/Z, and the yellow disc slides across the floor. Rotate: the ring turns the object about the vertical axis; the blue dot marks its front (+Z). Resize: face handles change width and depth symmetrically (the bottom-centre stays put) and height upwards. A drag commits once, on release; `Esc` during a drag cancels it. |
| Snap 10 mm · 15° | Handle snapping (1 mm and 1° when off). Typed values use the same units and conversions, so typed and dragged values store identical numbers. |
| **Add from catalog → Place…** | A translucent box at the asset's nominal size follows the pointer on the floor. Click to place, `Enter` places it at the marker, `Esc` cancels. The new instance keeps its asset reference and the catalog's dimension evidence. |
| **Duplicate…** `⌘D` / `Ctrl+D` | Shows a copy beside the source; click or `Enter` places it. |
| **Remove** `Delete` / `Backspace` | Removes the selection (undo restores it in place). |
| **Undo** `⌘Z` / `Ctrl+Z` · **Redo** `⇧⌘Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Disabled when there is nothing to undo or redo; hover to see the step. Any new edit after an undo clears the redo branch. |
| **Save project** `⌘S` / `Ctrl+S` | Downloads `<project-id>-r<revision>.json`. **Open project…** reopens it through the API check. |

Editing a size marks that axis **user-supplied** and unreviewed. A model stretched beyond its tolerance is flagged both in the inspector and in the object list ("Model stretched 20 %"). The **Edit record** section and the axis rows show the previous value and its evidence, and the scene summary lists the whole edit log. The scene revision advances on every edit, undo and redo. The top bar shows **Unsaved changes** until you save, and loading another scene or file first asks you to save, discard or cancel. Undo history is not saved; the edit log is. Edits are **not** checked for overlaps, clearance or feasibility (M5), and a strongly resized model is flagged as stretched. Details: [docs/contracts.md](docs/contracts.md#edits-revisions-and-the-edit-log-040).

Opening a file from an older contract (0.1.0–0.3.0) shows a review of the upgrade notes first. You can open the upgraded copy or download it, and nothing is replaced until you choose.

To see input rejection, click **Open project…** and choose `fixtures/invalid/negative-dimension.json`. The API rejects it, names `/scene/objects/4/dimensions/width/value_m`, and the current scene stays loaded.

To upgrade an older project file from the command line instead (for example `fixtures/legacy/foundation-scene-0.1.0.json`):

```bash
uv run python -m replay_world_contracts.migrate OLD.json -o NEW.json
```

API docs (OpenAPI) are served at <http://127.0.0.1:8000/docs> while the API runs.

## Checks

| Command (repo root) | What it verifies |
| --- | --- |
| `pnpm contracts:check` | Committed JSON Schema and TypeScript types match the Pydantic models |
| `pnpm assets:check` | Committed glTF models and manifest rebuild byte-for-byte from `apps/web/scripts/catalog` |
| `pnpm fixtures:check` | The industrial demo fixture matches what `scripts/build_demo_fixture.py` produces |
| `pnpm lint` | ESLint (TS/React) and Ruff (lint + format) |
| `pnpm typecheck` | `tsc -b` for every TS package, and `mypy --strict` |
| `pnpm test` | Vitest (contracts, API client, renderer placement) and pytest (contracts, transforms, API) |
| `pnpm build` | Production build of the web app |
| `pnpm check` | All of the above, in that order (what CI's main job runs) |
| `pnpm test:e2e:smoke` | The six `@smoke` Playwright tests (demo with verified models; edit → save → reopen; unsaved changes; no rendering while idle; describe → place → save → reopen → rebuild a missing model; a language edit shown before it is applied). CI runs them in a separate job with software WebGL: behaviour only, never frame rate |
| `pnpm bench` | Rendering benchmark in your installed Google Chrome with GPU acceleration (opens a visible window for several minutes). Options: `--scenes 0,15,45,105` (extra catalog instances), `--runs 5`, `--viewport 1440x900@2`, `--uncapped`. Writes `bench-results/<label>/`. Method and results: [docs/performance.md](docs/performance.md) |
| `pnpm review` | Visual-review screenshots in the same browser (`--stage after` writes `bench-results/review-after/shots/`; chosen before/after pairs are kept in `docs/visual-review/`) |
| `pnpm test:e2e` | Playwright: starts its own API (port 8010, offline **recorded** language answers, a temporary copy of the catalog library, no `.env`) and web server (port 5180), then runs the browser paths: scene loading, cameras, model failures, editing, save/reopen, unsaved changes, upgrades, and the guided start, described object, builder and language edits |
| `uv run python scripts/evaluate_assist.py [--record] [--unguided]` | **Live** evaluation against ASU Voyager (needs `VOYAGER_API_KEY`): object descriptions and edit requests including vague, hostile and ambiguous cases. Writes `docs/assist-evaluation/`. `--record` refreshes the answers the offline tests replay (`fixtures/assist/recorded/`) |

After changing a model in `packages/contracts/python/replay_world_contracts/models.py`, run `pnpm contracts:generate` and commit the regenerated files. After changing equipment geometry, run `pnpm assets:build` and then `pnpm fixtures:build`.

## Repository layout

```
apps/web/              React + TypeScript + Vite editor; React Three Fiber viewport; Playwright e2e
apps/web/scripts/catalog/  Procedural generator for the curated catalog's glTF models
services/api/          FastAPI service (replay_world_api); assist/ (language proposals), objects/ (generated-model builder)
packages/contracts/    Contract source of truth (Pydantic) + generated JSON Schema and TS types + Ajv validators
fixtures/              Synthetic scenes, an edited sample, legacy and invalid samples, recorded language answers (assist/)
assets/catalog/        Catalog library: glTF models + manifest (authorship and rights in its README); generated/ (git-ignored)
scripts/               Contract generation / drift check; demo fixture builder
tests/                 Repository data checks (models ↔ manifest ↔ demo fixture)
docs/                  Environment record, contract conventions, learning notes
prompts/               Project context, milestones, backlog, decisions and session log
.github/workflows/     CI (lint, types, contracts, tests, build)
```

## Conventions that matter

- **Units:** metres, seconds, kilograms, radians internally. Display formatting is a UI concern.
- **World frame:** right-handed, +Y up, floor in the X-Z plane (identical to Three.js, so no conversion is applied when rendering).
- **Object placement:** `position_m` is the bottom-centre of the object's bounding box; `dimensions` are measured along the object's local axes before rotation.
- **Evidence:** every known value, including each dimension axis separately, carries an origin (`measured`, `user_supplied`, `supplier`, `inferred`, `default`) and a review status. Unknown parameters are `{"state": "unknown", "reason": ...}` and never carry a substitute number.
- **Assets:** catalog assets record their source and usage rights explicitly (`NOASSERTION` when unknown). Objects reference them by stable ID, and every reference must resolve.
- **Models are pictures, not measurements:** a glTF model is authored in metres, +Y up, front +Z, origin at its bottom-centre, and scaled to the instance's recorded dimensions. It is loaded only if its sha256 and bounds match the catalog. A project file that uses models needs the same catalog library to open elsewhere.
- **One schema source:** Pydantic models → JSON Schema → TypeScript types and browser validation. Details in [docs/contracts.md](docs/contracts.md).

## Data care

Keep credentials, customer drawings, model weights and run outputs out of commits (see `.gitignore`). Use synthetic or permissioned inputs in `fixtures/`. The API binds to `127.0.0.1` by default; do not expose it without a deliberate decision. Uploaded document content is data, never instructions.

## Project records

- Current state: [prompts/PROJECT_STATE.md](prompts/PROJECT_STATE.md)
- Backlog: [prompts/BACKLOG.md](prompts/BACKLOG.md) · Milestones: [prompts/MILESTONES.md](prompts/MILESTONES.md)
- Decisions: [prompts/DECISIONS.md](prompts/DECISIONS.md) · Session log: [prompts/SESSION_LOG.md](prompts/SESSION_LOG.md)
- Environment record: [docs/environment.md](docs/environment.md)

No license has been chosen yet; do not assume one.
