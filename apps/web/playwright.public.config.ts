// The public preview's journeys (ADR-054) against the production build: the web app built with
// the preview's settings and served by the API in public mode, on one origin, as anonymous
// visitors with no stored state. Run with: pnpm --filter @replay-world/web test:e2e:public
// With PUBLIC_URL set (a running container, or the staging site), the same journeys run against
// it and nothing is started here.
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const PORT = 8030;
const TARGET = process.env.PUBLIC_URL?.replace(/\/+$/, "");
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
export const PUBLIC_DATA_DIR = join(tmpdir(), `rws-public-data-${PORT}`);

if (!process.env.TEST_WORKER_INDEX) {
  rmSync(PUBLIC_DATA_DIR, { recursive: true, force: true });
  mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
}

export default defineConfig({
  testDir: "e2e/public",
  fullyParallel: false,
  workers: 1,
  timeout: process.env.CI ? 90_000 : 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: TARGET ?? `http://127.0.0.1:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: TARGET ? undefined : {
    // Build exactly as the container does, then serve it from the API in public mode.
    command: `pnpm exec vite build --outDir dist-public && cd ${JSON.stringify(repoRoot)} && uv run python -m replay_world_api`,
    url: `http://127.0.0.1:${PORT}/health`,
    env: {
      VITE_API_BASE_URL: "/",
      VITE_PUBLIC_PREVIEW: "1",
      VITE_RETENTION_HOURS: "24",
      RWS_PUBLIC: "1",
      RWS_ENV_FILE: "none",
      RWS_API_HOST: "127.0.0.1",
      RWS_API_PORT: String(PORT),
      RWS_WEB_DIR: join(repoRoot, "apps/web/dist-public"),
      RWS_DATA_DIR: PUBLIC_DATA_DIR,
      // Even a key in the environment must not turn AI on in the public build.
      VOYAGER_API_KEY: "public-build-test-placeholder",
    },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
