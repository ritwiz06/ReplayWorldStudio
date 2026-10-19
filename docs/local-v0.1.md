# Replay World Studio v0.1, local (ADR-058)

v0.1 runs on your own computer at `http://127.0.0.1:8000` through `pnpm start`. Nothing is hosted, and no other machine can reach it.

| Stage | Status (2026-10-18) |
| --- | --- |
| Runs locally | **Yes.** Checked from a clean checkout: install, `pnpm start`, an occupied port 8000, and no Voyager key. |
| Local journey | **Passes** (`pnpm --filter @replay-world/web test:e2e:local`, also in CI: https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/39184511408): the sample's move blocks the route; a DXF is imported, reviewed, edited, saved and reopened. |
| Online preview | **Not planned.** Superseded by ADR-058; see [public-preview.md](public-preview.md) for the history. |

## Install (once)

You need **Node.js ≥ 22.12** with **pnpm** (`corepack enable` gives the pinned 11.11.0) and **uv ≥ 0.12**. uv downloads Python 3.14 if it is missing. No GPU, Docker, cloud account or API key is needed.

```bash
git clone https://github.com/ritwiz06/ReplayWorldStudio.git
cd ReplayWorldStudio
uv sync --locked
pnpm install --frozen-lockfile
```

## Run

```bash
pnpm start                      # builds the web app, then serves http://127.0.0.1:8000
pnpm start --no-build           # later runs: reuse the last build
RWS_API_PORT=8001 pnpm start    # if port 8000 is taken
```

Open the address it prints. Stop it with `Ctrl+C`.

If port 8000 is in use, often by an API you started earlier, `pnpm start` stops with:

```
Port 8000 is already in use on this computer (perhaps an API you started earlier).
Stop that process, or choose another port:  RWS_API_PORT=8001 pnpm start
```

To find the process using it: `lsof -nP -iTCP:8000 -sTCP:LISTEN`.

The server listens on `127.0.0.1` only. Your computer's network address is refused, so other machines cannot open the app.

## First steps

1. **Try the sample** (in **Start**). Move *Machine B* into the aisle: drag it, or press **move it for me**. **Check layout** then says the 1.20 m cart's route is blocked. Undo puts it back.
2. **Upload your own plan:**
   - a **DXF** (ASCII, up to 10 MB) is read into a draft that you review: floor, scale, objects, and what the drawing leaves out;
   - a **PDF page, PNG or JPEG** (up to 10 MB) is shown as a picture: you mark one length you know, then trace the floor and objects.
   - Export a DWG as DXF first.
3. **Change, compare, check.** Move, turn, resize, add and remove objects, with undo. **Compare** shows the drawing beside your layout. **Check layout** looks for overlaps and blocked keep-clear zones, and checks whether an item of a width you enter can get through. These are 2D checks of the reviewed design: width only, no turning, and heights are not checked.
4. **Run a day.** It plays a shift on the layout: the sample's example shift, or a process you set up with **Set up a day**. It predicts what happens only under the operating assumptions you enter, not real productivity or safety ([run-a-day.md](run-a-day.md)).
5. **Save project** downloads a `.json` file, including the process; **Open project** reopens it.

## Where your files are, and how to delete them

Everything stays on your computer:

| What | Where | Delete |
| --- | --- | --- |
| Plans you upload (DXF, PDF, PNG, JPEG) | `data/sources/drawings/`, each named by its content hash | Stop the app, then delete the files, or the whole folder: `rm -rf data/sources/drawings` |
| Photos you add | `data/sources/photos/` | `rm -rf data/sources/photos` |
| Models generated for described or hand-built objects | `assets/catalog/generated/` | `rm -rf assets/catalog/generated` |
| Projects | Wherever your browser saves downloads | Delete the `.json` files |

- All of these folders are git-ignored, so they are never committed.
- `RWS_SOURCES_DIR` in `.env` moves the upload library elsewhere.
- **Nothing expires on its own**: files stay until you delete them.
- A project whose plan you deleted still opens. The drawing panel then says the original file is not in this computer's source library, and you can upload the plan again to relink it.

## AI is optional, and uses your own key

Without a key, every feature above works and the AI buttons are off. To turn the AI features on (drafting a plan picture's layout, describing objects, changing the scene with words, analysing a photo):

```bash
cp .env.example .env    # then set VOYAGER_API_KEY=... in .env, and restart pnpm start
```

- **The key stays on your computer.** Only the local API process reads it from the git-ignored `.env`; it is never sent to the browser, logged or committed.
- **The AI features exist only in your local app.** Nothing is hosted for anyone else.
- **Using an AI feature sends that request to ASU Voyager** (`https://openai.rc.asu.edu/v1`), and only when you press its button:
  - **Propose the layout** on a plan picture or **Analyse** on a photo: a smaller copy of the image, without its metadata.
  - A description: its text.
  - A request to change the scene: your words, plus the objects' names, kinds, positions and sizes.
  - **Propose the change** on a model: your instruction, plus the model's part list.

  Details are in [assist.md](assist.md).
- **Under ASU's AI governance,** send only plans and photos you are authorized to share with ASU Voyager, and treat what comes back as a proposal you review.

## Limits

- It has been tried on synthetic examples and supported files, not yet on real plans.
- It does not convert every drawing into an accurate 3D model, simulate physics, verify real output or worker safety, or certify anything about a real site. **Run a day** plays a production-event shift only under the assumptions you state.
- Heights are *assumed for display* unless you enter them.

## Checks

```bash
pnpm check                                           # contracts, lint, types, unit and API tests, build
pnpm test:e2e:install                                # once: Playwright's headless Chromium
pnpm --filter @replay-world/web test:e2e:local       # the local journey on the pnpm start build
LOCAL_URL=http://127.0.0.1:8000 pnpm --filter @replay-world/web test:e2e:local   # against a pnpm start you already run
```
