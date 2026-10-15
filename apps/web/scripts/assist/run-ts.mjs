// Run a TypeScript script that imports app modules, resolved by the project's Vite config (the
// contracts package, JSON imports and extensionless paths), without a browser:
//
//   node scripts/assist/run-ts.mjs scripts/assist/score-gen03-edits.ts [args…]
import { resolve } from "node:path";
import process from "node:process";
import { createServer } from "vite";

const [script, ...rest] = process.argv.slice(2);
process.argv = [process.argv[0], resolve(script), ...rest];
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error" });
try {
  await server.ssrLoadModule(resolve(script));
} finally {
  await server.close();
}
