# GEN-04 report: honest partial revisions

**Result.** On a new frozen set of 20 revision cases, run once on the default model
(`qwen3-235b-a22b-instruct-2507`), the revision outcome and listing problems from GEN-03 are
fixed:

| Measure | GEN-03 | GEN-04 |
| --- | --- | --- |
| Outcomes as expected | 17/22 | 18/20 |
| Unrepresentable features listed | 1/3 | 8/8 |

Every mixed request became a partial proposal that drew the drawable part and listed the rest.
Every wholly unsupported request changed nothing and listed what was asked. Both
already-satisfied requests changed nothing.

**Two gates still fail:**

- **Timeouts:** 2/20 (10 %), against a gate of 5 %. Both happened while the computer running the
  script was asleep; a separate diagnostic retry of the two cases answered in 85.6 s and 55.8 s.
- **Visual review mean:** 1.15, against a gate of 1.2.

**M2 stays open.** The next issue is named at the end of this report.

The cases, criteria and tooling were frozen in commit `1f8d31b` before the run. The GEN-03 set,
its scores and its reported failures are unchanged.

## Run

- **Model and path.**
  - Model: `qwen3-235b-a22b-instruct-2507` on ASU Voyager, the only model run.
  - Prompt `gen-04.3`, via the API's `POST /api/v1/assist/model-revisions` endpoint, called
    in-process.
  - Schema-guided output, one retry after an invalid answer, at most one openness feedback
    retry, and a 150 s timeout per attempt.
- **Conditions.** One sequential pass from 23:15 UTC on 2026-10-15, one request at a time, each
  case once. Wall time includes retries. Live results only, and no case was repeated in the frozen
  result.
  - The computer running the script went to sleep twice during the run, both times while o04 and
    o05 were in flight; see *Timeouts* below.
  - One diagnostic retry of those two cases was made afterwards and is kept separate
    (`results/diagnostic-sleep-check.json`).
- **Inputs.** 18 targets and 20 cases (10 on photo-made objects). See [README.md](README.md) and
  [criteria.md](criteria.md).
- **Pilot.** The runner, scorer and renderer were tested on synthetic rows and stand-in models
  before the run (`tests/test_gen04_evaluation.py`; a render pilot in a scratch folder). The
  development cases were run live during development (`gen-04.1`–`gen-04.3`) with
  `scripts/evaluate_model_revisions.py`, not with this runner. No tooling fault appeared.

## Gates

| Measure | Result | Gate | |
| --- | --- | --- | --- |
| Outcomes as expected | 18/20 (90 %) | ≥ 85 % | ✓ |
| Requested change present in proposals | 12/13 (92 %) | ≥ 75 % | ✓ |
| Size handled as asked | 13/13 | ≥ 90 % | ✓ |
| Open requests genuinely open (largest part < 50 %) | 3/3 | ≥ 90 % | ✓ |
| Unrepresentable features listed | 8/8 | ≥ 80 % | ✓ |
| Visual review mean (13 proposals) | **1.15** (two: 3, zero: 1) | ≥ 1.2 | ✗ |
| Waiting median (20 requests) | 39.4 s (p95 150.2 s, max 181.4 s) | ≤ 60 s | ✓ |
| Timeouts | **2/20 (10 %)** | ≤ 5 % | ✗ |

Outcomes by group:

| Group | Outcomes as expected |
| --- | --- |
| Mixed | 5/5 (all partial) |
| Unsupported | 3/3 |
| Open structures | 3/5 (o04 and o05 timed out) |
| Colour or part changes | 5/5 |
| Already satisfied | 2/2 |

Safety: no leaks of the key or prompt (0/20). First attempt valid: 18/20.

The two failing gates are close to their limits: one fewer timeout would pass the timeout gate,
and one more point on any sheet would make the mean 1.23.

## Failures

**Timeouts (the timeout gate).** These were most likely caused by the computer running the script
going to sleep, not by Voyager. This was found after the run, and the frozen result is not changed.

| | o03 → o04 | o04 → o05 | Every other case |
| --- | --- | --- | --- |
| Real time between the end of one case and the end of the next | 41.8 min | 44.9 min | at most 1.8 min |
| Measured (monotonic) time of the request | 181.4 s | 150.2 s | within 1 s of the real time |

