# A serious visual workspace

Make the world understandable before adding more controls

The central canvas is the product. Use a large 3D view, a compact source/object panel, a contextual property inspector, and a timeline that appears when a run exists. AI lives beside the scene and highlights the objects or events it discusses.

## The main screen: three actions (ADR-049)

- **Upload, Change something, Play or compare** are the only top-level actions. Everything else
  is contextual to what is selected or running.
- **After upload, show the emerging plan at once** (outlines, footprints, names) while the 3D
  scene builds. Never a blank wait or a long form.
- **Ask a question only when its answer changes what the user is trying to do.** For example: one
  scale measurement for a unitless drawing, a DXF export while DWG is unsupported, or a machine's
  height before an overhead-clearance check.
- **Provisional values look provisional,** in the scene and the inspector. A check that needs one
  says so ("height needed") and offers to take the value.
- **The engineer's detail is one step away:** the source and uncertainty behind each value, the
  exact dimensions a check used, and the evidence that replaced an estimate.
- **Enrichment happens in place.** Dropping a machine photo, 3D model or specification on an
  object improves that object, and the change is visible and undoable.

The modes below organise the contextual controls behind those three actions. Build and Inspect
serve Upload and Change something; Run and Compare serve Play or compare.

| Mode | Main task | Visible controls |
| --- | --- | --- |
| Build | Import, calibrate, map equipment and edit. | Selection, transform, dimensions, snap, asset choice and undo. |
| Inspect | Understand fit, access and geometry. | Measurements, service envelopes, route overlays and source overlay. |
| Run | Configure and observe an experiment. | Duration, scenario, run, cancel, playback speed and event navigation. |
| Compare | Explain a design decision. | Linked cameras, baseline/candidate metrics, assumptions and issue changes. |

## Visual acceptance

- Use coherent, detailed industrial assets with correct scale and material response. Procedural geometry is acceptable for floors, walls and early placeholders; placeholders remain identified.
- Use neutral architectural lighting, soft contact shadows, readable labels, restrained overlays and a consistent unit display. Preserve silhouettes and equipment proportions when adjusting dimensions.
- Provide orbit, top and walk views; selection focus; keyboard navigation; tooltips; colour-independent issue labels; and a list view for findings.

## Performance targets to measure

Provisional target: at least 30 FPS at 1080p on the recorded reference workstation for 20 equipment instances and 100 visible product items. Record hardware, browser, asset size and scene revision. Use instancing, levels of detail and bounded item visualization if needed.

> Realistic appearance is required for the product demo. Photorealism, frame rate and physics fidelity are independent measurements; none is evidence for the others.
