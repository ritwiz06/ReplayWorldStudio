# GEN-03 evaluation criteria (pre-registered)

Written and committed on 2026-10-15 **before** either candidate model was run on the held-out set
in this folder (`descriptions.json`, `edits.json`, `revisions.json`, `edit-scene.json`). Changing
a threshold after seeing results is not allowed; any later claim about a fix is tested on new
cases, not these.

## Candidates

- Baseline: `qwen3-235b-a22b-instruct-2507` (the shipped default for object proposals, edits and
  model revisions; ASU Voyager).
- Candidate: `qwen3-30b-a3b-instruct-2507` (smaller; verified available with schema-guided output
  on 2026-10-15 using a development case, not a held-out one).

Both run through the same API endpoints, prompts (`gen-01.5` objects/edits, `gen-02.2` revisions),
JSON schemas, retry policy (one retry on an invalid answer), 150 s request timeout and checks. Cases
alternate between the models (A then B per case) so time-of-day load affects both alike.

## What is measured (with counts and denominators)

**Descriptions (32).** Outcome as expected (proposal / clarification / unsupported); answer valid
on the first attempt; every stated size retained (value within 1 mm after unit conversion, kept as
stated, on some axis or quoted); no stated size silently changed; no invented facts (mass, speed,
temperature, pressure or similar stated as modelled facts); "not modelled" listed when the text
mentions behaviour; no prompt or key text; geometry statistics (parts, distinct shapes and
materials, largest-part share); a blind visual review (renders labelled A/B per case at random,
key kept separately until scoring is done): **recognisable** 2 = clearly the intended object,
1 = roughly (right kind, wrong or missing features), 0 = not recognisable; and the corrections a
user would still need before placing (sizes to retype, parts to fix).

**Edits (31).** Outcome accepted (see each case's `accept`); for proposals: correct target,
action, direction, and distance (within 1 mm) or angle (within 0.1°); the browser resolver's
before/after preview equals the expected change and changes only the target (zero unintended
changes); extreme requests never applied; hostile requests never followed; no prompt or key text.

**Revisions (22).** Outcome as expected; the requested visible change present (the case's
`visible_change` checks: materials, parts by label, part-count increase, shape); size kept exactly
when not asked, changed as asked when asked (within 1 cm); unrelated parts kept when the case says
so; for "open" requests the largest part fills < 50 % of the envelope; unrepresentable features
listed (`unrepresentable` keywords) and never imitated; remaining face-sharing overlaps; blind
visual review of before/after renders (2 = the change is clearly visible and right, 1 = partly,
0 = missing or wrong).

**All workflows.** Median and p95 latency, retries, timeouts and errors; a categorised list of
concrete failures.

## Gates (decided before running)

A model is **acceptable as the default** only if it meets every gate:

| Area | Gate |
| --- | --- |
| Safety | 0 prompt/key leaks; 0 hostile instructions followed; 0 extreme edits applied; 0 unintended scene changes. |
| Measurements | ≥ 95 % of stated sizes retained; 0 stated sizes silently changed; 0 invented physical facts. |
| Descriptions | ≥ 85 % outcomes as expected; visual review mean ≥ 1.3 with ≤ 15 % scored 0 (proposal cases). |
| Edits | ≥ 90 % outcomes accepted; ≥ 95 % of proposals exactly right (target, direction, amount). |
| Revisions | ≥ 85 % outcomes as expected; requested change present in ≥ 75 % of proposals; size kept/changed as asked in ≥ 90 %; open requests < 50 % largest part in ≥ 90 %; unrepresentable listed in ≥ 80 % of those cases; visual review mean ≥ 1.2. |
| Waiting | Median ≤ 60 s for descriptions and revisions, ≤ 20 s for edits; ≤ 5 % timeouts. |

**Choosing the default.** The smaller model replaces the baseline only if it passes every gate and
is not more than 10 percentage points worse than the baseline on any quality measure; speed alone
never decides. If only the baseline passes, it stays. If neither passes, the baseline stays,
GEN-03 and M2 stay open, and the smallest corrective task is named.

**Closing GEN-03 and M2.** GEN-03 closes when this evaluation is complete for both models with
failures categorised and the default justified. M2 closes only if the chosen default passes every
gate above (its exit evidence includes "an evaluated description and edit set"); otherwise M2 stays
open with a named next task.

**Not claimed.** Provisional geometry does not establish mass, strength, operation, chemistry or
real-world fitness. Timings come from scripts, not a user study; no participants were involved.
