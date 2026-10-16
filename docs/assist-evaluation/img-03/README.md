# IMG-03: accuracy of one photo to an editable world

- **Rules,** frozen before the held-out run: [criteria.md](criteria.md).
- **How a real site is photographed and measured:** [protocol.md](protocol.md).
- **Results,** after the run: [report.md](report.md).

## Inventory

What each permitted photo can and cannot be used for:

| Photo | Rights | Object sizes and floor positions | Calibration | Camera | Use in IMG-03 |
| --- | --- | --- | --- | --- | --- |
| `fixtures/photos/living-room.webp` | CC0 | unknown | the rug's size is assumed (2.0 m), not measured | unknown | none: no measurements |
| `fixtures/photos/office.jpg` | Public Domain Mark | unknown | none | unknown | none |
| `fixtures/photos/classroom.jpg` | Public Domain Mark | unknown | table width assumed (1.52 m) | unknown | none: the assumed width is not a measurement |
| `fixtures/photos/factory-walk.png` | render by this project | exact (industrial demo) | exact (walkway 6 × 1.8 m) | exact | development only: used in IMG-01/02 (the 5.1 m cabinet case) |
| `fixtures/photos/factory-walk-sign.jpg` | render by this project | exact | exact | exact | none: an injection test, not an accuracy case |
| `img-03/photos/dev-*.jpg` (2) | render by this project | exact | exact (floor mat) | exact | **development**: probes and pipeline checks |
| `img-03/photos/{line,store,office,lounge}-{a,b}.jpg` (8) | render by this project | exact | exact (floor mat) | exact | **held out, synthetic stratum**: run once |
| real, measured site photos | — | — | — | — | **none exist yet**: the missing input for IMG-03 |

A size that is "typical", assumed, or read off the same photo is not ground truth. The validator
refuses it (`scripts/img03_annotations.py`).

## Files

- `scenes.json` holds the synthetic scenes: rooms, the floor mat (the calibration rectangle),
  objects (catalog models, or builder templates built at an exact size) and cameras.
- `photos/` holds the renders (JPEG, metadata-free, 1280 × 960: the form the browser sends for
  analysis).
- `annotations/*.annotation.json` holds the ground truth (format `rws-img03-annotation/1`). Each
  object has:
  - visible and whole outlines, measured from flat-colour passes;
  - the share that shows, and the edges it is cut off at;
  - its centre, yaw and size in the mat's frame;
  - whether it is counted, and why not.
- `development/` holds the development probes:
  - the default model on the two development renders;
  - the second-model checks (`glm-4-5v` failed; `llama4-scout-17b` passed);
  - their scores and placements.
- `results/`, `scores.json` and `report.md` are written after the held-out run.

## Reproduce

From the repository root:

```sh
# 1. Models and renders (deterministic; the photos' sha256 are in the annotations)
pnpm --filter @replay-world/web exec node scripts/assist/run-ts.mjs \
  scripts/img03/dump-templates.ts ../../bench-results/img-03/templates.json
uv run --project services/api python scripts/build_img03_scenes.py
pnpm --filter @replay-world/web exec node scripts/img03/render.ts
uv run --project services/api python scripts/img03_annotations.py validate docs/assist-evaluation/img-03/annotations

# 2. Live run (needs VOYAGER_API_KEY in .env; never in CI; a result file is never overwritten)
uv run --project services/api python scripts/evaluate_img03.py --split held_out
uv run --project services/api python scripts/evaluate_img03.py --model llama4-scout-17b \
  --cases line-a store-a office-a lounge-a

# 3. Scores (offline)
pnpm --filter @replay-world/web exec node scripts/assist/run-ts.mjs scripts/img03/score.ts \
  --results results/qwen3-vl-32b-instruct.json --results results/llama4-scout-17b.json \
  --manual line-a,line-b,store-a,store-b,office-a,office-b,lounge-a,lounge-b \
  --out scores.json --worlds worlds.json
```

**Tests** (no provider):

- `tests/test_img03_annotations.py`: the format, the refusals, and the held-out set's
  composition;
- `apps/web/src/photo/evaluation.test.ts`: known answers for matching, frames and metres;
- `apps/web/e2e/img03-browser-path.spec.ts`: the scorer's world equals the browser's.
