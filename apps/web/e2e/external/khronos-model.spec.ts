// ENR-01 on one published model (local only): Khronos glTF-Sample-Assets "BoomBox" (CC0-1.0,
// Microsoft 2017), commit 8f492390ddc7a2ae221a1369ef560589cf8c70fb, Models/BoomBox/glTF-Binary/
// BoomBox.glb, sha256 f8b918445ebdd006768232205a62f5182d2208ca57f84c6ccc084943c0bc8f15, kept in the
// git-ignored data/external/khronos/BoomBox/ with its LICENSE.md and metadata.json. It is an
// interoperability test object (a textured boom box written 2 cm across), not a model of any
// machine: it checks that a third-party file with textures loads, is measured, is pointed out as
// implausibly small, and fits the recorded space without changing it.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const BOOMBOX = `${ROOT}data/external/khronos/BoomBox/BoomBox.glb`;
const SHA = "f8b918445ebdd006768232205a62f5182d2208ca57f84c6ccc084943c0bc8f15";
const OUT = `${ROOT}data/external/results`;
const CHAT = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }] }] };
test.use({ storageState: CHAT, viewport: { width: 1440, height: 900 } });

test("external: the Khronos BoomBox (CC0) is read, pointed out as tiny, and fitted to the water tank's recorded space", async ({ page }) => {
  test.skip(!existsSync(BOOMBOX), "data/external/khronos/BoomBox/BoomBox.glb is not downloaded");
  expect(createHash("sha256").update(readFileSync(BOOMBOX)).digest("hex")).toBe(SHA);
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await page.getByTestId("chat-suggest-run_example").click();
  const before = await page.getByTestId("run-bar").getAttribute("data-fingerprint");
  await page.getByTestId("chat-file-input").setInputFiles(BOOMBOX);
  await page.getByTestId("model-for-obj-dxf-115").click(); // Water tank
  const review = page.getByTestId("model-review");
  await expect(review).toHaveAttribute("data-busy", "false", { timeout: 60_000 });
  await expect(review.getByTestId("model-warnings")).toContainText("only 2.0 cm across");
  await review.getByTestId("model-details").locator("summary").click();
  await expect(review.getByTestId("model-details")).toContainText("4 textures (16,777,216 pixels)");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/enr01-boombox-review-1440.png` });
  await page.getByTestId("model-apply").click();
  await expect(page.getByTestId("chat").locator('[data-kind="model-applied"]')).toBeVisible();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/);
  expect(await page.getByTestId("run-bar").getAttribute("data-fingerprint")).toBe(before);
});
