import type { CameraMode } from "./CameraRig";

export const MODES: readonly { id: CameraMode; label: string; key: string; help: string }[] = [
  { id: "orbit", label: "Orbit", key: "1", help: "Inspect the whole area: drag to orbit, scroll to zoom, right-drag to pan" },
  { id: "top", label: "Top", key: "2", help: "Plan view to scale: drag to pan, scroll to zoom" },
  { id: "walk", label: "Walk", key: "3", help: "Walk at eye height: W A S D to move, drag to look" },
];

/** True when a key event belongs to a text field rather than to the viewport. */
export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}
