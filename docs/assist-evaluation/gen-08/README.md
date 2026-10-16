# GEN-08 frozen revision evaluation

GEN-08 is the evaluation after GEN-06 (recognisable additions) and GEN-07 (beginner-friendly
review): 26 new model-revision cases, run once on the default model
(`qwen3-235b-a22b-instruct-2507`). The cases and [criteria.md](criteria.md) were committed before
the live run. The GEN-03, GEN-04 and GEN-05 sets and results are not touched.

| File | What it is |
| --- | --- |
| `revisions.json` | 13 targets and 26 cases: 4 transparent, 4 small additions, 4 colour phrases, 4 occluded placements, 3 open structures, 3 partial requests, 3 stated sizes and 1 already satisfied. 13 of the cases are on photo-made objects. |
| `criteria.md` | Scoring rules, denominators and gates, fixed before running. |
| `results/<model>.json` | The frozen live result: every answer, both clocks, retries and provider calls. |
| `review-dialog.json`, `review-fixed.json` | The two visual reviews (dialog method, gated; fixed GEN-05 camera, context), each scored blind and then unblinded. |
| `scores.json`, `report.md` | Automatic scores, gates and the M2 decision. |

The pilot (three new development cases through the same path, before anything was frozen) is in
[../gen-08-pilot/](../gen-08-pilot/). The sets are built by `scripts/build_gen08_sets.py`.

## Running it

Running it needs `VOYAGER_API_KEY` in the git-ignored `.env`. Provider calls stay out of CI, and
the runner keeps the computer awake by itself.

```sh
uv run python scripts/evaluate_gen05.py --set docs/assist-evaluation/gen-08          # once
uv run python scripts/evaluate_gen05.py --set docs/assist-evaluation/gen-08 --build-targets
pnpm --filter @replay-world/web exec node scripts/assist/run-ts.mjs scripts/assist/render-gen08.ts
#    Score bench-results/gen-08-review/dialog/sheet-NN.png into review-dialog-blind.json, then
#    fixed/ into review-fixed-blind.json, without opening the sheet keys; then:
for m in dialog fixed; do uv run python scripts/unblind_gen05_review.py \
  bench-results/gen-08-review/review-$m-blind.json bench-results/gen-08-review/sheet-key-$m.json \
  --set docs/assist-evaluation/gen-08 --out-name review-$m.json; done
uv run python scripts/score_gen08.py
```
