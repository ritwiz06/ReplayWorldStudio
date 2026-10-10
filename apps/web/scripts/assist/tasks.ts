// Timed walk-throughs of the GEN-01 tasks against the running dev servers (live provider).
//
//   pnpm dev:api & pnpm dev:web          (with VOYAGER_API_KEY in .env)
//   pnpm --filter @replay-world/web exec node scripts/assist/tasks.ts [--out DIR] [--headed]
//
// Each task is driven the way a first-time user would do it, with no think time: every click,
// typed entry or key press counts as one step. The report separates the time spent waiting for
// the language model from the rest. These are observations of the software, not a usability
// study: a person reading and deciding adds time that a script does not.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, expect, type Page } from "@playwright/test";

const { values: options } = parseArgs({
  options: {
    out: { type: "string", default: "../../bench-results/gen-01-tasks" },
    base: { type: "string", default: "http://127.0.0.1:5173" },
    headed: { type: "boolean", default: false },
  },
});

interface Timing {
  task: string;
  steps: number;
  totalS: number;
  modelWaitS: number;
  outcome: string;
}

class Task {
  steps = 0;
  modelWaitMs = 0;
  readonly started = performance.now();
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  /** One user action. */
  async act(action: () => Promise<unknown>) {
    this.steps++;
    await action();
  }
  /** Time spent waiting for the language model (part of the total, reported separately). */
  async waitForModel(until: () => Promise<unknown>) {
    const t = performance.now();
    await until();
    this.modelWaitMs += performance.now() - t;
  }
  done(outcome: string): Timing {
    return {
      task: this.name,
      steps: this.steps,
      totalS: Math.round((performance.now() - this.started) / 100) / 10,
      modelWaitS: Math.round(this.modelWaitMs / 100) / 10,
      outcome,
    };
  }
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(options.out, `${name}.png`) });

let previous: { close: () => Promise<void> } | null = null;

/** A first visit (or a returning one) in a new context; the previous task's context is closed. */
async function fresh(browser: Awaited<ReturnType<typeof chromium.launch>>, seen: boolean) {
  await previous?.close();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  previous = context;
  if (seen) await context.addInitScript(() => window.localStorage.setItem("rws.start.seen", "1"));
  const page = await context.newPage();
  await page.goto(options.base);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "4/4 ready, 0 failed", { timeout: 60_000 });
  return page;
}

