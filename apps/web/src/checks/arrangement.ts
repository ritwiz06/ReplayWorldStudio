// The arrangement as drawn (for the before/after comparison of the checks): every object the
// review kept, at the drawing's place and size at the current scale, with the review's names and
// kinds; objects added since the import are left out and objects removed since are back.
import type { Project, SceneObject } from "@replay-world/contracts";
import { drawingSource, drawnObject, floorAround, floorOnOutline, statusOf } from "../drawing/world";

export function asDrawn(project: Project): Project | null {
  const source = drawingSource(project);
  if (!source) return null;
  const review = source.drawing.review;
  const t = source.source_to_world;
  const live = new Map(project.scene.objects.map((o) => [o.id, o]));
  const objects: SceneObject[] = [];
  for (const drawn of source.drawing.objects) {
    const status = statusOf(source, drawn.id);
    if (status === "used_as_floor" || status === "not_an_object") continue;
    const now = live.get(drawn.object_id);
    objects.push(drawnObject(source.filename, t, review.scale, drawn, { id: drawn.object_id, kind: now?.kind ?? drawn.kind, name: now?.name ?? drawn.label }));
  }
  const floorId = review.floor.object_id;
  const outline = review.floor.drawn_id ? source.drawing.objects.find((d) => d.id === review.floor.drawn_id) : null;
  if (floorId) objects.unshift(outline ? floorOnOutline(source.filename, t, review.scale, outline, floorId) : floorAround(objects, floorId));
  return { ...project, scene: { ...project.scene, objects, edit_log: [] } };
}
