# IMG-03 criteria: how one-photo import is scored (frozen before the held-out run)

These rules, thresholds and the held-out set were committed **before any held-out photo was sent
to a model**. They do not change after results are seen. The rules are implemented in
`apps/web/src/photo/evaluation.ts`, with known-answer tests in `evaluation.test.ts`, and applied
by `apps/web/scripts/img03/score.ts`.

## What is evaluated

The product exactly as it stands at the freeze commit:

- IMG-01/02 import: one indoor photo, a visible floor, a floor rectangle whose sides the user
  measured and marked.
- The vision model through the API's own image path: `propose_image`, prompt `img-01.2`,
  temperature 0, schema-guided, timeout 150 s, one validation retry.
- The app's own calibration, placement and correction code (`floor.ts`, `world.ts`,
  `corrections.ts`).
- The browser cross-check (`e2e/img03-browser-path.spec.ts`) shows the scored world is the
  world the dialog creates: same placements within 5 cm and 3 %.
- The placement algorithm is **not changed** for this evaluation.

## Two strata, never pooled

| Stratum | Photos | Ground truth | What it can show |
| --- | --- | --- | --- |
| **Real, measured** | **none available** | measured on site ([protocol.md](protocol.md)) | real-world accuracy; the only basis for closing IMG-03 |
| **Synthetic** | 8 held-out views (4 scene types × 2), 2 development views | exact (render geometry and camera) | that the metrics and the pipeline are right, and how the method behaves on known geometry; **never real-world accuracy** |

