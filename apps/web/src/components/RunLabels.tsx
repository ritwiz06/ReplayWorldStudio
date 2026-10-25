// The labels of "Run a day" over the 3D view: each station's name, state and queue, and each
// worker's name. Ordinary page elements, positioned on every frame by the projector inside the
// 3D view (RunLabelProjector), so they follow the run and the camera. Each carries a priority
// (UX-04): the selected station first, then blocked or stopped stations, then those waiting for
// a worker, working, idle, and workers last. The projector hides a label that would overlap one
// of higher priority, so labels never pile up; the rest show on selection or as space allows.
import type { RefObject } from "react";
import type { Frame } from "../run/replay";
import { STATE_SHORT } from "../run/words";

const PRIORITY: Record<string, number> = { blocked: 1, down: 1, waiting: 2, loading: 3, running: 3, idle: 4, supply: 4 };

export function RunLabels({ frame, layer, selectedId = null }: { frame: Frame; layer: RefObject<HTMLDivElement | null>; selectedId?: string | null }) {
  return (
    <div className="run-labels" ref={layer} aria-hidden="true">
      {frame.stations.map((s) => (
        <div
          key={s.id}
          data-anchor={`s:${s.id}`}
          className={`scene-label run-station-label run-state-${s.supply ? "supply" : s.state}`}
          data-testid={`run-station-${s.id}`}
          data-state={s.supply ? "supply" : s.state}
          data-priority={s.objectId === selectedId ? 0 : PRIORITY[s.supply ? "supply" : s.state]}
        >
          <strong>{s.name.replace(/ \(.*\)$/, "")}</strong>
          <span>
            {s.supply ? "material" : STATE_SHORT[s.state]}
            {s.remainingS !== null && ` ${Math.floor(s.remainingS / 60)}:${String(s.remainingS % 60).padStart(2, "0")}`}
            {!s.supply && ` · queue ${s.input}/${s.inCap}`}
            {!s.supply && s.output > 0 ? ` · ready ${s.output}` : ""}
          </span>
        </div>
      ))}
      {frame.workers.map((w) => (
        <div
          key={w.id}
          data-anchor={`w:${w.id}`}
          className={`scene-label run-worker-label run-worker-${w.activity}`}
          data-testid={`run-worker-${w.id}`}
          data-activity={w.activity}
          data-carrying={w.carrying ? "true" : "false"}
          data-priority={5}
        >
          {w.name.replace(/ \(.*\)$/, "")}
          {w.activity === "break" ? " · break" : ""}
        </div>
      ))}
    </div>
  );
}
