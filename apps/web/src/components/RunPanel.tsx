// "Run a day" beside the 3D view (SIM-03/04): what the run assumes, what is happening at the
// moment shown, the whole shift's results (already computed: playback only shows them unfold),
// the comparison with the original layout, and the run's identity. Layout checks answer whether
// things fit; Walk changes where you look; Run advances the entered process through time.
import type { OperatingValue, ProcessModel, Project } from "@replay-world/contracts";
import { useMemo } from "react";
import type { Playback } from "../hooks/usePlayback";
import { type DayComparison, type DayRun, plural } from "../run/day";
import type { WorkerState } from "../run/engine";
import { clockText } from "../run/replay";
import { SCOPE, STATE_COLOUR, STATE_WORDS } from "../run/words";

interface Props {
  project: Project;
  day: DayRun | null;
  playback: Playback;
  /** The layout changed since this run was made. */
  stale: boolean;
  /** The layout differs from the drawing's own arrangement. */
  edited: boolean;
  comparison: { original: DayRun; result: DayComparison } | null;
  onRun: () => void;
  onCompare: () => void;
  onSetUp: () => void;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
const WORKER_WORDS: Record<WorkerState, string> = { working: "working at a station", carrying: "carrying", walking: "walking", idle: "waiting for work", break: "on a break" };
function seconds(v: number): string {
  if (v >= 3600 && v % 60 === 0) return `${Math.floor(v / 3600)} h${v % 3600 ? ` ${(v % 3600) / 60} min` : ""}`;
  if (v >= 60 && v % 60 === 0) return `${v / 60} min`;
  return `${v} s`;
}

function Basis({ value }: { value: OperatingValue | null }) {
  if (!value) return null;
  return <span className={`basis basis-${value.basis}`}>{value.basis === "example" ? "example" : "entered"}</span>;
}

export function RunPanel({ project, day, playback, stale, edited, comparison, onRun, onCompare, onSetUp }: Props) {
  const process = project.process;
  const frame = useMemo(() => (day?.replay && !stale ? day.replay.frame(playback.t) : null), [day, playback.t, stale]);
  if (!process) {
    return (
      <div className="source-drawing-body run-panel" data-testid="run-panel">
        <p>
          <strong>Run a day</strong> advances a production process through a shift on this layout: workers going to their tasks, items moving between stations, machines
          working or waiting, queues forming.
        </p>
        <p className="small muted">This layout has no process yet. Its operating facts (which stations, in what order, how long each step takes, who does what, the shift and its breaks) are never read from the drawing: you enter them.</p>
        <button type="button" className="button button-primary" data-testid="run-setup" onClick={onSetUp}>
          Set up a day…
        </button>
        <p className="small muted">{SCOPE}</p>
      </div>
    );
  }
  const item = process.item_name;
  const result = day?.result ?? null;
  const metrics = result?.metrics ?? null;
  return (
    <div className="source-drawing-body run-panel" data-testid="run-panel" data-outcome={day?.plan.outcome ?? "none"} data-fingerprint={result?.fingerprint ?? ""}>
      <div className="run-head">
        <strong data-testid="run-name">{process.name}</strong>
        {process.example_note && <span className="badge badge-example">Example shift · assumptions</span>}
      </div>
      {process.example_note && (
        <p className="small muted" data-testid="run-example-note">
          {process.example_note}
        </p>
      )}
      {!day && (
        <button type="button" className="button button-primary" data-testid="run-start" onClick={onRun}>
          Run a day
        </button>
      )}
      {day && stale && (
        <div className="run-stale" data-testid="run-stale">
          <p>The layout changed since this run (it used revision {day.sceneRevision}). Run the same shift again on the layout as it is now.</p>
          <button type="button" className="button button-primary" data-testid="run-again" onClick={onRun}>
            Run again
          </button>
        </div>
      )}
      {day && day.plan.outcome !== "ready" && (
        <div className={`run-problem run-${day.plan.outcome}`} data-testid="run-problem">
          <strong>{day.plan.outcome === "blocked" ? "Some moves are blocked on this layout" : day.plan.outcome === "needs_input" ? "Something the run needs is missing" : "The run cannot be determined yet"}</strong>
          <ul>
            {day.plan.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {day.plan.outcome === "blocked" && <p className="small">The run below goes ahead without those moves: nothing is carried or walked through equipment.</p>}
        </div>
      )}
      {frame && metrics && (
        <>
          <div className="run-now" data-testid="run-now">
            <p>
              <strong data-testid="run-clock">{frame.clock}</strong> · {frame.completed} {plural(item)} completed so far · {frame.created - frame.completed} in progress
            </p>
            <ul className="run-states">
              {frame.stations
                .filter((s) => !s.supply)
                .map((s) => (
                  <li key={s.id} data-testid={`run-now-${s.id}`} data-state={s.state}>
                    <span className="state-dot" style={{ background: STATE_COLOUR[s.state] }} /> <strong>{s.name}</strong> {STATE_WORDS[s.state]} · queue {s.input}/{s.inCap}
                  </li>
                ))}
              {frame.workers.map((w) => (
                <li key={w.id} data-testid={`run-now-${w.id}`} data-activity={w.activity}>
                  <strong>{w.name}</strong> {w.doing}
                </li>
              ))}
            </ul>
          </div>
          <h4>The whole shift</h4>
          <p className="run-total" data-testid="run-total">
            <strong data-testid="run-completed">{metrics.completed}</strong> {plural(item)} completed; <span data-testid="run-unfinished">{metrics.unfinished}</span> unfinished at the end
            {metrics.unfinished > 0 &&
              ` (${[
                metrics.unfinishedAt.inputs && `${metrics.unfinishedAt.inputs} queued`,
                metrics.unfinishedAt.inStations && `${metrics.unfinishedAt.inStations} in stations`,
                metrics.unfinishedAt.outputs && `${metrics.unfinishedAt.outputs} waiting to be carried`,
                metrics.unfinishedAt.carried && `${metrics.unfinishedAt.carried} being carried`,
              ]
                .filter(Boolean)
                .join(", ")})`}
            .{metrics.busiest && ` ${metrics.busiest} is the busiest station and sets the pace.`}
          </p>
          <div className="table-scroll">
            <table className="run-table" data-testid="run-stations">
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Busy</th>
                  <th>Waiting</th>
                  <th>Blocked</th>
                  <th>Stopped</th>
                  <th>Longest queue</th>
                </tr>
              </thead>
              <tbody>
                {metrics.stations.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{pct(s.share.loading + s.share.running)}</td>
                    <td>{pct(s.share.waiting)}</td>
                    <td>{pct(s.share.blocked)}</td>
                    <td>{pct(s.share.down)}</td>
                    <td>
                      {s.inputMax}/{process.stations.find((p) => p.id === s.id)?.input_capacity?.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="run-table" data-testid="run-workers">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Working</th>
                  <th>Carrying</th>
                  <th>Walking</th>
                  <th>Waiting</th>
                  <th>Break</th>
                </tr>
              </thead>
              <tbody>
                {metrics.workers.map((w) => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    {(["working", "carrying", "walking", "idle", "break"] as const).map((k) => (
                      <td key={k} title={WORKER_WORDS[k]}>
                        {pct(w.share[k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {day && !stale && result && (
        <div className="run-compare" data-testid="run-compare">
          <h4>Compare with the original layout</h4>
          {!edited && <p className="small muted">The layout is as drawn. Move something (for example Machine B), run again, and compare the two runs here.</p>}
          {edited && !comparison && (
            <button type="button" className="button" data-testid="run-compare-button" onClick={onCompare}>
              Compare with the original layout
            </button>
          )}
          {edited && comparison && <Comparison comparison={comparison.result} />}
        </div>
      )}
      <Assumptions process={process} />
      {day && result && (
        <p className="small muted run-record" data-testid="run-record">
          Run record: engine {day.engine} · seed {day.seed} · layout revision {day.sceneRevision} · {result.events.length} events · fingerprint {result.fingerprint}. Running it again on the same
          layout gives the same events; playback speed and the camera never change them.
        </p>
      )}
      <p className="small muted" data-testid="run-scope">
        {SCOPE}
      </p>
    </div>
  );
}

function Comparison({ comparison }: { comparison: DayComparison }) {
  return (
    <div data-testid="run-comparison" data-identical={comparison.identical ? "true" : "false"}>
      <ul className="run-explanation" data-testid="run-explanation">
        {comparison.explanation.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {comparison.rows.length > 0 && (
        <div className="table-scroll">
          <table className="run-table" data-testid="run-compare-table">
            <thead>
              <tr>
                <th />
                <th>Original layout</th>
                <th>This layout</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((r) => (
                <tr key={r.label} className={r.worse === true ? "worse" : r.worse === false ? "better" : ""}>
                  <td>{r.label}</td>
                  <td>{r.before}</td>
                  <td>{r.after}</td>
                  <td>{r.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Both runs use the same process, seed and engine; only the layout differs.</p>
    </div>
  );
}

function Assumptions({ process }: { process: ProcessModel }) {
  const stations = new Map(process.stations.map((s) => [s.id, s.name]));
  const task = (t: string) => {
    const [kind, id] = t.split(":") as [string, string];
    if (kind === "station") return `work at ${stations.get(id)}`;
    const tr = process.transfers.find((x) => x.id === id);
    return tr ? `carry ${stations.get(tr.from_station)} → ${stations.get(tr.to_station)}` : t;
  };
  const sh = process.shift;
  return (
    <details className="run-assumptions" data-testid="run-assumptions">
      <summary>What this run assumes</summary>
      <ul className="small">
        <li>
          Shift {clockText(sh.start_clock_s.value, 0)}–{clockText(sh.start_clock_s.value, sh.duration_s.value * 1000)} ({seconds(sh.duration_s.value)}) <Basis value={sh.duration_s} />
          {sh.breaks.map((b) => (
            <span key={b.id}>
              {" "}
              · {b.name} {clockText(sh.start_clock_s.value, b.start_s.value * 1000)} for {seconds(b.duration_s.value)}
            </span>
          ))}
        </li>
        {process.stations.map((s) =>
          s.role === "supply" ? (
            <li key={s.id}>
              {s.name}: material is always available here (an assumption) <span className={`basis basis-${s.access_basis}`}>{s.access_basis}</span>
            </li>
          ) : (
            <li key={s.id}>
              {s.name}: {seconds(s.worker_s!.value)} with a worker, then {seconds(s.machine_s!.value)} on its own; queue {s.input_capacity!.value}, output {s.output_capacity!.value}
              {s.planned_stops.map((p) => ` · ${p.reason} at ${clockText(sh.start_clock_s.value, p.start_s.value * 1000)} for ${seconds(p.duration_s.value)}`)}
              {s.random_stops && ` · unplanned stops about every ${seconds(s.random_stops.mean_between_s.value)}, about ${seconds(s.random_stops.mean_duration_s.value)} long`} <Basis value={s.worker_s} />
            </li>
          ),
        )}
        {process.transfers.map((t) => (
          <li key={t.id}>
            {stations.get(t.from_station)} → {stations.get(t.to_station)}: carried by hand at {t.speed_m_s.value} m/s, {t.handling_s.value} s to pick up and to set down, needing a clear{" "}
            {(t.item_width_m.value + 2 * t.allowance_m.value).toFixed(2)} m path (checked on the layout) <Basis value={t.speed_m_s} />
          </li>
        ))}
        {process.workers.map((w) => (
          <li key={w.id}>
            {w.name}: {w.tasks.map(task).join(", then ")} (in that order of priority); walks at {w.walk_speed_m_s.value} m/s through {w.width_m.value} m <Basis value={w.walk_speed_m_s} />
          </li>
        ))}
        <li>Seed {process.seed} (used only for unplanned stops, if any are entered).</li>
      </ul>
    </details>
  );
}
