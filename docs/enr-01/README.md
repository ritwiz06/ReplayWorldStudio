# ENR-01, the GLB part: "Here is a better 3D model of this machine. Use it here."

The plan still starts the world. A later file improves one object in it: the same object, with its layout, edits, process and run intact. Everything here works without a Voyager key, and the file never goes to a language model.

Screens at 1440 × 900 and 1280 × 800 (Chrome, GPU, no key) are in [screens/](screens/):
1. before;
2. a rejected file;
3. the fit and orientation review;
4. after;
5. a running shift;
6. missing-model recovery.

[../demo/enr01-better-model.mp4](../demo/enr01-better-model.mp4) is a 28 s recording: the existing world → attach a model → review → the improved same object → the shift.

## The journey, and what the person chooses

1. **Choose the object, and the file.** Either select an object and choose **Change look… → Upload a 3D model…**, or attach a .glb in the conversation. In the conversation, a selected object is offered first ("Use for Machine B"); otherwise every equipment object is offered as a clickable choice, highlighted on hover. A model never adds an object or replaces the world.
2. **Review.** The object is highlighted and the view frames it. The card asks three things:
   - **Is this the right object?** Its name, highlighted in the world; **Current look / Proposed look** switch between the two in place.
   - **Is it facing the right way?** **↺ Turn / Turn ↻** (quarter turns) and the file's up axis (Y up is glTF's convention; Z up is common in CAD). The object itself never turns, and neither does its route geometry.
   - **Does it fit the recorded space?** **Keep proportions** (the default: the largest size that fits inside the recorded envelope, bottom-centred, with the unused space outlined) or **Stretch to fill it** (it distorts, and says by how much).

   Sizes are compared, never adopted:

   | Example: Machine B and `guarded-machine-cell.glb` | width × depth, height |
   | --- | --- |
   | Recorded object (drawn / assumed / drawn; unchanged) | 1.50 × 1.00 m, 1.60 m high |
   | Model file (its geometry, as turned) | 2.01 × 1.89 m, 2.47 m high |
   | Drawn as (proportions kept) | 1.06 × 1.00 m, 1.31 m high |

   **Beside Apply:** problems such as a model that fills under half of an axis, a stretch beyond 25 %, an implausible size in metres ("only 2.0 cm across"; the unit is offered only then, and never changed for the person), and animations that are not played.

   **Under Details:** the file name, size, sha256, triangles, vertices, nodes, meshes, materials, textures and decoded pixels, the bounds as written, extensions and ignored content, and that no licence is assumed.
3. **Apply** makes one undoable step. **Cancel**, a refused file or a closed review changes nothing.

## The supported subset (`services/api/src/replay_world_api/uploads.py`)

The API reads the content before anything renders it; the name decides nothing.

- **Read:** self-contained GLB 2.0, with static triangle meshes (including strips and fans), materials, and embedded PNG or JPEG textures. Material extensions the browser's loader draws (clearcoat, emissive strength, IOR, iridescence, sheen, specular, transmission, unlit, volume) and `KHR_texture_transform` are read.
- **Refused, with the reason:**
  - external files or data URIs (nothing is fetched);
  - Draco, meshopt or quantized geometry, and KTX2, WebP or AVIF textures;
  - any other required extension;
  - skins and morph targets (a fixed pose would mislead);
  - sparse accessors, points and lines;
  - malformed lengths and references;
  - a node with two parents, or a node cycle.
