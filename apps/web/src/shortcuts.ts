/** True on macOS, where editor shortcuts use ⌘ instead of Ctrl. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Display text for a modifier shortcut, e.g. "⌘Z", "Ctrl+Shift+Z". */
export function shortcut(key: string, shift = false): string {
  return IS_MAC ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`;
}
