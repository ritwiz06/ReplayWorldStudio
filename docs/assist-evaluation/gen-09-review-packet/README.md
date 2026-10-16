# GEN-09 independent review packet (for the coordinator)

**Status: independent review pending.** No reviewer has been contacted, and no answers exist.
GEN-08's visual review was done by the assistant running the evaluation: blind, but not
independent. This packet lets an independent person repeat it. The GEN-08 results, gate and
M2 decision are not changed by it, and no participant is recorded until one actually takes part.

## What to give the reviewer

Share only this folder:

- `instructions.md` and `rubric.md`;
- `sheets/sheet-01.jpg` … `sheet-25.jpg`;
- `answers-template.csv`.

**Do not share** `../gen-09-review-key/` or any other part of the repository: the key, the
GEN-08 report, the review files and the results all identify the cases and the assistant's
scores.

## What the sheets are

- The 25 GEN-08 dialog-method sheets (`../gen-08/renders/dialog/`), unchanged pictures.
- They are in a new shuffled order (seed 9090), with the old GEN-08 sheet number cropped off,
  so the GEN-08 key does not identify them.
- Each sheet shows only the request and the before and after pictures, as the Improve dialog
  showed them on opening at code `51d052d`.
- They are rebuilt by `scripts/build_gen09_review_packet.py`.

## Who can review

- **Independent** means: not involved in building or evaluating this project, and has not seen
  its evaluation reports.
- Record how the reviewer was found and their relation to the project in one line (for example
  "colleague in another lab, not involved").
- **More than one reviewer is better.** Score each answers file separately; do not average them
  before looking at agreement.
- **Ethics.** If this becomes a study (several people, results reported as research), check with
  ASU's research integrity office or IRB whether review is needed before recruiting anyone. A
  single colleague checking product quality may not need it, but ask rather than assume.
- **No personal data.** Do not put reviewer names, email addresses or other personal data in
  the repository.

## Scoring a returned answers file

```sh
uv run --project services/api python scripts/score_gen09_review.py answers.csv \
  --reviewer "R1: colleague in another lab, not involved" \
  --out docs/assist-evaluation/gen-09-review/R1.json
```

The scorer opens the key only then. It reports:

- the independent mean on the dialog method (the GEN-08 gate is 1.2 over 25 sheets);
- exact and within-one agreement with the assistant's GEN-08 scores, and every difference;
- which sheets the reviewer found **looks done but is not**, and which of those carried no
  warning in GEN-08.

## What it decides

- **The GEN-09 criterion "an independent reviewer or a small user study replaces the
  self-review" closes only when at least one real independent review is scored and recorded.**
- If the independent mean falls below 1.2, the GEN-08 visual pass is recorded as **not
  confirmed by independent review**. GEN-08's own result stays as it was frozen.
- Whether M2 is then reopened is a decision for the project owner, recorded in
  `docs/DECISIONS.md`.
