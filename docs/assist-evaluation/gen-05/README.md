# GEN-05 frozen revision evaluation

This evaluation tests visible, time-bounded revisions: 22 new model-revision cases, run once on
the default model (`qwen3-235b-a22b-instruct-2507`). The cases and [criteria.md](criteria.md)
were committed before the live run. The GEN-03 and GEN-04 sets and results are not touched.

| File | What it is |
| --- | --- |
| `revisions.json` | 13 targets and 22 cases: 6 visible small additions, 5 open structures, 3 transparent parts, 3 explicit colours, 4 partial requests and 1 already satisfied; 10 of the cases are on photo-made objects. |
| `criteria.md` | Scoring rules, denominators and gates, fixed before running. |
| `results/<model>.json` | The frozen live result: every answer, both clocks, retries and errors. |
| `results/diagnostic-*.json` | Diagnostic retries, if any. They are kept apart and never scored as the result. |
| `scores.json`, `review.json` | Automatic scores, and the visual review unblinded after scoring. |
| `report.md` | Results, failures, run conditions and the M2 decision. |

**Pilot.** Before freezing, the whole path (live run, render, blind scoring, unblinding,
scoring) was tried on three new development examples in [../gen-05-pilot/](../gen-05-pilot/).
It found two check gaps, both fixed before the freeze:

- a rail touching a round lid along one tangent was missed;
- a 2 cm status light was too small to see but not reported.

## How the targets were made

- **Photo-made.** These come from the app's own photo import using the recorded vision answers:
  - `classroom.jpg`, with an assumed 3.0 m floor width, for the rectangular table and the blue
    plastic chair;
  - the GEN-04 captures for the white chair, the low bookshelf, the TV and the media player.
- **Builder.** These are the app's templates (`apps/web/src/assist/templates.ts`), fitted with
  the API's `fit_to_envelope`. The chest uses the template size; the bin is 0.5 × 0.3 × 0.35 m.
- **Described.** These are the GEN-01 recorded workbench and water tank, as used in GEN-04.

## Running it

Running it needs `VOYAGER_API_KEY` in the git-ignored `.env`. The key is never printed or
written, and provider calls stay out of CI. The runner keeps the computer awake by itself
(`caffeinate` on macOS) and records the request timer and the real clock for every request.

```sh
uv run python scripts/evaluate_gen05.py                       # the frozen run (once)
uv run python scripts/evaluate_gen05.py --build-targets
pnpm --filter @replay-world/web exec node scripts/assist/run-ts.mjs scripts/assist/render-gen05.ts
#    Score bench-results/gen-05-review/sheet-NN.png into review-blind.json without opening
#    sheet-key.json, then:
uv run python scripts/unblind_gen05_review.py bench-results/gen-05-review/review-blind.json \
    bench-results/gen-05-review/sheet-key.json
uv run python scripts/score_gen05.py
```

Add `--set docs/assist-evaluation/gen-05-pilot` to any step to run the pilot instead. The tooling
is tested on synthetic rows in `tests/test_gen05_evaluation.py`.
