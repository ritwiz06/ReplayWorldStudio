# GEN-04 frozen revision evaluation: criteria

Written and committed with `revisions.json` before the cases are run. Thresholds, denominators and
scoring rules below do not change after results are seen; a later fix is tested on new cases, not
these. The GEN-03 held-out set, its scores and its reported failures are not touched or rescored.

## What is evaluated

GEN-04 makes model revisions honest about partial requests: a useful partial proposal that draws
the drawable part and lists the rest, a wholly unsupported request that changes nothing, and an
already-satisfied request that creates no new asset version. These 20 new cases test that on the
default model only.

- **Model:** `qwen3-235b-a22b-instruct-2507` (ASU Voyager), the default kept by GEN-03. No other
  model is run.
- **Path:** the API endpoint `POST /api/v1/assist/model-revisions`, with the revision prompt
  `gen-04.3`, schema-guided output, one retry after an invalid answer, at most one openness
  feedback retry, a 150 s request timeout and the API's own checks.
- **Runs:** one sequential run, one request at a time, each case once. Nothing is automatically
  repeated. Any diagnostic retry is written to a separate file and never replaces or joins the
  frozen result.

## Cases (20)

`revisions.json` contains 18 target models and 20 cases. 10 of the cases use photo-made objects,
which come from the app's photo import of `living-room.webp` and `classroom.jpg` using recorded
answers. The other targets are 6 builder templates and 3 objects described in GEN-01 recordings.
None of the targets or instructions comes from the GEN-03 held-out set or the GEN-04
development cases.

| Group | Cases | Expected outcome |
| --- | --- | --- |
| Mixed drawable / undrawable | m01–m05 | `partial`: a proposal that draws the drawable part, with the undrawable part listed in `not_represented` |
| Wholly unsupported | u01–u03 | `unsupported`: no change, every requested feature listed |
| Open structures | o01–o05 | `proposal`: the solid or closed body becomes genuinely open |
| Colour or part changes | c01–c05 | `proposal` |
| Already satisfied | s01–s02 | `already_satisfied`: no change, no new version |

## Scoring rules (per case)

- **Outcome as expected.**
  - `partial`: the API outcome is `proposal` with `partial: true`.
  - `proposal`: the outcome is `proposal`, partial or not. Any listing in such a case is reported
    as a diagnostic.
  - `unsupported` and `already_satisfied`: that exact outcome.
  - An HTTP error or a timeout is a wrong outcome.
  - A no-op counts as correct only in the two cases that expect `already_satisfied`.
- **Requested change present.** Every `visible_change` check holds on the proposed spec:
  - `material:a|b`: some part uses one of the listed materials;
  - `part:a|b`: some part label contains one of the words;
  - `parts:+n`: the part count rose by at least n.

  The denominator is every proposal in a case with `visible_change` checks.
- **Size handling.**
  - `keep`: the envelope is unchanged (within 1e-6 m).
  - A stated change is met within 1 cm.

  The denominator is every proposal.
- **Genuinely open.** In an `open` case, the largest part fills less than 50 % of the envelope.
  The denominator is the proposals in the 5 open cases. A missing proposal is already an outcome
  failure.
- **Unrepresentable features listed.** Each `unrepresentable` keyword group appears, matched
  case-insensitively, in the `not_represented` list.
  - The denominator is all 8 mixed and unsupported cases.
  - An error, a timeout or a proposal without a listing counts as not listed.
  - Imitating such a feature with a cosmetic shape or colour is a failure of the outcome, the
    listing, or both, and is also named in the failure list.
- **Visual review.** For each proposal, the before and after models are rendered with the app's
  generator.
  - The reviewer scores each sheet before reading any automatic score or the model's answer
    text. The sheets are numbered in a shuffled order and show only the instruction and the two
    renders; the case key is opened after scoring.
  - 2 = the drawable change is clearly visible and right; 1 = partly; 0 = missing or wrong.
  - The mean is taken over rendered proposals.
  - The reviewer is Claude (the assistant running the evaluation), not a study participant.
- **Waiting.** Wall time of each request through the endpoint, retries included.
  - The median and p95 cover all 20 requests.
  - A timeout is a 504 or a provider attempt that did not answer within 150 s.

Diagnostics are reported but are not gates:

- first-attempt validity and retries;
- unrelated parts kept (`keep_other_parts`);
- listings in cases that expected none;
- answer length;
- hidden parts;
- separated overlaps;
- leaked secrets or prompts.

## Gates (the existing GEN-03 revision gates)

| Measure | Gate |
| --- | --- |
| Outcomes as expected | ≥ 85 % (≥ 17 / 20) |
| Requested change present in proposals | ≥ 75 % |
| Size handled as asked | ≥ 90 % of proposals |
| Open requests genuinely open | ≥ 90 % of open-case proposals |
| Unrepresentable features listed | ≥ 80 % (≥ 7 / 8) |
| Blind visual review mean | ≥ 1.2 |
| Revision waiting median | ≤ 60 s |
| Timeouts | ≤ 5 % (≤ 1 / 20) |

## Closing M2

M2 closes only if this run passes every gate above. It must do so alongside the GEN-03
description, edit, safety and measurement gates, which the default already passed. If any gate
fails, M2 stays open, and the report names the failing measure, its cases and the smallest next
task.

**Not claimed.** Provisional geometry does not establish mass, strength, operation, chemistry or
real-world fitness. Timings come from a script, not a user study, and no participants were
involved.
