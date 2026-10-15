// GEN-03: score the language-edit answers of each model with the browser's own resolver.
//
//   pnpm --filter @replay-world/web exec node scripts/assist/run-ts.mjs scripts/assist/score-gen03-edits.ts [--set DIR]
//
// For every held-out edit (<set>/edits.json) and every model's answer (<set>/results/*.json), the
// proposed intent is resolved and applied exactly as the editor would (src/assist/editScoring.ts).
// Writes <set>/edit-scores.json and prints a summary per model.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Project } from "@replay-world/contracts";
import { type EditCase, type EditRow, type EditScore, scoreEdit } from "../../src/assist/editScoring.ts";

const { values: options } = parseArgs({
  options: { set: { type: "string", default: new URL("../../../../docs/assist-evaluation/gen-03/", import.meta.url).pathname } },
});
const SET = resolve(options.set);
const data = JSON.parse(readFileSync(join(SET, "edits.json"), "utf8")) as { scene: string; cases: EditCase[] };
const scene = JSON.parse(readFileSync(join(SET, data.scene), "utf8")) as Project;

const scores: Record<string, (EditScore | { id: string; category: string; missing: true })[]> = {};
for (const file of readdirSync(join(SET, "results")).filter((f) => f.endsWith(".json"))) {
  const report = JSON.parse(readFileSync(join(SET, "results", file), "utf8")) as { model: string; rows: { edits: Record<string, EditRow> } };
  scores[report.model] = data.cases.map((c) => {
    const row = report.rows.edits[c.id];
    return row ? scoreEdit(scene, c, row) : { id: c.id, category: c.category, missing: true as const };
  });
}
writeFileSync(join(SET, "edit-scores.json"), `${JSON.stringify(scores, null, 1)}\n`);
for (const [model, rows] of Object.entries(scores)) {
  const scored = rows.filter((r): r is EditScore => !("missing" in r));
  const proposals = scored.filter((r) => r.outcome === "proposal");
  console.log(
    model,
    `accepted ${scored.filter((r) => r.accepted).length}/${scored.length}`,
    `exact ${proposals.filter((r) => r.exact).length}/${proposals.length} proposals`,
    `unintended ${scored.filter((r) => (r.unintended_changes ?? []).length > 0).length}`,
    `leaks ${scored.filter((r) => r.leak).length}`,
    `missing ${rows.length - scored.length}`,
  );
}