Inventory of the earlier permitted photos ([README.md](README.md#inventory)):

- None has independently measured ground truth.
- The factory render (`fixtures/photos/factory-walk.png`) has exact geometry, but it was used
  in development (IMG-01, IMG-02). Its 5.1 m cabinet case is a development example (near the
  horizon, base hidden, added by the user), reported in that category and not in the held-out
  score.

The held-out synthetic views are `line-a`, `line-b` (industrial), `store-a`, `store-b` (storage),
`office-a`, `office-b` (office) and `lounge-a`, `lounge-b` (lounge). They hold:

- 68 counted objects;
- 31 partly visible;
- 10 near the horizon, from the true camera;
- 4 not counted, because less than a quarter of each shows.

They include deliberate stress cases:

- two similar cabinets side by side, and two similar racks;
- a table with four chairs around it;
- objects partly hidden behind machines and tables;
- far objects seen from low cameras.

## Ground truth and counting

- **Counted:** on the floor, visible or partly visible, with a visible outline at least 16 px
  each way.
- **Partly visible:** less than 90 % of its whole outline shows, or it is cut off at the photo's
  edge. It is counted and also reported apart.
- **Mostly hidden (under 25 %) or out of frame:** not counted. A proposal that finds one is
  *ignored*: neither a find nor a false positive.
- Visible outlines are the box around an object's pixels that show. Positions and sizes are in
  the rectangle's frame:
  - origin at the centre;
  - +x along corner 0 → 1, +z along corner 1 → 2.

## Matching (outlines only; labels are scored apart)

1. Proposal and object pairs with **IoU ≥ 0.5** against the object's visible outline are matched
   one to one, greedily by IoU. A counted match is a **true positive**.
2. A remaining proposal that **covers** (≥ 70 % of each visible outline) two or more counted
   objects finds the largest of them, if that one is still unfound.
   - Any find whose outline also swallows a counted object that nothing else found is a **group
     outline**, reported with the finds ("table with chairs").
   - The swallowed objects are missed.
3. A remaining proposal with IoU ≥ 0.5 against an already-found object is a **duplicate**: a
   false positive.
4. Every other proposal is a **false positive**: a *poor outline* (best IoU 0.1–0.5) or *no
   object*.
5. Unfound counted objects are **false negatives**. A provider error or a refused photo means
   every counted object in it is missed.

**Precision and recall** are reported with their raw TP, FP and FN counts:

- pooled, per scene type and per photo;
- for the **initial proposal** (the objects the app pre-accepts, `suggest_accept`);
- for **all proposals** (ticked or not).

**Label agreement:** the model's shape family equals the object's class, among finds. Objects
the user adds as *not seen* never count towards model recall.

## Three worlds per photo, reported apart

- **Initial proposal:** the pre-accepted objects, placed by the app with the measured rectangle
  (both sides typed), uncorrected.
- **Reviewed (idealised photo-only reviewer):**
  - rejects false positives;
  - merges duplicates;
  - ticks finds the app had left unticked;
  - splits group outlines into the objects they swallowed;
  - tightens outlines whose IoU is below 0.75 to the visible outline;
  - corrects the shape family and the visibility;
  - tightens a poor outline that is the only one near an unfound object;
  - adds each remaining missed object by outlining what shows.

  **No size or position is typed**: a photo alone gives none. The corrections use the true
  outlines, so this is the *best* a careful photo-only review can do, not what a person does.
- **Manual only:** no vision model. Every counted object is outlined, given its shape family and
  marked partly visible where it is.
  - Done on **all 8 held-out views**: it is computed offline and costs nothing.
  - Same idealised outlines as above.

## Metres (counted objects placed in each world)

For each object, compare the app's footprint, mapped into the rectangle's frame through where the
app puts the four marked corners, with the true footprint:

- **Floor-centre error** (m).
- **Visible width error:** footprint extent across the line of sight from the camera, predicted
  minus true (m and relative).
- **Hidden-depth error:** extent along the line of sight, predicted minus true (signed and
  absolute relative). It is mostly a hidden side estimated from typical proportions.
- **Height error** (m).
- **Strata:**
  - **near the horizon**: the camera sees the object's centre less than 6° below the horizon, by
    the calibrated camera;
  - partly visible.
- Distributions: n, median, 90th percentile and maximum. The eight worst floor-centre errors are
  listed with their photo and object.
- **Near-horizon flag:** the share of near-horizon objects the app notes as "nearly on the
  horizon".
- **Evidence labelling:** the share of placed objects whose every estimated size (partly hidden,
  hidden or not seen) says "estimate" or "guess" in its saved evidence.
- **Calibration:**
  - depth derived from the width alone, against the measured depth (relative);
  - camera height and field-of-view error (synthetic only);
  - corner residual (px);
  - for real photos, the check-length error.
- **Sensitivity to corner marking:** the reviewed world recomputed with the corners offset by
  (+2, −1), (−2, +1), (+1, +2), (−1, −2) px.

## Correction effort

- **Primary:** action counts per photo, by kind: reject, accept, split, merge, add, outline,
  shape, visibility. They come from the reviewed and manual protocols.
- **Time:** a keystroke-level *estimate*, declared here and never presented as measured. Seconds
  per action:

  | Action | Seconds |
  | --- | --- |
  | reject, accept | 1.5 |
  | split, merge | 4 |
  | add (outline and place) | 8 |
  | outline | 5 |
  | shape, visibility | 3 |

- No participant takes part: these are not user-study timings and are not generalised to
  beginners.

## Run plan

- Each held-out view is run **once** through `qwen3-vl-32b-instruct`:
  `scripts/evaluate_img03.py --split held_out`, sequentially, with the host kept awake.
- **Paired second model:** `llama4-scout-17b` on `line-a`, `store-a`, `office-a` and `lounge-a`.
  In development probes it accepted the same image input and schema, first answer valid.
  `glm-4-5v` did not: an invalid first answer, then an empty retry, 245 s.
- **Failures:**
  - errors count as misses;
  - nothing is retried automatically or replaced;
  - a diagnostic re-run, if any, goes to its own file and is never scored as the result;
  - a host pause (the two clocks differ by more than 5 s) is a run fault, reported.
- **Live calls are never made in CI.**

## What a pass means (bounded indoor-photo case)

The thresholds apply to the **real, measured stratum**. The synthetic stratum is reported against
the same numbers **for information only**.

| Measure | Threshold |
| --- | --- |
| Initial proposal, counted objects: precision | ≥ 0.80 |
| Initial proposal, counted objects: recall (pooled), and in every scene type | ≥ 0.80, and ≥ 0.70 |
| Reviewed world, not near the horizon: floor-centre error | median ≤ 0.30 m and p90 ≤ 0.75 m |
| Reviewed world: visible width, absolute relative error | median ≤ 0.15 |
| Near-horizon objects flagged by the app | ≥ 80 % (when there are at least 3) |
| Estimated sizes labelled as estimates in the saved evidence | 100 % |
| Depth derived from the width alone (or the check length, real) | median absolute relative error ≤ 0.10 |
| Hidden depth | reported, not gated: it is an estimate by design |

**IMG-03 closes only when:**

- there are at least **6 real measured held-out photos**, from at least **3 scene types**, with
  **40 or more counted objects**;
- their rights permit the analysis;
- they meet every threshold above;
- the report keeps their failure cases.

The synthetic stratum cannot close IMG-03 or M3, whatever its result.
