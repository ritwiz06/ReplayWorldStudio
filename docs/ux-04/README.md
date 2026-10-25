# UX-04: a readable workspace and short, connected requests

"A person can see what is happening, give a short instruction, review the change, and understand its result without navigating technical panels."

UX-04 builds on UX-03 ([../ux-03/README.md](../ux-03/README.md)). It reuses the same contracts, command path, undo/redo, import review, geometric checks, event engine and evidence export. Nothing new simulates, measures or certifies anything.

Screens at 1440 × 900 and 1280 × 800 are in [screens/](screens/), taken in Chrome with its GPU. They use recorded AI answers (labelled "Recorded answers (test)") and, for the `nokey-` files, no key. [../demo/ux04-one-request.mp4](../demo/ux04-one-request.mp4) is a 30 s recording of one request progressing.

## What changed on screen

| Before (UX-03) | Now |
| --- | --- |
| An empty world was a dark grid; the attachment was a small paperclip. | **A start screen in the canvas:** "Drop your plan here", **Upload plan**, **Explore example**, a picture of the real example world, the formats. A DWG is answered with "save it as DXF first", in place. The whole canvas accepts a dropped file. |
| Pale translucent boxes everywhere (honest about assumed heights, hard to read). | **Solid draft materials:** a neutral floor; consistent colours for equipment, racks, tables, conveyors and walls; soft shadows; a cyan selection outline. A chip says **"Draft appearance · some heights assumed"**. **Show uncertainty** turns the assumed heights translucent again. Appearance never changes dimensions, provenance, checks or the run. |
| The camera framed the floor slab, so a small layout floated in space; the top view could tilt toward the origin. | **Framing fits the layout beside the conversation:** a floor much larger than the layout is left out; a floor about its size is included. A camera the person has moved is never reset by a run. The top view is centred on the content (fixed: its controls had kept the origin as target). |
| Run labels overlapped; the playback said "0 batches done" beside a chat result of 102. | **Labels by priority:** the selection first, then blocked or broken-down stations, waiting ones, then the rest; overlapping lower ones are hidden. The run bar says **"Completed so far N"** (at the playback clock) and **"Whole shift 102 batches"** (the finished run). **Overview** frames the stations from above; **See through** fades tall equipment for display only (routing is unchanged). |
| One action per message. | **A plan of up to four steps from one message,** reviewed once and applied once (below). |
| The review listed every question. | **One correction at a time:** a summary ("12 outlines · 1 of 4 answered"), the next correction, and answered ones collapsed but changeable. Symbol layers come last, with counts. A layer named like a wall is never preselected, and ticking it warns that its loose lines would stop blocking routes. |

## Requests a message can carry

One model call maps the message to at most **four** typed steps (`ChatResult.steps`, prompt chat-02). Everything after that is the app's own code.

| Ask | Steps | Done by |
| --- | --- | --- |
| "Move Machine B 1 metre right, check its routes, and run the shift again." | move → check_route → run_day | edit command; GEO-02 along the shift's routes touching Machine B; `rws-run/1` |
| "Select the mixer, turn it 90 degrees clockwise, and check the layout." | select → rotate → check_layout | selection; edit command; Check layout |
| "Undo that move and run again." | undo → run_day | history ("that" is the object the conversation was about) |
| "Move the workbench 1 metre right, run the same shift, and explain the difference." | move → run → explain_change | edit command; engine; `compareDays` against the layout **before this request**, same process and seed |
| "Add a packing table, 1.5 metres wide and 0.8 metres deep, beside Machine B." | add_object | a catalog item to accept (here "Generic packing station (provisional)"), the side to choose, then `add_catalog_instance` |
| "Move the rack 1 m back and run the shift again." | move (asks which rack) → run_day | choices that highlight in the world; the rest of the plan is kept |

**Before anything changes**, the plan card:
- lists the steps, each with what it still needs: which object, how far or which way, which catalog item, which side;
- dry-runs every change in order through the command engine, so the ghost in the world and the consequences are those of the whole plan. Consequences include walks that get longer and routes that would be blocked, from the checks, never from the model;
- keeps the stated amounts and sizes exactly;
- says what part is not supported, and that it will not be attempted;
- says that directions are as seen from above (the Top view), whatever the camera shows.

