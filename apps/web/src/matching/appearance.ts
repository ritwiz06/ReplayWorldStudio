// Which catalog model could make imported equipment easier to recognise (UX-05, IMP-02's
// equipment mapping). Deterministic and offline: the object's own words (its name, its station
// name in the process, the drawing's label for it, treated as untrusted descriptive text) are
// compared with the catalog's names, and its recorded footprint with each model's own size.
//
// A suggestion needs name evidence: the two names agree on what the thing is (their head nouns,
// "Kit cabinet" and "Electrical cabinet"). A shared modifier alone ("Pallet rack" and "Pallet with
// cartons") is not evidence, and a name that says nothing about the kind of equipment ("Machine
// B", "Fixtures 5") gets a question, never a suggestion: a matching footprint does not identify a
// machine. Nothing here changes the project; a chosen model is applied by `set_appearance`, which
// changes only which model draws the object.
import type { CatalogAsset, Project, SceneObject } from "@replay-world/contracts";
import { drawingSource } from "../drawing/world";

/** Words that never say what kind of equipment something is. */
const NOT_A_KIND = new Set([
  ...["machine", "machines", "equipment", "station", "unit", "item", "object", "thing", "block"],
  ...["fixture", "fixtures", "layer", "entity", "shape", "outline", "generic", "provisional"],
  ...["new", "old", "small", "large", "big", "main", "spare", "the", "and", "with", "for", "of"],
  ...["title", "mm", "cm", "m", "material", "materials"],
]);

/** Head nouns that name the same kind of thing as a catalog head noun. Written down, not learned. */
const SAME_KIND: Record<string, string> = {
  cupboard: "cabinet",
  locker: "cabinet",
  enclosure: "cabinet",
  belt: "conveyor",
  conveyer: "conveyor",
};
/** "Electrical panel" and "Control panel" are cabinets; a panel of another kind is not. */
const PANEL_WORDS = new Set(["electrical", "electric", "control", "switch", "power", "distribution"]);

/** A model stretched beyond this on a plan axis is not offered; beyond `WARN` it is flagged. */
const MAX_STRETCH = 3;
const WARN_STRETCH = 0.25;
/** A name match fitted with more stretch than this on a plan axis is asked about, not suggested. */
const GOOD_FIT = 2;

/** The largest stretch or squeeze on a plan axis when `asset` is fitted to the object (≥ 1). */
export function planStretch(object: SceneObject, asset: CatalogAsset): number {
  const n = asset.nominal_dimensions;
  const d = object.dimensions;
  return Math.max(...[d.width.value_m / n.width.value_m, d.depth.value_m / n.depth.value_m].map((r) => Math.max(r, 1 / r)));
}

export interface Candidate {
  asset: CatalogAsset;
  /** Why it is offered, in plain words. */
  reason: string;
  /** Fitting the model to the recorded size: stretching, an assumed height. */
  warnings: string[];
  /** The fit in one line, for a list of options. */
  summary: string;
  /** A generic illustration, not a specific manufacturer's machine. */
  generic: boolean;
}

export type Match =
  /** The names agree on what it is: one model is suggested, others can be chosen. */
  | { kind: "suggested"; object: SceneObject; label: string; best: Candidate; others: Candidate[] }
  /** The name does not say what it is: the person chooses a model, or keeps the current look. */
  | { kind: "ask"; object: SceneObject; label: string; question: string; options: Candidate[] }
  /** It is named, but no catalog model is that kind of thing. */
  | { kind: "none"; object: SceneObject; label: string; options: Candidate[] };

const words = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];
const stem = (w: string) => w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")).slice(0, 7);

/** The words that say what something is, its head noun last. */
function kindWords(text: string): string[] {
  return words(text).filter((w) => w.length > 2 && !NOT_A_KIND.has(w));
}

function headOf(text: string): string | null {
  const all = kindWords(text);
  const head = all.at(-1);
  if (!head) return null;
  if (head === "panel") return all.some((w) => PANEL_WORDS.has(w)) ? "cabinet" : "panel";
  return SAME_KIND[head] ?? head;
}

