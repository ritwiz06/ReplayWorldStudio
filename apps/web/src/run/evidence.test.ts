// Evidence bundles (REL-01): the export holds the engine's own event logs in the order they were
// produced, reads the project without changing it, states the basis of every operating input,
// and a bundle's runs come out the same when they are run again from its project file.
import { readFileSync } from "node:fs";
import { type DrawingAnalysis, type EvidenceAsset, type Project, validateDrawingAnalysis, validateEvidenceManifest } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { SAMPLE_MOVE_TO, sampleProject } from "../drawing/sampleProject";
import { drawingSource, toWorld } from "../drawing/world";
import { serializeProject } from "../editing/projectFile";
import { runDay } from "./day";
import { buildEvidence, bundleRuns, operatingInputs, reproduce } from "./evidence";

const data: unknown = JSON.parse(readFileSync(new URL("../../../../fixtures/drawings/layout-checks-mm.analysis.json", import.meta.url), "utf8"));
const checked = validateDrawingAnalysis(data);
if (!checked.ok) throw new Error("analysis");
const sample = sampleProject(checked.value as DrawingAnalysis);
const at = toWorld(drawingSource(sample)!.source_to_world, SAMPLE_MOVE_TO);
const edited: Project = {
  ...sample,
  scene: { ...sample.scene, revision: sample.scene.revision + 1, objects: sample.scene.objects.map((o) => (o.id === "obj-dxf-111" ? { ...o, transform: { ...o.transform, position_m: { ...o.transform.position_m, x: at.x, z: at.z } } } : o)) },
};
const dxf = drawingSource(sample)!;
const assets: EvidenceAsset[] = [{ uri: dxf.drawing.file.uri, kind: "drawing", label: dxf.filename, sha256: dxf.sha256, bytes: dxf.drawing.file.bytes, status: "repo_owned" }];

describe("an evidence bundle of the sample's before/after", () => {
  const current = runDay(edited, edited.process!, "edited");
  const runs = bundleRuns(edited, current, true, null);
  const before = serializeProject(edited);
  const request = buildEvidence(edited, runs, assets, { include: [assets[0]!.uri], summaryOnly: false }, new Date("2026-10-19T12:00:00Z"));

  it("leaves the project as it was", () => {
    expect(serializeProject(edited)).toBe(before);
  });

  it("holds both runs, the blocked route and the output change, with a valid manifest", () => {
    const m = request.manifest;
    expect(validateEvidenceManifest(m).ok).toBe(true);
    expect(m.replay).toBe("full");
    expect(m.project.synthetic).toBe(true);
    expect(m.runs.map((r) => [r.layout, r.outcome, r.completed])).toEqual([
      ["original", "ready", 102],
      ["edited", "blocked", 0],
    ]);
    expect(m.runs[0]!.layout_fingerprint).not.toBe(m.runs[1]!.layout_fingerprint);
    expect(m.runs[0]!.process_fingerprint).toBe(m.runs[1]!.process_fingerprint);
    expect(m.comparison!.explanation[0]).toMatch(/^Rack A \(material\) ↔ Mixer is blocked in the edited layout .*0\.50 m between Rack A and Machine B/);
    expect(m.comparison!.explanation).toContain("Output goes from 102 to 0 completed batches (−102).");
    const summary = request.texts.find((t) => t.path === "summary.md")!.text;
    expect(summary).toMatch(/\*\*Synthetic example\.\*\*/);
    expect(summary).toMatch(/Results under stated assumptions/);
    expect(summary).toContain("Machine B moved");
  });

  it("states every operating input with its unit and basis", () => {
    const inputs = operatingInputs(edited.process!);
    expect(inputs.every((i) => i.basis === "example")).toBe(true);
    expect(inputs.find((i) => i.path === "stations[3].worker_s")).toMatchObject({ value: 240, unit: "s" });
    expect(inputs.filter((i) => i.path.endsWith("access_m"))).toHaveLength(edited.process!.stations.length);
  });

  it("writes the engine's event log unchanged, ordered by time", () => {
    const log = JSON.parse(request.texts.find((t) => t.path === "runs/original/events.json")!.text);
    expect(log.events).toEqual(runs[0]!.result!.events);
    expect(log.events.every((e: { t: number }, i: number, all: { t: number }[]) => i === 0 || all[i - 1]!.t <= e.t)).toBe(true);
    expect(log.stations.map((s: { name: string }) => s.name)).toEqual(["Rack A (material)", "Mixer", "Machine B", "Packing table"]);
  });

  it("is reproduced from its own project file: the same events, fingerprints, counts and explanation", () => {
    const reopened = JSON.parse(request.texts.find((t) => t.path === "project.json")!.text) as Project;
    const recorded = Object.fromEntries(runs.map((r) => [r.layout, JSON.parse(JSON.stringify(r.result!.events))]));
    const check = reproduce(reopened, request.manifest, recorded);
    expect(check.rows.filter((r) => !r.same)).toEqual([]);
    expect(check.same).toBe(true);
  });

  it("notices a changed event log or a different process", () => {
    const recorded = { original: runs[0]!.result!.events.map((e, i) => (i === 5 ? { ...e, t: e.t + 1 } : e)), edited: runs[1]!.result!.events };
    expect(reproduce(edited, request.manifest, recorded).rows.find((r) => r.what === "event log, event by event" && !r.same)?.now).toBe("differs from event 5");
    const slower = { ...edited, process: { ...edited.process!, seed: 2 } };
    expect(reproduce(slower, request.manifest, recorded).same).toBe(false);
  });

  it("left out files and summary-only bundles are labelled", () => {
    const without = buildEvidence(edited, runs, assets, { include: [], summaryOnly: false });
    expect(without.manifest.replay).toBe("runs_only");
    expect(without.manifest.excluded).toEqual([{ what: "layout-checks-mm.dxf", reason: "part of the repository, not selected" }]);
    const summary = buildEvidence(edited, runs, assets, { include: [assets[0]!.uri], summaryOnly: true });
    expect(summary.manifest.replay).toBe("summary_only");
    expect(summary.manifest.project.file).toBeNull();
    expect(summary.include).toEqual([]);
    expect(summary.texts.map((t) => t.path)).not.toContain("project.json");
  });
});
