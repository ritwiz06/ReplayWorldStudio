# IMG-03 report: accuracy of one photo to an editable world

## Result

**IMG-03 stays open, and so does M3.** No real, independently measured photo exists, so
real-world accuracy is **unmeasured**.

**The missing input:** at least 6 permissioned photos of real indoor sites, from at least 3
scene types, with 40 or more counted objects. Each needs:

- a measured floor rectangle and a check length;
- measured floor positions and sizes for the objects.

[protocol.md](protocol.md) says how to capture them.

**What exists:** the evaluation path and a **synthetic stratum**, 8 held-out renders of
known-geometry rooms (68 counted objects). It verifies the metrics and shows how the method
behaves on exact geometry. **It is not real-world accuracy and is never reported as such.**

Held-out synthetic results for the default model, `qwen3-vl-32b-instruct`, run once:

| | Result |
| --- | --- |
| Precision of the initial proposal | **0.978** (TP 45, FP 1) |
| Recall | **0.662** (FN 23; 10 of them in the one photo whose call timed out) |
| Reviewed world, floor-centre error (not near the horizon) | median **0.17 m**, p90 **0.65 m**, max 1.97 m (n = 48) |
| Reviewed world, visible width error | median **6 %** |
| Near-horizon objects | reviewed median 0.69 m (n = 10); **10/10 flagged** by the app |
| Hidden depth | a guess by design: median absolute error 23 %, up to +386 % for cabinets split from a conveyor's outline |
| Correction effort | about 9 corrections per photo after the model, against 21.5 actions to outline everything by hand |

The paired second model, `llama4-scout-17b`, found **3 of 34** counted objects on its subset.

## Provenance and run

- **Freeze.**
  - Inputs, rules and thresholds: `f44536c` (with the tooling in `7807e9c`), committed and
    pushed before any held-out call.
  - CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38979438108 green.
- **Held-out set.** 8 renders made by this project, which owns them:
  - industrial: `line-a`, `line-b`;
  - storage: `store-a`, `store-b`;
  - office: `office-a`, `office-b`;
  - lounge: `lounge-a`, `lounge-b`.

  Exact ground truth comes from the render: flat-colour passes for what shows, scene geometry
  for positions and sizes, and the exact camera. They hold:
  - 68 counted objects;
  - 31 partly visible;
  - 10 near the horizon;
  - 4 not counted, because less than a quarter of each shows.
- **Development, not scored:**
  - 2 renders (`dev-line-a`, `dev-office-a`);
  - the factory render from IMG-01/02.
- **Default model run.**
  - `qwen3-vl-32b-instruct`, prompt `img-01.2`, temperature 0, schema-guided, 150 s budget, one
    validation retry.
  - 23:04:52–23:13:19 UTC, sequential, host kept awake, no run faults.
  - 8 calls, no retries.
  - **One timeout:** `lounge-a` at 150.1 s. Under the rules it counts as all 10 objects missed.
  - Latency: median 56.7 s, max 150.1 s.
- **Paired model run.** `llama4-scout-17b` on `line-a`, `store-a`, `office-a` and `lounge-a`.
  - Its `lounge-a` answer came back as an `unsupported` result with no proposal (the only
    outcome without one). My runner's progress print then crashed before saving the row, so its
    text was lost. It is scored as a failure, as observed.
  - The runner was fixed to save every row first (`99400d7`). `tests/test_img03_runner.py`
    fails on the old runner and passes on the new one.
  - `store-a` and `office-a` had not been reached. They were then run once each and are not
    replacements.
- **Diagnostics, kept apart and never scored** (`results/diagnostic-*.json`). `lounge-a`
  answered on a second try on both models:
  - `qwen3-vl` in 71.7 s;
  - `llama4-scout` in 15.8 s.
