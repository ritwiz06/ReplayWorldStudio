# GEN-05 frozen revision evaluation: criteria

These criteria were written and committed with `revisions.json` before any of these cases was
run. Thresholds, denominators and scoring rules do not change once results are seen. The GEN-03
and GEN-04 sets, scores and reported failures are not touched or rescored. The six GEN-04 cases
reused during GEN-05 development (m01, m02, c02, c03, c05, o03) are development regressions,
not part of this set.

## What is evaluated

GEN-05 makes revisions visible and time-bounded:

- Added parts are checked for being hidden, buried, floating, too small or out of view, and for
  colour.
- The model gets at most one shared corrected answer, within one 150 s budget for the whole
  request.
- What the checks find and the model does not fix is shown as a problem before Apply.

This set tests that on the default model only.

- **Model:** `qwen3-235b-a22b-instruct-2507` (ASU Voyager), the only model run.
- **Path:**
  - the API endpoint `POST /api/v1/assist/model-revisions`, with revision prompt `gen-05.1`;
  - schema-guided output and the API's own checks;
  - one 150 s budget per request, covering the first answer, the checks and the one shared retry;
  - a retry only while the remaining budget covers it.
- **Runs.** One sequential pass, one request at a time, each case once, with nothing repeated
  automatically.
  - The script keeps the computer awake (`caffeinate`) and records the request timer and the
    real clock for every request.
  - A request during which the host paused (the clocks differ by more than 5 s) is a **run
    fault**. It is reported separately with the measured result kept as it is. A timeout is
    never quietly reclassified.
  - Diagnostic retries, if any, go to `results/diagnostic-*.json` and never replace or join the
    frozen result.

## Cases (22)

`revisions.json` contains 13 target models and 22 cases, 10 of them on photo-made objects. The
targets come from three sources:

- **Photo-made:** the app's photo import of `classroom.jpg` (the rectangular table and a blue
  plastic chair are used for the first time) and four GEN-04 photo targets.
- **Builder:** templates rack, chair, sofa, and box at two sizes.
- **Described:** two GEN-01 recorded objects (workbench, water tank).

The six GEN-04 targets (white chair, low bookshelf, TV, media player, workbench, water tank)
come back with new instructions; none was a GEN-04 development regression. No instruction
repeats one from GEN-03, GEN-04, the development cases or the pilot.

| Group | Cases | Expected outcome |
| --- | --- | --- |
| Visible small additions | v01–v06 | `proposal` |
| Open structures | o01–o05 | `proposal` |
| Transparent parts | t01–t03 | `proposal` |
| Explicit colours | e01–e03 | `proposal` (e03 `partial`: blue is available, the blue fabric texture is not) |
| Partial requests | p01–p04 | `partial` |
| Already satisfied | s01 | `already_satisfied` |

Cases flagged `visible_additions` (13) add items that a viewer must be able to see. These are the
ones most likely to need the feedback retry.

## Scoring rules (per case)

**The GEN-04 rules** (`scripts/score_gen04.py`, used unchanged):

- **Outcome.**
  - `partial` = a proposal with `partial: true`.
  - `proposal` = a proposal, partial or not.
  - `already_satisfied` and `unsupported` need that exact outcome.
  - An error or a timeout is a wrong outcome.
- **Requested change present.** Every `visible_change` check holds on the proposal (materials by
  name, parts by label). Denominator: proposals in cases with checks.
- **Size.** `keep`: the envelope is unchanged. Denominator: every proposal.
- **Genuinely open.** The largest part fills less than 50 % of the envelope. Denominator:
  proposals in the 3 cases marked `open` (o01, o02, o04, whose targets start solid).
- **Unrepresentable features listed.** Each keyword group appears in `not_represented`.
  Denominator: all 5 cases with keywords (e03 and p01–p04); an error counts as not listed.

**Visual review.**

- Each proposal is rendered before and after with the app's generator, from the review dialog's
  default view.
- The sheets are numbered in a shuffled order, and each shows only the instruction and the two
  pictures. They are scored before the case key, any automatic score or any answer text is
  opened.
- 2 = the requested drawable change is clearly visible and right; 1 = partly; 0 = missing,
  hidden or wrong.
- The mean is taken over rendered proposals. The reviewer is Claude (the assistant running the
  evaluation), not a study participant.

**Waiting.**

- Request wall time with every retry included; the median and p95 cover all 22 requests.
- **A timeout** is a request answered with HTTP 504, or one that took longer than the 150 s
  budget plus 5 s.
- A first answer shown with its problems because the corrected answer was cut off by the budget
  reached the user in time. It is not a timeout; it is reported as a budget-cut retry.

**GEN-05 diagnostics (reported, not gates):**

- problems shown before Apply, per case;
- the share of `visible_additions` proposals with no problems;
- colour notes (named colours honoured, contrasting finishes);
- retries and budget-cut retries;
- total request time;
- run faults;
- first-attempt validity, unrelated parts kept, hidden parts, leaks.

## Gates (the established revision gates)

| Measure | Gate |
| --- | --- |
| Outcomes as expected | ≥ 85 % (≥ 19 / 22) |
| Requested change present in proposals | ≥ 75 % |
| Size handled as asked | ≥ 90 % of proposals |
| Open requests genuinely open | ≥ 90 % of open-case proposals |
| Unrepresentable features listed | ≥ 80 % (≥ 4 / 5) |
| Visual review mean | ≥ 1.2 |
| Revision waiting median | ≤ 60 s |
| Timeouts | ≤ 5 % (≤ 1 / 22) |

## Closing M2

M2 closes only if this run passes every gate above. It must do so alongside the GEN-03
description, edit, safety and measurement gates, which the default already passed. If any gate
fails, M2 stays open, and the report names the failing measure, its cases and the next task.

**Not claimed.** Provisional geometry does not establish mass, strength, operation, chemistry or
real-world fitness. Timings come from a script, not a user study, and no participants were
involved.
