// Write the builder templates (src/assist/templates.ts) as JSON for scripts/build_img03_scenes.py.
//   node scripts/assist/run-ts.mjs scripts/img03/dump-templates.ts OUT.json
import { writeFileSync } from "node:fs";
import { TEMPLATES } from "../../src/assist/templates";

const out = process.argv[2];
if (!out) throw new Error("usage: dump-templates.ts OUT.json");
writeFileSync(out, JSON.stringify(Object.fromEntries(TEMPLATES.map((t) => [t.key, { spec: t.spec }])), null, 1));
