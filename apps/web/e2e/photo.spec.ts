// IMG-01: one permitted photo becomes a reviewed, editable 3D world. The API replays the vision
// model's recorded live answers ("recorded" mode, labelled as such), so detection, review, scale,
// building, saving and the source-photo checks all run offline and deterministically.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { E2E_SOURCES_DIR } from "./paths";

const photoPath = (name: string) => new URL(`../../../fixtures/photos/${name}`, import.meta.url).pathname;
const FACTORY = photoPath("factory-walk.png");
const FACTORY_SHA = createHash("sha256").update(readFileSync(FACTORY)).digest("hex");

// The walkway between the floor grid lines x = -3 and x = +3 of the rendered demo: exactly 6 m by
// 1.8 m, its corners the projections of those floor points (see src/photo/world.test.ts).
const WALKWAY: [number, number][] = [
  [0.2073, 0.6507],
  [0.7927, 0.6507],
  [0.934, 0.7511],
  [0.066, 0.7511],
];

interface Saved {
  schema_version: string;
  sources: {
    kind: string;
    filename: string;
    sha256: string;
    source_to_world: unknown;
    image: { uri: string; media_type: string; width_px: number; height_px: number };
    photo_import: {
      vision_model: { model: string };
      calibration: { camera: { fov_basis: string; position_m: { x: number; y: number; z: number } }; reference: { size_basis: string; width: { origin: string; source_ref: string } } };
      observations: { id: string; decision: string; object_id: string | null }[];
    };
  }[];
  catalog: { id: string; generation: { method: string; language_model: { model: string } | null }; nominal_dimensions: Record<string, { origin: string; review_status: string; source_ref: string }> }[];
  scene: { objects: { id: string; name: string; kind: string; transform: { position_m: { x: number } } }[]; edit_log: { type: string }[] };
}

const objects = (page: Page, n: number) => expect(page.getByTestId("scene-status")).toHaveText(`Scene loaded · ${n} objects`);
const objectList = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name });

async function openDemo(page: Page) {
  await page.goto("/");
  await objects(page, 15);
}

async function openPhotoImport(page: Page) {
  await page.getByTestId("open-start").click();
  await page.getByTestId("start-image").click();
  await expect(page.getByTestId("photo-import")).toBeVisible();
}

/** Drag the four gold corners onto points given as fractions of the photo. */
async function markRectangle(page: Page, corners: [number, number][]) {
  for (const [i, [u, v]] of corners.entries()) {
    const stage = (await page.getByTestId("photo-stage").boundingBox())!;
    const handle = (await page.getByTestId(`photo-corner-${i}`).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + u * stage.width, stage.y + v * stage.height, { steps: 6 });
    await page.mouse.up();
  }
}

async function setLength(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).fill(value);
  await page.getByTestId(testId).press("Enter");
}

async function save(page: Page): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  return { name: download.suggestedFilename(), text: readFileSync((await download.path())!, "utf8") };
}

async function reopen(page: Page, file: { name: string; text: string }) {
  await page.getByTestId("scene-file-input").setInputFiles({ name: file.name, mimeType: "application/json", buffer: Buffer.from(file.text) });
}