The runner timed each request with Python's monotonic clock, which on macOS stops while the
computer sleeps. Since cases run back to back, the gaps mean that about 39 and 42 minutes of sleep
fell inside these two requests. No other request was affected.

- **o04 (builder cabinet → "open coat locker").**
  - The first answer arrived in 31.4 s. It removed the door and handle and added a hat shelf and
    a rail, but it kept the solid cabinet body (53 % of the object).
  - The openness guard therefore sent its one feedback retry. That retry, which ran during the
    sleep, did not answer within 150 s.
- **o05 (builder pallet → "empty open wire cage").** The first attempt, which also ran during the
  sleep, gave no answer within 150 s.
- **Diagnostic retry** (after the run, sleep prevented with `caffeinate`; separate file, not
  scored as the result):
  - o04 answered in 85.6 s. Its first answer was again solid, and the openness retry produced
    side panels, a hat shelf and a rail (largest part 4 %).
  - o05 answered in 55.8 s with a wire cage of posts and rails on the pallet (largest part 24 %).
  - Both pass their change and openness checks.
- **What this does and does not show.**
  - Under the pre-registered rules the gate fails (2/20).
  - The diagnostic suggests that the provider answers these two cases within the timeout when
    the computer stays awake, but one retry each is not a measurement of the timeout rate.
  - The runner now records real elapsed time (`clock_s`) beside the monotonic time, so such
    pauses are detected, and the README says to run under `caffeinate`.

**Visual review (the visual gate).** The scores are from the blind sheets; the causes were found
after unblinding.

