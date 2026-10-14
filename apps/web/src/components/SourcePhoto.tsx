// The source photo of a world built from a photo, beside the 3D view for comparison: each
// object's outline where it was seen, linked both ways to the scene (click an outline to select
// the object; the selected object's outline is highlighted). A photo missing from this
// computer's source library is reported, never replaced; the original can be attached.
import type { Project, SourceDocument } from "@replay-world/contracts";
import { useState } from "react";
import type { ApiClient } from "../api/client";
import { photoCameraView } from "../photo/cameraView";
import type { FixedView } from "../scene/CameraRig";

interface Props {
  client: ApiClient;
  project: Project;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onView: (view: FixedView) => void;
  /** Source files the API reported missing when the project was opened (opened without them). */
  missingFiles: readonly string[];
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

export function SourcePhoto({ client, project, selectedId, onSelect, onView, missingFiles }: Props) {
  const source = project.sources.find((s): s is SourceDocument & { image: NonNullable<SourceDocument["image"]> } => s.kind === "photo" && s.image !== null);
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<{ uri: string; status: "loading" | "ready" | "missing"; nonce: number }>({ uri: "", status: "loading", nonce: 0 });
  const [attach, setAttach] = useState<string | null>(null);
  if (!source) return null;
  const image = source.image;
  // A photo the API reported missing is shown as missing, whatever the browser may have cached.
  const current = state.uri === image.uri ? state : { uri: image.uri, status: missingFiles.includes(image.uri) ? ("missing" as const) : ("loading" as const), nonce: state.nonce };
  const observations = source.photo_import?.observations.filter((o) => o.decision === "accepted" && o.object_id) ?? [];
  const live = new Set(project.scene.objects.map((o) => o.id));
  const view = source.photo_import ? photoCameraView(source.photo_import.calibration) : null;

  async function reattach(file: File) {
    setAttach("Checking…");
    const stored = await client.uploadPhoto(file, source!.filename ?? file.name, source!.sha256 ?? undefined);
    if (!stored.ok) {
      setAttach(stored.error.kind === "http" && stored.error.status === 409 ? `${file.name} is not the original photo (different sha256); it was not used.` : stored.error.message);
      return;
    }
    setAttach(null);
    setState({ uri: image.uri, status: "loading", nonce: current.nonce + 1 });
  }

  return (
    <div className={`source-photo${open ? " open" : ""}`} data-testid="source-photo">
      <button type="button" className="source-photo-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide photo" : `Photo: ${source.filename}`}
      </button>
      {open && (
        <>
          {current.status !== "missing" ? (
            <div className="photo-frame" style={{ aspectRatio: `${image.width_px} / ${image.height_px}` }}>
              <img
                key={current.nonce}
                src={`${client.sourceFileUrl(image.uri)}${current.nonce ? `?v=${current.nonce}` : ""}`}
                alt={`Source photo ${source.filename}`}
                data-testid="source-photo-image"
                data-state={current.status}
                onLoad={() => setState({ ...current, status: "ready" })}
                onError={() => setState({ ...current, status: "missing" })}
              />
              {observations.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`photo-box accepted${o.object_id === selectedId ? " selected" : ""}${live.has(o.object_id!) ? "" : " removed"}`}
                  title={live.has(o.object_id!) ? `${o.label}: select it in the scene` : `${o.label}: removed from the scene since the import`}
                  disabled={!live.has(o.object_id!)}
                  style={{ left: pct(o.box.left), top: pct(o.box.top), width: pct(o.box.right - o.box.left), height: pct(o.box.bottom - o.box.top) }}
                  onClick={() => onSelect(o.object_id!)}
                />
              ))}
            </div>
          ) : (
            <div className="source-photo-missing" role="alert" data-testid="source-photo-missing">
              <p>
                The photo <strong>{source.filename}</strong> is not in this computer&apos;s source library. Nothing else is shown in its place.
              </p>
              <label className="button button-small">
                Attach the original photo…
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void reattach(file);
                  }}
                />
              </label>
              {attach && <p className="small">{attach}</p>}
            </div>
          )}
          <p className="source-photo-caption">
            {source.filename} · outlines where each object was seen · placements are approximate
          </p>
          {view && (
            <button type="button" className="button button-small" data-testid="source-photo-view" title="Look at the 3D scene from where the photo was taken, with the same lens" onClick={() => onView(view)}>
              View from the photo&apos;s camera
            </button>
          )}
        </>
      )}
    </div>
  );
}
