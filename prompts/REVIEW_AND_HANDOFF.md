# Review the work and preserve continuity

Use for the currently selected milestone or a bounded interrupted session. Review actual code, UI and outputs; a previous narrative is not proof of completion.

## Review questions

- Does the user-facing workflow work from the documented commands?
- Which requirements and backlog acceptance criteria are actually satisfied?
- Are unit conversions, transforms and data contracts consistent?
- Are results attached to the correct scene/process revision and marked stale after edits?
- Are defaults, inferred values, unknowns and mock behaviours visible where relevant?
- Do simulation metrics come from the defined model and event records?
- Do AI claims and actions reference valid objects, parameters and results?
- Does the graphical result satisfy the current visual milestone, rather than merely render something?
- Were only appropriate files changed and licensed/permitted data used?

For a review-only user request, report findings before making changes unless fixes are authorized. During an implementation task, fix relevant reversible defects within its scope and rerun the affected checks.

## Gate decision

Record `complete`, `partial`, or `blocked` with evidence. A successful build does not establish a complete importer or simulator. A screenshot does not prove numerical correctness. Do not invent evidence for checks that were unavailable.

## Update the canonical records

1. Project state: current milestone, implemented features, actual checks, blockers and next task.
2. Backlog: update only affected items; retain issue IDs, dependencies and acceptance definitions.
3. Decisions: record a meaningful architecture change with alternatives and rationale.
4. Session log: append a dated entry with exact reproduction steps and evidence locations.

If the repository already has live records under docs/, update those and keep the prompt folder's pointer accurate. Avoid duplicate status histories. Do not overwrite older entries with a generated summary.

## Final response to the user

State the result first, then report:

- What changed and why.
- Exact commands and working directories to run the relevant workflow.
- Checks actually run and their outcomes.
- Current limitations, unavailable evidence and any remaining blocker.
- Completed issue IDs, milestone status and next executable task.

Keep the response concise and concrete. Do not claim a deployment, commit, push, benchmark or real-world validation that was not performed.
