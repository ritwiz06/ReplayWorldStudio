// The part list of a generated model's specification: name, shape, material, size and centre of
// every part, in metres in the object frame. Shared by the object builder and "Improve model".
import type { Extent3, GeometryPart } from "@replay-world/contracts";
import { useState } from "react";
import { newPart } from "../assist/objectDraft";
import { formatFixed, LENGTH_DECIMALS, parseDecimal } from "../editing/units";

const SHAPES: GeometryPart["shape"][] = ["box", "rounded_box", "cylinder", "frustum", "sphere"];
const MATERIALS: GeometryPart["material"][] = [
  "paint_light_grey", "paint_anthracite", "paint_white", "paint_blue", "paint_red", "paint_green", "paint_orange", "safety_yellow",
  "aluminium", "stainless_steel", "steel_dark", "copper", "rubber_black", "plastic_black", "plastic_grey", "polycarbonate",
  "glass_clear", "hmi_screen", "signal_green", "signal_amber", "signal_red", "signal_white", "estop_red", "motor_blue",
  "cardboard", "wood", "pallet_wood", "concrete", "fabric_grey", "label_black",
];

function PartNumber({ value, label, onCommit }: { value: number; label: string; onCommit: (v: number) => void }) {
  const shown = formatFixed(value, LENGTH_DECIMALS);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseDecimal(draft, LENGTH_DECIMALS, "m");
    setDraft(null);
    if (parsed.ok && formatFixed(parsed.value, LENGTH_DECIMALS) !== shown) onCommit(parsed.value);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      className="part-number"
      value={draft ?? shown}
      onFocus={(e) => {
        setDraft(shown);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

/** The builder: every part's shape, material, size and centre, in metres in the object frame.
 * `onParts` receives the whole new list; the caller recomputes the overall size from it. */
export function PartsEditor({ parts, envelope, onParts }: { parts: readonly GeometryPart[]; envelope: Extent3; onParts: (parts: GeometryPart[]) => void }) {
  const update = (index: number, patch: Partial<GeometryPart>) => onParts(parts.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const reshape = (index: number, shape: GeometryPart["shape"]) =>
    update(index, {
      shape,
      axis: shape === "cylinder" ? "y" : null,
      taper: shape === "frustum" ? 0.5 : null,
      narrow_end: shape === "frustum" ? "bottom" : null,
    });
  return (
    <section aria-label="Parts" className="parts-editor" data-testid="parts-editor">
      <h3 className="section-title">
        Parts <span className="count">{parts.length}</span>
      </h3>
      <p className="muted small">Sizes and centres in metres; X is width, Y height (up), Z depth (front is +Z). The overall size follows the parts.</p>
      <div className="parts-table">
        {parts.map((p, i) => (
          <div key={p.id} className="part-row" data-testid={`part-${i}`}>
            <input type="text" aria-label={`Part ${i + 1} name`} value={p.label} maxLength={80} onChange={(e) => update(i, { label: e.target.value || p.id })} />
            <select aria-label={`Part ${i + 1} shape`} value={p.shape} onChange={(e) => reshape(i, e.target.value as GeometryPart["shape"])}>
              {SHAPES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
            <select aria-label={`Part ${i + 1} material`} value={p.material} onChange={(e) => update(i, { material: e.target.value as GeometryPart["material"] })}>
              {MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {m.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            {p.shape === "cylinder" && (
              <select aria-label={`Part ${i + 1} axis`} value={p.axis ?? "y"} onChange={(e) => update(i, { axis: e.target.value as "x" | "y" | "z" })}>
                <option value="x">along X</option>
                <option value="y">upright</option>
                <option value="z">along Z</option>
              </select>
            )}
            <span className="part-xyz">
              size
              {(["x", "y", "z"] as const).map((a) => (
                <PartNumber
                  key={a}
                  value={p.size_m[a]}
                  label={`Part ${i + 1} size ${a}`}
                  onCommit={(v) => v >= 0.002 && update(i, { size_m: { ...p.size_m, [a]: v } })}
                />
              ))}
            </span>
            <span className="part-xyz">
              centre
              {(["x", "y", "z"] as const).map((a) => (
                <PartNumber key={a} value={p.center_m[a]} label={`Part ${i + 1} centre ${a}`} onCommit={(v) => update(i, { center_m: { ...p.center_m, [a]: v } })} />
              ))}
            </span>
            <button
              type="button"
              className="button button-small"
              disabled={parts.length <= 1}
              aria-label={`Remove part ${i + 1}`}
              onClick={() => onParts(parts.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="examples">
        <span className="muted">Add:</span>
        {SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            className="chip-button"
            disabled={parts.length >= 40}
            data-testid={`add-part-${s}`}
            onClick={() => onParts([...parts, newPart(parts, envelope, s)])}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>
    </section>
  );
}
