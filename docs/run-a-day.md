# Run a day (SIM-01..04, ADR-059)

**Run a day** advances a production process through a shift on your layout. It shows workers going to their tasks, items moving between stations, machines working, waiting, blocked or stopped, and queues forming. It is one of three different things the app does:

| | What it answers | What it uses |
| --- | --- | --- |
| **Check layout** | Does this layout fit? Overlaps, keep-clear zones, and whether an item of a given width can get from A to B. | The reviewed plan's geometry, in 2D. |
| **Walk** | What does it look like from here? | The camera only. Nothing happens in the scene. |
| **Run a day** | What happens during a shift under these operating assumptions? | A process you set up (or the sample's example), the layout's routes (the same route check), a seed and an event engine. |

**What a run claims.** It predicts outcomes under the entered process assumptions. It does **not** verify real productivity, worker safety, forces, structural strength or chemistry. The equipment models are illustrations: their insides are not simulated, only each station's state is shown.

## Try it

From the first screen, press **Run a day** on the left. The sample hall opens and its example shift starts playing.

- **The playback bar** over the 3D view:
  - shows the shift clock, Play/Pause, Restart, the speed (real time to 600×) and a timeline with the breaks marked;
  - stays in every camera mode (Orbit, Top and Walk). Switching cameras never restarts or changes the run.
- **In the 3D view:**
  - simple worker figures, each carrying a box while they carry a batch;
  - boxes in each station's queue (input) and beside it (finished, waiting to be carried);
  - a box on a station while it works;
  - a coloured ring and label for each station: running, loading, needs a worker, idle, blocked (output full) or stopped.
- **The Run tab** beside the view:
  - what is happening at that moment;
  - the whole shift's results: output, unfinished items, station and worker shares, longest queues;
  - the comparison with the original layout;
  - every assumption, with its basis, and the run record.

To see an edit's effect: move Machine B (**move it for me** in the sample guide). The run is marked as being for the old layout; press **Run the same shift again**, then **Compare with the original layout**.

## The sample's example shift (assumptions, not data)

Every value below is an **example assumption** made up for this synthetic hall. None is read from the drawing, and none describes a real factory. The app labels the process "Example shift · assumptions".

| | Value |
| --- | --- |
| Shift | 06:00–14:00. Morning break 09:00 for 15 min; lunch 11:30 for 30 min (everyone). |
| Material | Taken from Rack A, in the aisle (always available: itself an assumption). |
| Mixer | 60 s with a worker, then 150 s on its own. Queue 1, output 1. |
| Machine B | 20 s with a worker, then 120 s on its own. Queue 2, output 2. Changeover 10:00 for 20 min (no cycle starts). |
| Packing table | 240 s with a worker. Queue 4. Completes the batch. |
| Carrying | By hand, 0.6 m wide with 0.1 m clear each side (a 0.8 m path), at 1.0 m/s, 10 s to pick up and again to set down. |
| Workers | **Worker 1:** carry Mixer → Machine B, work at Mixer, carry Rack A → Mixer (in that priority). **Worker 2:** carry Machine B → Packing, work at Machine B. **Worker 3:** work at Packing. All walk at 1.2 m/s through 0.8 m. |
| Seed | 1. It is used only for unplanned stops, and this shift has none. |

**Result on the layout as drawn.**
- **Routes:** all four routes fit (Rack A → Mixer 18.8 m, Mixer → Machine B 4.9 m, Machine B → Packing 17.3 m, Rack A → Machine B 13.9 m).
- **Output:** 102 batches completed, 110 started, 8 unfinished at 14:00 (5 queued, 2 in stations, 1 waiting to be carried).
- **Stations:** the packing table is busiest (86 %) and sets the pace; its queue reaches 4/4. Machine B is stopped 4 % of the shift (the changeover). The mixer is blocked 1 %.

**With Machine B moved into the aisle.**
- Rack A → Mixer is **blocked**: the route check finds the way narrowing to 0.50 m between Rack A and Machine B, and the path needs 0.80 m.
- Machine B's own access point falls inside Rack B.
- Nothing can be fetched, so 0 batches are made. The comparison says why, route by route; nothing is walked through equipment.

## How a run works

- **Stations.** Each one is tied to a scene object by its stable ID. A worker stands at its access point, defined in the object's own frame, so it moves and turns with the object.
  - The first station is the **supply**: material is always available there.
  - A **process** station takes `worker_s` with a worker present, then `machine_s` on its own. A station with no worker time starts by itself.
  - The last station completes items.
- **Buffers are finite.**
  - When a cycle ends, the item goes to the station's output. If the output is full, the station is **blocked**, holding the item, until a worker takes one away.
  - A carry starts only when the item is there and a place is free at the destination; both are reserved.
- **Workers are limited resources.**
  - One task at a time, chosen in each worker's own priority order. Walking takes the route's length divided by their speed.
  - A break starts at its time, or as soon as the task in hand ends, and lasts its full length.
- **Stops.**
  - **Planned:** a running cycle finishes, and no cycle starts during the stop.
  - **Unplanned** (optional): drawn from the seed, with exponential gaps and lengths, in whole seconds.
- **Routes.**
  - Every carry and every empty-handed walk uses the existing route check (GEO-02) on the reviewed plan, with the carry's or the worker's corridor width. The distance is the route's length.
  - A **blocked** route is a move that cannot happen; the run goes ahead without it.
  - A route the check **cannot determine** stops the run, naming why.
  - Nothing ever moves through equipment.
- **Events.**
  - Items are created at the supply, carried, loaded, processed and completed only by events, in whole milliseconds from the shift start; anything at or after the shift end does not happen.
  - The 3D playback reads the event log at the clock's time. It never creates, moves or completes anything.
- **Identity.**
  - A run records the engine (`rws-run/1`), the seed, the layout revision it used, a fingerprint of the process, and a fingerprint of its event log.
  - The same inputs always give the same events. Pausing, the speed, scrubbing and the camera only choose which moment is shown.
- **Comparison.**
  - The original layout's run uses the drawing's own arrangement with the **same process, seed and engine**.
  - The explanation is computed from the two runs: blocked or cleared routes, route length changes with the time they cost at the entered speed, and the busiest station.
  - If no route changed, the runs are identical and it says so: moving equipment alone does not change the result.

## Set up a day on your own plan (guided)

On an uploaded plan, the Run tab opens **Set up a day**. The review must be finished first, with the floor traced or chosen; the Run tab says so if it is not.

1. **Stations, in process order.** Click an object in the 3D view or on the plan and **Add** it, or choose one from the list.
   - The first is where material comes from. Reorder with ↑ ↓; remove with ✕.
   - A name that does not say which object it is (for example "Fixtures 5" among Fixtures 1–7) must be renamed; the object keeps its own name.
2. **What moves between them**, in plain words (for example "kit"). Items are carried by hand.
3. **Pace and people,** if you know them: the time for one item at each step, in minutes or seconds, and how many people work the process.
4. **Example assumptions.** Everything not typed is offered as an example, shown as "Example assumption — please accept or change":
   - the pace not typed (2 min) and the people (one per step);
   - a worker present the whole time;
   - queues of 2;
   - carrying 0.6 m wide with 0.1 m clear each side, at 1.0 m/s, with 10 s to pick up and to set down;
   - walking at 1.2 m/s through 0.8 m;
   - where a worker stands (the first side of the object clear on the plan);
   - the shift 06:00 for 8 h, with breaks at 09:00 (15 min) and 12:00 (30 min);
   - who does what (each person works a station and carries into it).

   Change one under **Review assumptions** and it becomes a value you entered. **Run stays off until each example is accepted**; one button accepts all of those shown.
5. **Routes.** The setup checks every route the shift needs on the layout, and says how to correct one that is blocked or cannot be determined: choose another side, move an object, or mark door and hatch layers as drawing symbols in the review. Nothing is assumed to pass.
6. **Save and run the day:** one undoable step (`process_set`). The Run tab then counts the values you entered and the illustrative assumptions you accepted, and marks each in **What this run assumes**.

**Suggest setup (optional).** With a Voyager key, describe the work in a sentence and the language model suggests stations, their order and questions to answer, from the reviewed objects' names. It never sets times or staffing (its answer has no place for them). Nothing is applied until you press **Use these stations**, and you review them. Without a key, everything above works by hand. **Full form…** opens every field at once.

Real drawings and what they need first (a traced floor, symbol layers, renamed stations) are recorded in [external-drawings.md](external-drawings.md).

## Saved with the project

The process is part of the project file (contract 0.13.0, `process`): every value with its basis, the stations' object IDs and the seed. Runs are not stored. They are made again from the saved process, the layout and the seed, and give the same events: the fingerprint matches.

An older file opens through the existing upgrade path, which adds `process: null`.

## Not supported yet

- **Transfers:** only carrying by hand. No conveyors, forklifts or AGVs, and no batching, splitting or merging of items.
- **Flow:** one line of stations from one supply. No branches, rework, scrap, quality, or several products.
- **Workers:** no skills, learning, fatigue or shift handover. Breaks are the same for everyone.
- **Machines:** no setup times that depend on the product, no maintenance plans beyond planned stops, and no energy use.
- **Movement:** no congestion between workers in the same aisle. Routes are width-only (no turning), as in Check layout.
- **Not available:** physics, forces, structural or chemical behaviour, and live AI.
- **Display:** playback is visual only; there is no export of the event log yet (REL-01).

## Checks

```bash
pnpm --filter @replay-world/web exec vitest run src/run                    # engine known answers, the sample on its layout, setup
pnpm --filter @replay-world/web exec playwright test e2e/run-day.spec.ts   # run → edit → run again → compare → save/reopen; set up a day
```

**Known answers** (`apps/web/src/run/engine.test.ts`), each worked out by hand:
- output counts;
- finite-buffer blocking and release;
- a break taken late for its full length;
- a planned stop;
- one worker for two stations halving output, with no overlapping tasks;
- items conserved at every event;
- nothing moved along a blocked route;
- the same events for the same seed.
