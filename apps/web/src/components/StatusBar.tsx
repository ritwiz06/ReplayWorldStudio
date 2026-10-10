import type { Project } from "@replay-world/contracts";
import type { ModelSummary } from "../hooks/useCatalogModels";
import type { CameraMode } from "../scene/CameraRig";

interface Props {
  project: Project | null;
  mode: CameraMode;
  models: ModelSummary;
}

const MODE_LABEL: Record<CameraMode, string> = { orbit: "Orbit view", top: "Top view (plan)", walk: "Walk view" };

export function StatusBar({ project, mode, models }: Props) {
  return (
    <footer className="statusbar" data-testid="status-bar">
      {project ? (
        <>
          <span>
            Units {project.units.length} · {project.units.time} · {project.units.mass} ·{" "}
            {project.units.angle}
          </span>
          <span>
            {project.world_frame.handedness}-handed · {project.world_frame.up_axis} up · floor{" "}
            {project.world_frame.floor_plane}
          </span>
          <span>Schema {project.schema_version}</span>
          <span>Scene revision {project.scene.revision}</span>
          <span data-testid="camera-mode-status">{MODE_LABEL[mode]}</span>
          {models.total > 0 && (
            <span data-testid="model-status" className={models.failed > 0 ? "status-warn" : undefined}>
              Models {models.ready}/{models.total} verified
              {models.loading > 0 ? ` · ${models.loading} loading` : ""}
              {models.failed > 0 ? ` · ${models.failed} unavailable` : ""}
            </span>
          )}
        </>
      ) : (
        <span>No scene loaded</span>
      )}
    </footer>
  );
}
