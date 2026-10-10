import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Dedicated ports so the smoke test never reuses (or collides with) your dev servers.
const API_PORT = 8010;
const WEB_PORT = 5180;
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  // Headless Chromium renders WebGL in software; two workers keep frames (and the React
  // commits behind each assertion) responsive, and WebGL-heavy checks get extra time.
  workers: 2,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: "uv run python -m replay_world_api",
      cwd: repoRoot,
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: { RWS_API_PORT: String(API_PORT), RWS_CORS_ORIGINS: `http://127.0.0.1:${WEB_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { VITE_API_BASE_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