async function describeAndPlace(page: Page, name: string, description: string, correct?: { field: string; value: string }) {
  const task = new Task(name);
  await task.act(() => page.getByTestId("start-describe").click());
  const create = page.getByTestId("create-object");
  await task.act(() => create.getByTestId("describe-text").fill(description));
  await task.act(() => create.getByTestId("describe-submit").click());
  await task.waitForModel(() => expect(create.getByTestId("size-review")).toBeVisible({ timeout: 180_000 }));
  await expect(create.getByTestId("model-preview")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot(page, `${name}-review`);
  if (correct) {
    await task.act(() => create.getByTestId(correct.field).fill(correct.value));
    await task.act(() => create.getByTestId(correct.field).press("Enter"));
    await expect(create.getByTestId("model-preview")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  }
  if (await create.getByTestId("confirm-sizes").isVisible()) await task.act(() => create.getByTestId("confirm-sizes").click());
  await task.act(() => create.getByTestId("place-generated").click());
  await expect(page.getByTestId("placement-banner")).toBeVisible();
  // The marker in the 3D view (which listens for Enter) mounts just after the banner.
  await expect(page.getByTestId("placement-readout")).toBeVisible();
  await task.act(() => page.keyboard.press("Enter"));
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^5\/5 ready/, { timeout: 30_000 });
  const timing = task.done((await page.getByTestId("object-inspector").locator(".panel-title").textContent()) ?? "?");
  await page.keyboard.press("f");
  await page.waitForTimeout(1200);
  await shot(page, `${name}-placed`);
  return timing;
}

async function main() {
  mkdirSync(options.out, { recursive: true });
  const browser = await chromium.launch({ headless: !options.headed });
  const timings: Timing[] = [];
  // Written after every task, so a failure late in the run keeps the earlier observations.
  const report = () => writeFileSync(join(options.out, "timings.json"), `${JSON.stringify(timings, null, 2)}\n`);

  // 1. First visit: describe the conveyor from the user's prompt, confirm the estimates, place.
  let page = await fresh(browser, false);
  await shot(page, "start-panel");
  timings.push(await describeAndPlace(page, "conveyor", "a guarded conveyor about 2.2 m long with a control screen"));
  report();

  // 2. Describe a tank, correct one estimated size, place.
  page = await fresh(browser, false);
  timings.push(
    await describeAndPlace(page, "tank", "a cylindrical water tank 1.5 m tall with a cone-shaped bottom on four legs", { field: "size-width", value: "1.2" }),
  );
  report();

  // 3. Describe a workbench, place.
  page = await fresh(browser, false);
  timings.push(await describeAndPlace(page, "workbench", "a workbench 1.8 m wide with a monitor and a drawer unit"));
  report();

  // 4. Move the selected cabinet with words.
  page = await fresh(browser, true);
  let task = new Task("language-move");
  await task.act(() => page.getByRole("button", { name: /Control cabinet 1/ }).click());
  await task.act(() => page.getByTestId("change-input").fill("move the selected cabinet 1 metre left"));
  await task.act(() => page.getByTestId("change-submit").click());
  await task.waitForModel(() => expect(page.getByTestId("change-summary")).toBeVisible({ timeout: 120_000 }));
  await shot(page, "language-move-proposal");
  await task.act(() => page.getByTestId("change-apply").click());
  await expect(page.getByTestId("field-position-x")).toHaveValue("-3.000");
  timings.push(task.done("Control cabinet 1 at x = -3.000 m"));
  report();
  await shot(page, "language-move-applied");

  // 5. An ambiguous request: the user is asked which object.
  page = await fresh(browser, true);
  task = new Task("language-ambiguous");
  await task.act(() => page.getByTestId("change-input").fill("move the cabinet 1 m left"));
  await task.act(() => page.getByTestId("change-submit").click());
  await task.waitForModel(() => expect(page.getByTestId("change-question")).toBeVisible({ timeout: 120_000 }));
  timings.push(task.done((await page.getByTestId("change-question").textContent()) ?? "?"));
  report();
  await shot(page, "language-ambiguous");

  // 6. Build an object by hand (no language model).
  page = await fresh(browser, true);
  task = new Task("builder");
  await task.act(() => page.getByTestId("catalog-build").click());
  const create = page.getByTestId("create-object");
  await task.act(() => create.getByTestId("template-cabinet").click());
  await task.act(() => create.getByTestId("size-height").fill("2.2"));
  await task.act(() => create.getByTestId("size-height").press("Enter"));
  await expect(create.getByTestId("model-preview")).toHaveAttribute("data-extents", /,2\.200,/);
  await expect(create.getByTestId("model-preview")).toHaveAttribute("data-state", "ready");
  await shot(page, "builder");
  await task.act(() => create.getByTestId("place-generated").click());
  await expect(page.getByTestId("placement-banner")).toBeVisible();
  // The marker in the 3D view (which listens for Enter) mounts just after the banner.
  await expect(page.getByTestId("placement-readout")).toBeVisible();
  await task.act(() => page.keyboard.press("Enter"));
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^5\/5 ready/, { timeout: 30_000 });
  timings.push(task.done("Cabinet placed"));
  report();

  await browser.close();
  report();
  for (const t of timings) console.log(`${t.task.padEnd(20)} ${String(t.steps).padStart(2)} steps  ${t.totalS.toFixed(1).padStart(6)} s  (model ${t.modelWaitS.toFixed(1)} s)  ${t.outcome}`);
}

await main();
