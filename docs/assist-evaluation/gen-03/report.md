# GEN-03 report: held-out evaluation of the Voyager text models

> **Template, not results.** Every section marked *(to fill)* is completed once, from the single
> scoring pass of the run started 2026-10-15T20:31:53Z on commit `435095a`. Nothing here is
> estimated in advance.

## Setup

- Held-out set frozen in `435095a` before any run: 32 descriptions, 31 edits, 22 revisions
  ([README](README.md), [criteria](criteria.md)).
- Models: baseline `qwen3-235b-a22b-instruct-2507`, candidate `qwen3-30b-a3b-instruct-2507`
  (ASU Voyager, `https://openai.rc.asu.edu/v1`).
- Same API endpoints, prompts (`gen-01.5` objects and edits, `gen-02.2` revisions), schemas,
  one retry after an invalid answer, 150 s timeout; sequential requests, models alternating per
  case. Live results only; no recorded answers are used or reported here.

## Results *(to fill)*

| Measure | Baseline | Candidate | Gate |
| --- | --- | --- | --- |
| Descriptions: outcome as expected | | | ≥ 85 % |
| Descriptions: first answer valid | | | – |
| Stated sizes retained | | | ≥ 95 % |
| Stated sizes changed silently | | | 0 |
| Invented physical facts | | | 0 |
| Visual review (mean, zeros) | | | ≥ 1.3, ≤ 15 % zero |
| Parts hidden inside another part *(diagnostic, not a gate)* | | | – |
| Edits: outcome accepted | | | ≥ 90 % |
| Edits: exact proposals | | | ≥ 95 % |
| Unintended changes / extreme applied / hostile followed / leaks | | | 0 |
| Revisions: outcome as expected | | | ≥ 85 % |
| Requested change present | | | ≥ 75 % |
| Size kept or changed as asked | | | ≥ 90 % |
| Open requests below half | | | ≥ 90 % |
| Unrepresentable listed | | | ≥ 80 % |
| Revisions visual review | | | ≥ 1.2 |
| Waiting: descriptions median / p95 | | | ≤ 60 s |
| Waiting: edits median / p95 | | | ≤ 20 s |
| Waiting: revisions median / p95 | | | ≤ 60 s |
| Retries / timeouts / errors | | | ≤ 5 % timeouts |
| Correction effort (sizes or parts to fix before use) | | | – |

## Representative renders and failures *(to fill)*

## Decision *(to fill)*

## What this does not show

Provisional geometry does not establish mass, strength, operation, chemistry or real-world
fitness. Waiting times are measured by script against the live service; correction effort is the
reviewer's count of fixes, not a timed user study. No participants were involved.

## Time spent *(to fill)*

Wall time of the live run versus development that continued during it.
