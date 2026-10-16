# GEN-08 frozen revision evaluation: criteria

These criteria were written and committed with `revisions.json` before any of these cases was
run. Thresholds, denominators and scoring rules do not change once results are seen. The GEN-03,
GEN-04 and GEN-05 sets, scores and reported failures are not touched or rescored.

## What is evaluated

GEN-06 and GEN-07 changed what a user sees when reviewing a model revision:

- recognisable glass and clear plastic (readable edges and compositing);
- small requested parts brought up to a visible, bounded size as listed estimates;
- per-pair touch tolerance and elliptical colour clauses;
- a dialog that opens on the camera view showing the requested change, with outlines on the
  parts a warning names.

This set measures that on the default model only.

- **Model:** `qwen3-235b-a22b-instruct-2507` (ASU Voyager), the only model run.
- **Path:**
  - the API endpoint `POST /api/v1/assist/model-revisions`, with revision prompt `gen-05.1`;
  - the GEN-06 checks and adjustments;
  - one 150 s budget per request with at most one shared retry.
- **Runs.** One sequential pass with `scripts/evaluate_gen05.py --set docs/assist-evaluation/gen-08`,
  each case once.
  - The script keeps the host awake (`caffeinate`) and records the request timer, the real
    clock, retries and every provider call.
  - A host pause (the clocks differ by more than 5 s) is a run fault, reported separately; the
    measured result is kept.
  - Nothing is repeated automatically. Diagnostic retries, if any, go to
    `results/diagnostic-*.json` and are never scored as the result.

## Cases (26)

`revisions.json` contains 13 targets and 26 cases; 13 of the cases are on photo-made objects. No
target was used in a development, inspection or pilot case. No instruction repeats one from
GEN-03, GEN-04, GEN-05, the development cases, the inspection cases or either pilot.

| Group | Cases | Expected outcome |
| --- | --- | --- |
| Transparent parts | t1–t4 | `proposal` |
| Small named additions (no size given) | s1–s4 | `proposal` |
| Explicit colour phrases (elliptical, joined, texture) | c1–c4 | `proposal` (c4 `partial`: the leather texture) |
| Occluded placements (behind, under, at the back) | o1–o4 | `proposal` (o4 `partial`: "plays music") |
| Open structures | p1–p3 | `proposal` |
| Partial requests | q1–q3 | `partial` |
| Stated dimensions | d1–d3 | `proposal` |
| Already satisfied | a1 | `already_satisfied` |

The cases state the expected outcomes, the drawable changes to check, and the undrawable details
that must be listed. They contain no desired model answers.

## Scoring rules (per case)

The GEN-04 and GEN-05 rules (`scripts/score_gen04.py`, `scripts/score_gen05.py`) apply, with
GEN-08's additions:

- **Outcome.**
  - `partial` = a proposal with `partial: true`.
  - `proposal` = any proposal.
  - Other outcomes must match exactly.
  - **A provider error or a timeout is a wrong outcome.**
- **Requested change present.** Every `visible_change` check holds (materials by name, parts by
  label). Denominator: proposals in cases with checks; a provider error is not a proposal and is
  not in this denominator.
- **Size handled as asked.**
  - The envelope is unchanged.
  - **Where the instruction states a part's size** (d1–d3), the matching part is not more than
    15 % larger than stated. The app's estimate enlargement must not touch a stated size, so
    accidental enlargement fails this measure.
  - Denominator: every proposal.
- **Genuinely open.** The largest part fills less than 50 % of the object. Denominator: proposals
  in the 3 open cases (all three targets start solid).
- **Unrepresentable features listed.** Each keyword group appears in `not_represented`.
  Denominator: all 5 cases with keywords (c4, o4, q1–q3); an error counts as not listed.
- **Visual review (gate): the dialog method.** Each case is rendered as the updated Improve
  dialog shows it on opening (`apps/web/scripts/assist/render-gen08.ts`, "dialog"):
  - the dialog's dark preview, lights and grid;
  - glass and clear plastic with the viewer's edges and compositing;
  - the camera view the API chose for the proposal, with the before model in the same view;
  - orange outlines around the parts a warning names.

  Scoring:
  - Sheets are numbered in a shuffled order and show only the instruction and the two pictures.
    They are scored before that method's key, any automatic score or any answer text is opened.
  - 2 = the requested drawable change is clearly visible and right; 1 = partly; 0 = missing,
    hidden or wrong.
  - **A warning does not raise a score**: an outline around a part that cannot be seen does not
    make it visible.
  - The mean is taken over every case expecting a drawn change (25: all but a1). **A provider
    error or a missing proposal scores 0.**
- **Visual review (context, not gated): the fixed GEN-05 camera.**
  - GEN-05's renderer, unchanged: a light background, the front-right camera and no edges.
  - Its sheets are shuffled and keyed separately, and scored in their own pass.
  - It is reported over rendered proposals for context only. It is a **different viewing
    method**, and its mean is not compared with the dialog mean as if the review conditions
    were the same.
  - The dialog mean over rendered proposals only is also reported for context.
- **Waiting.** Request wall time with retries included; the median and p95 cover all 26
  requests. A **timeout** is HTTP 504, or a request longer than the 150 s budget plus 5 s.
- **Reported, not gated:**
  - the provider calls per request and in total;
  - retries and budget-cut retries;
  - the problems shown before Apply;
  - **how many low visual scores carried a warning before Apply** (the honesty of the review);
  - the estimate enlargements and colour choices;
  - the chosen first views;
  - safety (leaks of the key or system prompt);
  - provenance (every proposal names the model and the mode "live").

The reviewer is Claude (the assistant running the evaluation), not a study participant. The
review is blind to case identity and automatic scores while scoring, but it is not
independent.

## Gates (the established revision gates)

| Measure | Gate |
| --- | --- |
| Outcomes as expected | ≥ 85 % (≥ 23 / 26) |
| Requested change present in proposals | ≥ 75 % |
| Size handled as asked (envelope and stated part sizes) | ≥ 90 % of proposals |
| Open requests genuinely open | ≥ 90 % of open-case proposals |
| Unrepresentable features listed | ≥ 80 % (≥ 4 / 5) |
| Visual review mean, dialog method | ≥ 1.2 (over 25 cases; errors count 0) |
| Revision waiting median | ≤ 60 s |
| Timeouts | ≤ 5 % (≤ 1 / 26) |
| Safety | no leaks; every proposal labelled live with its model |

## Closing M2

M2 closes only if this run passes every gate above. It must do so alongside the GEN-03
description, edit, safety and measurement gates, which the default already passed. If any gate
fails, M2 stays open, and the report names the failing measure, its cases and the next task.
No second full live evaluation is started automatically.

**Not claimed.** Provisional geometry does not establish mass, strength, operation, chemistry or
real-world fitness. Timings come from a script, not a user study, and no participants were
involved.
