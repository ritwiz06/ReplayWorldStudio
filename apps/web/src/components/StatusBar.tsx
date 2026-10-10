import type { Project } from "@replay-world/contracts";

export function StatusBar({ project }: { project: Project | null }) {
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
        </>
      ) : (
        <span>No scene loaded</span>
      )}
    </footer>
  );
}
