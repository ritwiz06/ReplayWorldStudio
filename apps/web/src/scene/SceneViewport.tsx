import type { Project, SceneObject } from "@replay-world/contracts";
import { GizmoHelper, GizmoViewport, Grid, Html, Line, useCursor } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  type Box3,
  BufferGeometry,
  type DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  type Intersection,
  PMREMGenerator,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { SceneChecks } from "../checks/results";
import { AXIS_ORDER, type CommandRequest } from "../editing/commands";
import { formatFixed, radToDeg } from "../editing/units";
import type { ModelStates } from "../hooks/useCatalogModels";
import { type CameraMemory, type CameraMode, type CameraProbe, CameraRig, type ViewCommand } from "./CameraRig";
import type { EditTool, Snap } from "./drag";
import { EditHandles, type HandleProbe } from "./EditHandles";
import type { Vec3Tuple } from "./fit";
import { ObjectVisual } from "./ObjectVisuals";
import { type GhostSpec, PlacementGhost } from "./PlacementGhost";
import { worldBounds } from "./placement";
import { RunLabelProjector, RunOverlay } from "./RunOverlay";
import { isFloorMarking, sceneBounds, walkWorldOf } from "./sceneBounds";
import type { PlaybackClock } from "../hooks/usePlayback";
import type { Replay } from "../run/replay";

interface Props {
  project: Project;
  /** Changes whenever a document is loaded, even one with the same project ID, so camera views
   * remembered for the previous document are not reused for a different layout. */
  documentKey: number;
  models: ModelStates;
  mode: CameraMode;
  command: ViewCommand | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onReady: () => void;
  onProbe: (probe: CameraProbe) => void;
  /** Top view scale (screen pixels per metre), used to size plan labels. */
  planPixelsPerMetre: number | null;
  /** Editing is possible (not in walk view, no dialog open). */
  editable: boolean;
  tool: EditTool;
  snap: Snap;
  /** A pending placement: the ghost to show, or null. */
  placement: GhostSpec | null;
  onPlace: (position: Vec3Tuple) => void;
  onCommand: (request: CommandRequest) => void;
  onDragChange: (dragging: boolean) => void;
  onHandleProbe: (probe: HandleProbe | null) => void;
  /** The source drawing's lines on the floor (world x, y, z per segment end), or null. */
  underlay?: Float32Array | null;
  /** What the layout checks found, highlighted while they are open (GEO-01/02). */
  checks?: SceneChecks | null;
  /** A plan picture laid on the floor (IMP-03): where its corners are, in world metres. */
  picture?: { url: string; corners: { x: number; z: number }[] } | null;
  /** A run of the day being played back: workers, items and station states (SIM-03). */
  run?: { replay: Replay; clock: PlaybackClock } | null;
  /** The page elements the run's labels are drawn in (moved here to their figures). */
  runLabels?: RefObject<HTMLDivElement | null>;
  /** The conversation's emphasis (UX-03): a proposed position, and objects a question is about. */
  accent?: AccentSpec | null;
}

export interface AccentSpec {
  /** Outlines of objects to point at (footprint and top height). */
  outlines: { points: { x: number; z: number }[]; top: number }[];
  /** A proposed new place for one object: its footprint there, and from where to where. */
  ghost: { points: { x: number; z: number }[]; top: number; from: { x: number; z: number }; to: { x: number; z: number } } | null;
}

const ACCENT = "#37d0ff";

