# GEN-08 report: revision evaluation and the M2 decision

**Result.** On a new frozen set of 26 revision cases, run once on the default model
(`qwen3-235b-a22b-instruct-2507`), **every pre-registered revision gate passes**:

| Measure | Result |
| --- | --- |
| Outcomes as expected | 26/26 |
| Requested change present | 25/25 |
| Size handled as asked, stated part sizes included | 25/25 |
| Open requests genuinely open | 3/3 |
| Undrawable features listed | 5/5 |
| Waiting median | 29.5 s |
| Timeouts | 0/26 |
| Safety and provenance | clean |
| **Visual mean, dialog method** | **1.24** (gate 1.2) |

The GEN-03 description, edit, safety and measurement gates already passed. Under the criteria
committed before the run (`51d052d`), **M2 closes**.

**The visual pass is narrow.** Two fewer points across 25 sheets would have failed it. The
reviewer is the assistant running the evaluation, so the review is blind but not independent.
Six of the fifteen weak sheets carried a warning before Apply; nine did not, and two of those
are genuinely misleading (below).

## Run conditions

- **Model and path.**
  - Model: `qwen3-235b-a22b-instruct-2507`, the only model run.
  - Prompt `gen-05.1`, with the GEN-06 checks and adjustments.
  - Via `POST /api/v1/assist/model-revisions`, in-process, at code `51d052d`, run by
    `scripts/evaluate_gen05.py --set docs/assist-evaluation/gen-08`.
- **Timing.**
  - One sequential pass from 2026-10-16 06:56:49 to 07:11:51 UTC (15.0 min).
  - Request time 901.9 s, against 901.8 s of real time.
  - The host was kept awake (`caffeinate -i -w <pid>`), and there were **no run faults**.
- **Calls.** **32 provider calls** for 26 requests. Six requests used the one shared retry (s1,
  s2, p1, q1, q2, d1), and none was cut short by the budget.
- **No repeats.** Nothing was repeated, and there were no diagnostic retries.
- **Pilot.** The pilot ([../gen-08-pilot/](../gen-08-pilot/README.md)) ran the whole path on
  three new development cases first. It found two renderer faults, which were fixed before the
  freeze.

## Gates

| Measure | Result | Gate | |
| --- | --- | --- | --- |
| Outcomes as expected | 26/26 | ≥ 85 % | ✓ |
| Requested change present in proposals | 25/25 | ≥ 75 % | ✓ |
| Size handled as asked (envelope; stated part sizes d1–d3 3/3 kept) | 25/25 | ≥ 90 % | ✓ |
| Open requests genuinely open | 3/3 | ≥ 90 % | ✓ |
| Unrepresentable features listed | 5/5 | ≥ 80 % | ✓ |
| **Visual review mean, dialog method** (25 cases; errors count 0; there were none) | **1.24** (2: 10, 1: 11, 0: 4) | ≥ 1.2 | ✓ |
| Waiting median (26 requests) | 29.5 s (p95 83.0 s, max 86.2 s) | ≤ 60 s | ✓ |
| Timeouts | 0/26 | ≤ 5 % | ✓ |
| Safety and provenance | 0 leaks; 25/25 proposals labelled live with the model | clean | ✓ |

**Context, not gated** (each a different viewing method; not comparable as if the conditions
were the same):

- **The fixed GEN-05 camera** (light background, no edges): mean **1.08** over 25 rendered
  proposals (2: 8, 1: 11, 0: 6). It differs from the dialog method mostly where the dialog opens
  on another view (o1, o4) or shows glass with edges on a dark ground (t3, t4).
- **The dialog method over rendered proposals only:** 1.24 (the same, since no request failed).

**Other diagnostics:**

- first attempt valid 26/26;
- hidden parts 1/25;
- first views chosen: front-right 22, from behind 2 (o1, o4), low 2 (o3, q3).

## What the visibility work did in this run

- **Shared retry:** 6 requests used it. After it, s2 (stop button), p1 (open shelf) and q2
  (motor) showed no problem. s1, q1 and d1 still did, and the dialog shows those before Apply.
- **Estimate enlargement:** none applied. s1's 1 cm light sits on the front face at the edge of
  the recorded depth, so it could not grow without changing the object's size; it is reported as
  too small instead. The **stated sizes** (4 cm light, 30 cm pot, 10 cm button) were all kept.
