// External-drawing checks (docs/external-drawings.md): real downloaded files in the git-ignored
// data/external/, local only (each test skips when its file is absent). They are heavy (pictures
// of 45 megapixels decoded and drawn in software WebGL), so they run alone, one at a time, never
// beside the parallel suite. Run with: pnpm --filter @replay-world/web test:e2e:external
// Recorded AI answers about these drawings live in the git-ignored data/external/recorded/; the
// API replays them together with the repository's own recordings.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const RECORDINGS = join(tmpdir(), "rws-external-recordings");
if (!process.env.TEST_WORKER_INDEX) {
  rmSync(RECORDINGS, { recursive: true, force: true });
  mkdirSync(RECORDINGS, { recursive: true });
  cpSync(`${repoRoot}fixtures/assist/recorded`, RECORDINGS, { recursive: true });
  if (existsSync(`${repoRoot}data/external/recorded`)) cpSync(`${repoRoot}data/external/recorded`, RECORDINGS, { recursive: true });
}
const servers = Array.isArray(base.webServer) ? base.webServer : [];

export default defineConfig({
  ...base,
  testDir: "e2e/external",
  testIgnore: [],
  workers: 1,
  timeout: 300_000,
  webServer: servers.map((server, i) => (i === 0 ? { ...server, env: { ...server.env, RWS_ASSIST_RECORDINGS_DIR: RECORDINGS } } : server)),
});
