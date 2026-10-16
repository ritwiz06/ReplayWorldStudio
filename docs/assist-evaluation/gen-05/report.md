# GEN-05 report: visible, time-bounded revisions

**Result.** On a new frozen set of 22 revision cases, run once on the default model
(`qwen3-235b-a22b-instruct-2507`), every automatic revision gate passes, including the timing
gates GEN-04 failed:

- no timeouts (0/22);
- median 39.6 s, p95 105.7 s;
- the longest request 108.6 s, inside the one 150 s budget.

**The visual review fails: mean 1.10 against the 1.2 gate.** Transparent additions were
practically invisible and were not reported, and many small additions stayed hard to see.
**M2 stays open.**

The cases, criteria and tooling were frozen in commit `7e7c473` before the run. The GEN-03 and
GEN-04 inputs and results are unchanged.

## Run conditions

- **Model and path.**
  - Model: `qwen3-235b-a22b-instruct-2507`, the only model run.
  - Prompt `gen-05.1`, via `POST /api/v1/assist/model-revisions` in-process (feature commit
    `586eb71` plus the check fixes in `7e7c473`).
  - One 150 s budget per request, and at most one shared retry.
- **Timing.**
  - One sequential pass, 2026-10-16 04:33:56–04:52:01 UTC, one request at a time, each case
    once.
  - Total request time 1,085.2 s (18.1 min), equal to the real elapsed time (1,085.1 s).
- **Host.** The runner kept the computer awake (`caffeinate -i -w <pid>`). Every request
  recorded the request timer and the real clock; **no run faults** (no difference above 5 s).
- **No repeats.** No case was repeated, and there were no diagnostic retries of this set.
- **Pilot.** The full path was first run on three new development examples
  ([../gen-05-pilot/](../gen-05-pilot/README.md)). It found two check gaps, which were fixed
  before the freeze.

## Gates

| Measure | Result | Gate | |
| --- | --- | --- | --- |
| Outcomes as expected | 21/22 (95 %) | ≥ 85 % | ✓ |
| Requested change present in proposals | 19/20 (95 %) | ≥ 75 % | ✓ |
| Size handled as asked | 20/20 | ≥ 90 % | ✓ |
| Open requests genuinely open | 2/2 (o04 failed earlier, as an outcome) | ≥ 90 % | ✓ |
| Unrepresentable features listed | 5/5 | ≥ 80 % | ✓ |
| **Visual review mean (20 proposals)** | **1.10** (two: 7, one: 8, zero: 5) | ≥ 1.2 | ✗ |
| Waiting median (22 requests) | 39.6 s (p95 105.7 s, max 108.6 s) | ≤ 60 s | ✓ |
| Timeouts | 0/22 | ≤ 5 % | ✓ |

- **By group:** visible additions 6/6, open structures 4/5, transparent 3/3, explicit colours
  3/3, partial 4/4, already satisfied 1/1.
- **Retries:** 7 of 22 requests used the one shared retry (v01, v03, v04, o04, o05, p03, p04).
  No retry was cut short by the budget.
- **Other diagnostics:**
  - leaks 0;
  - first attempt valid 21/22;
  - hidden parts 0/20;
  - unrelated parts kept exactly 2/6 (fitting rescales slightly);
  - longest answer 2,994 characters.

## Failures

**Visual review (the failing gate).** Seven sheets scored 2, eight scored 1 and five scored 0.
The scores were given blind; the causes below were found after unblinding.

| Case | Score | What the picture showed | Cause | Warned before Apply? |
| --- | --- | --- | --- | --- |
| t02 (clear plastic side panels) | 0 | Nothing at the ends. | The panels exist and are 49–64 % unoccluded in the render check, but at 20 % opacity they cannot be seen against the light background. | **No** |
| t03 (glass back panel) | 0 | Nothing behind the shelves. | Same cause as t02 (glass at 25 % opacity). | **No** |
| e03 (black legs, dark blue fabric armrests) | 0 | No change. | A parsing gap: "the armrests dark blue fabric" follows "and" without its own verb, so the colour was not tied to the armrests. Blue was not honoured, and the model listed the whole "dark blue fabric" as not shown. | Listed as not shown |
| p03 (white wall bracket behind the screen) | 0 | No bracket. | Behind the screen, where the user asked. | Yes: "where you asked for it cannot be seen…" and "sunk 50 %…" |
| p04 (red drain valve at the bottom of the cone) | 0 | No valve. | Under the tank. | Yes: "cannot be seen from the usual front-right view" |
| v01 (red stop button on the front edge) | 1 | A red speck at the back edge. | Small (9 cm on a 2.25 m table), and placed at the back. | Yes: "too small to see" |
| v03 (green status lamp on a post) | 1 | A green dot. | 6 cm on a 2 m rack. | Yes: "too small to see" |
| v04 (desk lamp) | 1 | A small pale shape. | Small; the lamp's arm and head do not touch the joint. | Yes: tiny and floating |
| v05 (grey webcam) | 1 | A pale bump. | 10 cm across, 16 pixels; above the "too small" threshold. | No |
| p02 (red label holders) | 1 | Small red marks. | Small. | No |
| t01 (clear glass top) | 1 | A faint outline. | Glass at 25 % opacity. | No |
| o01 (open cube shelf) | 1 | Two side panels and thin shelves. | Open, but no top, bottom or back; the shelves are barely visible. | No |
| o03 (drawer unit to open shelves) | 1 | Barely readable. | Small at this view. | No |

