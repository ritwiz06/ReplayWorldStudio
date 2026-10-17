// IMP-02: correct a draft from a drawing in minutes. The warehouse fixture fools the first
// reading twice: the site boundary is proposed as the floor, and the header says millimetres
// for a drawing in centimetres. On the simple screen (no Details), the person fixes the floor,
// measures one known length, corrects two objects, moves one, compares, undoes and redoes,
// saves and reopens; the review and every source link survive.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const WAREHOUSE = new URL("../../../fixtures/drawings/warehouse-cm.dxf", import.meta.url).pathname;
const SIMPLE = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }] }] };

test.use({ storageState: SIMPLE });

interface Saved {
  schema_version: string;
  sources: {
    drawing: {
      units: { declared: string };
      review: {
        floor: { choice: string; drawn_id: string; status: string };
        scale: { basis: string; status: string; metres_per_unit: number; reference: { real_length_m: number; drawing_length: number; agrees: boolean; compared_with: number } };
        objects: { drawn_id: string; status: string }[];
        omissions: string;
      };
    };
  }[];
  scene: { objects: { id: string; name: string; kind: string; dimensions: { width: { value_m: number; origin: string } } }[]; edit_log: { type: string; correction?: string }[] };
}

const objects = (page: Page, n: number) => expect(page.getByTestId("scene-status")).toHaveText(`Scene loaded · ${n} objects`);

