// What a proposed edit changes in the layout checks (UX-03), shown before Apply: new or
// cleared overlaps and keep-clear conflicts, the asked route, and the routes the shift carries
// along. Every line comes from the existing deterministic checks run on both layouts.
import type { Project } from "@replay-world/contracts";
import { type RouteAsk, runChecks } from "../checks/results";
import { planRun, type RunPlan } from "../run/plan";
import { brief } from "./context";

const key = (f: { kind: string; objectIds: string[] }) => `${f.kind}:${[...f.objectIds].sort().join(",")}`;

function carried(plan: RunPlan) {
  return new Map(
    plan.routes
      .filter((r) => r.uses.some((u) => u.startsWith("carrying")))
      .map((r) => [`${plan.locations[r.from]?.name} ↔ ${plan.locations[r.to]?.name}`, r] as const),
  );
}

/** Plain lines: what the change does to the checks. Empty when nothing they look at changes. */
export function editImpact(before: Project, after: Project, ask: RouteAsk | null): string[] {
  const lines: string[] = [];
  const a = runChecks(before, ask)?.now;
  const b = runChecks(after, ask)?.now;
  if (a && b) {
    const was = new Map(a.layout.findings.filter((f) => f.state === "conflict").map((f) => [key(f), f]));
    const now = new Map(b.layout.findings.filter((f) => f.state === "conflict").map((f) => [key(f), f]));
    for (const [k, f] of now) if (!was.has(k)) lines.push(`New: ${f.message}`);
    for (const [k, f] of was) if (!now.has(k)) lines.push(`Clears: ${f.message}`);
    if (a.route && b.route && a.route.outcome !== b.route.outcome) {
      lines.push(`Your route ${b.route.outcome === "fits" ? "now fits" : b.route.outcome === "conflict" ? `becomes blocked: ${brief(b.route.summary)}` : "can no longer be determined"}.`);
    }
  }
  const process = before.process;
  if (process && after.process) {
    const x = carried(planRun(before, process));
    const y = carried(planRun(after, after.process));
    for (const [name, r] of y) {
      const old = x.get(name);
      if (!old) continue;
      if (r.outcome === "conflict" && old.outcome !== "conflict") lines.push(`${name} would be blocked: ${brief(r.summary)}.`);
      else if (r.outcome === "fits" && old.outcome === "conflict") lines.push(`Clears: ${name} would fit again.`);
      else if (r.lengthM !== null && old.lengthM !== null && Math.abs(r.lengthM - old.lengthM) >= 0.05) lines.push(`Walk ${name}: ${old.lengthM.toFixed(1)} m → ${r.lengthM.toFixed(1)} m.`);
    }
  }
  return lines;
}