test("a photo becomes a reviewed, editable 3D world that saves, reopens and survives a missing photo", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(180_000);
  await openDemo(page);
  await openPhotoImport(page);
  const wizard = page.getByTestId("photo-import");
  const input = page.getByTestId("photo-file-input");

  // Unsupported and oversized files are refused in the browser; nothing is sent.
  await input.setInputFiles({ name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not a photo at all") });
  await expect(page.getByTestId("photo-error")).toContainText("Only JPEG, PNG and WebP photos are supported.");
  const huge = Buffer.alloc(16 * 1024 * 1024);
  huge.set([0xff, 0xd8, 0xff, 0xe0]);
  await input.setInputFiles({ name: "huge.jpg", mimeType: "image/jpeg", buffer: huge });
  await expect(page.getByTestId("photo-error")).toContainText("the limit is 15 MB");

  // A supported photo is shown at once, with where it would be sent said before anything is.
  await input.setInputFiles(FACTORY);
  await expect(page.getByTestId("photo-image")).toBeVisible();
  await expect(page.getByTestId("photo-routing")).toContainText("Offline test provider: replays recorded answers of qwen3-vl-32b-instruct. Not live AI.");

  // A model failure is reported with a retry; the open project is untouched.
  const proposals = "**/api/v1/assist/image-proposals";
  await page.route(proposals, (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ detail: "The vision service did not answer." }) }));
  await page.getByTestId("photo-analyse").click();
  await expect(page.getByTestId("photo-failed")).toBeVisible();
  await expect(page.getByTestId("photo-retry")).toBeEnabled();
  await page.unroute(proposals);

  // Analysis can be cancelled while it runs; the photo stays ready to try again.
  let held = false;
  await page.route(proposals, () => {
    held = true; // never answered: the request is abandoned by the cancel below
  });
  await page.getByTestId("photo-retry").click();
  await expect(page.getByTestId("photo-analysing")).toBeVisible();
  await expect.poll(() => held).toBe(true);
  await page.getByTestId("photo-cancel").click();
  await expect(page.getByTestId("photo-analyse")).toBeVisible();
  await page.unroute(proposals);
  await objects(page, 15);

  // The proposal: separate objects outlined over the photo, small items on machines suggested
  // for rejection, and no world until a scale is given.
  await page.getByTestId("photo-analyse").click();
  await expect(page.getByTestId("photo-stage")).toBeVisible();
  for (const id of ["obs-1", "obs-2", "obs-3", "obs-4", "obs-5"]) await expect(page.getByTestId(`photo-accept-${id}`)).toBeChecked();
  for (const id of ["obs-6", "obs-7"]) await expect(page.getByTestId(`photo-accept-${id}`)).not.toBeChecked();
  await expect(page.getByTestId("photo-contact-obs-2")).toBeVisible();
  await expect(page.getByTestId("photo-needs-scale")).toBeVisible();
  await expect(page.getByTestId("photo-create")).toBeDisabled();

  // Reject one object.
  await page.getByTestId("photo-accept-obs-5").uncheck();
  await expect(page.getByTestId("photo-tab-objects")).toHaveText("1 Objects (4)");

  // Scale: a measured rectangle on the floor. Both sides are known, so the lens is solved too.
  await page.getByTestId("photo-tab-scale").click();
  await markRectangle(page, WALKWAY);
  await page.getByTestId("photo-feature").fill("walkway between floor grid lines");
  await setLength(page, "photo-scale-width", "6");
  // Create waits until the user says whether the size is measured or assumed.
  await expect(page.getByTestId("photo-needs-basis")).toBeVisible();
  await expect(page.getByTestId("photo-create")).toBeDisabled();
  await page.getByTestId("photo-basis-measured").check();
  await expect(page.getByTestId("photo-create")).toBeEnabled();
  await setLength(page, "photo-scale-depth", "1.8");
  await expect(page.getByTestId("photo-scale-summary")).toContainText("Camera about 1.60 m above the floor, 70° view (from your two side lengths)");
  await page.getByTestId("photo-tab-layout").click();
  await expect(page.getByTestId("photo-layout")).toBeVisible();

  // Create: the photo is stored, each object gets a provisional model, and the world replaces
  // the demo only now.
  await objects(page, 15);
  await page.getByTestId("photo-create").click();
  await expect(wizard).toBeHidden({ timeout: 60_000 });
  await objects(page, 6);
  await expect(page.getByTestId("scene-source")).toHaveText("Built from the photo factory-walk.png (not saved yet)");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "4/4 ready, 0 failed");
  await expect(page.getByTestId("source-photo-image")).toHaveAttribute("data-state", "ready");
  expect(existsSync(join(E2E_SOURCES_DIR, "photos", `${FACTORY_SHA}.png`))).toBe(true);

  // Compare with the photo from the reconstructed camera, then walk.
  await page.getByTestId("source-photo-view").click();
  await expect
    .poll(async () => {
      const probe = JSON.parse((await page.getByTestId("viewport").getAttribute("data-camera")) ?? "{}") as { position?: number[] };
      return probe.position?.map((v) => Math.round(v * 10) / 10);
    })
    .toEqual([0, 1.6, 4.5]);
  await page.getByTestId("mode-walk").click();
  await expect(page.getByTestId("walk-hud")).toBeVisible();
  await page.getByTestId("mode-orbit").click();

  // Edit: move one object, add another from the catalog, undo the addition.
  await objectList(page, /Center machine/).click();
  const x = page.getByTestId("field-position-x");
  const before = Number(await x.inputValue());
  await x.fill((before + 0.5).toFixed(3));
  await x.press("Enter");
  await expect(page.getByTestId("revision-status")).toHaveText("Scene revision 1");
  await page.locator("[data-testid^=place-asset-]").first().click();
  await expect(page.getByTestId("placement-readout")).toBeVisible();
  await page.keyboard.press("Enter");
  await objects(page, 7);
  await page.getByTestId("undo").click();
  await objects(page, 6);

  // Save: the photo is an identified, hash-checked source; image-inferred and user values differ.
  const file = await save(page);
  const saved = JSON.parse(file.text) as Saved;
  expect(saved.schema_version).toBe("0.13.0");
  const source = saved.sources[0]!;
  expect([source.kind, source.filename, source.sha256, source.source_to_world]).toEqual(["photo", "factory-walk.png", FACTORY_SHA, null]);
  expect(source.image).toMatchObject({ uri: `photos/${FACTORY_SHA}.png`, media_type: "image/png", width_px: 1328, height_px: 1000 });
  expect(source.photo_import.vision_model.model).toBe("qwen3-vl-32b-instruct");
  expect(source.photo_import.calibration.camera.fov_basis).toBe("from_sides");
  expect(source.photo_import.calibration.reference.width.origin).toBe("user_supplied");
  expect(source.photo_import.calibration.reference.size_basis).toBe("measured");
  const decisions = Object.fromEntries(source.photo_import.observations.map((o) => [o.id, o.decision]));
  expect(decisions).toEqual({ "obs-1": "accepted", "obs-2": "accepted", "obs-3": "accepted", "obs-4": "accepted", "obs-5": "rejected", "obs-6": "rejected", "obs-7": "rejected" });
  const ids = new Set(saved.scene.objects.map((o) => o.id));
  expect(source.photo_import.observations.filter((o) => o.object_id).every((o) => ids.has(o.object_id!))).toBe(true);
  for (const asset of saved.catalog) {
    expect(asset.generation.method).toBe("photo");
    expect(asset.nominal_dimensions.height).toMatchObject({ origin: "inferred", review_status: "unreviewed" });
    expect(asset.nominal_dimensions.height.source_ref).toContain("factory-walk.png");
  }
  const moved = saved.scene.objects.find((o) => o.name.startsWith("Center machine"))!;
  expect(moved.transform.position_m.x).toBeCloseTo(before + 0.5, 3);
  expect(saved.scene.edit_log.map((r) => r.type)).toEqual(["object_edited"]);

  // Reopen: accepted with the photo present and hash-checked.
  await reopen(page, file);
  await expect(page.getByTestId("scene-source")).toHaveText(`${file.name} (accepted by API)`);
  await objects(page, 6);
  await expect(page.getByTestId("source-photo-image")).toHaveAttribute("data-state", "ready");

  // Without the photo the file is refused at the photo's location, never shown with a substitute.
  const stored = join(E2E_SOURCES_DIR, "photos", `${FACTORY_SHA}.png`);
  rmSync(stored);
  await reopen(page, file);
  const rejected = page.getByTestId("file-rejected");
  await expect(rejected).toContainText("/sources/0/image/uri");
  await expect(rejected.getByTestId("photo-missing")).toContainText("factory-walk.png");
  // A different file is not accepted as the original.
  await rejected.getByTestId("attach-photo-input").setInputFiles(photoPath("living-room.webp"));
  await expect(rejected.getByTestId("photo-missing-message")).toContainText("is not the original photo");
  expect(existsSync(stored)).toBe(false);
  // The original is: the project opens with its photo again.
  await rejected.getByTestId("attach-photo-input").setInputFiles(FACTORY);
  await expect(rejected).toBeHidden();
  await expect(page.getByTestId("scene-source")).toHaveText(`${file.name} (accepted by API)`);
  expect(existsSync(stored)).toBe(true);

  // Or the project opens without it: objects and evidence stay, the photo is reported missing.
  rmSync(stored);
  await reopen(page, file);
  await rejected.getByTestId("open-without-photo").click();
  await objects(page, 6);
  await expect(page.getByTestId("source-photo-missing")).toBeVisible();
});

