# UX-05: a responsive chat, and reviewed models for imported equipment

UX-05 builds on UX-04 ([../ux-04/README.md](../ux-04/README.md)). It does not add another interface, engine, check or simulation capability.

Screens at 1440 × 900 and 1280 × 800 are in [screens/](screens/), taken in Chrome on the GPU. They use recorded answers and the labelled synthetic test fixtures; the `nokey-` file was taken with no key. [../demo/ux05-appearance-and-request.mp4](../demo/ux05-appearance-and-request.mp4) is a 38 s recording: upload and review → improve the equipment's appearance → one connected move, run and explain request.

## A. The chat's wait

### Where the time went: measured, not assumed

The API now reports each interpretation's timing (`ChatResult.timing`):
- preparation;
- provider waiting;
- parsing and checking;
- the characters sent and received;
- the provider's own token counts, when it reports them.

The browser records interpreting, proposal preparation and execution after Apply. Each card shows these under **Details**, and as `data-*-ms` attributes for the tests.

| Request (ASU Voyager, `qwen3-235b-a22b-instruct-2507`) | Before: chat-02 | After: chat-03 |
| --- | --- | --- |
| Request sent, sample (12 objects) | 4,793 characters + a 2,828-character schema | **2,508** + **921** |
| Request sent, CC0 workshop (25 objects) | 6,723 + 2,828 | **3,098** + **921** |
| Provider tokens, workshop plan | 2,361 in, 246 out | **899 in, 99 out** |
| Provider tokens, sample plans | not known (the one sample call timed out) | 672–675 in, 78–105 out |
| Provider wait, completed calls | 27.1 s (workshop) | **6.2, 6.5, 6.7, 6.9 s** |
| Timeouts at the 30 s deadline | 1 of 2 calls (the sample plan) | 1 of 6 calls (select, turn and check, on its first attempt; its second attempt took 6.5 s) |

**Local work, with recorded answers** (the sample plan, three scripted runs):
- interpreting took 16–17 ms (the local API round trip);
- the API's parsing and checking took 0–6 ms;
- preparing the proposal in the browser (the dry run of every step) took 0–1 ms;
- the steps after Apply took 562–896 ms, mostly the shift's run, not counting the 120 ms pauses that let Cancel in.

**Why the workshop was slower, and why that is not settled.**
- **The 85 s answer was not larger.** The request was 6.7k characters against 4.8k for the sample, and the answer was smaller than a sample answer that took 19.5 s.
- **Remeasured, the same chat-02 request took 27.1 s** (246 output tokens, about 9 tokens per second).
- **Output length looks like the main lever.** Under chat-02, about 40 % of every answer was pretty-printing whitespace and null fields.
- **The rest is provider-side variance.** The two timeouts show it; one observation proves nothing about its cause.
- **What chat-03 changes:**
  - the model sends compact one-line JSON;
  - each step carries only `do`, `obj`, `obj2`, `what`, `said` and `alts`;
  - every description and number is built from validated data in the app.

**A small sample.**
- Six chat-03 calls do not support a p95 or a quality claim.
- **The 10 s aim.** The aim was to return common short plans within 10 s. Every chat-03 call whose time was captured (four) took under 7 s. One answered but its time was lost, and one timed out at 30 s.
- A timeout is a cut-off, not a speed-up, and is counted separately above.

### Interpretation stays correct

Each step quotes the person's own words for that step (`said`). The app reads every amount from those words:

| Case | Result (tests) |
| --- | --- |
| "Move Rack A 1 m right and Machine B 2 m left." | Rack A 1 m right; Machine B 2 m left. If the model swaps the object ids, the words win. |
| "Add a table 1.5 m wide and 0.8 m deep." | Width 1.5, depth 0.8. In "1.5 by 0.8 m", the sizes have no axis words, so neither is used. An older answer that swaps the axes is caught. |
| "Select the mixer; do not move it." | Select only. The check says “do not move it” is not part of the plan. |
| "Move Machine B 1 m right and sort out the corner." | The plan stays visible with a **Not understood yet** row and a reply box. Apply is not offered until the person answers; the answer re-asks with their words. |
| "Move the rack 1 m back" | Every object whose name fits stays a candidate (Rack A, Rack B). The model's other suggestions add candidates, never remove them. |
| Words that are not the person's own | No amount is taken from them; the step asks how far. |

