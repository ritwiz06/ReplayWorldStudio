import { readFileSync } from "node:fs";
import type { Project } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { createApiClient, locationToPath } from "./client";

const fixture = readFileSync(
  new URL("../../../../fixtures/scenes/foundation-scene.json", import.meta.url),
  "utf8",
);

function respond(status: number, body: string): typeof fetch {
  return () =>
    Promise.resolve(new Response(body, { status, headers: { "Content-Type": "application/json" } }));
}

const BASE = "http://api.test";

describe("api client", () => {
  it("returns a contract-checked project", async () => {
    const result = await createApiClient(BASE, respond(200, fixture)).getFoundationFixture();
    expect(result.ok && result.value.scene.objects.length).toBe(6);
  });

  it("reports an unreachable API as a network failure", async () => {
    const offline: typeof fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    const result = await createApiClient(BASE, offline).getHealth();
    expect(result).toEqual({
      ok: false,
      error: { kind: "network", message: "Could not reach the API at http://api.test." },
    });
  });

  it("reports a 2xx body that breaks the contract with located issues", async () => {
    const broken = JSON.parse(fixture) as Project;
    broken.scene.objects[1]!.dimensions.depth.value_m = 0;
    const result = await createApiClient(
      BASE,
      respond(200, JSON.stringify(broken)),
    ).getFoundationFixture();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      kind: "contract",
      issues: [{ path: "/scene/objects/1/dimensions/depth/value_m", message: "must be > 0" }],
    });
  });

  it("reports a non-JSON 2xx body as a parse failure", async () => {
    const result = await createApiClient(BASE, respond(200, "<html>proxy</html>")).getHealth();
    expect(!result.ok && result.error.kind).toBe("parse");
  });

  it("turns a 422 rejection into located issues", async () => {
    const rejection = JSON.stringify({
      detail: [
        {
          loc: ["body", "scene", "objects", 4, "dimensions", "width", "value_m"],
          msg: "Input should be greater than 0",
          type: "greater_than",
        },
      ],
    });
    const result = await createApiClient(BASE, respond(422, rejection)).validateProjectDocument(
      "{}",
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "http",
        status: 422,
        message: "The API rejected the input.",
        issues: [
          {
            path: "/scene/objects/4/dimensions/width/value_m",
            message: "Input should be greater than 0",
          },
        ],
      },
    });
  });

  it("keeps the API's message for other HTTP errors", async () => {
    const result = await createApiClient(
      BASE,
      respond(500, JSON.stringify({ detail: "Fixture 'foundation' failed contract validation" })),
    ).getFoundationFixture();
    expect(!result.ok && result.error).toMatchObject({
      kind: "http",
      status: 500,
      message: "Fixture 'foundation' failed contract validation",
    });
  });

  it("propagates caller cancellation instead of reporting a failure", async () => {
    const controller = new AbortController();
    const waitsForAbort: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const pending = createApiClient(BASE, waitsForAbort).getHealth(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("formats error locations as JSON pointers", () => {
    expect(locationToPath(["body", "scene", "objects", 2])).toBe("/scene/objects/2");
    expect(locationToPath(["body"])).toBe("/");
  });
});
