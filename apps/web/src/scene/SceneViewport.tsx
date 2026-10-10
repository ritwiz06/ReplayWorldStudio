import type { Project } from "@replay-world/contracts";
import { GizmoHelper, GizmoViewport, Grid, useCursor } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { type Box3, type DirectionalLight, PMREMGenerator, Vector3 } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { ModelStates } from "../hooks/useCatalogModels";
import { type CameraMemory, type CameraMode, type CameraProbe, CameraRig, type ViewCommand } from "./CameraRig";
import { ObjectVisual } from "./ObjectVisuals";
import { worldBounds } from "./placement";
import { isFloorMarking, sceneBounds, walkWorldOf } from "./sceneBounds";

interface Props {
  project: Project;
  models: ModelStates;
  mode: CameraMode;
  command: ViewCommand | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onReady: () => void;
  onProbe: (probe: CameraProbe) => void;
  /** Top view scale (screen pixels per metre), used to size plan labels. */
  planPixelsPerMetre: number | null;
}

const BACKGROUND = "#1f2329";

/** Plan labels narrower than this (px) would be unreadable, so they are hidden. */
const MIN_PLAN_LABEL_PX = 44;

export function SceneViewport({ project, models, mode, command, selectedId, onSelect, onReady, onProbe, planPixelsPerMetre }: Props) {
  const objects = project.scene.objects;
  const sceneBox = useMemo(() => sceneBounds(objects), [objects]);
  const walkWorld = useMemo(() => walkWorldOf(objects), [objects]);
  const assets = useMemo(() => new Map(project.catalog.map((a) => [a.id, a])), [project.catalog]);
  const selected = objects.find((o) => o.id === selectedId) ?? null;
  const selectedBox = useMemo(() => (selected ? worldBounds(selected) : null), [selected]);
  // One camera memory per project, so opening another scene frames it afresh.
  const memory: RefObject<CameraMemory> = useMemo(() => ({ current: { orbit: null, top: null, walk: null } }), [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const radius = sceneBox.getSize(new Vector3()).length() / 2;
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
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: 45, near: 0.1, far: 600, position: [20, 14, 20] }}
      onCreated={onReady}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[BACKGROUND]} />
      {mode !== "top" && <fog attach="fog" args={[BACKGROUND, radius * 2.2, radius * 6]} />}
      <Lighting box={sceneBox} shadows={mode !== "top"} />
      <Grid
        position={[0, 0.006, 0]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#666c72"
        sectionSize={5}
        sectionThickness={0.9}
        sectionColor="#565c63"
        fadeDistance={radius * 2.5}
        fadeFrom={0}
        fadeStrength={1.2}
        infiniteGrid
      />
      {objects.map((o) => (
        <ObjectVisual
          key={o.id}
          object={o}
          asset={o.asset_id ? (assets.get(o.asset_id) ?? null) : null}
          model={o.asset_id ? models.get(o.asset_id) : undefined}
          selected={o.id === selectedId}
          hovered={o.id === hoveredId && mode !== "walk"}
          planLabelWidth={planLabelWidth(o.id, o.kind === "equipment" || isFloorMarking(o))}
          onSelect={onSelect}
          onHover={setHoveredId}
        />
      ))}
      <HoverCursor active={hoveredId !== null && mode !== "walk"} />
      <CameraRig
        key={`${project.id}:${mode}`}
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
  const key = useRef<DirectionalLight>(null);
  const centre = useMemo(() => box.getCenter(new Vector3()), [box]);
  const radius = useMemo(() => Math.max(box.getSize(new Vector3()).length() / 2, 2), [box]);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    scene.environmentIntensity = 0.45;
    return () => {
      scene.environment = null;
      environment.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

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
  }, [centre, radius]);

  return (
    <>
      <hemisphereLight args={["#e8edf2", "#4a4e53", 0.5]} />
      <directionalLight
        ref={key}
        position={[centre.x - radius * 0.45, centre.y + radius * 1.5, centre.z + radius * 0.7]}
        intensity={1.8}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.025}
      />
      <directionalLight position={[centre.x + radius, centre.y + radius * 0.6, centre.z - radius]} intensity={0.35} />
    </>
  );
}