**Recordings.**
- chat-01 and chat-02 recordings still replay, through the same checks, with explicit compatibility rules in `assist/chat.py`.
- Three sample plan recordings are now chat-03 answers (move-check-run, select-turn-check, and the new two-moves case), and so is the workshop plan. The others are chat-02 or chat-01 answers.
- The three files named `chat-test-*` are synthetic test fixtures, labelled `test_only` and "NOT a live answer". Two of them simulate a slow provider.

### The deadline

- **One deadline: 30 s end to end** (`RWS_CHAT_DEADLINE_S`), retries included. It is separate from the object generator's 150 s.
- **While waiting:** the progress card shows the seconds elapsed and the deadline ("Reading your request… 4 s (stops at 30 s)"), with **Cancel**. There is no percentage.
- **On timeout:**
  - "No answer within 30 s, so nothing was changed.";
  - the request is quoted;
  - **Try again** and **Move a machine by hand** are offered;
  - no second request is started.
- **What Cancel stops.** Cancel and the deadline stop the *browser* waiting, and a late answer is discarded. The local API's request to the provider is not interrupted. It runs until the provider answers or the deadline passes, and its answer is then dropped.
- **A run stays current after a change of look.** Its key now covers what it reads (objects without their model reference, sources and process), so an appearance edit does not mark it out of date.

No smaller model was tried: the live budget went to the comparison above. The models for generation, revisions and vision are unchanged.

## B. Models for imported equipment

**Upload a plan → review it → "Improve equipment appearance"** (a suggestion, the typed "Make this equipment easier to recognise", or **Change look…** on a selected object) **→ review → Apply.**

**Matching is deterministic and uses only the current catalog:**
- the four in-house glTF models, plus any generated models in the project;
- placeholder boxes are left out, because they would look no different from the stand-in;
- nothing was downloaded.

**What is compared:**
- the object's name, its station name and the drawing's label for it (used as untrusted descriptive words);
- its footprint against each model's own size.

**The rules:**

| Situation | What the card does | Sample / workshop |
| --- | --- | --- |
| The names agree on what it is (head nouns, a few written-down synonyms such as "electrical/control panel" → cabinet), and the model fits within 2× on a plan axis | **Suggested**, with the reason and every fitting warning | Electrical cabinet and Control panel → "Electrical cabinet, 800 mm" |
| The names agree, but the model would be distorted more than 2× | **Asked**, stating the stretch ("would be stretched to 287 %") | Kit cabinet (workshop) |
| The name says nothing about the kind ("Machine B", "Fixtures 5", "Title Block 1") | **Asked**: a footprint alone does not identify a machine | Machine B, kept unchanged in the journey |
| Named, but no catalog model is that kind of thing | **Describe this equipment**, **Build it manually**, **Keep the current stand-in** | Rack, Mixer, Packing table, Water tank; workshop Workbench and Store shelving |
| More than 3× on a plan axis | Not offered | — |

**How suggestions are shown:**
- **Every model is labelled a "generic model".** It identifies no manufacturer or machine.
- **No confidence percentage is shown.**
- **Nothing is chosen by default.** Each object needs its own **Use this model**.
- **Apply changes the chosen objects together,** listed by name, as one step.
- **Previews:** hovering a row or an option draws that object with the model in the world, fitted to its recorded size (display only), and highlights it. **Choose another** opens a searchable list of every model that fits.

**What a change of look preserves.** The command `set_appearance` changes only `asset_id`:
- the id, name, placement and dimensions, with their per-axis evidence and review status;
- the process station references, drawing links, keep-clear zones and route geometry.

