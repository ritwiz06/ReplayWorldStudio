# UX-03: chat-first main screen and visual redesign

"Upload a plan. Ask what you want to change. See it happen in the world."

## What took attention away from the world (inspected 2026-10-20)

Screens of the app before this change are in [before/](before/), at 1440 × 900 and 1280 × 800.

- **A cramped canvas.** At 1280 × 800 the 3D world gets about 520 px of 1280 (41 %). A 270 px journey list sits on the left, and a 480 px drawing/run panel on the right.
- **The same fact said three or four times.** On the sample, these all say "synthetic" or "assumption":
  - the "Synthetic demonstration" banner;
  - the "Try it" guide;
  - the "Synthetic example" badge;
  - the "Example shift · assumptions" badge;
  - the example note paragraph.
- **Competing buttons:**
  - the top bar (Start, Undo, Redo, Save, Details, Open);
  - the left journey list, which offers the same actions;
  - the view toolbar, and keyboard hints under the canvas;
  - the Review, Drawing, Compare, Check and Run tabs.
- **Technical language on the main path:** "LWPOLYLINE 101 on layer A-WALL", "$INSUNITS", "Frame selection F".
- **Walls of text:** a numbered review list, run tables with 6 columns, and a 4-bullet route explanation before the result.
- **Weak hierarchy:** flat grey lighting and pale translucent boxes. The selection, a proposed change and the running shift do not stand out from the panels.

## The design

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ Replay World · Sample factory hall  [synthetic]      ↶ ↷   Save   Open   Full editor │
├─────────────────────────────────────────────────────────────┬──────────────────────┤
│                                                             │ Assistant  ● AI on  ⟩ │
│   Orbit Top Walk                                            │                      │
│                                                             │ ▸ you: move Machine B │
│                       THE 3D WORLD                          │   1 m right          │
│              (proposed position shown as a ghost,           │ ┌ Proposed ────────┐ │
│               route highlighted, workers animated)          │ │ Machine B → 1 m ⟶│ │
│                                                             │ │ new: route blocked│ │
│                                                             │ │ [Apply]  [Cancel] │ │
│                                                             │ └──────────────────┘ │
│   ┌ shift 06:32 ▶ ──────●──────── 120× ┐                    │ (Run it) (Undo)      │
│                                                             │ 📎 Ask about this world│
└─────────────────────────────────────────────────────────────┴──────────────────────┘
```

- **The world** takes everything except a 360 px conversation column (340 px at 1280). The conversation collapses to a floating **Ask** button.
- **The conversation shows short cards instead of instructions:**
  - progress ("Reading the drawing…", with Cancel);
  - a question, with clickable choices or a small input;
  - a proposal, with Apply and Cancel;
  - a result, with Undo;
  - "can't determine", with the reason.

  Measurements, assumptions and evidence sit one click away under **Details** on each card.
- **Suggestions follow the state.** They are shown only when they can work now.
  - An empty project: "Show me the example factory", "Upload a drawing and make a world", "What can I check in this layout?".
  - A world is open: "Move this machine" (with a selection), "Will the route still fit?", "Run an example shift" (with a process), "Run it again" (after an edit), "Why did output change?" (with two runs).
- **Full editor** (top bar) shows the existing panels unchanged. Switching back and forth keeps the scene, selection, camera, pending review, undo history and the current run: one App, the same canvas, never remounted.
- **Style:** one accent (cyan) for the selection and proposals; run states keep their colours; quieter panels, larger type for answers, warmer lighting and soft shadows in the world, reduced motion respected.

## How a request is handled

```
message ─► interpreting (Voyager, cancellable) ─► typed action, question or "cannot"
        ─► the app checks: object ids exist, the scene revision is unchanged, prerequisites
        ─► proposal (preview in the world) ─► Apply ─► existing command / check / engine
