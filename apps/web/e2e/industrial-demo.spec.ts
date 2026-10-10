// WRL-02: the industrial demo with verified glTF models, the three camera modes, and honest
// failure handling for models and model paths.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

interface Probe {
  mode: string;
  position: [number, number, number];
  target: [number, number, number];
  pixelsPerMetre: number | null;
}

const demoText = readFileSync(new URL("../../../fixtures/scenes/industrial-demo.json", import.meta.url), "utf8");
const CELL = { x: -5.195, z: -1.2 }; // obj-cell-filling footprint centre

async function probe(page: Page): Promise<Probe> {
  const raw = await page.getByTestId("viewport").getAttribute("data-camera");
  return JSON.parse(raw ?? "null") as Probe;
}

async function openDemo(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
}

test("opens on the industrial demo with verified, labelled synthetic equipment", { tag: "@smoke" }, async ({ page }) => {
  await openDemo(page);
  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-renderer", "ready");
  await expect(viewport).toHaveAttribute("data-models", "4/4 ready, 0 failed");
  await expect(page.getByTestId("model-status")).toHaveText("Models 4/4 verified");

  const banner = page.getByTestId("fixture-banner");
  await expect(banner).toContainText("Synthetic demonstration");
  await expect(banner).toContainText("not verified engineering data");
  await banner.getByRole("button", { name: "Details" }).click();
  await expect(banner).toContainText("not verified engineering data or real products");

  await page.getByRole("button", { name: /Filling cell/ }).click();
  const inspector = page.getByTestId("object-inspector");
  await expect(inspector.getByTestId("model-state")).toHaveText("Loaded; hash and bounds verified");
  await expect(inspector.getByTestId("model-fit")).toContainText("Scaled ×1.000 × 1.000 × 1.000");
  const asset = inspector.getByTestId("asset-details");
  await expect(asset).toContainText("models/guarded-machine-cell.glb");
  await expect(asset).toContainText("metres, +Y up, front +Z, origin at bottom-centre");
  await expect(asset).toContainText("in-house · Replay World Studio project");
  await expect(asset).toContainText("LicenseNot asserted (NOASSERTION)");

  await page.keyboard.press("h");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/industrial-demo.png" });
});

test("switches between orbit, top and walk views and keeps the selection", async ({ page }) => {
  await openDemo(page);
  const viewport = page.getByTestId("viewport");
  await page.getByRole("button", { name: /Filling cell/ }).click();

  // Orbit: frame the selection.
  await page.getByRole("button", { name: /Frame selection/ }).click();
  await expect.poll(async () => {
    const { target } = await probe(page);
    return Math.hypot(target[0] - CELL.x, target[2] - CELL.z);
  }).toBeLessThan(0.05);

  // Top: a plan to scale, -Z up, and the selection still shown.
  await page.getByTestId("mode-top").click();
  await expect(viewport).toHaveAttribute("data-camera-mode", "top");
  await expect(page.getByTestId("mode-top")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("scale-bar")).toHaveText(/^\d+(\.\d+)? m$/);
  await expect(page.getByTestId("plan-overlay")).toContainText("−Z plan up · +X right");
  await expect.poll(async () => (await probe(page)).mode).toBe("top");
  expect((await probe(page)).pixelsPerMetre).toBeGreaterThan(5);
  await expect(page.getByTestId("object-inspector")).toContainText("Filling cell");
  await expect(page.getByTestId("camera-mode-status")).toHaveText("Top view (plan)");

  // Walk: start in front of the selection at eye height, move, reset and exit.
  await page.keyboard.press("3");
  await expect(page.getByTestId("walk-hud")).toContainText("eye height 1.60 m");
  await expect.poll(async () => (await probe(page)).mode).toBe("walk");
  const start = await probe(page);
  expect(start.position[1]).toBeCloseTo(1.6, 3);
  expect(Math.abs(start.position[0] - CELL.x)).toBeLessThan(0.01);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(600);
  await page.keyboard.up("KeyW");
  await expect.poll(async () => start.position[2] - (await probe(page)).position[2]).toBeGreaterThan(0.3);
  const walked = await probe(page);
  expect(walked.position[2]).toBeGreaterThan(CELL.z + 0.946 + 0.25 - 0.01); // stopped short of the cell

  await page.keyboard.press("r");
  await expect.poll(async () => (await probe(page)).position[2]).toBeGreaterThan(5); // back at the open edge

  await page.keyboard.press("Escape");
  await expect(viewport).toHaveAttribute("data-camera-mode", "orbit");
  await expect(page.getByTestId("walk-hud")).toBeHidden();
  await expect(page.getByTestId("object-inspector")).toContainText("Filling cell");
  // Returning to orbit restores the framed view rather than resetting it.
  await expect.poll(async () => {
    const { target } = await probe(page);
    return Math.hypot(target[0] - CELL.x, target[2] - CELL.z);
  }).toBeLessThan(0.05);
});

