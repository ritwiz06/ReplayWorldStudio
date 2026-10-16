# GEN-05 pilot (development examples, not held out)

The pilot covers three new development cases on builder templates (screen, tank, plant) that no
evaluation set uses. It was run through the whole GEN-05 path before the frozen set was made:
live run, render, blind scoring, unblinding and scoring. Its purpose was to find tooling and
check faults early. It is development evidence, not a result.

**Run (2026-10-16, prompt `gen-05.1`).**

| Case | Request | Time | Notes | Blind score |
| --- | --- | --- | --- | --- |
| p1 | status light | 22.5 s | | 0 |
| p2 | guard rail | 149.3 s | one retry, inside the 150 s budget | 2 |
| p3 | plant stand | 22.8 s | partial; "rustle in the wind" listed | 2 |

**What it found, fixed before the freeze:**

- **Tiny additions.** p1's 2 cm status light could not be seen, but no check reported it. A
  requested addition with no size given that is under 4 % of the object's largest side and
  covers under 12 pixels in the default view is now a problem with one retry.
- **Round tangents and the starting model.** Two faults made p2's rail around a round lid read
  as "floating":
  - the touch test missed a tangent contact (it now samples more finely);
  - the tank template's own legs stand clear of its round body, so its additions inherited that
    gap. Parts kept from the current model now count as supported; only additions are judged.

**Diagnostic retry after the fixes** (`results/diagnostic-after-fixes.json`):

- p1 came back with a 6 cm light and no problems (35.5 s, 2 attempts).
- p2's corrected answer drew 7 cm rail blocks, which were reported as too small to see (75.4 s).
