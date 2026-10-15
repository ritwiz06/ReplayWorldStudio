# GEN-03 held-out evaluation

The evaluation gate for M2: can a first-time user create, edit and improve recognisable
provisional objects with acceptable waiting and correction effort, and which Voyager text model
should be the default? The inputs and criteria were frozen in commit `435095a` before either model
ran; see [criteria.md](criteria.md).

| File | What it is |
| --- | --- |
| `descriptions.json` | 32 object descriptions: expected outcome, stated sizes (in metres, with the words), what a viewer should recognise, facts that must not be invented. |
| `edits.json`, `edit-scene.json` | 31 language edits on a synthetic packing-room scene: expected outcome, target, action, direction and amount. |
| `revisions.json` | 22 model revisions of 16 target models (9 made from photos): requested visible change, size rule, open/unrepresentable checks. |
| `criteria.md` | Measures and pass/fail gates, fixed before running. |
| `results/<model>.json` | Live results: every answer, timing, retries and errors, through the API endpoints. |
| `edit-scores.json`, `scores.json` | Automatic scores. |
| `review.json` | Blind visual review, unblinded after scoring. |
| `report.md` | The comparison and decision. |

## Running it

Needs `VOYAGER_API_KEY` in the git-ignored `.env` (the API settings read it; it is never printed
or written). Provider calls stay out of CI.

```sh
# 1. Live run through the API endpoints, both models, cases alternating which goes first.
#    Results are written after every call; an interrupted run resumes where it stopped and keeps
#    every recorded result, errors and timeouts included (--retry-errors re-runs those explicitly).
uv run python scripts/evaluate_gen03.py

# 2. Automatic scores (edits through the browser's own resolver, then everything else).
pnpm --filter @replay-world/web exec node scripts/assist/score-gen03-edits.ts
uv run python scripts/score_gen03.py

# 3. Blind visual review: render the models, score the sheets by option without the key,
#    then unblind and score again.
uv run python scripts/evaluate_gen03.py --build-targets
pnpm --filter @replay-world/web exec node scripts/assist/render-gen03.ts
#    (write bench-results/gen-03-review/review-blind.json from sheets.html; do not open the key)
uv run python scripts/unblind_gen03_review.py bench-results/gen-03-review/review-blind.json \
    bench-results/gen-03-review/blind-key.json
uv run python scripts/score_gen03.py
```

The tooling is tested on synthetic fixtures without provider calls: `tests/test_gen03_evaluation.py`
(scorer rules, waiting-time statistics, resume after an interruption, unblinding) and
`apps/web/src/assist/editScoring.test.ts` (edit scoring with the real resolver).

## Future evaluations: a bounded pilot and limited concurrency

This run is sequential (one request at a time, alternating models). It takes about two hours for
85 cases × 2 models, mostly waiting for the larger model. For the next evaluation:

- **Pilot first.** Run 3 cases per workflow and per model (about 18 requests) before the full set,
  only to catch tooling faults (endpoint shape, scoring, rendering). Pilot cases come from the
  development set, never from the held-out one, so the frozen set stays unseen until the real run.
- **Limited concurrency.** At most 2 requests in flight per model (4 in total), and only after
  checking the gateway: if any 429 or a rising share of 5xx or timeouts appears, drop back to 1.
  Waiting times measured under concurrency are not comparable with sequential ones, so report the
  concurrency used with every latency figure, and keep the alternation between models so both see
  the same load.
- **Budget.** Stop and report if timeouts exceed 10 % in the first 20 requests of either model.
