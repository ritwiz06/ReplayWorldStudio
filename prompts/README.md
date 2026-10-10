# Replay World Studio - prompts and project context

Planning baseline: 2026-10-09. Working product title: Replay World Studio.

This folder is self-contained. It does not depend on a PDF, another conversation, or the earlier planning kit. These files supply context and executable prompts to a coding agent; they are not implemented software or proof of completed work.

## Put these files in your repository

Extract the archive into your existing repository so these files are under `prompts/`. Merge with an existing prompts folder; preserve unrelated files and newer versions. Do not create a second nested `prompts/prompts/` folder.

Most coding agents do not automatically read arbitrary Markdown in a prompts folder. Explicitly ask the agent to open the entry-point file.

Use this message for the first session:

```text
Read prompts/START_HERE.md and follow it. Inspect this initialized repository, reconcile its current state with the project context, then execute the first incomplete milestone. If no implementation exists, execute prompts/START_PHASE_0.md. Complete and verify that milestone, then write the handoff.
```

Use the same entry point when resuming. To select a particular gate, say, for example:

```text
Read prompts/START_HERE.md, then use prompts/IMPLEMENT_MILESTONE.md for M2. Verify the prerequisites, implement the drawing-import milestone, run the relevant checks, and update the project state and session log.
```

## Read only the context needed for the task

| File | Purpose | When to load |
| --- | --- | --- |
| [START_HERE.md](START_HERE.md) | Inspect and resume the real repository | Every new coding session |
| [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) | Vision, first application, user expectations and scope | Every new coding session |
| [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) | Working rules, honest evidence and repository care | Every new coding session |
| [PROJECT_STATE.md](PROJECT_STATE.md) | Current-state seed or pointer to existing live state | Every new coding session |
| [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) | Factory workflow and functional requirements | Feature design and acceptance |
| [UI_UX_REQUIREMENTS.md](UI_UX_REQUIREMENTS.md) | Realistic graphics and understandable interaction | UI, 3D, asset and visual work |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Modules, data contracts, units and simulation boundaries | Architecture, API, import and simulation |
| [MILESTONES.md](MILESTONES.md) | M0-M6 scope, estimates and gates | Choose or review a milestone |
| [BACKLOG.md](BACKLOG.md) | Issue IDs, dependencies and completion evidence | Select a concrete task |
| [VALIDATION.md](VALIDATION.md) | Test cases, numerical checks and evaluation targets | Verification and release review |
| [EXPANSION_ROADMAP.md](EXPANSION_ROADMAP.md) | Photo/video, physics, engineering, aging and team modules | Future scope decisions |
| [DECISIONS.md](DECISIONS.md) | Proposed architecture decisions and changes | Before a consequential design change |
| [SESSION_LOG.md](SESSION_LOG.md) | Append-only coding session handoffs | Read latest entry; update at session end |
| [START_PHASE_0.md](START_PHASE_0.md) | Execute the repository foundation milestone | Only when M0 is incomplete |
| [IMPLEMENT_MILESTONE.md](IMPLEMENT_MILESTONE.md) | Reusable implementation procedure | M1-M6, one milestone at a time |
| [REVIEW_AND_HANDOFF.md](REVIEW_AND_HANDOFF.md) | Review evidence and record the next action | Milestone/session completion |
| [SOURCES.md](SOURCES.md) | Primary documentation used by the baseline plan | Verify relevant technical claims |

## Keep one live progress record

If the repository already has a maintained `docs/PROJECT_STATUS.md`, decision log or session log, use those live records. Update PROJECT_STATE.md here to point to them. Otherwise use the state, decisions and session log in this folder. Do not maintain conflicting copies of progress.

Context files describe the intended product. Source code and actual checks establish what exists. A status file is a helpful index, not proof that a feature works. Follow current user instructions and applicable repository instructions when they change a planning assumption.

The original plan estimated 208-312 implementation hours, approximately 250-375 with contingency, for the initial factory release. The 15 hours/week assumption was not a confirmed availability commitment. Do not turn these estimates into promises.