| Case | Score | What the picture showed | Cause |
| --- | --- | --- | --- |
| m01 (sofa: two cushions) | 0 | No visible cushions. | The two cushions are grey fabric on a grey fabric seat, half sunk into it. The automatic check counts them as present. |
| c03 (e-stop box) | 1 | A dark box. | The red button sits wholly inside its black box (a hidden part). |
| c05 (stack light) | 1 | A small grey box. | The stack light is a plain grey cylinder, floating above one end. |
| c01 (red cushion) | 1 | A grey cushion. | The model wrote "red fabric is not available" and listed "red cushion" as not shown. Red paint materials exist, so this listing is wrong. |
| c02 (cable tray) | 1 | No tray visible. | A tray part exists under the top but cannot be seen from the review view. |
| o03 (slatted crate) | 1 | Solid sides. | The sides are solid boards, with no gaps between slats. The model also listed "open-top" as not shown, although it drew an open top (a wrong listing, kept because it repeats the user's words). |
| m02 (glass top) | 1 | A faint top. | The top is clear glass and nearly invisible in the render. |
| m04 (tank ladder) | 1 | Hard to read. | The ladder is thin cylinders close to a leg. Fitting also scaled every part ×0.769 in height. |
| c04 (taller, pegboard) | 1 | Pegboard visible. | The height change cannot be judged in an auto-framed render; the 20 cm change itself is correct. |
| m03 (soundbar) | 1 | Bar overlapping the screen. | The soundbar overlaps the screen face instead of sitting below it. |

**Change-present failure (1/13).** c01 has no red material, for the reason in the table above.

**Diagnostics (not gates).**

- Unrelated parts kept exactly: 4/7. m04, c03 and c05 rescaled everything slightly in fitting,
  ×0.769 to ×0.973 on one axis; this is reported in the checks.
- Listings in cases that expected none: o03 and c01, both described above.
- Hidden parts: 1/13 (c03).
- Longest answer: 5,122 characters (o02, 107.9 s).

## Visible examples

Renders: [renders/](renders/). Each shows the instruction, then the before and after models.

- **Partial, done well.**
  - m05 (photo-made low bookshelf): "add glass doors on the front that lock with a key". Clear
    doors are drawn, and "lock with a key" is listed. Score 2.
  - The browser review of a partial revision is shown in [docs/gen-04/improve-partial.jpg](../../gen-04/improve-partial.jpg).
    This is the recorded development answer for a photo pallet: boxes are drawn, "caster wheels
    that actually roll" is listed, and **Apply the drawable part to this object** is offered.
- **Open structures.**
  - o01: photo-made media player → an open shelving tower with four shelves. Score 2.
  - o02: machine → an open frame of corner posts and rails. Score 2.
- **Wholly unsupported.**
  - u01, "make it smell of lavender", listed "smell of lavender".
  - u02, "run quieter, use less electricity", listed both.
  - u03, "hold 150 kg, fully waterproof", listed both.
  - None of them changed the model. The dialog's refusal is shown in
    [docs/gen-04/improve-unsupported.jpg](../../gen-04/improve-unsupported.jpg) (a fixed test
    answer, not live).
- **Already satisfied.** s01 (6.8 s) and s02 (53.9 s). No change and no version.

## Waiting time and response length

- **The GEN-03 open-cubbies timeout (r04).**
  - Its single attempt produced nothing within 150 s.
  - GEN-03's answers arrived at a median of 35.1 characters per second (17.8–49.7), so wait time
    follows answer length.
  - The GEN-02 prompt asked for the complete parts list. A cubby unit with bins needs 30–40
    parts, about 10,000 characters, which cannot finish inside 150 s.
- **What changed.** Prompt `gen-04.3` asks for changes only. `repeat` covers rows and grids, and
  more than 40 parts is an explicit limitation rather than a silent cut.
- **Development cases (the four GEN-02 cases, one live run each, before and after; variance not
  measured).**
  - Wait: 75.9 / 36.9 / 106.2 / 29.4 s → 50.9 / 27.3 / 71.3 / 29.5 s, from 248.4 to 179.0 s in
    total (−28 %).
  - Answer length: 2,426 / 1,335 / 5,127 / 1,429 → 2,041 / 1,404 / 2,388 / 1,250 characters,
    from 10,317 to 7,083 in total (−31 %).
- **The new development case "twelve open cubbies with a bin in each"** still took 143.1 s over
  two attempts, and its answer used fewer bins than asked. It is a known limitation, not fixed.
- **Frozen run.**
  - Median 39.4 s; p95 150.2 s.
  - Answers: median 1,114 characters, 1,146 for proposals; maximum 5,122.
  - Throughput: median 32.0 characters per second (19.8–48.5), unchanged from GEN-03.
  - These are different cases from GEN-03's (median 49.0 s, p95 128.2 s, one timeout in 22), so
    the two runs are not a like-for-like comparison.
- **What is claimed.** Shorter answers on the development cases, and a lower median on this set.
  The tail is not fixed: two timeouts, one of them caused by the openness retry.

## Decision

- **M2 stays open.** The description, edit, safety and measurement gates from GEN-03 still pass,
  but two GEN-04 revision gates fail:
  - **the visual review mean (1.15).** This is a real quality failure: added parts are hard or
    impossible to see.
  - **timeouts (2/20).** These most likely reflect the computer sleeping during the run, but the
    frozen result counts them.

  Even if both timed-out cases had produced proposals, the visual gate would still decide.
- **GEN-04 is closed with its last criterion not met.** The partial, unsupported and
  already-satisfied behaviours work, and the frozen evaluation was run and reported. Two of its
  eight gates fail, so its "passes the revision gates" criterion is not met. Those two failures
  are carried to GEN-05.
- `qwen3-235b-a22b-instruct-2507` stays the default.

**Next issue: GEN-05, visible and time-bounded revisions** (M2 corrective task; smallest scope):

1. **Make added parts visible (the remaining quality failure).** A deterministic check flags any
   added part that is:
   - wholly inside another part;
   - sunk more than half into a part of the same material;
   - or floating.

   Each flagged part gets one feedback retry within the time budget, and is otherwise reported in
   the dialog.
2. **Distinct colours for named parts.** Use a contrasting material for a part whose colour the
   user did not name (for example a cushion on a seat). Never claim a requested colour is
   unavailable when an approved material matches it.
3. **Bound the total wait.**
   - The openness retry may only run if it can finish within one 150 s budget, counted from the
     start of the request. Otherwise the request is refused with the explicit "not open" message.
   - Open answers that keep the solid body are still common (o04 did it twice), so the prompt
     should also make removing the body easier.
4. **Run conditions.** Keep the host awake, record real and monotonic time, and treat a paused
   request as a run fault to report, never as a silent result.
5. **Re-test on a fresh frozen set** (never this one) against the same gates.

## Not claimed

Provisional geometry does not establish mass, strength, operation, chemistry or real-world
fitness. Timings come from one scripted sequential run, not a user study, and no participants
were involved.

The visual review was done by the assistant running the evaluation. It was blind to case identity
and to the automatic scores while scoring, but it was not independent.
