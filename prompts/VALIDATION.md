# Earn trust one question at a time

Proposed gates; none has been measured yet

| Area | Provisional gate | Evidence method |
| --- | --- | --- |
| Scale / transforms | All synthetic unit, rotation and nested-block fixtures pass. | Known dimensions, round-trip transforms, source overlays and numerical tolerances. |
| Import assistance | Report precision/recall and correction time on held-out drawings; no silent unsupported geometry. | Ground-truth annotations and split by drawing family, not near-duplicate page. |
| Spatial checks | No missed seeded conflict in the defined fixture set; report false positives. | Touching edges, rotations, narrow passages, height-separated cases and tolerances. |
| Production | Exact analytical counts in deterministic fixtures; conservation always holds. | Event-level traces, finite buffers, outages, routes and boundary-time cases. |
| Reproducibility | Same pinned configuration reproduces event/metric outputs within declared numerical policy. | Saved input hashes, seeds, engine versions and stable event order. |
| AI | At least 90% semantically correct on supported held-out commands; no ungrounded numeric claim in the test set. | Human-reviewed intent labels, traces, references and failure taxonomy. |
| Usability / graphics | Complete import-edit-run-compare task; meet recorded 30 FPS scene target. | Timed tasks, screen recording, issue list and target workstation profile. |

## Known-answer example

One station takes exactly 60 seconds per item. Infinite input is available at time zero; no downtime or transport exists. Over [0, 600] seconds, exactly 10 items complete when events at the endpoint are included. Define that endpoint policy explicitly and test it; library run-until defaults may differ.

For stochastic comparisons, start with 30 independent replications as a pilot sample, use paired seeds across alternatives where appropriate, and report confidence intervals. Increase the sample only when interval width prevents the decision. Do not confuse fitted input uncertainty with random process variation.

> Engineering validity requires comparison with relevant real observations. NIST emphasizes verification, validation and uncertainty assessment for credible digital twins. [S09]


## Data and research evaluation

Evaluate the work saved and the errors introduced

## Candidate research question

Can an evidence-aware drawing-to-scene assistant reduce the effort needed to create an executable factory model, while preserving dimensional accuracy and making missing operational assumptions visible? This is a research hypothesis, not an established novelty claim.

| Dataset | Proposed size / role | Ground truth |
| --- | --- | --- |
| Synthetic layouts | 12-20 varied small layouts for controlled development and geometry tests. | Generated geometry, dimensions, equipment labels and seeded conflicts. |
| Permissioned drawings | 5-10 varied layouts if access is available; keep a held-out subset. | Manually verified footprints, scale, labels and correction log. |
| Operational fixtures | At least 6: serial line, parallel stations, finite buffer, outage, transport, resource contention. | Analytical expectations or independently checked event traces. |
| AI requests | 40 held-out requests plus a separate development set. | Expected intent, valid parameters, required clarification and evidence. |
| User tasks | A small formative study with 3-5 relevant reviewers if recruited. | Time, corrections, completion rate and qualitative feedback; no broad statistical claims. |

## Comparisons

Compare manual setup in the same editor, deterministic import with manual mapping, and AI-assisted mapping/commands. Keep assets and tasks comparable. Measure time to a usable model, manual corrections, geometric error, supported-command success and prediction error where real operational evidence exists.

## Existing work and the gap to test

Visual Components already supports factory layout and operational simulation. Siemens offers AI assistance for simulation programming, and NVIDIA supplies industrial digital-twin technologies. The candidate contribution is a measured reduction in source-to-model effort with explicit assumptions and traceable experiments. [S01-S03]

Use synthetic and properly licensed material in a public demo. Without permissioned operating data, describe the result as a validated software prototype on benchmark cases, not an industrially validated predictor.


Source IDs refer to [SOURCES.md](SOURCES.md). All thresholds are proposed gates until measured; scope claims must match the cases actually evaluated.
