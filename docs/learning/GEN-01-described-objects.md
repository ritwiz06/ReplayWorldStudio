# GEN-01: why a valid JSON proposal can still be wrong

Learning note for M2 (guided creation). Code: `services/api/src/replay_world_api/assist/`, `services/api/src/replay_world_api/objects/`, `apps/web/src/assist/`. Evidence: [docs/assist.md](../assist.md), [docs/assist-evaluation/](../assist-evaluation/).

## The question

A project lead types *"a guarded conveyor about 2.2 m long with a control screen"*. What must happen before an object appears in the world, so that the world stays honest about what it knows?

## The model of the problem

A described object combines three different kinds of information. They must never blur together:

| Kind | Example | Who establishes it | How it is stored |
| --- | --- | --- | --- |
| **Stated** | "about 2.2 m long" | the user | `user_supplied`, with the user's words quoted |
| **Inferred** | height 0.9 m, depth 0.8 m, legs | the language model | `inferred`; placement waits for the user to confirm it |
| **Unknown** | mass, strength, chemistry, operating behaviour | nobody yet | `unknown_properties`, always present |

A language model is useful for the middle row: it knows what conveyors usually look like. It is also the most likely source of a silent error, because its output reads as fluently when it is wrong as when it is right.

## Structured output is a format guarantee, not a truth guarantee

Voyager runs on vLLM, which can constrain decoding to a JSON Schema. With that guidance, every live answer in this session was schema-valid on the first attempt. Without it, 0 of 9 edit answers matched the schema even after a retry. Guidance is necessary but not sufficient: each failure below came in **valid JSON**:

1. "move the selected cabinet **2 km** left". The schema's unit list had no `km`, so the model answered `distance: 2, unit: "m"` and quoted "2 km". The schema could not object; the answer was well formed and wrong by a factor of 1000.
2. "move **the cabinet** 1 m left", with two cabinets in the scene. The model picked one.
3. "move **the selected** cabinet…" while a conveyor was selected. The model chose a cabinet by name instead.
4. A tank's cylinder came without an `axis` (allowed, since `null` is valid for other shapes).
5. A conveyor's estimated depth (0.3 m) disagreed with the parts it laid out itself (0.46 m), which would have stretched the model by 35 %.

None of these is caught by "is it valid JSON?". Each was caught by a **deterministic check grounded in something outside the model**:

- the user's words: a stated value must appear in the text with its unit (1 → asked; after adding `km` to the vocabulary, the engine refuses 2 km as beyond the ±1000 m limit);
- the scene: the object names that fit the words (2), and the selection and its name (3);
- the geometry rules: an upright default for cylinders (4), and estimates follow the parts (5).

## One worked example

The description gives one length. The parser (`assist/lengths.py`) finds `2.2 m` and nothing else. The model proposes:

- width 2.2 m `stated`, quote "about 2.2 m long" → the API finds 2.2 m in the text → kept as stated;
- height and depth `inferred` → the API replaces them with the extent of the model's own parts → shown as "estimate - please check".

The user presses **Sizes look right**. The API then builds the model from the specification (never from model-written code), stores it as `generated/<sha256>.glb`, and returns a catalog asset in which:

- the width is `user_supplied`/confirmed, with the source "Stated in the description: “about 2.2 m long”";
- height and depth are `inferred`/confirmed;
- mass, strength, chemical composition and operating behaviour are unknown.

One command adds the asset and the instance, and one undo removes both.

## The implementation boundary

- The language model proposes **data**: a bounded specification of up to 40 axis-aligned parts, 5 shapes and 30 materials. The generator is ours, deterministic and pure Python, so the same specification always gives the same bytes. That is why a saved project can rebuild a missing model and prove it is the same file (sha256).
- The browser resolves an edit intent into an exact command and dry-runs it with the same engine as every other edit. The user sees `x  -2.000 → -3.000 m` before anything changes.
- A generated model is a picture at a confirmed size. It cannot support a load, clearance, mass or behaviour claim.

## How it is validated

- Unit tests with a scripted provider: every grounding and clarification rule, retries, refusals and the evidence assigned to each dimension.
- Replays of **real recorded answers** through the whole pipeline (`test_assist_recorded.py`): three different descriptions give three different, valid, hash-pinned models with the stated size kept; vague and hostile inputs are not turned into objects; edit outcomes match.
- A live evaluation script (`scripts/evaluate_assist.py`), run guided and unguided, with latencies.
- A browser test of the whole journey: describe, confirm, place, undo, save, reopen, delete the model file, rebuild, reopen.

## One failure case that remains

Proposal quality is limited by the model's spatial reasoning. The conveyor in the first run had no legs and a top cover the user never asked for. The prompt now asks for supporting structure, but nothing *checks* that a conveyor looks like a conveyor. GEN-03 needs a held-out set with human review of visual plausibility, and a comparison against a faster model, because a 50-80 s wait is long for a first-time user.
