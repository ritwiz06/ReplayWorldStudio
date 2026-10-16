// Corrections to what the photo review found (IMG-02): split one outline that holds several
// objects ("table with chairs"), merge two outlines of the same object, and say how much of each
// object the photo shows. Every result stays linked to its photo observation, and every change is
// recorded in words; nothing is deleted, so the original observation is kept, marked "split" or
// "merged", and the saved project says what was done and by whom.
import type { ImageBox } from "@replay-world/contracts";
import type { PhotoTemplate } from "../assist/templates";
import { outlineIoU, outlineOverlap } from "./layoutChecks";
import type { ReviewItem, Visibility } from "./world";

export const VISIBILITY_NAME: Record<Visibility, string> = {
  visible: "visible in the photo",
  partly_visible: "partly visible",
  added: "added: not seen in the photo",
};

/** The model's own reading of how much shows, before the user says otherwise. */
export function visibilityFrom(model: "full" | "partly_hidden" | "mostly_hidden"): Visibility {
  return model === "full" ? "visible" : "partly_visible";
}

const TEMPLATE_WORDS: [RegExp, PhotoTemplate][] = [
  [/\bchairs?\b|\bstools?\b|\bseats?\b/, "chair"],
  [/\btables?\b|\bdesks?\b|\bbench(es)?\b/, "table"],
  [/\bsofas?\b|\bcouch(es)?\b/, "sofa"],
  [/\bshel(f|ves)\b|\bracks?\b|\bbookcases?\b/, "shelf"],
  [/\bcabinets?\b|\blockers?\b|\bcupboards?\b/, "cabinet"],
  [/\bscreens?\b|\bmonitors?\b|\btvs?\b|\bwhiteboards?\b/, "screen"],
  [/\bplants?\b/, "plant"],
  [/\bpallets?\b/, "pallet"],
  [/\bconveyors?\b/, "conveyor"],
  [/\btanks?\b/, "tank"],
  [/\bmachines?\b/, "machine"],
];

/** A shape family for a label, when one word names it (else the fallback). */
export function templateFor(label: string, fallback: PhotoTemplate): PhotoTemplate {
  const text = label.toLowerCase();
  return TEMPLATE_WORDS.find(([words]) => words.test(text))?.[1] ?? fallback;
}

function singular(word: string): string {
  if (/ies$/.test(word)) return word.replace(/ies$/, "y");
  if (/(ches|shes|xes|ses)$/.test(word)) return word.replace(/es$/, "");
  return word.replace(/s$/, "");
}

/**
 * Names for the pieces of a group outline. "table with chairs" becomes "table", "chair",
 * "chair"…; "desks and chairs" becomes "desk", "chair"…; anything else "<label> 1", "<label> 2".
 */
export function pieceLabels(label: string, count: number): string[] {
  const words = label.trim().toLowerCase();
  const group = /^(.+?)\s+(?:with|and|&)\s+(?:\d+\s+|some\s+|its\s+|their\s+)?(.+)$/.exec(words);
  if (group) {
    // "rectangular table with chairs" -> "rectangular table", then "chair" for the rest.
    const head = group[1]!.replace(/\S+$/, singular);
    const rest = group[2]!.replace(/\S+$/, singular);
    return Array.from({ length: count }, (_, i) => (i === 0 ? head : rest));
  }
  return Array.from({ length: count }, (_, i) => `${label.trim() || "object"} ${i + 1}`);
}

/** Things that stand on the floor by themselves: named in the plural after "with", a group. */
const SEPARATE = /\b(?:with|and|&)\s+(?:\w+\s+)?(?:chairs|stools|seats|benches|tables|desks|sofas|armchairs|carts|trolleys|pallets)\b/i;

/**
 * Does this outline look like several objects in one? "table with chairs" does; "machine with
 * yellow safety cage" or "desk with computers" names one object and what is on or around it.
 */
export function looksLikeGroup(item: ReviewItem): boolean {
  // (The API's own note also covers "desk with computers", whose outline needs tightening, not
  // splitting: computers on a desk are not placed on the floor.)
  return SEPARATE.test(item.label) || /\b(set|group|row) of\b/i.test(item.label);
}

