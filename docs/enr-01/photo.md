# ENR-01, the photo part: "Here is a photo of this machine. Make this object look more like it."

A photo of one existing object gives it a new look, in any world: drawn from a plan, made from a room photo, placed from the catalog, described, or built by hand, and also an object already drawn with an attached model. It is the same object, with the same id, name, place, recorded size and evidence, links, process and run. Contract 0.16.0 (ADR-066).

Screens (Chrome, GPU, 1440 × 900 and 1280 × 800) are in [photo-screens/](photo-screens/):
1. the photo and its crop;
2. the review;
3. after;
4. a running shift;
5. a missing reference photo;
6. a world without a drawing (review, after).

The `nokey-` screens show the manual path. The 30 s demo is [../demo/enr01-photo-look.mp4](../demo/enr01-photo-look.mp4).

## The journey

1. **The object and the photo.** Select the object, then **Change look… → Improve from photo…**. Or attach a picture in the conversation: it offers **Use as a reference for [selected object]**, the other objects as choices that highlight on hover, and **Create a world from this picture instead** (the earlier path). A picture never adds an object or replaces the world.
2. **Before anything is sent.** The photo shows at once, with the target and its recorded size. Drag on it to keep only the object. The window says what **Suggest appearance** sends: a new JPEG of the crop without metadata (orientation from the file, at most 1600 px), the object's name, its recorded size and, if it is drawn with a generated model, that model's part list. Nothing else from the world is sent, and nothing at all until the person presses it.
3. **One bounded proposal.** One multimodal request to the vision model, with one 150 s budget that also covers the one corrected answer the checks may ask for. Cancel stops further requests and discards a late answer. A request already in flight is not interrupted: it ends within the budget.
4. **The review.** The photo crop, the current look and the proposed look, side by side with the same camera and views. A one-line summary leads, and the problems the checks still find sit beside **Apply**. **Change it by hand** offers part removal, colours and the full parts list (GEN-02's controls). **Details** lists what was seen and drawn, what was estimated, what cannot be drawn, the app's own placements, the model and prompt, the photo's hash and the crop.
5. **Apply to this object** builds a new, immutable asset and changes the look through the common command, together with the reference photo, as one undoable step. **Keep the current look**, Cancel, a refused proposal or a failed build change nothing. For an object drawn with a catalog or attached model, the window says the proposal is a new, simplified look and does not edit that model, which stays in the catalog.

**Without a key**, the same window is manual work, and says so. The person can keep the photo as a reference only (one undoable step that changes no look or evidence), build the look by hand beside the photo, or choose a catalog model. The reference photo is then shown beside the object in its selection chip.

## The common path (source-independent)

`set_appearance` no longer needs a drawing. It records an `appearance_changed` edit; earlier `drawing_reviewed` records stay as written. It applies to any object except areas (walkways, keep-clear zones). A model must be of the object's kind, and an attached model now records that kind. Catalog matching, attached models, the object generator for an existing object, photo looks and the stand-in recovery all use it. Stale proposals (the object's look changed) and late revisions are refused. Run readiness is unchanged: a world without a process still needs one set up.

## What the photo can and cannot do

- **Drawn when seen:** the body's shape, an open frame or guard, a control panel or screen, doors and drawers as fixed panels, legs, shelves and visible colours. Shapes and materials are the generator's own; no code from the model runs.
- **Never from a photo:** a size (the recorded size is the envelope), a mass, strength, material grade, cycle time or how it works. A metallic surface is an appearance. Items claiming a property are left out, and the check says so. Hidden sides are plain and listed as estimated, and nothing claims manufacturer accuracy.
- **The app's own placements, listed as such:** a small part drawn inside the part it belongs on (a handle in a drawer, buttons in a panel) goes onto that part's front face, with the part set back to make room. A part floating above another settles onto it. No move that would change the overall size is made.

## Live results (ASU Voyager, `qwen3-vl-32b-instruct`), reported as they are

