import { tmpdir } from "node:os";
import { join } from "node:path";

/** Catalog library served by the API under test (a fresh copy per run; see playwright.config.ts). */
export const E2E_CATALOG_DIR = join(tmpdir(), "rws-e2e-catalog-8010");
