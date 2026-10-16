# IMG-03 capture protocol for real, measured indoor photos

This is how a real photo becomes ground truth for IMG-03. No photo taken this way exists yet.
Until one does, real-world accuracy is **unmeasured**. The synthetic renders in this folder
check the method; they do not stand in for real photos.

The supported case is unchanged: **one indoor photo, with a visible floor and a floor rectangle
the user measures and marks.** Outdoor scenes, several photos of one place and automatic scale
are out of scope here.

## 1. Permission (before anything is photographed)

- Get written permission from the site's owner or manager. It must cover:
  - taking the photo;
  - **sending a copy to ASU Voyager for analysis**: the vision model sees the image;
  - keeping the anonymised measurements in this repository.
- Record separately whether the photo itself may be published.
  - If it may not, it stays on the computer that holds it (`local_only: true`, in
    `$RWS_IMG03_LOCAL_DIR`, never inside the repository).
  - Only its sha256 and the anonymised measurements are committed.
- No people, faces, screens with content, documents, signs naming the organisation, or other
  identifying details in frame. If any cannot be avoided, do not use the photo.
- The annotation records:
  - who gave permission, by role, not by name;
  - where the permission is kept, outside the repository.
- Check the ASU data classification for the site before photographing. If in doubt, ask the data
  steward first.

## 2. The floor rectangle

- A rectangle lying flat on the floor, **all four corners visible in the photo**. It can be a rug,
  a mat, floor tiles, or tape marks. Use at least 2 m × 1.5 m.
- View it obliquely, not square-on: its perspective then fixes the lens.
- **Measure both sides** with a steel tape (or laser distance meter), each to ±5 mm. Record
  `tolerance_m` (0.005 by default) and the method.
- Corner 0 → 1 is the width, 1 → 2 the depth (going round the rectangle). The rectangle's frame
  has its origin at the centre, +x along 0 → 1, +z along 1 → 2, y up.
- **Check length**: measure one more distance on the floor, between two marks visible in the
  photo and away from the rectangle (≥ 3 m). Record it as `check_length_m` and `check_points`.
  It is never used to calibrate; it checks the calibration.

## 3. Objects

- Choose up to 15 floor-standing objects of these classes: table, chair, cabinet, shelf, sofa,
  machine, conveyor, pallet, box, screen, plant, tank.
- For each object:
  - **Floor position:** measure its footprint centre in the rectangle's frame. Tape two distances
    from known rectangle corners, or lay out a measured grid. Record `tolerance_m` (±2 cm is
    typical; larger for big machines).
  - **Size:** measure width (across its front), depth and height with a tape, ±1 cm.
  - **Yaw:** how its front is turned from the rectangle's +x axis, ±5°.
  - **Method:** `tape`, `laser_distance` or `site_drawing` (an as-built drawing checked on site).
    Never a "typical" size, a catalogue size not checked on site, or a value read from the same
    photo.
  - A value that was not measured is null. It is left out of the metrics, never guessed.
- **Visible outline:** draw a box around what shows of each object in the photo, as a careful
  person would. Then record:
  - its **visibility**: `visible`, `partly_visible` (hidden or cut off: say by what in `notes`),
    `mostly_hidden` (less than about a quarter shows) or `out_of_frame`;
  - `on_floor`.
- **Counted** objects are on the floor, visible or partly visible, with an outline of at least
  16 px each way. The validator enforces this rule. Anything else is listed with the reason it
  is not counted.
- Objects outside the supported workflow are listed but not counted, each with its reason in
  `notes`: wall-mounted items, objects on tables, people, vehicles, and anything that moves.

## 4. Recording

- Write one `<name>.annotation.json` per photo in the `rws-img03-annotation/1` format, and
  check it:

  ```sh
  uv run --project services/api python scripts/img03_annotations.py validate PATH
  ```

  The validator refuses:
  - a real rectangle or object without a method and tolerance;
  - a real value claiming a render's exactness;
  - a "typical" method;
  - an unpublishable photo that is not local only;
  - a count that breaks the counting rule.
- Store the photo's EXIF-free copy. The sha256 recorded is that of the file sent for analysis.
- **Split:** decide `development` or `held_out` before any model sees the photo. A held-out photo
  is analysed once, after the criteria are frozen.
