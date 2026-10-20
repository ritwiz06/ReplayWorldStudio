// A bounded live check of the chat path (UX-03), local only and never in CI: the main chat journey
// against ASU Voyager with the key in the git-ignored .env, read by the API process only. Four
// short text requests about the synthetic sample are sent; no image or drawing.
// Run with: LIVE_AI=1 pnpm --filter @replay-world/web exec playwright test -c playwright.live.config.ts
import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

const servers = Array.isArray(base.webServer) ? base.webServer : [];

export default defineConfig({
  ...base,
  testMatch: ["chat.spec.ts"],
  grep: /move a machine, check the route/,
  workers: 1,
  timeout: 300_000,
  webServer: servers.map((server, i) => {
    if (i !== 0) return server;
    const env = { ...server.env };
    delete env.RWS_ENV_FILE;
    return { ...server, env: { ...env, RWS_ASSIST_PROVIDER: "voyager" } };
  }),
});