function AccentOverlay({ accent }: { accent: AccentSpec }) {
  const lift = 0.04;
  const box = (points: { x: number; z: number }[], top: number) => {
    const segments: [number, number, number][] = [];
    for (let k = 0; k < points.length; k++) {
      const a = points[k]!;
      const b = points[(k + 1) % points.length]!;
      segments.push([a.x, lift, a.z], [b.x, lift, b.z], [a.x, top, a.z], [b.x, top, b.z], [a.x, lift, a.z], [a.x, top, a.z]);
    }
    return segments;
  };
  const ghost = accent.ghost;
  const shape = useMemo(() => (ghost ? new ShapeGeometry(new Shape(ghost.points.map((p) => new Vector2(p.x, -p.z)))) : null), [ghost]);
  useEffect(() => () => shape?.dispose(), [shape]);
  return (
    <group name="chat-accent">
      {accent.outlines.map((o, i) => (
        <Line key={`c${i}`} raycast={none} points={box(o.points, o.top)} segments color={ACCENT} lineWidth={3} depthTest={false} renderOrder={14} />
      ))}
      {ghost && shape && (
        <>
          <mesh raycast={none} geometry={shape} rotation={[-Math.PI / 2, 0, 0]} position={[0, lift, 0]} renderOrder={14}>
            <meshBasicMaterial color={ACCENT} transparent opacity={0.42} side={DoubleSide} depthTest={false} depthWrite={false} />
          </mesh>
          <Line raycast={none} points={box(ghost.points, ghost.top)} segments color={ACCENT} lineWidth={3.5} dashed dashSize={0.25} gapSize={0.15} depthTest={false} renderOrder={15} />
          <Line raycast={none} points={[[ghost.from.x, lift + 0.02, ghost.from.z], [ghost.to.x, lift + 0.02, ghost.to.z]]} color={ACCENT} lineWidth={4} depthTest={false} renderOrder={15} />
          <mesh raycast={none} position={[ghost.to.x, lift + 0.03, ghost.to.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={16}>
            <circleGeometry args={[0.16, 24]} />
            <meshBasicMaterial color={ACCENT} depthTest={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

const BACKGROUND = "#171a1f";

/** Plan labels narrower than this (px) would be unreadable, so they are hidden. */
const MIN_PLAN_LABEL_PX = 44;

/** Pointer hits on edit handles come first, so a handle drawn over equipment is what gets grabbed. */
function handlesFirst(hits: Intersection[]): Intersection[] {
  const isHandle = (hit: Intersection) => {
    for (let o: Intersection["object"] | null = hit.object; o; o = o.parent) if (o.userData.editHandle) return true;
    return false;
  };
  return [...hits.filter(isHandle), ...hits.filter((h) => !isHandle(h))];
}

function HandlesFirst() {
  const setEvents = useThree((s) => s.setEvents);
  useEffect(() => setEvents({ filter: handlesFirst }), [setEvents]);
  return null;
}

export function SceneViewport({
  project,
  documentKey,
  models,
  mode,
  command,
  selectedId,
  onSelect,
  onReady,
  onProbe,
  planPixelsPerMetre,
  editable,
  tool,
  snap,
  placement,
  onPlace,
  onCommand,
  onDragChange,
  onHandleProbe,
  underlay = null,
  checks = null,
  picture = null,
  run = null,
  runLabels,
  accent = null,
}: Props) {
  const objects = project.scene.objects;
  // While a handle is dragged, the object is drawn from this preview; the scene is unchanged
  // until the drag is released and its single command is accepted.
  const [draft, setDraft] = useState<SceneObject | null>(null);
  const [handleHover, setHandleHover] = useState(false);
  const sceneBox = useMemo(() => sceneBounds(objects), [objects]);
  const walkWorld = useMemo(() => walkWorldOf(objects), [objects]);
  const assets = useMemo(() => new Map(project.catalog.map((a) => [a.id, a])), [project.catalog]);
  const committed = objects.find((o) => o.id === selectedId) ?? null;
  const selected = draft && committed && draft.id === committed.id ? draft : committed;
  const selectedBox = useMemo(() => (selected ? worldBounds(selected) : null), [selected]);
  // One camera memory per loaded document, so opening another file (even a saved copy of the
  // same project) frames it afresh.
  const memory: RefObject<CameraMemory> = useMemo(() => ({ current: { orbit: null, top: null, walk: null } }), [documentKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const radius = sceneBox.getSize(new Vector3()).length() / 2;
  const showHandles = editable && tool !== "select" && !placement && mode !== "walk";
  useEffect(() => {
    if (!showHandles || !committed) onHandleProbe(null);
  }, [showHandles, committed, onHandleProbe]);
  const footprintWidths = useMemo(() => new Map(objects.map((o) => [o.id, worldBounds(o).getSize(new Vector3()).x])), [objects]);

  // In the top view each label fits inside its object's on-screen width, so labels of adjacent
  // equipment never overlap; the selected object's label is always shown.
  const planLabelWidth = (id: string, labelled: boolean): number | undefined => {
    if (mode !== "top" || !planPixelsPerMetre) return undefined;
    const px = (footprintWidths.get(id) ?? 0) * planPixelsPerMetre - 6;
    if (id === selectedId) return Math.max(px, 120);
    return labelled && px >= MIN_PLAN_LABEL_PX ? px : undefined;
  };

  return (
    <Canvas
      // Render only when something changes (camera, scene, selection, handles); an idle scene
      // costs no CPU or GPU time whatever its size.
      frameloop="demand"
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: 45, near: 0.1, far: 600, position: [20, 14, 20] }}
      onCreated={onReady}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[BACKGROUND]} />
      {/* Fog stays attached in every view (the plan view pushes it out of range): adding or removing
          fog changes every material's shader, and recompiling them made the first switch to the
          plan view stall. */}
      <fog attach="fog" args={mode === "top" ? [BACKGROUND, 1e5, 2e5] : [BACKGROUND, radius * 2.2, radius * 6]} />
      <Lighting box={sceneBox} shadows={mode !== "top"} />
      <Grid
        position={[0, 0.006, 0]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#3f454c"
        sectionSize={5}
        sectionThickness={0.9}
        sectionColor="#4d545c"
        fadeDistance={radius * 2.5}
        fadeFrom={0}
        fadeStrength={1.2}
        infiniteGrid
      />
      <HandlesFirst />
      {picture && <PictureUnderlay url={picture.url} corners={picture.corners} />}
      {underlay && !picture && <DrawingUnderlay positions={underlay} />}
      {checks && <CheckHighlights checks={checks} />}
      {accent && <AccentOverlay accent={accent} />}
      {run && <RunOverlay replay={run.replay} clock={run.clock} objects={objects} />}
      {run && runLabels && <RunLabelProjector replay={run.replay} clock={run.clock} objects={objects} layer={runLabels} />}
      {objects.map((o) => (
        <ObjectVisual
          key={o.id}
          object={selected && o.id === selected.id ? selected : o}
          asset={o.asset_id ? (assets.get(o.asset_id) ?? null) : null}
          model={o.asset_id ? models.get(o.asset_id) : undefined}
          selected={o.id === selectedId}
          hovered={o.id === hoveredId && mode !== "walk" && !placement}
          planLabelWidth={planLabelWidth(o.id, o.kind === "equipment" || isFloorMarking(o))}
          interactive={!placement}
          hideLabel={showHandles && o.id === selectedId}
          onSelect={onSelect}
          onHover={setHoveredId}
        />
      ))}
      {showHandles && selected && (
        <EditHandles
          object={selected}
          tool={tool as Exclude<EditTool, "select">}
          snap={snap}
          revision={project.scene.revision}
          vertical={mode !== "top"}
          onPreview={setDraft}
          onCommit={onCommand}
          onDragChange={onDragChange}
          onHover={setHandleHover}
          onProbe={onHandleProbe}
        />
      )}
      {showHandles && selected && draft && committed && <DragReadout before={committed} after={draft} />}
      {placement && editable && <PlacementGhost key={placement.nonce} spec={placement} stepMm={snap.lengthMm} onPlace={onPlace} />}
      <HoverCursor active={((hoveredId !== null && !placement) || handleHover) && mode !== "walk"} />
      <CameraRig
        key={`${documentKey}:${mode}`}
        mode={mode}
        sceneBox={sceneBox}
        selectedBox={selectedBox}
        walkWorld={walkWorld}
        command={command}
        memory={memory}
        onProbe={onProbe}
      />
      {mode === "orbit" && (
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={["#e5534b", "#57ab5a", "#539bf5"]} labelColor="#ffffff" />
        </GizmoHelper>
      )}
    </Canvas>
  );
}

/** The drawing's lines on the floor: where everything was drawn, so a moved object visibly
 * leaves its drawn outline behind. Not pickable: clicks go to the objects. */
function DrawingUnderlay({ positions }: { positions: Float32Array }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} renderOrder={2} raycast={() => null} name="drawing-underlay">
      <lineBasicMaterial color="#26313d" transparent opacity={0.9} depthWrite={false} />
    </lineSegments>
  );
}

const none = () => null;
const FLAG_COLOUR = { conflict: "#ff5c57", uncertain: "#f0b429" } as const;
const ROUTE_COLOUR = { fits: "#57d9a3", conflict: "#ff5c57", cannot_determine: "#f0b429" } as const;

/** The layout checks' findings in the scene: each affected object outlined as a box (seen
 * through whatever is in front of it), overlapping areas filled on the floor, and the route
 * with its ends and, where it is blocked, the narrowest place. Not pickable. */
function CheckHighlights({ checks }: { checks: SceneChecks }) {
  const areas = useMemo(
    () =>
      checks.regions.map((r) => {
        // Drawn in the XY plane and laid flat: (x, y) becomes world (x, -y), so y is -z.
        const shape = new Shape(r.points.map((p) => new Vector2(p.x, -p.z)));
        return { geometry: new ShapeGeometry(shape), flag: r.flag };
      }),
    [checks.regions],
  );
  useEffect(() => () => areas.forEach((a) => a.geometry.dispose()), [areas]);
  const lift = 0.03;
  return (
    <group name="check-highlights">
      {checks.outlines.map((o, i) => {
        const ring = [...o.points, o.points[0]!];
        const segments: [number, number, number][] = [];
        for (let k = 0; k < o.points.length; k++) {
          const a = o.points[k]!;
          const b = o.points[(k + 1) % o.points.length]!;
          segments.push([a.x, lift, a.z], [b.x, lift, b.z], [a.x, o.top, a.z], [b.x, o.top, b.z], [a.x, lift, a.z], [a.x, o.top, a.z]);
        }
        return (
          <group key={`o${i}`}>
            <Line raycast={none} points={segments} segments color={FLAG_COLOUR[o.flag]} lineWidth={2.5} depthTest={false} transparent opacity={0.95} renderOrder={10} />
            <Line raycast={none} points={ring.map((p) => [p.x, lift, p.z] as [number, number, number])} color={FLAG_COLOUR[o.flag]} lineWidth={3.5} depthTest={false} renderOrder={10} />
          </group>
        );
      })}
      {areas.map((a, i) => (
        <mesh raycast={none} key={`a${i}`} geometry={a.geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, lift + 0.005, 0]} renderOrder={11}>
          <meshBasicMaterial color={FLAG_COLOUR[a.flag]} transparent opacity={0.55} side={DoubleSide} depthTest={false} depthWrite={false} />
        </mesh>
      ))}
      {checks.route && checks.route.points.length > 1 && (
        <Line raycast={none} points={checks.route.points.map((p) => [p.x, lift + 0.01, p.z] as [number, number, number])} color={ROUTE_COLOUR[checks.route.outcome]} lineWidth={4} depthTest={false} renderOrder={12} />
      )}
      {checks.ends.map((p, i) => (
        <mesh raycast={none} key={`e${i}`} position={[p.x, lift + 0.02, p.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={13}>
          <circleGeometry args={[0.18, 24]} />
          <meshBasicMaterial color={i === 0 ? "#7cc4ff" : "#c39bff"} depthTest={false} />
        </mesh>
      ))}
      {checks.passage && (
        <mesh raycast={none} position={[checks.passage.x, lift + 0.02, checks.passage.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={13}>
          <ringGeometry args={[0.22, 0.32, 32]} />
          <meshBasicMaterial color={FLAG_COLOUR.conflict} depthTest={false} side={DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

/** A plan picture on the floor, under everything: where each object was marked, so a moved one
 * visibly leaves its place on the plan. Not pickable. */
function PictureUnderlay({ url, corners }: { url: string; corners: { x: number; z: number }[] }) {
  const [texture, setTexture] = useState<Texture | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let alive = true;
    const loader = new TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(url, (t) => {
      if (!alive) return t.dispose();
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      setTexture(t);
      invalidate();
    });
    return () => {
      alive = false;
    };
  }, [url, invalidate]);
  useEffect(() => () => texture?.dispose(), [texture]);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const [a, b, c, d] = corners;
    g.setAttribute("position", new Float32BufferAttribute([a!.x, 0.004, a!.z, b!.x, 0.004, b!.z, c!.x, 0.004, c!.z, d!.x, 0.004, d!.z], 3));
    g.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    return g;
  }, [corners]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (!texture) return null;
  return (
    <mesh geometry={geometry} renderOrder={1} raycast={() => null} name="plan-picture">
      <meshBasicMaterial map={texture} transparent opacity={0.9} depthWrite={false} side={DoubleSide} />
    </mesh>
  );
}

/** The values a drag would commit, shown above the object while the handle is held. */
function DragReadout({ before, after }: { before: SceneObject; after: SceneObject }) {
  const p = after.transform.position_m;
  const parts: string[] = [];
  const b = before.transform.position_m;
  if (p.x !== b.x || p.y !== b.y || p.z !== b.z) parts.push(`x ${formatFixed(p.x, 3)} · y ${formatFixed(p.y, 3)} · z ${formatFixed(p.z, 3)} m`);
  if (after.transform.rotation_rad.y !== before.transform.rotation_rad.y) parts.push(`rotation Y ${formatFixed(radToDeg(after.transform.rotation_rad.y), 1)}°`);
  for (const axis of AXIS_ORDER) {
    if (after.dimensions[axis].value_m !== before.dimensions[axis].value_m) parts.push(`${axis} ${formatFixed(after.dimensions[axis].value_m, 3)} m`);
  }
  if (parts.length === 0) return null;
  return (
    <Html position={[p.x, p.y + after.dimensions.height.value_m + 0.35, p.z]} center zIndexRange={[30, 0]} pointerEvents="none">
      <div className="scene-label scene-label-strong drag-readout" data-testid="drag-readout">
        {parts.map((part) => (
          <span key={part}>{part}</span>
        ))}
      </div>
    </Html>
  );
}

function HoverCursor({ active }: { active: boolean }) {
  useCursor(active);
  return null;
}

/**
 * Neutral industrial lighting: a procedural room environment for reflections (no network
 * download), soft sky/ground fill, and one shadow-casting key light sized to the scene.
 */
function Lighting({ box, shadows }: { box: Box3; shadows: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const key = useRef<DirectionalLight>(null);
  const centre = useMemo(() => box.getCenter(new Vector3()), [box]);
  const radius = useMemo(() => Math.max(box.getSize(new Vector3()).length() / 2, 2), [box]);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    scene.environmentIntensity = 0.45;
    invalidate();
    return () => {
      scene.environment = null;
      environment.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);

  useEffect(() => {
    const light = key.current;
    if (!light) return;
    light.target.position.copy(centre);
    light.target.updateMatrixWorld();
    const cam = light.shadow.camera;
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.near = 0.5;
    cam.far = radius * 5;
    cam.updateProjectionMatrix();
    invalidate();
  }, [centre, radius, invalidate]);

  // The plan view hides shadows without changing how the light is set up: toggling castShadow
  // would recompile every material's shader on the first switch (a visible hitch). The shadow
  // map is not updated while hidden, so the plan view also skips the shadow pass.
  useEffect(() => {
    const light = key.current;
    if (!light) return;
    light.shadow.intensity = shadows ? 1 : 0;
    gl.shadowMap.autoUpdate = shadows;
    gl.shadowMap.needsUpdate = shadows;
    invalidate();
  }, [gl, shadows, invalidate]);

  return (
    <>
      <hemisphereLight args={["#eaf2ff", "#3c3833", 0.55]} />
      <directionalLight
        ref={key}
        position={[centre.x - radius * 0.45, centre.y + radius * 1.5, centre.z + radius * 0.7]}
        intensity={2}
        color="#fff2e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.025}
      />
      <directionalLight position={[centre.x + radius, centre.y + radius * 0.6, centre.z - radius]} intensity={0.4} color="#c4d8ff" />
    </>
  );
}