test("shows labelled fallbacks and actionable errors when models cannot be loaded", async ({ page }) => {
  await page.route("**/api/v1/catalog/files/models/guarded-machine-cell.glb", (route) =>
    route.fulfill({
      status: 404,
      json: { detail: "Model file 'models/guarded-machine-cell.glb' is not in the catalog library. Rebuild the models with `pnpm assets:build` or restore the file." },
    }),
  );
  await page.route("**/api/v1/catalog/files/models/pallet-cartons.glb", (route) =>
    route.fulfill({ status: 200, contentType: "model/gltf-binary", body: Buffer.from("tampered bytes") }),
  );
  await openDemo(page);
  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-models", "2/4 ready, 2 failed");

  const notice = page.getByTestId("model-notice");
  await expect(notice).toContainText("2 of 4 equipment models could not be shown");
  await expect(notice).toContainText("Guarded machine cell: Model file 'models/guarded-machine-cell.glb' is not in the catalog library");
  await expect(notice).toContainText("Pallet with cartons: models/pallet-cartons.glb does not match the sha256 recorded in the catalog");
  await expect(page.getByTestId("model-fallback-obj-cell-filling")).toHaveText("Model unavailable");
  await expect(page.getByTestId("model-fallback-obj-cell-inspection")).toBeVisible();
  await expect(page.getByTestId("model-status")).toHaveText("Models 2/4 verified · 2 unavailable");

  await page.getByRole("button", { name: /Filling cell/ }).click();
  await expect(page.getByTestId("model-state")).toContainText("Unavailable - Model file 'models/guarded-machine-cell.glb'");

  await page.unrouteAll();
  await notice.getByRole("button", { name: "Retry models" }).click();
  await expect(viewport).toHaveAttribute("data-models", "4/4 ready, 0 failed");
  await expect(notice).toBeHidden();
  await expect(page.getByTestId("model-fallback-obj-cell-filling")).toBeHidden();
});

test("rejects opened projects whose model files are unsafe or unavailable", async ({ page }) => {
  await openDemo(page);
  const fileInput = page.getByTestId("scene-file-input");
  const rejected = page.getByTestId("file-rejected");
  const upload = async (name: string, edit: (doc: { catalog: { visual: { uri: string; sha256: string } }[] }) => void) => {
    const doc = JSON.parse(demoText);
    edit(doc);
    await fileInput.setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)) });
  };

  await upload("escape.json", (doc) => (doc.catalog[0]!.visual.uri = "../../pyproject.glb"));
  await expect(rejected).toContainText("escape.json was rejected");
  await expect(rejected).toContainText("/catalog/0/visual/uri");
  await expect(rejected).toContainText("should match pattern");

  await upload("missing.json", (doc) => (doc.catalog[1]!.visual.uri = "models/not-built.glb"));
  await expect(rejected).toContainText("Model file 'models/not-built.glb' is not in the catalog library");

  await upload("swapped.json", (doc) => (doc.catalog[2]!.visual.sha256 = "0".repeat(64)));
  await expect(rejected).toContainText("/catalog/2/visual/sha256");
  await expect(rejected).toContainText("does not match the recorded sha256");
  await expect(page.getByTestId("scene-source")).toHaveText("API industrial demo"); // nothing replaced
});