function nextId(items: readonly ReviewItem[], base: string): string {
  const used = new Set(items.map((i) => i.id));
  for (let n = 1; ; n++) {
    const id = `${base}-${String.fromCharCode(96 + n)}`;
    if (n <= 26 && !used.has(id)) return id;
    if (n > 26 && !used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

/**
 * Split one outline into `count` objects side by side (equal vertical strips of its box, each
 * standing where its strip meets the floor). The user then adjusts each piece's outline and floor
 * point. The original is kept, marked "split", and each piece names it.
 */
export function splitItem(items: readonly ReviewItem[], id: string, count: number): { items: ReviewItem[]; pieces: string[] } {
  const original = items.find((i) => i.id === id);
  if (!original || count < 2 || original.decision === "split" || original.decision === "merged") return { items: [...items], pieces: [] };
  const labels = pieceLabels(original.label, count);
  const { left, right, top, bottom } = original.box;
  const step = (right - left) / count;
  const pieces: ReviewItem[] = [];
  let all: ReviewItem[] = [...items];
  for (let n = 0; n < count; n++) {
    const box: ImageBox = { left: left + n * step, right: left + (n + 1) * step, top, bottom };
    const label = labels[n]!;
    const piece: ReviewItem = {
      ...original,
      id: nextId(all, original.id),
      label,
      template: templateFor(label, original.template),
      box,
      contact: { u: (box.left + box.right) / 2, v: box.bottom },
      contactBasis: "box_bottom",
      decision: "accepted",
      entered: {},
      derivedFrom: original.id,
      replacedBy: null,
      notes: [],
      corrections: [`Split by you from “${original.label}” (${original.id}), which outlined several objects as one.`],
    };
    pieces.push(piece);
    all = [...all, piece];
  }
  const index = items.findIndex((i) => i.id === id);
  const marked: ReviewItem = {
    ...original,
    decision: "split",
    corrections: [...original.corrections, `Split by you into ${pieces.map((p) => `“${p.label}” (${p.id})`).join(", ")}.`],
  };
  return { items: [...items.slice(0, index), marked, ...pieces, ...items.slice(index + 1)], pieces: pieces.map((p) => p.id) };
}

/** Undo a split: the pieces go, and the original outline is used again. */
export function unsplitItem(items: readonly ReviewItem[], id: string): ReviewItem[] {
  const original = items.find((i) => i.id === id);
  if (!original || original.decision !== "split") return [...items];
  return items
    .filter((i) => i.derivedFrom !== id)
    .map((i) => (i.id === id ? { ...i, decision: "accepted" as const, corrections: i.corrections.filter((c) => !c.startsWith("Split by you into")) } : i));
}

/**
 * Two outlines of one object become one: the outline the user keeps stays exactly as it is, and
 * the other is kept, marked "merged" and pointing at it.
 */
export function mergeItems(items: readonly ReviewItem[], keepId: string, dropId: string): ReviewItem[] {
  const keep = items.find((i) => i.id === keepId);
  const drop = items.find((i) => i.id === dropId);
  if (!keep || !drop || keepId === dropId || drop.decision === "split" || drop.decision === "merged") return [...items];
  return items.map((i) =>
    i.id === keepId
      ? { ...i, corrections: [...i.corrections, `Merged by you with “${drop.label}” (${drop.id}): the same object, outlined twice.`] }
      : i.id === dropId
        ? { ...i, decision: "merged" as const, replacedBy: keepId, corrections: [...i.corrections, `Merged by you into “${keep.label}” (${keep.id}).`] }
        : i,
  );
}

/** Undo a merge: the merged outline is used again. */
export function unmergeItem(items: readonly ReviewItem[], dropId: string): ReviewItem[] {
  const drop = items.find((i) => i.id === dropId);
  if (!drop || drop.decision !== "merged" || !drop.replacedBy) return [...items];
  const keepId = drop.replacedBy;
  return items.map((i) => {
    if (i.id === dropId) return { ...i, decision: "accepted" as const, replacedBy: null, corrections: i.corrections.filter((c) => !c.startsWith("Merged by you into")) };
    if (i.id === keepId) return { ...i, corrections: i.corrections.filter((c) => !c.includes(`(${dropId}): the same object`)) };
    return i;
  });
}

const area = (b: ImageBox) => (b.right - b.left) * (b.bottom - b.top);

export interface Suggestion {
  kind: "split" | "merge";
  ids: string[];
  text: string;
}

/** Outlines that probably hold several objects, and pairs that are probably one object twice. */
export function suggestions(items: readonly ReviewItem[]): Suggestion[] {
  const live = items.filter((i) => i.decision === "accepted");
  const out: Suggestion[] = [];
  for (const item of live) {
    if (looksLikeGroup(item)) out.push({ kind: "split", ids: [item.id], text: `“${item.label}” may outline several objects as one: split it.` });
  }
  const word = (label: string) => singular(label.toLowerCase().trim().split(/\s+/).pop() ?? "");
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      // The same kind of thing, outlined in nearly the same place. (A chair inside a "table with
      // chairs" outline is not a duplicate: that outline needs splitting.)
      if (looksLikeGroup(a) || looksLikeGroup(b)) continue;
      if (word(a.label) === word(b.label) && (outlineIoU(a.box, b.box) >= 0.5 || outlineOverlap(a.box, b.box) >= 0.9)) {
        // Keep the tighter outline: the other is usually a rough one (a split piece, a loose box).
        const [keep, drop] = area(a.box) <= area(b.box) + 1e-9 ? [a, b] : [b, a];
        out.push({ kind: "merge", ids: [keep.id, drop.id], text: `“${keep.label}” and “${drop.label}” may be the same object, outlined twice.` });
      }
    }
  }
  return out;
}
