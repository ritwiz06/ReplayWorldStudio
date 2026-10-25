// How each scene object is drawn. Equipment with a verified glTF model shows the model fitted
// to its recorded dimensions; a missing or rejected model shows a clearly labelled fallback of
// the same size. Structures are plain architectural solids, markings are painted on the floor.
import type { CatalogAsset, GltfVisual, SceneObject } from "@replay-world/contracts";
import { Edges, Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { memo, type ReactNode, useContext, useEffect, useMemo } from "react";
import { type Appearance, AppearanceContext } from "./appearance";
import { BoxGeometry, CanvasTexture, EdgesGeometry, type Group, RepeatWrapping, SRGBColorSpace } from "three";
import { heightAssumed } from "../evidence";
import { formatFootprint } from "../format";
import type { ModelState } from "../hooks/useCatalogModels";
import { displayForm, type DisplayForm, partsOf } from "./displayForms";
import { envelopeFill } from "./fit";
import { instanceModel } from "./modelLoader";
import { placementOf } from "./placement";
import { isSlab } from "./sceneBounds";

const ACCENT = "#37d0ff";


/** Consistent illustrative colours: one per kind of stand-in, one for generic equipment. */
const DRAFT = { equipment: "#6a92b8", rack: "#7f95aa", table: "#c4a47e", conveyor: "#55606c", wall: "#d2ccc1", floor: "#a8a49b" } as const;

/** Material settings for a body: opaque in the draft view, see-through where the view asks. */
function look(appearance: Appearance, assumed: boolean, uncertaintyOpacity: number) {
  if (appearance === "see-through") return { transparent: true, opacity: 0.18, depthWrite: false };
  if (appearance === "uncertainty" && assumed) return { transparent: true, opacity: uncertaintyOpacity, depthWrite: false };
  return { transparent: false, opacity: 1, depthWrite: true };
}
/** Pointer travel (px) above which a release ends a drag, not a click. */
const CLICK_TOLERANCE_PX = 4;

interface Props {
  object: SceneObject;
  asset: CatalogAsset | null;
  model: ModelState | undefined;
  selected: boolean;
  hovered: boolean;
  /** Top view: maximum label width in px; undefined hides the plan label. */
  planLabelWidth: number | undefined;
  /** False while a placement is pending: the pointer then belongs to the placement. */
  interactive: boolean;
  /** Hide the floating name label (the edit handles and their readout are shown instead). */
  hideLabel: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

export const ObjectVisual = memo(function ObjectVisual({ object, asset, model, selected, hovered, planLabelWidth, interactive, hideLabel, onSelect, onHover }: Props) {
  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.delta <= CLICK_TOLERANCE_PX) onSelect(object.id);
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onHover(object.id);
    },
    onPointerOut: () => onHover(null),
  };
  const gltf = asset?.visual.type === "gltf" ? asset.visual : null;

  // A model kept in proportion (0.15.0) may not fill the recorded space: the space shows.
  const unfilled = gltf && model?.status === "ready" && gltf.fit === "contain" && envelopeFill(gltf, object.dimensions).some((f) => f < 0.95);
  let body;
  if (object.kind === "walkway" || object.kind === "keep_clear") body = <FloorMarking object={object} />;
  else if (gltf && model?.status === "ready") body = <GltfInstance template={model.template} visual={gltf} object={object} />;
  else if (gltf && model?.status === "failed") body = <FallbackBox object={object} />;
  else if (gltf) body = <LoadingBox object={object} />;
  else if (object.kind === "structure") body = <StructureBox object={object} />;
  else {
    const form = displayForm(object);
    body = form === "box" ? <PlaceholderBox object={object} /> : <ProvisionalForm object={object} form={form} />;
  }

  return (
    <group name={object.id} {...(interactive ? handlers : {})}>
      {body}
      {unfilled && <EnvelopeOutline object={object} />}
      {(selected || hovered) && <SelectionBox object={object} strong={selected} />}
      {!hideLabel && (selected || planLabelWidth !== undefined) && <ObjectLabel object={object} emphasis={selected} planWidth={planLabelWidth} />}
    </group>
  );
});

