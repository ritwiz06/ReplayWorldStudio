// "Does this layout fit?" (GEO-01/02) on the simple screen: one short answer for the footprints
// and keep-clear zones, one for a route the person asks about, the plan with what they found,
// and the same answers for the drawing's own arrangement beside the edited one. The numbers
// behind each answer are under "Measurements and limits". A 2D check of the reviewed design.
import type { PlanPoint } from "@replay-world/contracts";
import { useState } from "react";
import type { LayoutResult } from "../checks/layout";
import { type CheckPair, flagOf, planChecks, type RouteAsk } from "../checks/results";
import type { RouteResult } from "../checks/route";
import { answer } from "../drawing/checks";
import { compareWithDrawing } from "../drawing/compare";
import { scalePhrase } from "../drawing/world";
import { DrawingPlan } from "./DrawingPlan";

/** A result's summary after its outcome words, as a sentence of its own. */
function rest(summary: string): string {
  const text = summary.replace(/^(Cannot determine yet|Fits in the reviewed design|Blocked): /, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const LAYOUT_WORDS: Record<LayoutResult["outcome"], string> = {
  fits: "Fits in the reviewed design",
  conflict: "Conflict found",
  cannot_determine: "Cannot determine yet",
};
const ROUTE_WORDS: Record<RouteResult["outcome"], string> = {
  fits: "Fits in the reviewed design",
  conflict: "Blockage found",
  cannot_determine: "Cannot determine yet",
};

interface Props {
  checks: CheckPair;
  ask: RouteAsk | null;
  onAsk: (ask: RouteAsk) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function LayoutCheck({ checks, ask, onAsk, selectedId, onSelect }: Props) {
  const [shown, setShown] = useState<"now" | "drawn">("now");
  const [picking, setPicking] = useState<"start" | "end" | null>(null);
  const source = checks.now.source;
  const current: RouteAsk = ask && ask.sourceId === source.id ? ask : { sourceId: source.id, start: null, end: null, width: "", allowance: "" };
  const result = shown === "now" ? checks.now : checks.drawn;
  const { layout, route } = result;
  const statuses = new Map(source.drawing.review.objects.map((o) => [o.drawn_id, o.status]));
  const changed = new Set(
    compareWithDrawing(checks.now.project)
      ?.changes.filter((c) => c.status === "changed" && c.what.some((w) => /^(moved|turned|footprint)/.test(w)))
      .map((c) => c.objectId) ?? [],
  );
  const overhead = answer(checks.now.project, "overhead");
  const conflicts = layout.findings.filter((f) => f.state === "conflict");
  const open = layout.findings.filter((f) => f.state !== "conflict");
  const findings = [...conflicts, ...open];

  const pick = (point: PlanPoint) => {
    if (!picking) return;
    const next = { ...current, [picking]: { x: point.x, y: point.y } };
    onAsk(next);
    setPicking(picking === "start" && !next.end ? "end" : null);
  };
  const names = (ids: readonly string[]) => ids.map((id) => result.project.scene.objects.find((o) => o.id === id)).filter((o) => o !== undefined);

  return (
    <div className="source-drawing-body layout-check" data-testid="layout-check">
      <div className={`check-result check-${layout.outcome}`} data-testid="layout-outcome" data-outcome={layout.outcome} role="status">
        <strong>Footprints and keep-clear zones: {LAYOUT_WORDS[layout.outcome]}.</strong> {rest(layout.summary)}
      </div>
      {route && (
        <div className={`check-result check-${route.outcome}`} data-testid="route-outcome" data-outcome={route.outcome} role="status">
          <strong>Route A to B: {ROUTE_WORDS[route.outcome]}.</strong> {rest(route.summary)}
          <span className="check-scope" data-testid="route-scope">
            Width-only route; turning not evaluated.
          </span>
        </div>
      )}

      <table className="check-compare" data-testid="check-before-after">
        <thead>
          <tr>
            <th scope="col">Show on the plan</th>
            {(
              [
                ["drawn", "As drawn"],
                ["now", "Now"],
              ] as const
            ).map(([id, label]) => (
              <th key={id} scope="col">
                <button type="button" className="link-button" aria-pressed={shown === id} data-testid={`check-show-${id}`} onClick={() => setShown(id)}>
                  {label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Footprints and zones</th>
            <td data-testid="check-drawn-layout" data-outcome={checks.drawn.layout.outcome}>
              {LAYOUT_WORDS[checks.drawn.layout.outcome]}
            </td>
            <td data-testid="check-now-layout" data-outcome={checks.now.layout.outcome}>
              {LAYOUT_WORDS[checks.now.layout.outcome]}
            </td>
          </tr>
          {checks.now.route && checks.drawn.route && (
            <tr>
              <th scope="row">Route A to B</th>
              <td data-testid="check-drawn-route" data-outcome={checks.drawn.route.outcome}>
                {ROUTE_WORDS[checks.drawn.route.outcome]}
              </td>
              <td data-testid="check-now-route" data-outcome={checks.now.route.outcome}>
                {ROUTE_WORDS[checks.now.route.outcome]}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="drawing-plan-frame check-plan">
        <DrawingPlan
          drawing={source.drawing}
          statuses={statuses}
          now={shown === "now" ? { project: checks.now.project, source, moved: changed } : { project: checks.drawn.project, source: checks.drawn.source, moved: new Set() }}
          selectedId={selectedId}
          onSelect={onSelect}
          labels="selected"
          testId="check-plan"
          title={shown === "now" ? "The layout now, with what the checks found" : "The layout as drawn, with what the checks found"}
          mode={picking ? "point" : "select"}
          onPoint={pick}
          checks={planChecks(result, current)}
        />
      </div>
      <p className="muted small">
        {picking
          ? `Click the plan where the item ${picking === "start" ? "starts (A)" : "has to get to (B)"}.`
          : shown === "now"
            ? "The layout now. Red: conflict or blockage · amber: not evaluated accurately · click an object to select it."
            : "The drawing's own arrangement, with its results."}
      </p>

      {findings.length > 0 && (
        <ul className="check-findings" data-testid="layout-findings">
          {findings.slice(0, 6).map((f, i) => (
            <li key={i} data-testid="layout-finding" data-state={f.state} className={`finding-${flagOf(f.state)}`}>
              {f.message}
              {f.fix && <span className="muted"> To correct: {f.fix}.</span>}{" "}
              {names(f.objectIds).map((o) => (
                <button key={o.id} type="button" className="link-button" data-testid={`finding-select-${o.id}`} onClick={() => onSelect(o.id)}>
                  Select {o.name}
                </button>
              ))}
            </li>
          ))}
          {findings.length > 6 && <li className="muted">and {findings.length - 6} more (under Measurements and limits)</li>}
        </ul>
      )}

      <fieldset className="route-ask" data-testid="route-ask">
        <legend>Can an item get from A to B?</legend>
        <div className="route-ask-row">
          <button type="button" className="button button-small" aria-pressed={picking === "start"} data-testid="route-pick-start" onClick={() => setPicking(picking === "start" ? null : "start")}>
            {current.start ? "Move A" : "Pick A on the plan"}
          </button>
          <button type="button" className="button button-small" aria-pressed={picking === "end"} data-testid="route-pick-end" onClick={() => setPicking(picking === "end" ? null : "end")}>
            {current.end ? "Move B" : "Pick B on the plan"}
          </button>
        </div>
        <div className="route-ask-row">
          <label>
            Item width{" "}
            <input type="text" inputMode="decimal" size={5} value={current.width} data-testid="route-width" aria-label="Item width in metres" onChange={(e) => onAsk({ ...current, width: e.target.value })} /> m
          </label>
          <label>
            Allowance each side (optional){" "}
            <input type="text" inputMode="decimal" size={5} value={current.allowance} placeholder="0" data-testid="route-allowance" aria-label="Allowance on each side in metres" onChange={(e) => onAsk({ ...current, allowance: e.target.value })} /> m
          </label>
        </div>
        {!route && <p className="muted small">Pick A and B on the plan and enter the width of what has to pass. Nothing is assumed: no cart size, door opening or rule is filled in for you.</p>}
      </fieldset>

      <details className="check-details" data-testid="check-details">
        <summary>Measurements and limits</summary>
        <ul>
          <li>Basis: the reviewed design in {source.filename} ({scalePhrase(source.drawing.review.scale)}). A 2D layout check, not a physical simulation and not the site as built.</li>
          {layout.tested.map((t) => (
            <li key={t}>Checked: {t}.</li>
          ))}
          {layout.closest && (
            <li data-testid="layout-closest">
              Closest pair that does not overlap: {layout.closest.names[0]} and {layout.closest.names[1]}, {layout.closest.gapM.toFixed(3)} m apart.
            </li>
          )}
          {layout.findings.map((f, i) => (
            <li key={`f${i}`}>
              {f.kind === "overlap" ? "Overlap" : f.kind === "zone" ? "Into a keep-clear zone" : f.kind === "floor_edge" ? "Past the floor's edge" : "Keep-clear zone not confirmed"}
              {f.metres > 0 ? `: ${f.metres.toFixed(3)} m` : ""} ({names(f.objectIds).map((o) => o.name).join(", ")}).
            </li>
          ))}
          {layout.blockers.map((b) => (
            <li key={b}>Not confirmed: {b}.</li>
          ))}
          {route && (
            <>
              {route.tested.map((t) => (
                <li key={t}>Route: {t}.</li>
              ))}
              {route.passage && (
                <li data-testid="route-passage">
                  Narrowest passage {route.outcome === "fits" ? "on the route" : "of the best way"}: {route.passage.widthM.toFixed(3)} m
                  {route.passage.between.length ? ` (${route.passage.between.join(" and ")})` : ""}.
                </li>
              )}
              {route.clearanceM !== null && <li>Least distance from the route's centre line to anything it avoids: {route.clearanceM.toFixed(3)} m (the item needs {(route.needM / 2).toFixed(3)} m).</li>}
              {route.uncertainOnRoute.map((u) => (
                <li key={u}>Uncertain on the route: {u}.</li>
              ))}
              <li>{route.scope}</li>
            </>
          )}
          <li data-testid="check-overhead-limit">
            Overhead clearance: {overhead.status === "height_needed" ? `height needed. ${overhead.needs.length} object${overhead.needs.length === 1 ? " has" : "s have"} only a height assumed for display, which is never used for a check.` : "not checked yet."}
          </li>
          <li>Not checked: strength, floor loading, throughput, process chemistry, people or vehicle movement over time.</li>
        </ul>
      </details>
    </div>
  );
}
