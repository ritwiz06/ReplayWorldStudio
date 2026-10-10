# M1 learning note: visual scale, physical dimensions and collision geometry

**Question.** When a conveyor in the scene is 3.6 m wide, which of the numbers in the system say so, and which only look as if they do?

**Model.** Three things describe an object, and they answer different questions:

| Concept | Where it lives | What it answers | Who may change it |
| --- | --- | --- | --- |
| Physical dimensions | `SceneObject.dimensions` (width, height, depth `Length` records, each with its evidence) | How big the real object is, and how we know | A measurement, a supplier sheet, or a person through an edit command (recorded in the edit log) |
| Visual scale | Computed at render time: `dimension / model extent` per axis (`apps/web/src/scene/fit.ts`) | How much the glTF picture is stretched to fill that box | Nobody; it follows from the two numbers above |
| Collision geometry | Derived boxes: the walk obstacles (`walkWorldOf`), and later M3 footprints and envelopes | What may not overlap, at a stated tolerance | A checker, from the dimensions, never from the mesh |

**Assumptions.** Dimensions are the bounding box of the object along its own axes before rotation, with the origin at the bottom centre. A model is authored in metres, +Y up, front +Z, bottom-centre origin (contract 0.3.0), so scaling about its origin never moves its footprint. Walk collision treats every non-floor object as its axis-aligned world box, which is coarse for rotated objects.

**Worked example.** The catalog conveyor model measures 3.00 × 0.95 × 0.83 m. Typing a width of 3.6 m in the inspector:

1. runs `set_dimensions`, which records width 3.6 m as `user_supplied` and keeps the previous 3.00 m with its evidence in the edit log;
2. makes the renderer scale the model by 3.6 / 3.0 = 1.2 on X. That is 20 % beyond the 5 % tolerance, so the inspector and the object list say the model is stretched;
3. widens the walk obstacle to the new 3.6 m box.

Nothing reads 3.6 m back from the mesh. Had the model been 3.1 m wide, the stored width would still be 3.6 m.

**Implementation boundary.** M1 stores and draws dimensions and derives simple walk collision. It does **not** check clearance, overlap, access or feasibility: an edited layout is labelled "not checked", and those checks are M3, with explicit tolerances.

**Validation.** `modelLoader.test.ts` checks that each drawn model fills its recorded box to 0.1 mm, `commands.test.ts` that an edited axis keeps its previous evidence, and `walk.test.ts` that the walker stops at obstacle boxes. The WRL-04 benchmark measures how many such objects the browser can draw interactively (docs/performance.md).

**Failure case.** A model whose `model_bounds_m` disagree with its geometry would be scaled by the wrong factor and drawn larger or smaller than the recorded box. The loader therefore re-measures the bounds and refuses the model (shown as a labelled fallback box) rather than trusting the declared numbers. A second failure is a strongly stretched model that "looks" like different equipment: it is flagged, but the picture can still mislead, which is why decisions must read the dimensions, not the image.