- **Shown, but not as the file intends:** animations are not played, and the model is shown at rest.
- **Ignored:** cameras and lights (the app's views and lighting are used); names, extras and metadata (data, never interpreted).
- **Limits, checked before the vertices are read:**
  - 25 MB per file, and 4 MB for the JSON;
  - 4,000 nodes, nested at most 32 deep;
  - 2,000 meshes and 4,000 primitives;
  - 500,000 vertices and 1,000,000 triangles;
  - 512 materials;
  - 32 images, each at most 4,096 px per side, and 32 M decoded pixels in all (read from the PNG and JPEG headers, without decoding).
- **Bounds** come from every vertex of the default scene, through every node's complete transform, never from the declared accessor min/max. In `fixtures/models/nested.glb` the accessors describe only the untransformed box; the exact bounds are (0, 0, −2) to (2, 2, 0).

## What the application keeps, and what it records

- **The original file is kept unchanged** as `uploaded/<sha256>.glb` (git-ignored). The asset records:
  - the file name, size and triangles;
  - the source: "uploaded", with rights `NOASSERTION` / `unknown` unless the person said something, in which case only what they said;
  - the nominal sizes as the model's geometry (`inferred`, "not a measurement of the machine");
  - the visual: the same file and hash, the person's correction (up axis, quarter turns, exact file bounds, offset), the unit and the fit.

  There is no derived file: the browser applies the correction when it draws the model, and checks the result against the recorded bounds (within 1 mm).
- **The edit log** records the change as "Equipment appearance (display only): Machine B → guarded-machine-cell (attached file guarded-machine-cell.glb, reviewed; kept in proportion)".
- **The contract is 0.15.0.** It adds `upload` and `correction` (both null in older files; a migration adds them, tested), the `contain` fit and the "uploaded" source kind.

## Evidence that placement, evidence and operation survive

From the browser journey (`e2e/enrich.spec.ts`, on the sample factory, imported from its DXF):

- **Machine B is unchanged except for its model:** its saved object equals the sample's apart from `asset_id` (id, name, transform, dimensions and their per-axis evidence, parameters). The process, the sources, and the list of object ids are identical.
- **The run is untouched:** it stays current (no "layout changed" notice), with the same event fingerprint as before the new look. A real move afterwards ("Move Machine B 1 metre right, check its routes, and run the shift again") changes the fingerprint, as it should, and "why" answers from the two runs.
- **Undo and redo** of the move and the enrichment restore the stand-in, then the model.
- **The saved file reopens** with the model verified by its hash (1/1 models ready), and reruns with the moved layout's fingerprint.
- **Cancel, and a review the world has moved past** (a move applied while it was open), change nothing.
- **Refusals:** a Draco-required file, an external buffer, a malformed accessor, a skinned file and a DXF renamed `.glb` are refused, each with its reason. Nothing is stored or changed.
- **Missing-file recovery:** a project whose attached model is missing opens, with the object drawn as "Model unavailable". **Attach the same file…** refuses a different file ("is a different file … not used here"; it could become a new reviewed version through Change look…) and accepts the same one by its hash. **Use the stand-in** returns the object to its stand-in as one undoable step.
- **Resources:** four orientation changes leave the renderer exactly as after the first (79 geometries, 13 textures), and an idle world draws no frames. With disposal turned off, the test fails (+1 geometry and +1 texture per turn).
- **The API** (`services/api/tests/test_uploads.py`, 16 tests): the known bounds of every fixture, refusals, limits, storage unchanged and idempotent, the person's choices recorded, bundle inclusion and exclusion with hash checks on opening, and a missing file opening while a different file is refused.
- **Unchanged checks.** The fixture-based Run a day and generated-model rebuilds (`test_assist.py`) still pass. REL-01's committed bundle, written at 0.14.0, was at first refused by the new contract; the manifest now keeps the version a bundle was written with, the project is upgraded on opening, and the bundle (unchanged) reruns with the same events (`e2e/local/evidence.spec.ts`, `test_evidence.py`).

**What does change.** REL-01's *layout* fingerprint hashes the scene objects, `asset_id` included, so it changes when a model is applied. The event fingerprint and metrics do not. Nothing was altered to make them match.

## Test files

- **`fixtures/models/`,** built by `scripts/build_model_fixtures.py`, which only checks unless given `--write`. All are synthetic boxes:
  - an off-centre origin;
  - nested translated, rotated and scaled nodes;
  - a textured model;
  - a tall, thin proportion mismatch;
  - a Z-up file;
  - a file written in millimetres;
  - Draco-required, skinned, external-buffer and malformed files.
- **One published file, tested locally only.** Khronos [glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) "BoomBox":
  - commit `8f492390ddc7a2ae221a1369ef560589cf8c70fb`, `Models/BoomBox/glTF-Binary/BoomBox.glb`, sha256 `f8b918445ebdd006768232205a62f5182d2208ca57f84c6ccc084943c0bc8f15`;
  - CC0-1.0 (Microsoft, 2017);
  - downloaded with its LICENSE.md and metadata.json only, into the git-ignored `data/external/khronos/BoomBox/`;
  - an interoperability test object: a textured boom box, 6,036 triangles, four 2,048 px textures, written about 2 cm across. It is not a machine, and says nothing about any manufacturer's equipment.
  - The app reads it, says it is implausibly small, and fits it inside the water tank's recorded space with its textures. The run is unchanged (`e2e/external/khronos-model.spec.ts`).
- **The demonstration** uses the repository's own `guarded-machine-cell.glb`, an in-house generic illustration, for Machine B.

## Remaining enrichment gaps (ENR-01 stays open)

- Enrichment from a machine **photo**.
- **STEP** files: the licence and units are to be decided first (the "Filling-Cell.step" journey).
- **Accepting geometry as checked** where a file supports it. Sizes are only compared now; adopting a supplier's documented dimensions is ENR-02, a separate reviewed step.
- **Worlds without a drawing source:** objects in such a world (for example, placed only from the catalog) cannot be enriched yet, because `set_appearance` records the change as a drawing review correction.
- **Orientation in quarter turns only**, and no gizmo to align a model to a face.
- **Whether newcomers find this easy is UX-02.**
