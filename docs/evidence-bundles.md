# Evidence bundles (REL-01, `rws-evidence/1`)

**Export this run** (Run tab) writes one ZIP. Someone else can open it in their own local copy of Replay World Studio and run the same shift again. The bundle states what each number rests on. It is not a measurement: every result is computed under the operating inputs it lists, and the bundle shares nothing beyond the ZIP you save.

## What is in a bundle

| Path | What it is |
| --- | --- |
| `README.md` | What the bundle is, what is in it and left out, how to open it and run it again, the conventions, and what it shows. |
| `summary.md` | The before/after in words. It covers: <ul><li>the explanation computed from the two runs (the blocked route and why);</li><li>the comparison table and each run's counts and fingerprints;</li><li>the layout evidence, and every operating input with its basis;</li><li>what the results do and do not show.</li></ul> |
| `manifest.json` | Described [below](#manifestjson). |
| `project.json` | The project file, exactly as **Save project** writes it: the reviewed layout (as edited), the drawing reading, the process and the edit record. Not in a summary-only bundle. |
| `runs/original/events.json`, `runs/edited/events.json` | Each run's event log, as the engine (`rws-run/1`) produced it. |
| `runs/original/metrics.json`, `runs/edited/metrics.json` | Each run's plan (outcome, reasons, every route with its corridor, length and result) and whole-shift metrics. |
| `files/drawings/<sha256>.<ext>` | A source drawing or plan picture, if included. |
| `models/<uri>` | A model file, if included. |

There is an `edited` run only when the layout differs from the drawing. Otherwise the bundle holds the original layout's run alone.

## manifest.json

Every field is checked by the contract (`EvidenceManifest` in `packages/contracts/python/replay_world_contracts/evidence.py`).

- **Identity:**
  - `format: "rws-evidence/1"`;
  - `created_utc`;
  - `schema_version` (the contract), `engine` (`rws-run/1`).
- **`project`:**
  - `file` (`project.json`, or null in a summary-only bundle);
  - `id`, `name`;
  - `synthetic` (true for the repository's sample) and its note.
- **`process`:** name, `fingerprint`, `seed`, and the example note of a shipped example.
- **`runs[]`,** one per layout:
  - `engine`, `seed`, `scene_revision`;
  - `layout_fingerprint`, `process_fingerprint`, `event_fingerprint`;
  - `outcome` and `reasons` (the blocked or undetermined routes, in words);
  - `event_count`, `completed`, `created`, `unfinished`;
  - the paths of its events and metrics files.
- **`comparison`:** `identical`, and the `explanation` lines exactly as the app showed them.
- **`inputs[]`:** every operating value of the process:
  - its path in the process (e.g. `stations[3].worker_s`), a label, the value and unit;
  - for a worker's place, a `detail` in words instead of a value;
  - its **`basis`:** `example` (an illustrative assumption: shipped, or accepted in the guided setup) or `entered` (typed by a person).
- **`layout_evidence[]`:** what the drawing and its review established. This covers the file and its hash, the floor, scale and outlines reviewed, the symbol layers, and how the edited layout differs from the drawing. It is kept separate from the operating inputs on purpose: the drawing says where things are, never how fast they work.
- **`claims[]`:** what the results show and do not show.
- **`conventions[]`:** described [below](#conventions).
- **`replay`:**
  - `full`: the project and every file it names are included, or are part of the repository;
  - `runs_only`: the runs replay from `project.json`, but some files are left out;
  - `summary_only`: there is no project, so nothing can be rerun.
- **`files[]`:** every file in the ZIP except the manifest, with its `sha256`, `bytes`, `role` and, for an asset, the `uri` the project uses.
- **`excluded[]`:** each file the project names that is not in the bundle, and why.

## Conventions

- **Times.** Event times (`t`) and durations (`ms`) are whole milliseconds from the shift start. A clock time is the shift start (`shift_start_clock` in each events file) plus `t`. Inputs are in the units listed with them: s, m, m/s and items.
- **Order.** Events are in the order the engine processed them: by time, then in the order they were scheduled. Ties at the same millisecond keep that order, and `t` never decreases.
- **References.** Numbers in an event (`worker`, `station`, `transfer`, `from`, `to`) are positions in the `workers`, `stations`, `transfers` and `locations` tables of the same file. Items are numbered from 0 in the order they were created at the supply.
- **The shift end.** Nothing at or after it happens. An item counts as completed if its last step ends before it.
- **Metrics.** Shares are fractions (0 to 1) of the shift. Route lengths are metres along the path the route check found.
- **Fingerprints** are cyrb53 (a 53-bit string hash; `fingerprint()` in `apps/web/src/run/engine.ts`) of compact JSON (`JSON.stringify`), as 14 hex digits:
  - `event_fingerprint`: the events array;
  - `process_fingerprint`: the process;
  - `layout_fingerprint`: the layout's scene objects. For the original layout, these are the drawing's own arrangement as the review left it.

  Files are identified by sha256.

### Event types

| `type` | Fields | Meaning |
| --- | --- | --- |
| `shift_start`, `shift_end` | | The shift's ends. |
| `walk` | `worker, from, to, ms, item, transfer` | The worker walks between two locations, carrying `item` if not null. |
| `pick` | `worker, item, station, transfer, ms, created` | The item leaves the station, or is created at the supply when `created` is true. Handling takes `ms`. |
| `drop` | `worker, item, station, transfer, ms` | The item reaches the station's input, after `ms` of setting it down. |
| `load` | `worker, station, item, ms` | The item enters the station; the worker works with it for `ms`. `worker` is null for a station that starts by itself. |
| `run` | `station, item, ms` | The station runs on its own for `ms`. |
| `done` | `station, item, to` | The cycle ends: the item goes to the `output`, the station is `blocked` (output full) or the item is `complete`. |
| `release` | `station, item` | A blocked station's item moves into its output. |
| `stop` | `station, ms, reason, planned` | A planned or unplanned stop: no cycle starts during it. |
| `break` | `worker, ms, name` | The worker rests. |

## Opening a bundle

**Open project** accepts the ZIP. The API checks it before anything is used, and refuses it with the reason, keeping the open project, when:

| Problem | The message |
| --- | --- |
| Not a ZIP, or a damaged one | "This is not a ZIP file, or the ZIP is damaged." |
| No `manifest.json`, or not an `rws-evidence/1` manifest | Names what is wrong in the manifest. |
| A listed file is missing, has another sha256 or size, or the ZIP holds a file the manifest does not list | Names the file: "…differs from the manifest…: the bundle was changed or damaged; nothing was opened." |
| An entry name with `..`, an absolute path, a backslash or other characters; more than 201 entries; over 200 MB packed or 400 MB unpacked | Refused; nothing is unpacked to disk. |
| A source or model file is not the one the project records | "…a different file is never used in place of a source." |
| Summary only | "…holds no project file, so nothing can be opened or rerun." |

**Files the bundle carries.** A source file is stored in the local library only when it has the hash the project records. A file already there under that name with other bytes is left alone, and the problem is reported.

**Files the bundle leaves out.** If such a file is not on the computer either, the app says so: the runs still replay from the project, but the file cannot be shown or checked. Nothing is ever substituted.

**Run both layouts again.** In the Run tab, this reruns each recorded layout with the bundle's process and seed, and compares:
- the engine and the process fingerprint;
- each layout's fingerprint, outcome and blocked routes;
- the event count and the event fingerprint;
- the completed and unfinished counts;
- the event log, event by event;
- the explanation.

## What is never in a bundle

- **Never read:** the Voyager key, `.env`, settings, other projects' files and anything not listed in the export review.
- **Not selected unless you tick them:** a person's own drawings, plan pictures, photos and generated models.
- **Not bundled:** third-party files (for example the drawings in `data/external/`). They are the person's own library files, so they are never selected by default; their licences may forbid sharing.

## Checking a bundle by hand

```bash
unzip -o bundle.zip -d bundle && cd bundle
python3 -c "import json,hashlib; m=json.load(open('manifest.json')); print(all(hashlib.sha256(open(f['path'],'rb').read()).hexdigest()==f['sha256'] for f in m['files']))"
```

## The sample's bundle

[`docs/demo/sample-factory-hall-synthetic-run-*.zip`](demo/) was exported during the recorded demo:
- the synthetic sample with Machine B in the aisle;
- the original run (102 batches) and the edited run (blocked, 0 batches);
- the synthetic drawing.

A fresh clone opens and reruns it with no key (see [demo/README.md](demo/README.md)).
