// The scene edit log made readable: what each edit changed and the value and evidence it replaced.
import type { Length, Project, Transform } from "@replay-world/contracts";
import type { EditRecord } from "../editing/commands";
import { formatFixed, radToDeg } from "../editing/units";
import { ORIGIN_LABEL, REVIEW_LABEL } from "../format";

const AXIS_LABEL = { width: "Width", height: "Height", depth: "Depth" } as const;

const metres = (v: number) => `${formatFixed(v, 3)} m`;
const point = (t: Transform) => `(${formatFixed(t.position_m.x, 3)}, ${formatFixed(t.position_m.y, 3)}, ${formatFixed(t.position_m.z, 3)}) m`;

function evidence(length: Length): string {
  const parts = [ORIGIN_LABEL[length.origin], REVIEW_LABEL[length.review_status]];
  if (length.uncertainty_m) parts.push(`range ${metres(length.uncertainty_m.lower)} – ${metres(length.uncertainty_m.upper)}`);
  if (length.source_ref) parts.push(length.source_ref);
  return parts.join(" · ");
}

function transformLines(before: Transform, after: Transform): string[] {
  const lines: string[] = [];
  if ((["x", "y", "z"] as const).some((k) => before.position_m[k] !== after.position_m[k])) lines.push(`Position ${point(before)} → ${point(after)}`);
  for (const k of ["x", "y", "z"] as const) {
    if (before.rotation_rad[k] !== after.rotation_rad[k]) {
      lines.push(`Rotation ${k.toUpperCase()} ${formatFixed(radToDeg(before.rotation_rad[k]), 1)}° → ${formatFixed(radToDeg(after.rotation_rad[k]), 1)}°`);
    }
  }
  return lines;
}

/** One-line summary of a record for the scene log. */
function recordTitle(record: EditRecord, project: Project): string {
  const name = (id: string) => project.scene.objects.find((o) => o.id === id)?.name ?? id;
  switch (record.type) {
    case "object_added":
      return record.duplicate_of ? `Copied ${name(record.duplicate_of)} as ${name(record.object_id)}` : `Added ${name(record.object_id)} from ${record.asset_id}`;
    case "object_removed":
      return `Removed ${record.object.name} (${record.object.id})`;
    case "object_edited": {
      const what = [record.transform ? "placement" : null, ...record.dimensions.map((c) => c.axis)].filter(Boolean).join(", ");
      return `Edited ${name(record.object_id)}: ${what}`;
    }
    case "asset_revised": {
      const who = record.objects.length === 1 ? name(record.objects[0]!.object_id) : `${record.objects.length} objects`;
      return `Improved the model of ${who}: ${record.asset_before} → ${record.asset_after}`;
    }
    case "drawing_reviewed":
      return `Review: ${record.correction}`;
    case "appearance_changed":
      return record.summary;
    case "source_attached":
      return record.filename.includes("(reference photo of ") ? `Kept ${record.filename}` : `Kept ${record.filename} with this world (not aligned with the plan)`;
    case "process_set":
      return `Run a day: ${record.summary}`;
  }
}

/** Records about one object, newest first, with before/after values and replaced evidence. */
export function ObjectEditLog({ project, objectId }: { project: Project; objectId: string }) {
  const records = project.scene.edit_log
    .filter((r) =>
      r.type === "asset_revised" || r.type === "drawing_reviewed" || r.type === "appearance_changed" ? r.objects.some((o) => o.object_id === objectId) : r.type !== "object_removed" && r.type !== "source_attached" && r.type !== "process_set" && r.object_id === objectId,
    )
    .reverse();
  if (records.length === 0) return <p className="muted">No edits recorded for this object.</p>;
  return (
    <ol className="edit-log" data-testid="object-edit-log">
      {records.map((record) => (
        <li key={record.revision}>
          <span className="edit-rev">r{record.revision}</span>
          {record.type === "object_added" ? (
            <span>{record.duplicate_of ? `Copied from ${record.duplicate_of}` : `Added from catalog asset ${record.asset_id}`}</span>
          ) : record.type === "object_edited" ? (
            <ul>
              {record.transform && transformLines(record.transform.before, record.transform.after).map((line) => <li key={line}>{line}</li>)}
              {record.dimensions.map((c) => (
                <li key={c.axis}>
                  {AXIS_LABEL[c.axis]} {metres(c.before.value_m)} → {metres(c.after.value_m)}
                  <div className="muted">Was: {evidence(c.before)}</div>
                </li>
              ))}
            </ul>
          ) : record.type === "drawing_reviewed" ? (
            <span>Review: {record.correction}</span>
          ) : record.type === "appearance_changed" ? (
            <span>
              Look (display only): {record.objects.find((o) => o.object_id === objectId)?.asset_before ?? "stand-in"} → {record.objects.find((o) => o.object_id === objectId)?.asset_after ?? "stand-in"}
              {record.objects.find((o) => o.object_id === objectId)?.reason ? ` (${record.objects.find((o) => o.object_id === objectId)!.reason})` : ""}
            </span>
          ) : record.type === "asset_revised" ? (
            <ul>
              <li>
                Model {record.asset_before} → {record.asset_after}
              </li>
              {record.objects
                .find((o) => o.object_id === objectId)
                ?.dimensions.map((c) => (
                  <li key={c.axis}>
                    {AXIS_LABEL[c.axis]} {metres(c.before.value_m)} → {metres(c.after.value_m)}
                    <div className="muted">Was: {evidence(c.before)}</div>
                    <div className="muted">Now: {evidence(c.after)}</div>
                  </li>
                ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** The scene's log, newest first. */
export function SceneEditLog({ project }: { project: Project }) {
  const log = project.scene.edit_log;
  if (log.length === 0) return <p className="muted">No edits recorded. The scene is as loaded.</p>;
  const shown = [...log].reverse().slice(0, 15);
  return (
    <>
      <ol className="edit-log" data-testid="scene-edit-log">
        {shown.map((record) => (
          <li key={record.revision}>
            <span className="edit-rev">r{record.revision}</span> {recordTitle(record, project)}
          </li>
        ))}
      </ol>
      {log.length > shown.length && <p className="muted">…and {log.length - shown.length} earlier edits in the saved log.</p>}
    </>
  );
}
