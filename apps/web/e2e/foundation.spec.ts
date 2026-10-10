// Browser smoke path for M0: the app loads, reaches the API, renders the contract-checked
// fixture with its units and evidence, and keeps failures visible and recoverable.
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const fixture = (path: string) =>
  fileURLToPath(new URL(`../../../fixtures/${path}`, import.meta.url));

test("loads the fixture from the API and shows units, placeholders and evidence", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("api-health")).toHaveText("API online");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 6 objects");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-renderer", "ready");
  await expect(page.getByTestId("fixture-banner")).toContainText("not the realistic factory scene");
  await expect(page.getByTestId("status-bar")).toContainText("Units m · s · kg · rad");
  await expect(page.getByTestId("status-bar")).toContainText("right-handed · +Y up · floor XZ");

  await page.getByRole("button", { name: /Packing station \(placeholder\)/ }).click();
  const inspector = page.getByTestId("object-inspector");
  await expect(inspector).toContainText("Width (X)1.20 m");
  await expect(inspector).toContainText("Rotation Y1.571 rad (90.0°)");
  await expect(inspector.locator(".param").filter({ hasText: "Cycle time" })).toContainText(
    "UnknownNo value",
  );
  await expect(inspector).toContainText("Inferred");

  await page.screenshot({ path: "test-results/foundation-scene.png" });
});

test("explains a contract-breaking fixture response and recovers on retry", async ({ page }) => {
  await page.route("**/api/v1/fixtures/foundation", (route) =>
    route.fulfill({ json: { schema_version: "0.1.0", id: "broken" } }),
  );
  await page.goto("/");

  const error = page.getByTestId("load-error");
  await expect(error).toContainText("The data does not match the contract");
  await expect(error).toContainText("must have required property 'scene'");

  await page.unroute("**/api/v1/fixtures/foundation");
  await error.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 6 objects");
  await expect(error).toBeHidden();
});

test("reports an unreachable API instead of failing silently", async ({ page }) => {
  await page.route("**/health", (route) => route.abort("connectionrefused"));
  await page.route("**/api/v1/fixtures/foundation", (route) => route.abort("connectionrefused"));
  await page.goto("/");

  await expect(page.getByTestId("api-health")).toHaveText("API unreachable");
  await expect(page.getByTestId("load-error")).toContainText("Can't reach the API");
  await expect(page.getByTestId("load-error")).toContainText("pnpm dev:api");
});

test("rejects malformed scene files and keeps the current scene", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 6 objects");
  const fileInput = page.getByTestId("scene-file-input");
  const rejected = page.getByTestId("file-rejected");

  await fileInput.setInputFiles(fixture("invalid/negative-dimension.json"));
  await expect(rejected).toContainText("negative-dimension.json was rejected");
  await expect(rejected).toContainText("/scene/objects/4/dimensions/width_m");
  await expect(rejected).toContainText("Input should be greater than 0");
  await expect(rejected).toContainText("The current scene is unchanged.");
  await expect(page.getByTestId("scene-source")).toHaveText("API foundation fixture");

  // Uniqueness is a cross-field rule that only the API's models can check.
  await fileInput.setInputFiles(fixture("invalid/duplicate-object-id.json"));
  await expect(rejected).toContainText("duplicate object id: 'obj-column-c1'");

  await fileInput.setInputFiles({
    name: "not-json.json",
    mimeType: "application/json",
    buffer: Buffer.from("{ this is not json"),
  });
  await expect(rejected).toContainText("not-json.json was rejected");
  await expect(rejected).toContainText("Invalid JSON");

  await fileInput.setInputFiles(fixture("scenes/foundation-scene.json"));
  await expect(rejected).toBeHidden();
  await expect(page.getByTestId("scene-source")).toHaveText(
    "foundation-scene.json (accepted by API)",
  );
});