```

- **The model maps words to one of 12 actions** (`ChatResult`, `services/api/src/replay_world_api/assist/chat.py`): move, rotate, select, check_route, run_day, run_again, explain_change, undo, show_example, capabilities, save, export. Anything else is "cannot", with a reason.
- **Deterministic code does everything else.** The typed edit commands, the route check (GEO-02), the guided setup and the run engine (SIM) apply edits, measure and run.
- **A late answer is never applied.** If the request was cancelled or the scene revision changed, the answer is discarded.
- **What is sent:** the words, plus the objects' ids, names, kinds, positions and sizes, the selection and the app's state. Never a drawing or an image. Attaching a file stores it locally only.
- **With no key,** typing is off and says why. The suggestions, the attachment, the manual cards and the Full editor all work, so nothing pretends to be live AI.

## Issues

- **UX-03** (new): this redesign.
- **AGT-01** (extended): adds the chat orchestration for these actions. Catalog matching is still open.
- **UX-02:** stays open until real newcomers try it.

## Result (2026-10-20)

Screens in [before/](before/), [after/](after/) (recorded AI answers, labelled "Recorded answers (test)") and [nokey/](nokey/), at 1440 × 900 and 1280 × 800. [after/conversation.txt](after/conversation.txt) is the whole sample conversation behind them, with each card's details opened.

### What the conversation can do

| Ask (typed, or the suggestion) | What happens | Done by |
| --- | --- | --- |
| "Show me the example factory" | Opens the synthetic sample. | the fixture |
| Attach a DXF (📎) | Read on this computer; a draft world; a review card asks only the open corrections. | the DXF reader and builder (IMP-01/02) |
| Attach a PDF, PNG or JPEG | The plan-picture window opens to mark one known length; then the review card. | IMP-03 |
| Attach a project (.json) or bundle (.zip) | Opened and checked. | the API checks (REL-01) |
| "Move Machine B 3.5 m forward" (a turn, "Turn the mixer 90° clockwise", takes the same path but has no recorded test yet) | A proposal: the ghost in the world, the exact change, and what it does to the checks and the shift's routes. Apply or Cancel, then Undo. | the edit command engine (dry run, then applied) |
| "Move the rack 1 m back" | "“the rack” could be Rack A (material), Rack B. Which one?", with buttons that highlight each in the world. | the API's name checks |
| "Move a machine" (no AI) | A small form: machine, distance and direction; the same proposal. | the same |
| "Does the route still fit?" | One sentence, with the route highlighted. The measurements and limits sit under Details. The ends and width are asked with a small form when they are not known. | the GEO-02 route check |
| "What happens during a shift?", "Run a day" | Runs the process. If there is none, the guided setup opens in the conversation, and unknown pace or people are offered as labelled assumptions to accept. | the guided setup and `rws-run/1` |
| "Run it again" | The same process and seed, on the layout as it is now. | the same |
| "Why did output change?" | The output change, and the blocked route that caused it, from the comparison of the two runs. | `compareDays` |
| "Undo that", "Save", "Export this run" | As in the editor. | existing |
| "What can I check in this layout?" | What works now, and what the app cannot do. | the app |
| Anything else ("Paint the mixer red", instructions to ignore the rules) | "The application cannot change colors…", and nothing changes. | the model's "cannot" |

### Measured, by script (not a user study)

The workshop journey on the CC0 "Garage and workshop – 72 m²" DXF (local only; `e2e/external/`), from the open app to the saved, reopened and rerun project, in headless Chromium with software WebGL:

| | Full editor (`workshop.spec.ts`) | Conversation (`workshop-chat.spec.ts`) |
| --- | --- | --- |
| Clicks | 42 (the documented reference; 47 today, with the 5 export clicks added in REL-01) | **31** |
| Characters typed | 43 | **68** (the request "Move the workbench 1.5 m right" is 30 of them) |
| Scripted time | about 20 s, excluding export and a fixed 4 s wait | about 20 s |

**Scope differences.**
- **Only in the editor run:**
  - marks the two title-block shapes "not an object" (4 clicks);
  - moves the bench by typing a coordinate;
  - waits 4 s to watch.
- **Only in the conversation run:**
  - checks the routes after the move;
  - asks why the output changed.
- **The same results in both:** 66 kits; 0 after the 1.5 m move, which blocks Workbench ↔ Kit cabinet; the same fingerprint `01a894ac49ba38` after undo and after reopening.

**What the times leave out.** The recorded answers return at once. With the live model, each typed request waited **7.9 s, 9.7 s, 13.8 s and 12.1 s** (four requests in the sample journey, measured once: `playwright.live.config.ts`).

### Still hard (known usability problems)

- **Waiting for the live model:** 8–14 s for every typed request. Suggestions and forms are instant, but typing is the main path.
- **Real drawings still need work before anything can be checked:**
  - tracing the floor on the plan (4 clicks there);
  - marking symbol layers, where WALLS has to be ticked by hand;
  - accepting title-block shapes as objects, unless checked one by one in the full editor.
- **Layer-derived names** ("Fixtures 5") must still be renamed in the guided setup. The conversation then calls the object "Workbench (Fixtures 5)".
- **One action per message.** "Move it 1 m right and run again" is not split into steps.
- **The world is plain.** Translucent boxes keep showing that heights are assumed, which is honest but not attractive. Labels can overlap in the orbit view while a shift plays.
- **The empty world is a dark grid:** nothing yet points to the attachment button in the world itself.
