// UX-03 with no Voyager key, on the app as `pnpm start` serves it: the chat-first screen says AI
// is off and does not offer typing, and every suggestion, the attachment, the manual move card,
// the route check, the run and the full editor still work. Nothing pretends to be live AI.
import { expect, test } from "@playwright/test";

const HALL = new URL("../../../../fixtures/drawings/hall-mm.dxf", import.meta.url).pathname;

test("no key: the conversation works by hand, and says why typing is off", { tag: "@local" }, async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 0 objects");
  const chat = page.getByTestId("chat");
  await expect(chat.getByTestId("chat-ai")).toHaveAttribute("data-mode", "off");
  await expect(chat.getByTestId("chat-ai")).toHaveText("AI off · no key");
  await expect(chat.getByTestId("chat-input")).toBeDisabled();
  await expect(chat.getByTestId("chat-input")).toHaveAttribute("placeholder", "Typing needs AI (off: no key)");
  // The three starting points.
  await expect(chat.getByTestId("chat-suggestions").getByRole("button")).toHaveText(["Show me the example factory", "Upload a drawing and make a world", "What can I check in this layout?"]);
  await chat.getByTestId("chat-suggest-capabilities").click();
  await expect(chat.locator('[data-kind="capabilities"]')).toContainText("Here's what works right now");

  // The example, a manual move with its preview, Apply, the route and the run: no model involved.
  await chat.getByTestId("chat-suggest-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await expect(chat.locator('[data-kind="done"]').last()).toContainText("example factory");
  await page.getByTestId("view-toggle").click(); // pick Machine B in the full editor's list…
  await page.getByRole("button", { name: "Show the object list and details" }).click();
  await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name: /^Machine B/ }).click();
  await page.getByTestId("view-toggle").click(); // …and come back: the selection is kept
  await chat.getByTestId("chat-suggest-move").click();
  await chat.getByTestId("chat-move-distance").fill("1");
  await chat.getByTestId("chat-move-right").click();
  const proposal = chat.locator('[data-kind="proposal"]');
  await expect(proposal).toContainText("Move Machine B 1 m right?");
  await expect(proposal).not.toContainText("recorded answer");
  await proposal.getByTestId("chat-apply").click();
  await expect(chat.locator('[data-kind="applied"]')).toContainText("Moved Machine B 1 m right.");
  await chat.getByTestId("chat-suggest-route").click();
  await expect(chat.locator('[data-kind="route"]').last()).toContainText(/^Yes: a 1\.40 m wide path gets through/);
  await chat.getByTestId("chat-suggest-run_example").click();
  await expect(chat.locator('[data-kind="run"]').last()).toContainText(/Ran the shift: \d+ batches completed by 14:00/);
  await expect(page.getByTestId("run-bar")).toBeVisible();

  // Attaching a DXF reads it on this computer and asks only for what the review needs.
  await chat.getByTestId("chat-file-input").setInputFiles(HALL);
  // The edited sample is not saved: the usual question comes first; nothing is lost silently.
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(chat.getByTestId("chat-review")).toBeVisible({ timeout: 30_000 });
  await expect(chat.getByTestId("chat-review")).not.toContainText("LWPOLYLINE");
});