test("a second photo with different contents builds its own world; closing the import keeps the project", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemo(page);
  await openPhotoImport(page);
  await page.getByTestId("photo-file-input").setInputFiles(photoPath("living-room.webp"));
  await page.getByTestId("photo-analyse").click();
  await expect(page.getByTestId("photo-stage")).toBeVisible();
  await expect(page.getByTestId("photo-objects")).toContainText("sofa");
  await expect(page.getByTestId("photo-objects")).toContainText("coffee table");

  // Closing after the analysis changes nothing.
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("photo-import")).toBeHidden();
  await objects(page, 15);

  // Again, with an assumed rug size, through to a world.
  await openPhotoImport(page);
  await page.getByTestId("photo-file-input").setInputFiles(photoPath("living-room.webp"));
  await page.getByTestId("photo-analyse").click();
  await expect(page.getByTestId("photo-stage")).toBeVisible();
  await page.getByTestId("photo-tab-scale").click();
  await page.getByTestId("photo-feature").fill("rug");
  await setLength(page, "photo-scale-width", "2.0");
  await page.getByTestId("photo-basis-assumed").check();
  await expect(page.getByTestId("photo-scale")).toContainText("assumed by you");
  await page.getByTestId("photo-create").click();
  await expect(page.getByTestId("photo-import")).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId("scene-source")).toHaveText("Built from the photo living-room.webp (not saved yet)");
  await expect(objectList(page, /^Sofa/)).toBeVisible();
  await expect(objectList(page, /Coffee table/)).toBeVisible();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^(\d+)\/\1 ready, 0 failed$/);
});
