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

  await expect(page.getByTestId("license-summary")).toContainText("Not asserted (NOASSERTION) 3");

  await page.getByRole("button", { name: /Packing station \(placeholder\)/ }).click();
  const inspector = page.getByTestId("object-inspector");
  // A measured footprint and an inferred height are shown axis by axis.
  await expect(inspector.getByTestId("axis-width")).toContainText("1.20 mMeasured");
  await expect(inspector.getByTestId("axis-width")).toContainText("range 1.19 m – 1.21 m");
  await expect(inspector.getByTestId("axis-height")).toContainText("1.40 mInferred");
  await expect(inspector.getByTestId("axis-depth")).toContainText("1.00 mMeasured");
  await expect(inspector).toContainText("Rotation Y1.571 rad (90.0°)");
  await expect(inspector.locator(".param").filter({ hasText: "Cycle time" })).toContainText(
    "UnknownNo value",
  );
  const asset = inspector.getByTestId("asset-details");
  await expect(asset).toContainText("Generic packing station (provisional)");
  await expect(asset).toContainText("asset-generic-packing-station");
  await expect(asset).toContainText("synthetic · Replay World Studio foundation fixture");
  await expect(asset).toContainText("LicenseNot asserted (NOASSERTION)");
  await expect(asset).toContainText("Redistribution unknown");
  await expect(asset).toContainText("This instance uses the catalog nominal size.");

  await page.screenshot({ path: "test-results/foundation-scene.png" });

  await page.getByRole("button", { name: /Column C1/ }).click();
  await expect(inspector).toContainText("None - this object is scene geometry.");
  await expect(inspector.getByTestId("axis-height")).toContainText("6.00 mDefault");
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
  await expect(rejected).toContainText("/scene/objects/4/dimensions/width/value_m");
  await expect(rejected).toContainText("Input should be greater than 0");
  await expect(rejected).toContainText("The current scene is unchanged.");
  await expect(page.getByTestId("scene-source")).toHaveText("API foundation fixture");

  // Uniqueness is a cross-field rule that only the API's models can check.
  await fileInput.setInputFiles(fixture("invalid/duplicate-object-id.json"));
  await expect(rejected).toContainText("duplicate object id: 'obj-column-c1'");

  // Cross-record rule: an object may only reference an asset that is in the catalog.
  await fileInput.setInputFiles(fixture("invalid/dangling-asset-reference.json"));
  await expect(rejected).toContainText("'asset-not-in-catalog', which is not in the catalog");

  // An older contract gets one actionable message instead of a cascade of field errors.
  await fileInput.setInputFiles(fixture("legacy/foundation-scene-0.1.0.json"));
  await expect(rejected).toContainText("/schema_version");
  await expect(rejected).toContainText("Schema 0.1.0 is an older contract");
  await expect(rejected).toContainText("python -m replay_world_contracts.migrate");
  await expect(rejected.locator(".issues li")).toHaveCount(1);

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