- **Provider wait:** about 16.8 min recorded in all:
  - development probes, 6.1 min (including `glm-4-5v`'s 245 s);
  - the held-out runs, 9.2 min;
  - diagnostics, 1.5 min.
- **Scorer faults found before any number was reported** (`99400d7`; no rule, threshold or input
  changed):
  - **Review protocol:** after a split inserted its pieces, later proposals were looked up by
    position and landed on the wrong objects. A regression test now covers it.
  - **Manual baseline:** it had been skipped for the photo whose model call timed out, although
    it needs no model.
- **Browser cross-check:** the scored world is the world the photo dialog creates
  (`e2e/img03-browser-path.spec.ts`).

## Detection (initial proposal = what the app pre-accepts)

| Scene type | Photos | TP | FP | FN | Precision | Recall |
| --- | --- | --- | --- | --- | --- | --- |
| Industrial | 2 | 8 | 0 | 5 | 1.00 | 0.62 |
| Storage | 2 | 10 | 0 | 5 | 1.00 | 0.67 |
| Office | 2 | 18 | 0 | 2 | 1.00 | 0.90 |
| Lounge | 2 (one timed out) | 9 | 1 | 11 | 0.90 | 0.45 |
| **All** | **8** | **45** | **1** | **23** | **0.978** | **0.662** |

- **All proposals, ticked or not:** TP 45, FP 5, precision 0.90. The 4 extra false positives
  are monitors on machines and on a stand, which the app left unticked.
- **Labels:** the shape family is right for 39 of 45 finds. Errors:
  - cartons on a pallet called "box" (3);
  - a box called "cabinet" (2);
  - one outline matched to the plant was a chair.
- **Group outlines: 6.** Each is a find whose outline also covers a counted object nothing
  else found:
  - two similar racks in one outline, and two similar pallets in another (`store-a`);
  - a rack outline also covering a far pallet (`store-a`), and another covering its twin and a
    cabinet (`store-b`);
  - conveyors whose outlines cover the cabinets standing behind them (`line-a`, `line-b`), one
    also covering a far pallet;
  - a near table covering a far table behind it (`lounge-b`).
- **Duplicates: 1** (`lounge-b`, a plant outlined twice).
- **What was missed: 23.**
  - **Timed out:** 10, the whole of `lounge-a`.
  - **Inside another object's outline:** 11 of the 13 misses in answered photos.
    - the cabinets behind the conveyors (4);
    - twins beside a found rack or pallet (3);
    - far objects behind a near one (3);
    - a cabinet beside a rack (1).
  - **Poor outline:** 2. The screen on a stand, where only the monitor was outlined (IoU 0.42
    and 0.49).

**Paired subset** (`line-a`, `store-a`, `office-a`, `lounge-a`):

| Model | TP | FP | FN | Precision | Recall |
| --- | --- | --- | --- | --- | --- |
| `qwen3-vl-32b-instruct` | 18 | 0 | 16 | 1.00 | 0.53 |
| `llama4-scout-17b` | 3 | 12 | 31 | 0.20 | 0.09 |

`llama4-scout-17b`'s boxes use the same 0–1000 convention but are coarse: snapped to a grid and
shifted 4–9 % of the image height downwards. Most land at IoU 0.1–0.3. It is not a usable
alternative for this task, and `qwen3-vl-32b-instruct` stays the default. `glm-4-5v` failed the
development check: an invalid 14,230-character answer, mostly whitespace, then an empty retry.

## Metres (rectangle's frame, measured against exact geometry)

| World | Stratum | n | Centre median | p90 | Max | Visible width, median abs rel | Hidden depth, median abs rel | Height, median abs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Initial | not near horizon | 42 | 0.18 m | 0.74 m | **4.31 m** | 7 % | 23 % | 0.06 m |
| Initial | near horizon | 3 | 1.21 m | 1.49 m | 1.56 m | 38 % | 38 % | 0.10 m |
| Reviewed | not near horizon | 48 | **0.17 m** | **0.65 m** | 1.97 m | **6 %** | 23 % | 0.05 m |
| Reviewed | near horizon | 10 | 0.69 m | 1.06 m | 1.22 m | 5 % | 63 % | 0.02 m |
| Manual only | not near horizon | 58 | 0.11 m | 0.47 m | 1.88 m | 3 % | 23 % | 0.01 m |
| Manual only | near horizon | 10 | 0.13 m | 1.19 m | 1.36 m | 1 % | 38 % | 0.01 m |
| Reviewed, corners off by 1–2 px | not near horizon | 47 | 0.27 m | 0.66 m | 2.78 m | 6 % | 24 % | 0.09 m |

**Partly visible objects:**

| World | n | Centre median | p90 | Max |
| --- | --- | --- | --- | --- |
| Initial | 15 | 0.31 m | 2.69 m | 4.31 m |
| Reviewed | 25 | 0.38 m | 1.17 m | 1.97 m |

**Every estimated size is labelled** as an estimate or guess in the saved evidence: 45/45,
58/58 and 68/68.

**Calibration.** The synthetic corners are exact.

- The camera height is recovered exactly and the field of view to within 0.004°.
- The depth derived from the width alone is exact in 7 photos and 4 % off in `office-a`, where
  the rectangle's perspective cannot fix the lens.
- **Real marking error is not simulated** beyond the sensitivity row above. Moving each corner
  1–2 px raises the reviewed median from 0.17 to 0.27 m, and the near-horizon median from 0.69
  to 1.14 m.

## Worst measured errors, by cause

1. **Base hidden behind another object (initial proposal).**
   - In `office-a`, the two cabinets against the back wall are partly hidden behind the desks.
     They were placed **4.31 m** and **3.16 m** too far back, beyond the wall.
   - Their outlines stop at the desk tops, so the floor point taken from the outline's bottom is
     well behind the real base.
   - The idealised review, whose outline reaches the floor between the desk legs, brings them
     within 0.23 m.
   - [sheet](sheets/qwen3-vl-32b-instruct/office-a.jpg)
   - **In the browser** ([layout](browser/office-a-layout.jpg),
     [photo's camera](browser/office-a-photo-camera.jpg)), the same answer is replayed offline
     through the real dialog:
     - seen from the photo's own camera, the misplaced cabinets look right, because their outline
       is consistent;
     - only the plan shows them far behind the desks;
     - **no warning mentions them.** The Layout's checks see no clash, and a base hidden behind
       another outline is not flagged.
2. **Turned objects.**
   - The app sets each object facing the camera (its front square to the camera's view of the
     floor), not square to the room.
   - A rack standing side-on (`store-a` `rack-3`) is placed turned and **1.97 m** off in all
     three worlds.
   - **Post hoc, not in the criteria:** placed footprints are turned a median 18.7° (p90 23.5°)
     from the true ones, in every world.
   - [sheet](sheets/qwen3-vl-32b-instruct/store-a.jpg)
3. **Near the horizon.**
   - All 10 near-horizon objects are flagged "nearly on the horizon".
   - Their error after review is still a median 0.69 m, and a 1–2 px corner error doubles it.
   - With pixel-exact outlines (the manual baseline) the median is 0.13 m. The bottom edge of the
     outline decides the distance.
4. **Group outlines and their pieces.**
   - One outline around two objects finds one and misses the other until a reviewer splits it.
   - **In the browser, twins are not suggested for splitting**
     ([store-a](browser/store-a-layout.jpg)). One "large orange and blue shelf" outline covers
     both racks, and one "pallet with stacked boxes" covers both pallets. The IMG-02 split hint
     looks for plural labels such as "with chairs", and these labels are singular.
   - A split piece keeps the group outline's size guess. The cabinets split from the conveyors'
     outlines came out with hidden depths **+314 % to +386 %** of the true one.

**The 5.1 m cabinet (IMG-02) is a development example**, not in this score: the factory render,
a cabinet added by the user. It belongs in category 1 (base hidden behind a machine, placed from
a drawn base). The held-out `office-a` cabinets are fresh measurements of the same failure in the
initial proposal.

## Correction effort

- **Primary measure: action counts** from the declared protocols. The reviewed world, after
  the model, needed per photo a median of 9 (max 11):

  | Action | Total over 7 photos |
  | --- | --- |
  | Tighten an outline | 21 |
  | Set visibility | 23 |
  | Split | 6 |
  | Shape family | 6 |
  | Accept | 2 |
  | Merge | 1 |
  | Reject or add | 0 |

  The manual-only baseline needed a median of **21.5** per photo.
- **Keystroke-level estimate** (declared constants; not measured; no participants): **36 s** per
  photo after the model, against **110 s** by hand.
- These are idealised protocols: the reviewer and the manual operator draw pixel-exact outlines.
  Real people take longer and draw less precisely.

## Against the pre-registered thresholds (synthetic: information only)

| Measure | Threshold | Synthetic | |
| --- | --- | --- | --- |
| Precision (initial) | ≥ 0.80 | 0.978 | would pass |
| Recall (initial), pooled | ≥ 0.80 | 0.662 | **would fail** |
| Recall, every scene type | ≥ 0.70 | office 0.90; storage 0.67, industrial 0.62, lounge 0.45 | **would fail** |
| Reviewed centre error, not near horizon | median ≤ 0.30 m, p90 ≤ 0.75 m | 0.17 m, 0.65 m | would pass |
| Reviewed visible width | median ≤ 0.15 | 0.06 | would pass |
| Near-horizon objects flagged | ≥ 80 % | 100 % (10/10) | would pass |
| Estimates labelled | 100 % | 100 % | would pass |
| Depth from the width alone | median ≤ 0.10 | 0.00 (exact corners) | would pass (corners exact) |

Even on exact synthetic geometry, recall fails: hidden objects, twins swallowed into one
outline, far objects and one timeout. **Nothing here closes IMG-03.** The real stratum is empty.

## The smallest product fix supported by these measurements

**When the user picks a shape family for an object they outlined by hand, take that family's
typical proportions for its hidden side.**

**The same applies to a piece split from a group outline.**

- Today a hand-drawn object keeps a 1 × 1 × 1 guess, so its hidden depth equals its visible
  width. A split piece keeps the group outline's guess.
- Measured:
  - the manual baseline overestimates hidden depth by a median **+14 %** signed (reviewed: +2 %),
    up to +193 %;
  - cabinets split from conveyor outlines came out +314 % to +386 % deep;
  - in development, a 3 m conveyor drawn by hand came out 3 m deep, putting its centre 0.91 m
    off.
- It is one change where the shape family is set (`userItem`, `splitItem`, the shape picker).

**Larger fixes, in order of measured effect:**

1. **Warn when a partly visible object's base is hidden behind another outline** (the 4.31 m
   cabinets; the IMG-02 5.1 m case), and ask for its floor point or position. The IMG-02 overlap
   check already knows which object is in front.
2. **Place objects square to the measured rectangle, or to a chosen wall, rather than to the
   camera** (median 18.7° turn; the side-on rack).
3. **A second attempt within the time budget** when the vision call times out, since a re-run
   answered in 72 s. That needs its own evaluation; it is not tuned here.

None of these was made in this issue. The held-out set is used up: a fix must be judged on new
photos.

## Limitations

- **No real photo:** lighting, clutter, lens distortion, cropping and real marking error are
  absent.
- **The renders are clean:** flat colours, no texture noise, a floor with tiles. Real photos are
  likely harder for detection and for outlines.
- **The objects are the project's own catalog models and templates**, which the vision model may
  have seen in other renders from this project.
- **The reviewer and the manual operator are idealised protocols**, not people. Their outlines
  are exact, and effort is counted and estimated, not timed.
- **One run per photo; latency varies** (one timeout in 8; 72 s on a retry).
- **The "covers" rule counts objects standing behind an outline as swallowed** (a conveyor in
  front of cabinets), which inflates the group count. This was declared before the run and is
  kept.
- **Yaw is reported post hoc.** It was not among the frozen metrics.
- **Footprints are rectangles.** Nothing here checks clearance, collisions or real-world fit.

## Files

- **Inputs:** `scenes.json`, `photos/`, `annotations/`, [criteria.md](criteria.md),
  [protocol.md](protocol.md).
- **Answers:**
  - `results/qwen3-vl-32b-instruct.json`;
  - `results/llama4-scout-17b.json` and `results/llama4-scout-17b-continued.json`, combined in
    `results/llama4-scout-17b.scored.json`;
  - diagnostics in `results/diagnostic-*.json`.
- **Scores:** `scores.json` (per photo, per proposal, per object); `worlds.json` (placements).
- **Browser screenshots** of `office-a` and `store-a`: `browser/`, with the Objects and Layout
  views, the plan and the photo's camera, at 1440 × 900 (`e2e/img03-inspect.spec.ts`).
- **Sheets:** `sheets/<model>/<photo>.jpg`, which show:
  - the model's outlines, coloured by how they were scored;
  - the true outlines, dashed;
  - the plan: true footprints in white, the initial world dashed red, the reviewed world green.
