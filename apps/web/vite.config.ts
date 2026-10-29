import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** Which checkout this page was built from, so a stale page or server can be recognised. */
function buildId(): string {
  try {
    const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const changed = execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "";
    return `${commit}${changed ? " + local changes" : ""}, built ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  } catch {
    return `unknown commit, built ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(buildId()) },
  // One .env at the repository root serves both the API and the web app.
  envDir: "../..",
  // Browser tests run the dev server with RWS_E2E=1: no hot reload, so a source file saved while
  // the suite runs cannot reload the pages under test (it did once: a test mid-journey found the
  // app back on its first scene).
  server: { host: "127.0.0.1", port: 5173, strictPort: true, hmr: process.env.RWS_E2E ? false : undefined },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