/** A catalog name's head noun: the noun before a comma or "with" ("Electrical cabinet, 800 mm"). */
function assetHead(asset: CatalogAsset): string | null {
  return headOf(asset.name.split(/,|\(| with /i)[0] ?? asset.name);
}

/** Every name the object goes by: its own, its station's, and the drawing's label for it. */
export function namesOf(project: Project, object: SceneObject): string[] {
  const names = [object.name];
  const station = project.process?.stations.find((s) => s.object_id === object.id);
  if (station && station.name.trim().toLowerCase() !== object.name.toLowerCase()) names.unshift(station.name);
  const drawn = drawingSource(project)?.drawing.objects.find((d) => d.object_id === object.id);
  if (drawn && drawn.label !== object.name) names.push(drawn.label);
  return names;
}

/** How a station or object is called in these cards: "Workbench (Fixtures 5)". */
export function labelOf(project: Project, object: SceneObject): string {
  const station = project.process?.stations.find((s) => s.object_id === object.id)?.name;
  return station && !station.toLowerCase().includes(object.name.toLowerCase()) ? `${station} (${object.name})` : object.name;
}

const percent = (r: number) => `${Math.round(r * 100)} %`;

/** What fitting `asset` to the object's recorded size does to it, or null if it cannot fit. */
export function fitOf(object: SceneObject, asset: CatalogAsset): string[] | null {
  const n = asset.nominal_dimensions;
  const d = object.dimensions;
  const ratio = { width: d.width.value_m / n.width.value_m, depth: d.depth.value_m / n.depth.value_m, height: d.height.value_m / n.height.value_m };
  if ([ratio.width, ratio.depth].some((r) => r > MAX_STRETCH || r < 1 / MAX_STRETCH)) return null;
  const warnings: string[] = [];
  for (const axis of ["width", "depth", "height"] as const) {
    const r = ratio[axis];
    if (Math.abs(r - 1) <= WARN_STRETCH) continue;
    warnings.push(r > 1 ? `Stretched to ${percent(r)} of its ${axis} to fit the recorded size.` : `Squeezed to ${percent(r)} of its ${axis} to fit the recorded size.`);
  }
  // Turned a quarter, the model would fit much better: say so (it is drawn as recorded).
  const turned = Math.max(Math.abs(d.width.value_m / n.depth.value_m - 1), Math.abs(d.depth.value_m / n.width.value_m - 1));
  const straight = Math.max(Math.abs(ratio.width - 1), Math.abs(ratio.depth - 1));
  if (turned + 0.15 < straight) warnings.push("Its proportions suit the footprint turned a quarter; it is drawn along the recorded width and depth.");
  if (d.height.origin === "default") warnings.push(`The height is assumed (${d.height.value_m.toFixed(2)} m, display only): the model is drawn at that height.`);
  return warnings;
}

/** Catalog models that can give equipment a recognisable look: glTF models (shipped or
 * generated). A plain placeholder box would look no different from the stand-in. */
export function lookModels(project: Project, library: readonly CatalogAsset[]): CatalogAsset[] {
  const seen = new Set<string>();
  return [...project.catalog, ...library].filter((a) => a.kind === "equipment" && a.visual.type === "gltf" && !seen.has(a.id) && seen.add(a.id));
}

const isGeneric = (asset: CatalogAsset) => asset.source.kind !== "vendor" && asset.source.kind !== "third_party";

/** "Drawn at 75 % width, 53 % depth, 65 % height of the model; height assumed." */
export function fitSummary(object: SceneObject, asset: CatalogAsset): string {
  const n = asset.nominal_dimensions;
  const d = object.dimensions;
  const axes = (["width", "depth", "height"] as const).map((a) => [a, d[a].value_m / n[a].value_m] as const).filter(([, r]) => Math.abs(r - 1) > WARN_STRETCH);
  const fit = axes.length ? `Drawn at ${axes.map(([a, r]) => `${percent(r)} ${a}`).join(", ")} of the model` : "Fits without stretching";
  return `${fit}${d.height.origin === "default" ? "; height assumed" : ""}.`;
}

function candidate(object: SceneObject, asset: CatalogAsset, reason: string): Candidate | null {
  const warnings = fitOf(object, asset);
  return warnings ? { asset, reason, warnings, summary: fitSummary(object, asset), generic: isGeneric(asset) } : null;
}

/** Imported equipment whose look could be improved: equipment of the drawn world that has no
 * model yet, or a placeholder box. */
export function equipmentToImprove(project: Project): SceneObject[] {
  const source = drawingSource(project);
  if (!source) return [];
  const drawn = new Set(source.drawing.objects.map((d) => d.object_id));
  const assets = new Map(project.catalog.map((a) => [a.id, a]));
  return project.scene.objects.filter((o) => o.kind === "equipment" && drawn.has(o.id) && (o.asset_id === null || assets.get(o.asset_id)?.visual.type !== "gltf"));
}

/** One match per object: suggested, a question, or no model of that kind. */
export function matchEquipment(project: Project, objects: readonly SceneObject[], library: readonly CatalogAsset[]): Match[] {
  const models = lookModels(project, library);
  return objects.map((object): Match => {
    const label = labelOf(project, object);
    const names = namesOf(project, object);
    const heads = [...new Set(names.map(headOf).filter((h): h is string => h !== null))];
    const fitting = (reason: (a: CatalogAsset) => string) => models.map((a) => candidate(object, a, reason(a))).filter((c): c is Candidate => c !== null);
    if (!heads.length) {
      return {
        kind: "ask",
        object,
        label,
        question: `“${label}” does not say what kind of equipment it is, and a footprint alone does not identify it. Choose a model, or keep its current look.`,
        options: fitting(() => "Chosen by you: the name gives no evidence."),
      };
    }
    const named = models.filter((a) => {
      const h = assetHead(a);
      return h !== null && heads.some((x) => stem(x) === stem(h));
    });
    const suggested = named.map((a) => candidate(object, a, `Both are a ${assetHead(a)}: “${names.find((n) => headOf(n) && stem(headOf(n)!) === stem(assetHead(a)!)) ?? label}” and “${a.name}”.`)).filter((c): c is Candidate => c !== null);
    const rest = fitting((a) => {
      const shared = kindWords(a.name).filter((w) => names.some((n) => kindWords(n).some((x) => stem(x) === stem(w))));
      return shared.length ? `Shares the word “${shared[0]}”, but is a different kind of thing.` : "Chosen by you: a different kind of thing.";
    }).filter((c) => !suggested.some((s) => s.asset.id === c.asset.id));
    const good = suggested.filter((c) => planStretch(object, c.asset) <= GOOD_FIT);
    if (good.length) return { kind: "suggested", object, label, best: good[0]!, others: [...suggested.filter((c) => !good.includes(c)), ...good.slice(1), ...rest] };
    if (suggested.length) {
      // The right kind of thing, but it would have to be distorted to fit: the person decides.
      const poor = suggested[0]!;
      return {
        kind: "ask",
        object,
        label,
        question: `“${label}” and “${poor.asset.name}” are both a ${assetHead(poor.asset)}, but the model would be stretched to ${Math.round(planStretch(object, poor.asset) * 100)} % to fit the recorded footprint. Use it anyway, choose another, or keep its current look.`,
        options: [...suggested, ...rest],
      };
    }
    return { kind: "none", object, label, options: rest };
  });
}

/** The words of a description for the object generator, from what is recorded about it. */
export function describeFor(project: Project, object: SceneObject): { text: string; name: string; size: { width: number; depth: number; height: number } } {
  const d = object.dimensions;
  const name = (namesOf(project, object).find((n) => headOf(n) !== null) ?? object.name).replace(/\s*\(.*\)$/, "");
  return {
    text: `${name.toLowerCase()} ${d.width.value_m.toFixed(2)} m wide and ${d.depth.value_m.toFixed(2)} m deep`,
    name,
    size: { width: d.width.value_m, depth: d.depth.value_m, height: d.height.value_m },
  };
}
