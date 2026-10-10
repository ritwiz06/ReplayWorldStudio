#!/usr/bin/env node
// Generates the JSON Schema bundle and TypeScript types from the Pydantic models in
// packages/contracts/python - the single schema source of truth.
//
//   node scripts/contracts.mjs          regenerate the committed files
//   node scripts/contracts.mjs --check  fail if the committed files are out of date
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = join(root, "packages/contracts/schema/contracts.schema.json");
const typesPath = join(root, "packages/contracts/ts/generated/contracts.ts");
const check = process.argv.includes("--check");

const BANNER = `/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT.
 * Source of truth: packages/contracts/python/replay_world_contracts/models.py
 * Regenerate with: pnpm contracts:generate
 */`;

const schemaText = execFileSync("uv", ["run", "python", "-m", "replay_world_contracts.schema"], {
  cwd: root,
  encoding: "utf8",
});

// The URN $id is for runtime validation; the type generator only needs local $refs.
const bundle = JSON.parse(schemaText);
delete bundle.$id;
const typesText = await compile(bundle, "ReplayWorldContracts", {
  bannerComment: BANNER,
  additionalProperties: false,
  strictIndexSignatures: true,
  unreachableDefinitions: false,
  format: true,
});

const outputs = [
  [schemaPath, schemaText],
  [typesPath, typesText],
];

if (check) {
  const stale = outputs.filter(([path, text]) => {
    try {
      return readFileSync(path, "utf8") !== text;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) {
    for (const [path] of stale) console.error(`Out of date: ${relative(root, path)}`);
    console.error("Run `pnpm contracts:generate` and commit the result.");
    process.exit(1);
  }
  console.log("Generated contracts are up to date.");
} else {
  for (const [path, text] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`Wrote ${relative(root, path)}`);
  }
}