**Apply** runs the steps in order, once:
- each step is checked against the scene revision the plan expects, which includes the plan's own earlier changes;
- a failure stops the steps that depend on it and names what was already applied;
- **Cancel** stops before the next step;
- while a plan runs, no new request can start;
- **Undo this request** undoes exactly its changes.

**Adding an object:**
- **Stated sizes** are kept, with the source "Stated in the conversation".
- **An unstated height** comes from the catalog and is marked as assumed.
- **With no suitable catalog item,** "Describe a new object…" or "Build it by hand…" opens the existing tools, with the description and sizes filled in.
- **Never a silent match.**

**Without a key:**
- The suggestions and small forms (move, route) run the same actions.
- The plan path is reached through the move form as a one-step plan.

## Measured (scripted, not a user study)

**One identical task on the sample:** move Machine B 1 m right, check the routes, run the shift (`e2e/plans.spec.ts`, "timed"). Recorded answers return at once. The app time includes the 120 ms step pacing and the run.

| Path | Clicks | Characters typed | Requests to the model | App time |
| --- | --- | --- | --- | --- |
| Three messages, one action each (as in UX-03) | 4 | 81 | 3 | 5.8 s |
| **One plan (UX-04)** | **2** | **72** | **1** | 5.3 s |
| Forms and suggestions only (no AI) | 6 | 1 | 0 | 5.5 s |

**Provider waiting, live (ASU Voyager, `qwen3-235b-a22b-instruct-2507`).** Each figure is one call, measured when its answer was recorded on 2026-10-24.

| Request | Live latency |
| --- | --- |
| Move Machine B 1 m right, check its routes, run again | 19.5 s |
| Select the mixer, turn it 90° clockwise, check the layout | 24.9 s |
| Undo that move and run again | 11.1 s |
| Add a packing table 1.5 × 0.8 m beside Machine B | 9.8 s |
| Move the rack 1 m back and run again | 27.6 s |
| Workshop: move the workbench 1 m right, run, explain | **85.1 s** |

- **Plan answers versus one-action answers.** A plan answer took 10–28 s on the sample. UX-03's one-action answers took 7.9–13.8 s each, so three of them came to 24–41 s.
- **The workshop answer took 85 s.** The interpretation is cancellable while it waits.
- **Not compared live in the browser.** The plan path's live waiting was not measured there; the figures above are provider latency only.

**Journey B, the CC0 workshop DXF** (local only; `e2e/external/workshop-chat.spec.ts`):
- **The steps:** attach → compact review (floor traced, WALLS ticked with its warning) → set up and run the illustrative shift → **one request** to move the workbench 1 m right, run and explain → undo the request → rerun → redo → save → reopen → run.
- **The cost:** 29 clicks and 119 characters, of which the request is 81.
- **The results:**
  - output 66 kits in both runs;
  - the explanation: "Store shelving ↔ Workbench is 6.5 m before this request and 5.5 m now";
  - after undo, the original events again (`01a894ac49ba38`);
  - after reopening, the edited run's events again (`1de7effbc944f8`).

## Live provider budget for UX-04

- **Calls:** 6 of the 8 allowed, with no retries:
  - five sample plans, with the synthetic sample's object names only;
  - one workshop plan, with the CC0 drawing's object names and sizes, kept in the git-ignored `data/external/recorded/`.
- **Waiting:** 178 s in all, of the 600 s allowed.
- **No image, drawing or file was sent.**
- **Tests and CI** replay the recordings and make no provider call.

## Still hard (known limitations)

- **Live interpretation is slow:** 10–28 s for a plan on the sample, 85 s once on the workshop. Local steps after Apply take well under a second each.
- **Catalog matching is word overlap only,** for a described new object. Equipment in an imported drawing is still not matched to catalog or generated models, so AGT-01 stays open.
- **Ambiguous names in a drawing still need a friendly name to be addressed by words.** A guided-setup station named "Fixtures 5" is suggested a friendly name, but not forced. The object keeps its own name and id.
- **"Undo" can only come first** among a plan's changes.
- **A plan cannot place an object by dragging** a ghost; the side is chosen from four.
- **Real drawings still need** the floor traced and their symbol layers chosen.
- **Whether newcomers find this easier is UX-02**, which needs real participants.