There were six calls and 475.9 s of waiting, within ENR-01's limit of 6 calls and 480 s. Every call is in [live-calls.jsonl](live-calls.jsonl).

| Case | Prompt | Calls (s) | Result |
| --- | --- | --- | --- |
| Machine B, render crop | 1 | 118.4 | Parsed. Most parts at one centre: 16 problems. Kept as [attempts/machine-b-prompt-1.json](attempts/machine-b-prompt-1.json). |
| Machine B, render crop | 2 | 141.1 | Repeated one part until the 4,096-token limit: unusable, nothing proposed. Kept as [attempts/machine-b-prompt-2.json](attempts/machine-b-prompt-2.json). Answer lists are now bounded. |
| Machine B, render crop | 3 | 67.5 + 73.8 | One corrected answer. Shown below. |
| Control cabinet 1, office photo crop | 3 | 36.0 + 39.1 | One corrected answer. Shown below. |

- **Machine B (weak).** The result reads as a yellow top frame, an HMI screen, a control panel with three buttons, two white doors and frame posts, which are recognisable features of the reference. It does not read as the guarded cell, though:
  - the frame is incomplete;
  - the parts are bunched in the middle;
  - one frame post duplicates another, and that problem is shown.
- **Control cabinet 1 (weak to moderate).** Three drawers, each with a handle, and a lock. The generator has no dark wood, so the light wood was changed to anthracite by hand in the demonstration. The top drawer floats; moving it would change the recorded height, so it is reported, not moved.

The references are permitted repository files:
- `fixtures/photos/factory-walk.png`, a render made by this repository (synthetic, not a photograph), cropped to one guarded cell;
- `fixtures/photos/office.jpg`, a real public-domain photograph (USDA, Public Domain Mark), cropped to an office drawer unit. It is used as a look reference for the demo's control cabinet, not as a photo of that equipment.

Recordings are made only by `scripts/record_appearance.py --run`. The script shows what it would send otherwise, never replaces a recording without `--replace`, and refuses to run past the limit.

## Evidence that dimensions and operation survive

From `e2e/photo-look.spec.ts` (recorded answers, offline):
- **Machine B, drawn world:** its saved object equals the sample's except `asset_id`. The drawing source and the process are unchanged; the reference photo is one new source.
- **The run:** after the new look it stays current, with the same event fingerprint. A real move afterwards changes it.
- **Undo and redo:** they remove the look and the reference together, and bring both back.
- **Reopen:** the look is verified by its hash.
- **World without a drawing** (the industrial demo: catalog objects, no sources): an attached model, then a photo look, with Undo returning the attached model. The ids, dimensions and sources survive save and reopen.
- **A missing reference photo:** the file opens, the look is still drawn, and the notice names the photo. A different photo is refused; the same one is accepted by its hash.
- **No change:** a cancelled suggestion, Keep the current look and keeping a reference only change no look, size or evidence.

API tests (`services/api/tests/test_appearance.py`, 20) cover:
- only the crop, the name and the size being sent;
- kept size, property claims refused, bad answers asked again once;
- cancellation between stages, one budget for both answers;
- the generated start used only at the recorded size, and the placement repairs;
- the asset's evidence, and the project and log checks;
- a room photo's links kept beside a reference;
- missing and changed photos, rebuilds, and bundle inclusion and exclusion.

The two live recordings are pinned in `test_assist_recorded.py`. Browser unit tests (`src/photo/reference.test.ts`) cover the command in a world without a drawing, the reference kept in the same step, staleness and areas. The committed REL-01 bundle (0.14.0) still reproduces its run, and existing 0.15.0 projects upgrade with a note.

## Remaining gaps

- **The visual quality of live proposals is weak** for a busy machine. One bounded answer is not a reliable 3D reconstruction, and the review exists to show it.
- **No dark wood** (or other missing finishes) in the generator's palette.
- **No accepted geometry or dimensions** from a supplier: that is ENR-02.
- **STEP files.**
- **Whether newcomers find this easy is UX-02.**