Nominal catalog sizes never replace drawing sizes. The change is recorded as a `drawing_reviewed` correction, "Equipment appearance (display only): …", so the project contract needed no new version. Models not yet in the project's catalog are added with it in the same undo step. A review the world has moved past changes nothing.

**Nothing suitable: the object generator.** **Describe this equipment** opens the existing describe-and-review window:
- the description and the recorded size are filled in, and the proposal is set to that size;
- **Use for Workbench** makes the reviewed model that same object's look: no new object, and links kept;
- closing the window, or a failed proposal, changes nothing;
- tested with the recorded answer "a workbench 1.8 m wide with a monitor and a drawer unit".

**Evidence that the operating model is untouched:**
- **Sample, unit test:** the event fingerprint and metrics of the shift are identical before and after two objects change models.
- **Sample, browser:** after the batch, the shift, the move request and why run as before.
- **Workshop (local only):**
  - the IDs, process and sources are identical;
  - the run stays current;
  - the reopened file reruns with the original event fingerprint `01a894ac49ba38` and 66 kits.
- **What does change.** The REL-01 *layout* fingerprint hashes the whole object records, so it changes with `asset_id`; the event fingerprint and metrics do not. Nothing was altered to make them match.
- **REL-01.** The committed bundle still opens and reproduces its recorded run (`e2e/local/evidence.spec.ts`).

## Tests

**Unit tests:**
- `test_chat.py`: 31 tests, including the clause cases, ambiguity, geometry not sent, and one deadline covering every attempt;
- `matching/appearance.test.ts`: suggestions, fit, the batch apply, and identical runs;
- `chat/controller.test.ts`: the timeout card, a late answer after Cancel, the clarify row, the batch applied once, and a stale review.

**Browser tests:**
- `e2e/appearance.spec.ts` (5):
  - the batch;
  - undo, redo, a stale review and reopening;
  - generation, with failure and cancel;
  - the deadline and the clarify row;
  - each amount with its object.
- `e2e/local/chat-nokey.spec.ts`: manual matching with no key, with the fit preview, apply, undo, redo and reopening;
- `e2e/external/workshop-chat.spec.ts`: the workshop journey (local only).

## Live provider budget for UX-05

**8 of the 8 allowed calls.** Waiting came to at most 143 s of the 480 s allowed: text only, no images, no retries beyond the deadline.

| # | Request | Prompt | Outcome |
| --- | --- | --- | --- |
| 1 | Sample plan (move, check routes, run again) | chat-02 | timed out at 30 s |
| 2 | Workshop plan | chat-02 | 27.1 s |
| 3 | Sample plan | chat-03 | answered; its timing was lost (the output was cut off and the recording overwritten by #5) |
| 4 | Select, turn, check | chat-03 | timed out at 30 s |
| 5 | Sample plan, **sent by mistake** (a command meant to list files ran the recorder again) | chat-03 | 6.7 s |
| 6 | Two moves (Rack A, Machine B) | chat-03 | 6.2 s |
| 7 | Select, turn, check | chat-03 | 6.5 s |
| 8 | Workshop plan | chat-03 | 6.9 s |

## Remaining manual steps and open criteria

**Manual steps:**
- **The catalog is small:** four shipped models. Racks, shelving, tables, tanks, mixers and presses have no model, so most imported equipment goes to Describe, Build or Keep.
- **A model is drawn along the recorded width and depth,** never turned to suit its proportions.

**Open criteria:**
- **AGT-01:**
  - imported equipment is matched to catalog models and through the generator, but only by reviewed name evidence; no model ranks the candidates;
  - free questions about the scene remain unbuilt.
- **IMP-02:** mapping to models is built. Split and merge, wall solids, and closing open shapes remain open.
- **UX-02:** no newcomer has tried any of this.
- **Not part of this increment:** supplier specifications, STEP/GLB uploads (ENR-01/02) and free-form questions.