- **Colours:** s1's "blue" was honoured by the app. c4 drew red and listed only the leather
  texture.
- **Chosen views:**
  - the cable box behind the machine (o1) and the speaker on the back of the screen (o4) opened
    from behind;
  - the valve under the cone (o3) and the drawer (q3) opened on the low view.

## Failures and misleading examples

| Case | Dialog | Fixed | What a viewer sees | Warned before Apply? |
| --- | --- | --- | --- | --- |
| t2 glass door | 0 | 0 | A glass door over the cabinet's **still solid body**: the "glass" shows a grey wall, and its 1-pixel edges barely register. | **No.** The composited check passed on the edges. Misleading. |
| q1 wheels that roll | 0 | 0 | Orange outlines only; the wheels are inside the pallet. | Yes: "hidden inside “pallet”"; rolling listed. |
| s1 blue power light | 0 | 0 | An outline only; the light is 1 cm. | Yes: "too small to see" (no room to enlarge inside the recorded size). |
| o3 drain valve under the cone | 0 | 0 | An outline under the tank in the low view; the valve is not readable. | Yes: "where you asked for it cannot be seen…". |
| t1 glass doors | 1 | 1 | Glass doors only faintly readable (thin edge lines across the shelf fronts). The model also listed "doors" as not shown, although it drew them. | No |
| p3 open frame | 1 | 1 | Open frame shown, but the control panel and stack light float inside it. | **No.** Kept parts are not judged. Misleading. |
| c3 frame red and white | 1 | 1 | The frame is red, but the model turned the screen face white. | No |
| d2 30 cm plant pot | 1 | 1 | The pot is there, but a lower shelf lost a corner (an unrelated part changed). | No |
| d1 4 cm status light | 1 | 1 | A small light, but it sits inside its own mounting post. | Yes |
| s3, s4, o2, q3 | 1 | 1 | Small but present (desk lamp, gauge, bin, drawer). | No (each is above the size threshold) |

**Scored 2** (clearly visible and right in the dialog):

- t3 clear guards and t4 glass screen panel (both with readable edges);
- s2 stop button;
- c1 white legs and green seat; c2 blue cartons on a black pallet; c4 red cushion (leather
  listed);
- p1 open shelf; p2 open frame;
- q2 motor (faster belt listed);
- d3 10 cm red button.

Renders: [renders/dialog/](renders/dialog/) and [renders/fixed/](renders/fixed/), one per case.

## What a beginner can correct without editing a parts specification

All of these are in the dialog:

- **Colour of any material group:** colour pickers per group (fixes c3's white screen face).
- **Overall width, height and depth:** size boxes, recorded as entered by the user (gives room
  for s1's light).
- **Ask again in other words,** or **Start over** with a different request.
- **Turn the view:** Standard view, From behind, Low view, one click each; **Show it** outlines
  the part a warning names.
- **Apply to one object or all of them,** with the effect on each object shown.

Moving, resizing or removing one part (t2's solid body, p3's floating panel, d2's damaged shelf,
q1's buried wheels) still needs the parts list, which is not beginner-friendly.

## Decision

- **M2 closes.** Every applicable gate passes on the pre-registered rules, alongside GEN-03's
  description, edit, safety and measurement gates.
- **The caveats are part of the record:**
  - the visual margin is 0.04 above the gate;
  - the reviewer is not independent;
  - 9 of the 15 weak sheets carried no warning;
  - t2 and p3 look done but are not.
- `qwen3-235b-a22b-instruct-2507` stays the default.

**Next issue: GEN-09, misleading-but-unwarned revisions** (quality, after M2):

- A transparent part placed in front of a solid part of the same object is warned about ("you
  will see the solid body through it").
- Kept parts left floating by a revision are warned about.
- Unrelated parts changed by fitting or separation are warned about.
- Edges on light surfaces are made thicker or darker, so the check's edge threshold matches what
  people notice.
- Simple part actions (remove, move, resize one part) are added for beginners.
- An independent reviewer or a small user study replaces the self-review.

## Not claimed

Provisional geometry does not establish mass, strength, operation, chemistry or real-world
fitness. Timings come from one scripted sequential run, not a user study, and no participants
were involved. The visual review was done by the assistant running the evaluation, blind to case
identity and automatic scores while scoring, but not independent.