/** The recorded envelope's edges, faint: what a smaller, proportion-kept model leaves unused. */
function EnvelopeOutline({ object }: { object: SceneObject }) {
  const p = placementOf(object);
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(...p.size)), [p.size[0], p.size[1], p.size[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <group position={p.position} rotation={p.rotation}>
      <lineSegments geometry={edges} position={p.meshOffset}>
        <lineBasicMaterial color="#9fb3c8" transparent opacity={0.6} />
      </lineSegments>
    </group>
  );
}

function GltfInstance({ template, visual, object }: { template: Group; visual: GltfVisual; object: SceneObject }) {
  const placed = useMemo(() => instanceModel(template, visual, object), [template, visual, object]);
  return <primitive object={placed} />;
}

/** A solid box at the object's placement, sized to its recorded dimensions. */
function PlacedBox({ object, children }: { object: SceneObject; children: ReactNode }) {
  const p = placementOf(object);
  return (
    <group position={p.position} rotation={p.rotation}>
      <mesh position={p.meshOffset} castShadow receiveShadow>
        <boxGeometry args={p.size} />
        {children}
      </mesh>
    </group>
  );
}

function StructureBox({ object }: { object: SceneObject }) {
  const appearance = useContext(AppearanceContext);
  const slab = isSlab(object);
  const assumed = heightAssumed(object);
  const m = look(slab ? "draft" : appearance, assumed, 0.62);
  return (
    <PlacedBox object={object}>
      <meshStandardMaterial color={slab ? DRAFT.floor : DRAFT.wall} roughness={slab ? 0.78 : 0.9} metalness={0} envMapIntensity={slab ? 0.6 : 0.4} {...m} />
      {!slab && <Edges color={appearance === "uncertainty" && assumed ? "#d6dbe0" : "#9d978c"} />}
    </PlacedBox>
  );
}

/** A box with no model. One whose height is only assumed is see-through, so it reads as a
 * provisional footprint with a display height, not as a measured solid. */
function PlaceholderBox({ object }: { object: SceneObject }) {
  const appearance = useContext(AppearanceContext);
  const color = object.kind === "reference" ? "#c4a24a" : DRAFT.equipment;
  const assumed = heightAssumed(object);
  return (
    <PlacedBox object={object}>
      <meshStandardMaterial color={color} roughness={0.7} metalness={0.08} {...look(appearance, assumed, 0.6)} />
      <Edges color={object.kind === "reference" ? "#e0c477" : appearance === "uncertainty" && assumed ? "#d4e9ff" : "#3f5f7d"} />
    </PlacedBox>
  );
}

/** A simple stand-in shape (rack, table, conveyor) inside the recorded box, see-through like
 * every provisional object; the box's outline shows the extent the object actually records. */
function ProvisionalForm({ object, form }: { object: SceneObject; form: Exclude<DisplayForm, "box"> }) {
  const appearance = useContext(AppearanceContext);
  const p = placementOf(object);
  const [w, h, d] = p.size;
  const parts = useMemo(() => partsOf(form, w, h, d), [form, w, h, d]);
  const uncertain = appearance === "uncertainty";
  return (
    <group position={p.position} rotation={p.rotation} name={`form-${form}`}>
      {parts.map((part, i) => (
        <mesh key={i} position={part.centre} castShadow receiveShadow>
          <boxGeometry args={part.size} />
          <meshStandardMaterial color={uncertain ? "#85afd6" : DRAFT[form]} roughness={0.65} metalness={form === "table" ? 0 : 0.15} {...look(appearance, true, 0.8)} />
        </mesh>
      ))}
      {uncertain && (
        <mesh position={p.meshOffset}>
          <boxGeometry args={p.size} />
          <meshBasicMaterial transparent opacity={0.06} color="#7891ad" depthWrite={false} />
          <Edges color="#d3e2f1" />
        </mesh>
      )}
    </group>
  );
}

function LoadingBox({ object }: { object: SceneObject }) {
  return (
    <PlacedBox object={object}>
      <meshBasicMaterial color="#9aa4ae" transparent opacity={0.08} depthWrite={false} />
      <Edges color="#9aa4ae" />
    </PlacedBox>
  );
}

/** Same size as the missing model, deliberately unlike equipment, and always labelled. */
function FallbackBox({ object }: { object: SceneObject }) {
  const p = placementOf(object);
  return (
    <>
      <PlacedBox object={object}>
        <meshStandardMaterial color="#c0562b" roughness={0.9} transparent opacity={0.55} />
        <Edges color="#ff9a62" />
      </PlacedBox>
      <Html position={[p.position[0], p.position[1] + p.size[1] / 2, p.position[2]]} center zIndexRange={[20, 0]} pointerEvents="none">
        <div className="model-fallback-label" data-testid={`model-fallback-${object.id}`}>
          Model unavailable
        </div>
      </Html>
    </>
  );
}

