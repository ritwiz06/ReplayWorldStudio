// Local v0.1 (ADR-058): the app exactly as `pnpm start` serves it on 127.0.0.1, one origin, with
// no .env (no Voyager key, so no AI and no provider call) and a temporary source library.
// Run with: pnpm --filter @replay-world/web test:e2e:local
// With LOCAL_URL set (a `pnpm start` you already run), the journey runs against it instead.
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const PORT = 8040;
const TARGET = process.env.LOCAL_URL?.replace(/\/+$/, "");
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SOURCES = join(tmpdir(), `rws-local-sources-${PORT}`);

if (!process.env.TEST_WORKER_INDEX) {
  rmSync(SOURCES, { recursive: true, force: true });
  mkdirSync(SOURCES, { recursive: true });
}

export default defineConfig({
  testDir: "e2e/local",
  fullyParallel: false,
  workers: 1,
  timeout: process.env.CI ? 180_000 : 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: TARGET ?? `http://127.0.0.1:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: TARGET
    ? undefined
    : {
        command: "node scripts/start.mjs",
        cwd: repoRoot,
        url: `http://127.0.0.1:${PORT}/health`,
        env: { RWS_API_PORT: String(PORT), RWS_ENV_FILE: "none", RWS_SOURCES_DIR: SOURCES },
        reuseExistingServer: false,
        timeout: 240_000,
      },
});
