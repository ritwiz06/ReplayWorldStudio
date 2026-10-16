# GEN-08 pilot (development examples, not held out)

The pilot covers three new development cases on builder templates already used in development
(table, rack, screen). It was run through the whole GEN-08 path before the frozen set was
committed: live run, both renders, blind scoring of both viewing methods, unblinding and
scoring.

**Run** (2026-10-16, prompt `gen-05.1`): 3 requests, 3 provider calls, 96.9 s in total, no retries
and no run faults.

| Case | Request | Time |
| --- | --- | --- |
| pp1 | clear glass shelf | 22.0 s |
| pp2 | posts white, top beam red | 55.0 s |
| pp3 | 5 cm red light | 19.9 s |

**Blind scores:**

| Case | Dialog method | Fixed GEN-05 camera |
| --- | --- | --- |
| pp1 glass shelf | 2 | 0 |
| pp2 colours | 2 | 2 |
| pp3 light | 1 | 1 |

The 5 cm stated light was kept at 5 cm, as the stated-size rule requires, and is genuinely small.

**Tooling faults found and fixed before the freeze:**

- The dialog-method renderer's grid (far too many lines over too large an area) produced moiré
  that the real dialog does not have.
- The sheets shrank both renders to 460 px, hiding small details the real preview shows.

The renderer now uses the dialog's 0.1 m faint grid and native-size images.
