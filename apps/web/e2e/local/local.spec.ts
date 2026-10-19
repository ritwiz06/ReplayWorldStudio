// Local v0.1 (ADR-058): one complete journey on the app as `pnpm start` serves it, with no
// Voyager key: the sample's move turns the aisle route blocked; a DXF is imported and reviewed,
// an object is moved, the project is saved and reopened with the change and its drawing intact.
// Nothing about hosted visitors (retention, server folders, the preview badge) is shown locally.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const HALL = new URL("../../../../fixtures/drawings/hall-mm.dxf", import.meta.url).pathname;
const loaded = (page: Page, n: number) => expect(page.getByTestId("scene-status")).toHaveText(`Scene loaded · ${n} objects`);
const objectList = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name });

test("local: sample move blocks the route; a DXF is imported, reviewed, edited, saved and reopened", { tag: "@local" }, async ({ page }) => {
  await page.goto("/");
  // No key: AI is off, and the app says nothing that only applies to a hosted preview.
  const status = await page.evaluate(async () => (await fetch("/api/v1/assist/status")).json());
  expect(status.available).toBe(false);
  await expect(page.getByTestId("preview-badge")).toHaveCount(0);

  // The sample: move Machine B into the aisle and the width-only route is blocked.
  await page.getByTestId("start-sample").click();
  await page.getByTestId("sample-guide").waitFor();
  const route = page.getByTestId("route-outcome");
  await expect(route).toHaveAttribute("data-outcome", "fits");
  await page.getByTestId("sample-move").click();
  await expect(route).toHaveAttribute("data-outcome", "conflict");
  await expect(page.getByTestId("sample-blocked")).toContainText("Blocked.");
  await expect(page.locator("body")).not.toContainText(/24 hours|this preview's server|other visitors/i);

  // Import a plan: the edited sample is protected before it is replaced.
  await page.getByTestId("sample-upload").click();
  await page.getByTestId("drawing-file-input").setInputFiles(HALL);
  const dialog = page.getByTestId("drawing-import");
  await expect(dialog.getByTestId("drawing-units")).toHaveText("Unit: millimetres, as the drawing says · the layout is 24 m × 16 m");
  await dialog.getByTestId("drawing-open").click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await loaded(page, 12);

  // Review: floor, scale, objects, omissions.
  const review = page.getByTestId("drawing-review");
  await review.getByTestId("review-floor-accept").click();
  await review.getByTestId("review-scale-accept").click();
  await review.getByTestId("review-accept-remaining").click();
  await review.getByTestId("review-omissions-accept").click();
  await expect(review.getByTestId("review-ready")).toContainText("Reviewed");

  // Edit: move Press 1 two metres.
  await page.getByRole("button", { name: "Show the object list and details" }).click();
  await objectList(page, /Press 1/).click();
  await page.getByTestId("journey-change").click();
  const x = page.getByTestId("field-position-x");
  await expect(x).toHaveValue("-8.500");
  await x.fill("-6.500");
  await x.press("Enter");
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");

  // Save: a downloaded project file with the drawing and the move.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  const saved = JSON.parse(text);
  expect(saved.sources[0].filename).toBe("hall-mm.dxf");
  const press = saved.scene.objects.find((o: { id: string }) => o.id === "obj-dxf-104");
  expect(press.transform.position_m.x).toBe(-6.5);

  // Reopen in a fresh page: the move is there, and the drawing is still in the local library.
  await page.goto("/");
  await page.getByTestId("scene-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await loaded(page, 12);
  const list = page.getByRole("button", { name: "Show the object list and details" });
  if (await list.isVisible()) await list.click();
  await objectList(page, /Press 1/).click();
  await page.getByTestId("journey-change").click();
  await expect(page.getByTestId("field-position-x")).toHaveValue("-6.500");
  const check = await page.evaluate(async (body) => (await fetch("/api/v1/projects/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body })).json(), text);
  expect(check.missing_source_files).toEqual([]);
});
