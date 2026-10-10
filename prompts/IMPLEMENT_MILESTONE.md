# Implement one milestone

Use after START_HERE.md. The target is the milestone named by the user or the first incomplete gate established by repository inspection. Do not ask the user to fill a placeholder that the existing state already resolves.

## Before editing

1. Read the target row in MILESTONES.md and matching BACKLOG.md items.
2. Inspect actual prerequisite code and evidence. Repair gaps required for this milestone without restarting completed work.
3. Read the relevant requirements, architecture, visual direction, validation and decisions.
4. State a short sequence of concrete changes and the acceptance evidence for each. Then execute it.

## Target-specific instructions

| Target | Required emphasis |
| --- | --- |
| M1 | Dimensioned, realistic industrial scene; asset metadata; top/orbit/walk cameras; numeric and gizmo editing; undo; persistence; visual inspection and measured rendering performance. A decorative landing page is not the editor. |
| M2 | Supported DXF entities, units, nested block transforms, source overlay and reviewable equipment mapping. Preserve unsupported-data warnings. PDF/PNG starts as a calibrated manual reference; do not claim automatic extraction. |
| M3 | Footprint and service-envelope conflicts, stated tolerances, elevation limits and specified route envelopes. Findings identify objects and measured evidence. Do not infer vehicle turning behaviour from width alone. |
| M4 | Reviewed process graph, cycle times, resources, finite buffers, outages, event log, reproducible runs, replay and scenario comparison. Renderer speed must not change production results. |
| M5 | Real provider integration, typed proposals, validated mutations, missing-input clarification and result-grounded explanations. Run held-out semantic evaluation. Mock fixtures remain development aids only. |
| M6 | Held-out benchmarks, failure analysis, available user tasks, reproducible demo, export/reimport and a clear statement of validated scope. Report actual data access; do not fabricate industrial validation. |

## Implementation behaviour

Build complete paths through the affected layers. Reuse compatible components. Keep scope within the target gate; add new ideas to the expansion backlog. Preserve source evidence, units, revision identity and undo behaviour. Use synthetic or permitted fixtures.

Choose exact compatible dependency versions at implementation time. Validate unfamiliar APIs against official documentation. If an external service or model is unavailable, complete the local interface and tests that can be completed, then clearly mark the integration blocked or incomplete.

## Verification

Use VALIDATION.md to select checks for the changed risk. Exercise the happy path and at least one relevant error/edge case. Inspect meaningful UI changes visually when possible. Record performance only with scene size and environment. Do not broaden testing beyond a concrete remaining risk or required gate.

Run REVIEW_AND_HANDOFF.md. Update issue status only when its acceptance evidence exists. Stop at the selected milestone's boundary unless the user authorized continuing further.
