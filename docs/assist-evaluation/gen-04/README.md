# GEN-04 frozen revision evaluation

This evaluation tests honest partial revisions. It covers 20 new model-revision cases, run once on
the default model (`qwen3-235b-a22b-instruct-2507`). The cases and [criteria.md](criteria.md)
were committed before the live run. The GEN-03 held-out set and its scores are not touched.

| File | What it is |
| --- | --- |
| `revisions.json` | 18 target models and 20 cases (5 mixed, 3 unsupported, 5 open, 5 colour/part, 2 already satisfied; 10 on photo-made objects). Each case has an expected outcome, size rule, visible-change checks, and open and unrepresentable keywords. |
| `criteria.md` | Scoring rules, denominators and gates, fixed before running. |
| `results/<model>.json` | The frozen live result: every answer, timing, retries and errors. |
| `results/diagnostic-*.json` | Diagnostic retries, if any. These are kept apart and never scored as the result. |
| `scores.json` | Automatic scores and the gate table. |
| `review.json` | The visual review, scored sheet by sheet and then unblinded. |
| `report.md` | Results, failures, waiting time and the M2 decision. |

## How the targets were made

- **Photo-made (9 targets, 10 cases).** These come from the app's own photo import of
  `fixtures/photos/living-room.webp` and `classroom.jpg`, using the recorded vision answers.
  - The living room used a 2.0 m rug as an assumed scale (as in `e2e/photo.spec.ts`). The
    classroom used an assumed 3.0 m floor width.
  - Each spec is the stored, fitted spec of the asset the app created.
  - None of these is a GEN-03 target.
- **Builder (6).** These are the app's object templates (`apps/web/src/assist/templates.ts`),
  fitted with the API's `fit_to_envelope`. The crate uses 0.6 × 0.4 × 0.4 m; the others use
  their template sizes.
- **Described (3).** These are the GEN-01 recorded object answers for the workbench, water tank
  and guarded conveyor, fitted the same way.

## Running it

Running it needs `VOYAGER_API_KEY` in the git-ignored `.env`. The key is never printed or
written. Provider calls stay out of CI.

```sh
# 1. The frozen live run: one sequential pass, default model only. It resumes if interrupted and
#    keeps every recorded result, errors and timeouts included.
uv run python scripts/evaluate_gen04.py

# 2. The visual review, scored before the automatic scores are read.
uv run python scripts/evaluate_gen04.py --build-targets
pnpm --filter @replay-world/web exec node scripts/assist/run-ts.mjs scripts/assist/render-gen04.ts
#    Score bench-results/gen-04-review/sheet-NN.png into review-blind.json without opening
#    sheet-key.json, then:
uv run python scripts/unblind_gen04_review.py bench-results/gen-04-review/review-blind.json \
    bench-results/gen-04-review/sheet-key.json

# 3. Automatic scores and gates.
uv run python scripts/score_gen04.py

# Diagnostic retries only (never part of the frozen result):
uv run python scripts/evaluate_gen04.py --diagnostic NAME --cases m01 o03
```

The tooling is tested on synthetic rows without provider calls in `tests/test_gen04_evaluation.py`.
