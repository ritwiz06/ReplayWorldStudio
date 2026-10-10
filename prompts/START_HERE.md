# Start or resume Replay World Studio

You are the coding agent working in the user's existing initialized repository. Use these instructions for the current session.

## 1. Establish context

Read applicable repository instructions, then:

1. prompts/PROJECT_CONTEXT.md
2. prompts/DEVELOPMENT_RULES.md
3. prompts/PROJECT_STATE.md and any canonical state record it points to
4. The latest entry in the selected session log
5. prompts/MILESTONES.md and the relevant rows in prompts/BACKLOG.md

Load ARCHITECTURE.md, PRODUCT_REQUIREMENTS.md, UI_UX_REQUIREMENTS.md and VALIDATION.md only as needed for the active milestone. Read relevant decisions before changing a proposed boundary. There is no requirement to load every prompt or historical session into context.

## 2. Inspect before choosing work

Inspect git status, branch, current source, dependency files, scripts and documentation. Check whether the described implementation actually exists. Do not treat the seed PROJECT_STATE.md as proof that nothing has been built. Preserve dirty work and newer project records.

If the previous planning documents are present, they provide more detail. This folder is sufficient if they are absent; do not stop just because the PDF or earlier kit is unavailable.

## 3. Select the active milestone

Follow a milestone explicitly selected by the user. Otherwise resume the recorded active milestone if it is incomplete. If there is no reliable active milestone, identify the first incomplete gate supported by actual evidence.

- For incomplete M0, execute prompts/START_PHASE_0.md.
- For M1-M6, execute prompts/IMPLEMENT_MILESTONE.md for that milestone.
- If all initial gates are complete, use EXPANSION_ROADMAP.md to propose a concrete bounded next module unless the user has already selected one.

If a prerequisite is missing, repair the minimum required prerequisite and record it. Do not restart a completed milestone or rewrite a compatible foundation.

## 4. Execute and keep the session bounded

Briefly report what exists, what is selected and the next verification target, then do the authorized work. Resolve routine choices without repeatedly requesting confirmation. Continue until the selected milestone is complete or a concrete external blocker prevents progress; complete independent useful work before stopping.

Do not silently implement every milestone in one session. A current user request for a larger scope can override this default. Keep planning estimates separate from observed progress.

## 5. Review and hand off

Use prompts/REVIEW_AND_HANDOFF.md. Update the chosen live records and give the user exact run commands, observed evidence, unresolved limitations and the next step. Do not merely describe intended changes as if implemented.