- **Warnings before Apply.** Of the 13 sheets scored below 2, 5 carried a warning (v01, v03,
  v04, p03, p04), and e03 listed its colour as not shown. The transparent parts (t01–t03) and
  four small or thin items (v05, p02, o01, o03) had no warning.
- **One over-strict warning.** o05 (slatted backrest) was scored 2, yet warned that its slats
  "float". The slats end 1.65 cm from the posts, just beyond the touch tolerance (1.6 cm at
  this size).

**Outcome failure (1).** o04 (wire basket) returned HTTP 502 after 108.6 s. Both answers changed
part ids that did not exist ("bar-left", …), which is an unusable answer, not a timeout.

**Change-present failure (1).** e03 has no blue material, as above.

## What GEN-05 fixed (development evidence and this run)

- **Time.** One budget with one shared retry. No request exceeded 108.6 s, against GEN-04's
  181.4 s and GEN-03's single 150 s attempt. No retry was cut by the budget.
- **GEN-04's invisible additions** (development regressions, `docs/assist-evaluation/gen-05.1.json`;
  development evidence, not a held-out result):
  - fixed by the retry: the stop button moved out of its box, and the cable tray came out of the
    worktop;
  - recoloured: the cushions, so they stand out from the seat;
  - still reported as problems: the stack light's 11 cm gap and the crate's floating top slats.
- **In this run:**
  - The added cushion (v02), throw pillows (v06, recoloured white for contrast), seat pad (p01,
    green as asked), slatted backrest (o05) and colour changes (e01, e02) were clearly visible.
  - The retry rarely removed the problem: six of the seven retried requests still ended with a
    problem listed, which the dialog shows before Apply. The seventh, o04, had no usable answer.

## Visible examples

[renders/](renders/) holds the instruction plus before and after for each proposal.

- **Scored 2:**
  - o02, a solid chest made into an open shelf unit;
  - o05, a slatted backrest;
  - e01, yellow legs and an orange seat;
  - e02, yellow legs and a white shell;
  - v02, a cushion on the blue chair;
  - v06, white throw pillows;
  - p01, a green seat pad, with "fold flat" listed.
- **Failures:** t02 and t03 (invisible transparent panels), e03 (blue not honoured), and
  p03/p04 (parts placed out of view, warned).

## Decision

- **M2 stays open.** The description, edit, safety and measurement gates from GEN-03 still
  pass, and every automatic GEN-05 revision gate passes. The visual review mean is 1.10, against
  the 1.2 gate.
- **The concrete remaining failure:** what users see in the default preview.
  - Transparent additions are not recognisable, and nothing warns about them.
  - Requested small items stay too small.
  - A colour after "and" without its own verb is missed.
  - Parts placed behind or under something are honestly warned about, but cannot be judged from
    the one preview view.
- **GEN-05 is closed with its last criterion not met.** Visible checks, one shared retry, one
  budget, cancellation and the before-Apply warnings work, and the frozen evaluation was run and
  reported. Its visual gate failed; that failure is carried to GEN-06.
- `qwen3-235b-a22b-instruct-2507` stays the default.

**Next issue: GEN-06, recognisable additions in the preview** (M2 corrective task):

1. **Transparent parts recognisable.** Draw glass and clear plastic with a visible edge or a
   higher minimum opacity. This is a generator change, so the generator version and hashes
   change, and existing models must stay rebuildable. Count perceptual contrast, not raw pixels,
   in the visibility check.
2. **A minimum visible size for requested small items.** When the user gives no size, scale the
   item deterministically up to the minimum instead of only warning. Say so in the change list.
3. **Colour phrases after "and"** take the clause's verb ("make the legs black and the armrests
   blue").
4. **A second preview angle**, offered when an addition is placed behind or under something, so
   the user can see it before Apply.
5. **A touch tolerance** that scales with part size, so a 1.6 cm slat gap on a chair is not
   called floating.
6. **Re-test on a fresh frozen set** against the same gates.

## Not claimed

Provisional geometry does not establish mass, strength, operation, chemistry or real-world
fitness. Timings come from one scripted sequential run, not a user study, and no participants
were involved. The visual review was done by the assistant running the evaluation, blind to
case identity and automatic scores while scoring, but not independent.