let hatch: CanvasTexture | null = null;
/** Yellow and black diagonal stripes, 0.5 m per repeat. */
function hatchTexture(): CanvasTexture {
  if (hatch) return hatch;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#e5ad0c";
  for (let i = -64; i < 128; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 16, 0);
    ctx.lineTo(i + 16 - 64, 64);
    ctx.lineTo(i - 64, 64);
    ctx.closePath();
    ctx.fill();
  }
  hatch = new CanvasTexture(canvas);
  hatch.wrapS = hatch.wrapT = RepeatWrapping;
  hatch.colorSpace = SRGBColorSpace;
  hatch.anisotropy = 8;
  return hatch;
}

/** Painted floor marking: walkways are green with yellow edge lines, keep-clear areas hatched. */
function FloorMarking({ object }: { object: SceneObject }) {
  const p = placementOf(object);
  const [w, h, d] = p.size;
  const y = h + 0.001;
  const texture = useMemo(() => {
    if (object.kind !== "keep_clear") return null;
    const t = hatchTexture().clone();
    t.repeat.set(w / 0.5, d / 0.5);
    t.needsUpdate = true;
    return t;
  }, [object.kind, w, d]);
  const line = 0.08;
  const edges: [number, number, number, number][] = [
    [0, -d / 2 + line / 2, w, line],
    [0, d / 2 - line / 2, w, line],
    [-w / 2 + line / 2, 0, line, d],
    [w / 2 - line / 2, 0, line, d],
  ];
  const paint = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false } as const;
  return (
    <group position={p.position} rotation={p.rotation}>
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        {texture ? (
          <meshStandardMaterial map={texture} roughness={0.75} transparent opacity={0.9} {...paint} />
        ) : (
          <meshStandardMaterial color="#2f8a58" roughness={0.75} transparent opacity={0.3} {...paint} />
        )}
      </mesh>
      {object.kind === "walkway" &&
        edges.map(([x, z, lw, ld], i) => (
          <mesh key={i} position={[x, y + 0.0005, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[lw, ld]} />
            <meshStandardMaterial color="#e5ad0c" roughness={0.6} {...paint} />
          </mesh>
        ))}
    </group>
  );
}

/** Outline of the recorded physical box (not the model's own bounds) plus a footprint tint. */
function SelectionBox({ object, strong }: { object: SceneObject; strong: boolean }) {
  const p = placementOf(object);
  const [sx, sy, sz] = p.size;
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(sx, sy, sz)), [sx, sy, sz]);
  return (
    <group position={p.position} rotation={p.rotation}>
      <lineSegments geometry={edges} position={p.meshOffset} renderOrder={10}>
        <lineBasicMaterial color={strong ? ACCENT : "#e8eef4"} transparent opacity={strong ? 0.95 : 0.55} depthTest={false} />
      </lineSegments>
      {strong && (
        <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={9}>
          <planeGeometry args={[p.size[0] + 0.1, p.size[2] + 0.1]} />
          <meshBasicMaterial color={ACCENT} transparent opacity={0.16} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function ObjectLabel({ object, emphasis, planWidth }: { object: SceneObject; emphasis: boolean; planWidth: number | undefined }) {
  const p = placementOf(object);
  const flat = object.kind === "walkway" || object.kind === "keep_clear";
  const height = flat ? 0.2 : p.size[1] + 0.35;
  const plan = planWidth !== undefined;
  return (
    <Html position={[p.position[0], p.position[1] + height, p.position[2]]} center zIndexRange={[10, 0]} pointerEvents="none">
      <div
        className={`scene-label${emphasis ? " scene-label-strong" : ""}${plan ? " scene-label-plan" : ""}`}
        style={plan ? { maxWidth: `${planWidth}px` } : undefined}
        title={object.name}
      >
        <strong>{object.name}</strong>
        {emphasis && !plan && (
          <span>
            {formatFootprint(object.dimensions)}
            {heightAssumed(object) && " (height assumed)"}
          </span>
        )}
      </div>
    </Html>
  );
}
