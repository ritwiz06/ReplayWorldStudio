// Saving a project: the complete document as JSON, exactly as the editor holds it.
import type { Project } from "@replay-world/contracts";

/** Pretty-printed JSON. Every number keeps its shortest round-trip form, so parsing the text
 * gives back the same doubles (the editor never stores -0, which JSON cannot distinguish). */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

/** `proj-industrial-demo-r12.json`: the project ID and the scene revision saved. */
export function projectFileName(project: Project): string {
  return `${project.id}-r${project.scene.revision}.json`;
}

/** File name for an upgraded copy of `filename`, e.g. `plan.json` → `plan-0.4.0.json`. */
export function upgradedFileName(filename: string, version: string): string {
  const stem = filename.replace(/\.json$/i, "");
  return `${stem}-${version}.json`;
}

/** Offer `text` as a download. The browser decides where it is stored. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
