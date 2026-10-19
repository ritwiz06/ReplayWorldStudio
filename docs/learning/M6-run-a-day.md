# Learning note: Run a day (M6, SIM-01..04)

What building "Run a day" taught, for whoever extends it next.

## Three questions, three tools

- **Check layout** asks whether a layout *fits*: geometry only, in 2D.
- **Walk** changes where you *look*; nothing in the scene changes.
- **Run a day** asks what *happens* over a shift under stated operating assumptions.

Keeping these separate in the interface (the third step became "Walk or compare"; Run a day is its own entry) stops a camera mode being mistaken for a simulation.

## A discrete-event model in a few rules

A production line is modelled well by **events at times**, not by small time steps:
- an item is picked up;
- a cycle starts or ends;
- a break begins.

Between events nothing changes, so the engine jumps from one to the next.

**Rules that make results explainable:**
- **Finite buffers.** A full output buffer blocks the station before it: that is how queues and blocking appear.
- **Reservations.** A carry reserves both the item and a place at the destination before anyone walks. Without this, two workers could carry to the same last free place.
- **Priorities.** A worker always takes the first ready task in their own priority order. Contention is then visible and deterministic: one worker cannot be in two places.
- **Stops and breaks.** A planned stop lets a running cycle finish but starts no new one; a break waits for the task in hand. These are policies, written down, not physics.

**Known answers are worked out by hand on tiny lines:**
- a 60 s machine fed every 60 s from 70 s gives 59 items in an hour;
- a 10 s cutter feeding a 100 s welder spends most of the shift blocked.

If the engine and the hand calculation disagree, one of them is wrong, and it is worth finding out which before trusting a bigger run.

## Determinism is a design choice

A run is a pure function of (process, layout, seed, engine version):
- **Times** are whole milliseconds.
- **Randomness** (unplanned stops) comes from a seeded generator, drawn before the run and rounded to whole seconds.
- **The event log** gets a fingerprint.

Playback then only *chooses a moment*: what the 3D view shows at 09:42 is computed from the log at 09:42, whatever was shown before. Speed, pausing and the camera cannot change a result, and a saved project gives the same events when run again, so runs need not be stored.

## Reuse the geometry you already trust

Walking and carrying distances come from the same route check that answers "can a 1.20 m cart get through?", with each move's own corridor width:
- **Blocked:** the move cannot happen; the run goes ahead without it.
- **Cannot determine:** the run stops and says why.

Nothing ever walks through equipment, and moving a machine changes a result only through a route that changed. The comparison names that route and the seconds it costs at the entered speed.

## Assumptions are data, with their basis

Operating facts (cycle times, buffer sizes, who does what, breaks) are never in a drawing. Each value records whether it is an **example** assumption or was **entered**, and the setup form starts empty and names exactly what is missing. The example shift says, on screen, that its numbers are made up.

## A React lesson: labels over a 3D view

drei's `Html` mounts one React root per label and removes it in a layout-effect cleanup. React 19 refuses to unmount roots during a commit, which surfaced as a development-only `removeChild` error. Plain page elements over the canvas, moved each frame by a small projector inside it, avoid nested roots altogether and stay in step with both the run and the camera.
