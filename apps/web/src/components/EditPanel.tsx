// Numeric editing for the selected object: position and size in metres, rotation in degrees.
// Every field commits through the same command path as the handles; a rejected value shows why
// and leaves the scene unchanged.
import type { CatalogAsset, SceneObject, Transform } from "@replay-world/contracts";
import { type ReactNode, useId, useState } from "react";
import type { Axis } from "../editing/commands";
import { ANGLE_DECIMALS, degToRad, formatFixed, LENGTH_DECIMALS, parseDecimal, radToDeg } from "../editing/units";
import type { EditTool } from "../scene/drag";
import { fitDistortion, isStretched } from "../scene/fit";
import { shortcut } from "../shortcuts";

interface FieldProps {
  label: string;
  name: string;
  testId: string;
  value: number;
  decimals: number;
  unit: string;
  disabled: boolean;
  /** Why the last value typed here was not applied, if it was not. */
  error: string | null;
  errorId: string;
  setError: (testId: string, error: string | null) => void;
  /** Returns why the value was not applied, or null when it was. */
  onCommit: (value: number) => string | null;
}

function NumberField({ label, name, testId, value, decimals, unit, disabled, error, errorId, setError: report, onCommit }: FieldProps) {
  const shown = formatFixed(value, decimals);
  const [draft, setDraft] = useState<string | null>(null);
  const setError = (message: string | null) => report(testId, message);

  const commit = () => {
    if (draft === null) return;
    const text = draft;
    setDraft(null);
    if (text.trim() === shown) return setError(null);
    const parsed = parseDecimal(text, decimals, unit);
    if (!parsed.ok) return setError(parsed.message);
    // Equal at the field's resolution: not an edit (an untouched 90.0° stays exactly as stored).
    if (formatFixed(parsed.value, decimals) === shown) return setError(null);
    setError(onCommit(parsed.value));
  };

  return (
    <label className="num-field">
      <span className="num-label">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        spellCheck={false}
        value={draft ?? shown}
        disabled={disabled}
        aria-label={name}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        data-testid={testId}
        onFocus={(e) => {
          setDraft(shown);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.select();
          } else if (e.key === "Escape") {
            setDraft(null);
            setError(null);
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

/** Three fields in a row, with the reason any of them was not applied shown underneath. */
interface GroupProps {
  legend: string;
  ids: string[];
  errors: Readonly<Record<string, string>>;
  errorBase: string;
  children: ReactNode;
}

function FieldGroup({ legend, ids, errors, errorBase, children }: GroupProps) {
  return (
    <fieldset className="num-group">
      <legend>{legend}</legend>
      {children}
      {ids.map((id) =>
        errors[id] ? (
          <span key={id} id={`${errorBase}-${id}`} className="field-error" role="alert">
            {errors[id]}
          </span>
        ) : null,
      )}
    </fieldset>
  );
}

const TOOLS: { id: EditTool; label: string; key: string; help: string }[] = [
  { id: "select", label: "Select", key: "V", help: "Select only; no handles" },
  { id: "move", label: "Move", key: "M", help: "Arrows move along X, Y, Z; the disc slides across the floor" },
  { id: "rotate", label: "Rotate", key: "R", help: "Ring turns the object about the vertical axis" },
  { id: "resize", label: "Resize", key: "S", help: "Face handles change width, depth (symmetrically) and height (upwards)" },
];

interface Props {
  object: SceneObject;
  asset: CatalogAsset | null;
  tool: EditTool;
  snap: boolean;
  /** False in walk view: the fields show values but cannot be edited. */
  editable: boolean;
  onTool: (tool: EditTool) => void;
  onSnap: (snap: boolean) => void;
  onTransform: (transform: Transform) => string | null;
  onDimensions: (values: Partial<Record<Axis, number>>) => string | null;
  onDuplicate: () => void;
  onRemove: () => void;
}

export function EditPanel({ object, asset, tool, snap, editable, onTool, onSnap, onTransform, onDimensions, onDuplicate, onRemove }: Props) {
  const { position_m: p, rotation_rad: r } = object.transform;
  const position = (axis: "x" | "y" | "z") => (value: number) =>
    onTransform({ ...object.transform, position_m: { ...p, [axis]: value } });
  const rotation = (axis: "x" | "y" | "z") => (deg: number) =>
    onTransform({ ...object.transform, rotation_rad: { ...r, [axis]: degToRad(deg) } });
  const size = (axis: Axis) => (value: number) => onDimensions({ [axis]: value });
  const gltf = asset?.visual.type === "gltf" ? asset.visual : null;
  const stretched = gltf !== null && isStretched(gltf, object.dimensions);
  const disabled = !editable;
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const errorBase = useId();
  const setError = (id: string, message: string | null) =>
    setErrors((current) => {
      const { [id]: _, ...rest } = current;
      return message === null ? rest : { ...rest, [id]: message };
    });
  const errorProps = (id: string) => ({ error: errors[id] ?? null, errorId: `${errorBase}-${id}`, setError });

  return (
    <section className="edit-panel" aria-label="Edit object" data-testid="edit-panel">
      <h3 className="section-title">Edit</h3>
      <div className="edit-tools">
        <div className="segmented" role="group" aria-label="Edit tool">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tool === t.id}
              disabled={disabled}
              title={`${t.help} (key ${t.key})`}
              data-testid={`tool-${t.id}`}
              onClick={() => onTool(t.id)}
            >
              {t.label} <kbd>{t.key}</kbd>
            </button>
          ))}
        </div>
        <label className="snap-toggle" title="Handles snap to 10 mm and 15°; off: 1 mm and 1°">
          <input type="checkbox" checked={snap} disabled={disabled} onChange={(e) => onSnap(e.target.checked)} data-testid="snap" />
          Snap 10 mm · 15°
        </label>
      </div>
      {!editable && <p className="muted">Switch to the orbit or top view to edit.</p>}

      <FieldGroup legend="Position of bottom-centre (m)" ids={["x", "y", "z"].map((a) => `field-position-${a}`)} errors={errors} errorBase={errorBase}>
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberField
            key={axis}
            label={axis.toUpperCase()}
            name={`Position ${axis.toUpperCase()} (m)`}
            testId={`field-position-${axis}`}
            value={p[axis]}
            decimals={LENGTH_DECIMALS}
            unit="m"
            disabled={disabled}
            {...errorProps(`field-position-${axis}`)}
            onCommit={position(axis)}
          />
        ))}
      </FieldGroup>
      <FieldGroup legend="Rotation (degrees)" ids={["x", "y", "z"].map((a) => `field-rotation-${a}`)} errors={errors} errorBase={errorBase}>
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberField
            key={axis}
            label={axis.toUpperCase()}
            name={`Rotation ${axis.toUpperCase()} (degrees)`}
            testId={`field-rotation-${axis}`}
            value={radToDeg(r[axis])}
            decimals={ANGLE_DECIMALS}
            unit="°"
            disabled={disabled}
            {...errorProps(`field-rotation-${axis}`)}
            onCommit={rotation(axis)}
          />
        ))}
      </FieldGroup>
      <FieldGroup legend="Size (m)" ids={["width", "height", "depth"].map((a) => `field-${a}`)} errors={errors} errorBase={errorBase}>
        {(
          [
            ["width", "W"],
            ["height", "H"],
            ["depth", "D"],
          ] as const
        ).map(([axis, label]) => (
          <NumberField
            key={axis}
            label={label}
            name={`${axis[0]!.toUpperCase()}${axis.slice(1)} (m)`}
            testId={`field-${axis}`}
            value={object.dimensions[axis].value_m}
            decimals={LENGTH_DECIMALS}
            unit="m"
            disabled={disabled}
            {...errorProps(`field-${axis}`)}
            onCommit={size(axis)}
          />
        ))}
      </FieldGroup>
      {stretched && gltf && (
        <p className="conflict-note" role="note" data-testid="stretch-warning">
          The model is stretched {(fitDistortion(gltf, object.dimensions) * 100).toFixed(0)} % (tolerance{" "}
          {(gltf.max_fit_distortion * 100).toFixed(0)} %); its proportions may mislead. The recorded dimensions are what
          count.
        </p>
      )}
      <p className="edit-note">
        An edited size becomes <em>user-supplied</em> and unreviewed; the value and evidence it replaces stay in the edit
        log. Edits are not checked for clearance, collisions or physical feasibility.
      </p>
      <div className="edit-actions">
        <button type="button" className="button" disabled={disabled} onClick={onDuplicate} data-testid="duplicate" title={`Place a copy (${shortcut("D")})`}>
          Duplicate…
        </button>
        <button type="button" className="button button-danger" disabled={disabled} onClick={onRemove} data-testid="remove" title="Remove from the scene (Delete); undo restores it">
          Remove
        </button>
      </div>
    </section>
  );
}