/** Click a point given in drawing units on one of the plans. */
async function clickPlan(page: Page, testId: string, x: number, y: number) {
  const at = await page.getByTestId(testId).evaluate(
    (svg, p) => {
      const plan = svg as SVGSVGElement;
      const point = plan.createSVGPoint();
      point.x = p.x;
      point.y = -p.y;
      const screen = point.matrixTransform(plan.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    },
    { x, y },
  );
  await page.mouse.click(at.x, at.y);
}

const outline = (page: Page, drawnId: string) => page.getByTestId("review-plan").locator(`[data-drawn="${drawnId}"]`);

test("a draft that fooled the first reading is corrected, moved, compared, saved and reopened", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(process.env.CI ? 120_000 : 60_000);
  await page.goto("/");
  await objects(page, 15);
  // The simple screen: the three actions lead; the object list and inspector are behind Details.
  await expect(page.getByTestId("journey")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Scene objects" })).toHaveCount(0);
  await expect(page.getByTestId("object-inspector")).toHaveCount(0);

  await page.getByTestId("journey-upload").click();
  await page.getByTestId("drawing-file-input").setInputFiles(WAREHOUSE);
  await expect(page.getByTestId("drawing-units")).toHaveText("Unit: millimetres, as the drawing says · the layout is 6 m × 4 m");
  await page.getByTestId("drawing-open").click();
  await objects(page, 13);

  const review = page.getByTestId("drawing-review");
  await expect(review.getByTestId("review-ready")).toHaveText(
    "Before any check: the scale is not checked yet; the floor is only proposed; what the drawing leaves out is not yet accepted; 12 objects not checked yet.",
  );

  // 1. Is this the floor? The site boundary was proposed; the building is the floor.
  await expect(review.getByTestId("review-floor")).toContainText("Is this the floor? Floor (LWPOLYLINE 101 on layer SITE-BOUNDARY), 6 m × 4 m");
  await review.getByTestId("review-floor-pick").click();
  await expect(review.getByTestId("review-hint")).toHaveText("Click the outline that is the floor. Cancel");
  await outline(page, "dxf-102").click();
  await expect(review.getByTestId("review-floor")).toContainText("Floor corrected Wall outline 1 (LWPOLYLINE 102 on layer A-WALL), 3 m × 2 m");
  await objects(page, 12); // the building outline is the floor now, not an object of its own

  // 2. Is this the right scale? One known length shows the header is wrong by ten.
  await expect(review.getByTestId("review-scale")).toContainText("1 unit = 1 mm (the drawing's own unit, $INSUNITS); the floor is 3 m × 2 m");
  await review.getByTestId("review-measure").click();
  await clickPlan(page, "review-plan", 1600, 2000); // column 1's centre
  await clickPlan(page, "review-plan", 2200, 2000); // column 2's centre: "Column bays are 6.00 m"
  await review.getByTestId("review-length").fill("6");
  const preview = review.getByTestId("review-preview");
  await expect(preview).toHaveAttribute("data-agrees", "false");
  await expect(preview).toContainText("Your 6.00 m gives 1 unit = 1 cm, but the drawing says 1 unit = 1 mm. With your measurement the floor is 30 m × 20 m; with millimetres it is 3 m × 2 m.");
  await review.getByTestId("review-reference-use").click();
  const scale = review.getByTestId("review-scale");
  await expect(scale).toContainText("Scale checked against a known length 1 unit = 1 cm (from your known length of 6.00 m); the floor is 30 m × 20 m");
  // Undo and redo restore the scale and every size with it.
  await page.getByTestId("undo").click();
  await expect(scale).toContainText("the floor is 3 m × 2 m");
  await page.getByTestId("redo").click();
  await expect(scale).toContainText("the floor is 30 m × 20 m");

  // 3. Are these the right objects? A drop zone drawn on the equipment layer is a floor marking;
  // the title block is not an object.
  await outline(page, "dxf-10d").click();
  const card = review.getByTestId("review-object");
  await expect(card).toContainText("Pallet drop zone · not checked yet · from LWPOLYLINE 10D on layer EQUIPMENT");
  await expect(page.getByTestId("selection-card")).toContainText("Pallet drop zone");
  await card.getByTestId("review-kind-keep_clear").check();
  await expect(card).toContainText("Pallet drop zone · corrected");
  await outline(page, "dxf-115").click();
  await card.getByTestId("review-kind-none").check();
  await expect(card).toContainText("Warehouse W2 (synthetic) · not an object");
  await objects(page, 11);
  await page.getByTestId("undo").click();
  await objects(page, 12);
  await page.getByTestId("redo").click();
  await objects(page, 11);
  await review.getByTestId("review-accept-remaining").click();
  await review.getByTestId("review-omissions-accept").click();
  await expect(review.getByTestId("review-ready")).toHaveText(
    "Reviewed: a check can now give a design-layout result for this drawing (not the site as built). Except Water tank: its box only encloses the drawn shape, so enter its size to use it.",
  );

  // Change something with the existing editor: open Details from the selected object, move it.
  await outline(page, "dxf-108").click();
  await page.getByTestId("selection-card").getByTestId("selection-details").click();
  const x = page.getByTestId("field-position-x");
  await x.fill(String(Number(await x.inputValue()) + 2));
  await x.press("Enter");
  await page.getByTestId("details-toggle").click();
  await expect(page.getByTestId("object-inspector")).toHaveCount(0);

  // Play or compare: the drawing at its corrected scale against the layout now.
  await page.getByTestId("journey-compare").click();
  await expect(page.getByTestId("compare-summary")).toHaveText("Compared with warehouse-cm.dxf: 2 changed · 8 as drawn");
  await expect(page.getByTestId("drawing-compare")).toContainText("Rack A moved 2.00 m");
  await expect(page.getByTestId("drawing-compare")).toContainText("Pallet drop zone now a keep-clear zone (drawn as equipment)");
  // Walk through it, on the simple screen.
  await page.getByTestId("compare-walk").click();
  await expect(page.getByTestId("walk-hud")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("check-questions").locator("summary").click();
  await page.getByTestId("check-clearance").click();
  // A round tank's enclosing square is approximate: no check may pass on it until its size is entered.
  await expect(page.getByTestId("check-answer")).toContainText("The values are not ready for a check either: Water tank's box only encloses its drawn shape (enter its size to use it).");

  // Save: the header's unit and the person's measurement are both kept, with every decision.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  const saved = JSON.parse(text) as Saved;
  expect(saved.schema_version).toBe("0.10.0");
  const drawing = saved.sources[0]!.drawing;
  expect(drawing.units.declared).toBe("mm");
  expect(drawing.review.floor).toMatchObject({ choice: "outline", drawn_id: "dxf-102", status: "corrected" });
  expect(drawing.review.scale).toMatchObject({ basis: "reference_length", status: "measured", metres_per_unit: 0.01 });
  expect(drawing.review.scale.reference).toMatchObject({ real_length_m: 6, drawing_length: 600, compared_with: 0.001, agrees: false });
  expect(drawing.review.omissions).toBe("accepted");
  expect(drawing.review.objects.filter((o) => o.status === "proposed")).toEqual([]);
  const rack = saved.scene.objects.find((o) => o.name === "Rack A")!;
  expect(rack.dimensions.width).toMatchObject({ value_m: 16, origin: "drawn" });
  expect(saved.scene.edit_log.filter((r) => r.type === "drawing_reviewed").map((r) => r.correction)).toContain(
    "Floor: Wall outline 1 (LWPOLYLINE 102 on layer A-WALL), instead of Floor (LWPOLYLINE 101 on layer SITE-BOUNDARY)",
  );

  // Reopen in a fresh page: the review, the scale and the comparison come back as saved.
  await page.goto("/");
  await objects(page, 15);
  await page.getByTestId("scene-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await objects(page, 11);
  await expect(page.getByTestId("review-ready")).toContainText("Reviewed: a check can now give a design-layout result for this drawing (not the site as built).");
  await expect(page.getByTestId("review-scale")).toContainText("1 unit = 1 cm (from your known length of 6.00 m); the floor is 30 m × 20 m");
  await page.getByTestId("journey-compare").click();
  await expect(page.getByTestId("compare-summary")).toHaveText("Compared with warehouse-cm.dxf: 2 changed · 8 as drawn");
});
