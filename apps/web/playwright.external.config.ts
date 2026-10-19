// External-drawing checks (docs/external-drawings.md): real downloaded files in the git-ignored
// data/external/, local only (each test skips when its file is absent). They are heavy (pictures
// of 45 megapixels decoded and drawn in software WebGL), so they run alone, one at a time, never
// beside the parallel suite. Run with: pnpm --filter @replay-world/web test:e2e:external
import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({ ...base, testDir: "e2e/external", testIgnore: [], workers: 1, timeout: 300_000 });
