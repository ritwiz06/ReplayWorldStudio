// REL-01 demo recording (local only; e2e/demo/record-demo.spec.ts): the app as `pnpm start`
// serves it, with no .env and a temporary source library, in the installed Google Chrome
// (headless, with its GPU, so the 3D view renders as people see it).
// Run with: pnpm --filter @replay-world/web exec playwright test -c playwright.demo.config.ts
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const PORT = 8050;
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SOURCES = join(tmpdir(), `rws-demo-sources-${PORT}`);
const WIDTH = Number(process.env.DEMO_WIDTH ?? "1440");
const HEIGHT = Number(process.env.DEMO_HEIGHT ?? "900");

if (!process.env.TEST_WORKER_INDEX) {
  rmSync(SOURCES, { recursive: true, force: true });
  mkdirSync(SOURCES, { recursive: true });
}

export default defineConfig({
  testDir: "e2e/demo",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${PORT}`, localStorage: [{ name: "rws.start.seen", value: "1" }] }] },
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: WIDTH, height: HEIGHT },
        deviceScaleFactor: 1,
        launchOptions: { args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] },
      },
    },
  ],
  webServer: {
    command: "node scripts/start.mjs",
    cwd: repoRoot,
    url: `http://127.0.0.1:${PORT}/health`,
    env: { RWS_API_PORT: String(PORT), RWS_ENV_FILE: "none", RWS_SOURCES_DIR: SOURCES },
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
