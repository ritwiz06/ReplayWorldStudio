import type { Project, SceneObject } from "@replay-world/contracts";
import { Edges, GizmoHelper, GizmoViewport, Grid, Html, OrbitControls, useCursor } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useState } from "react";
import { formatFootprint } from "../format";
import { placementOf } from "./placement";

interface Props {
  project: Project;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onReady: () => void;
}

// Neutral, deliberately plain materials: these are foundation placeholders, not final assets.
const KIND_STYLE: Record<SceneObject["kind"], { color: string; edge: string }> = {
  structure: { color: "#5f656d", edge: "#7c838c" },
  equipment: { color: "#7891ad", edge: "#a5b8cc" },
  reference: { color: "#c4a24a", edge: "#e0c477" },
};

export function SceneViewport({ project, selectedId, onSelect, onReady }: Props) {
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: [14, 11, 16], fov: 45, near: 0.1, far: 400 }}
      onCreated={onReady}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#171a1e"]} />
      <hemisphereLight args={["#e4eaf0", "#2b2f35", 0.9]} />
      <directionalLight
        position={[12, 20, 9]}
        intensity={1.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      <Grid
        position={[0, 0.005, 0]}
        cellSize={1}
        cellThickness={0.8}
        cellColor="#48505a"
        sectionSize={5}
        sectionThickness={1.1}
        sectionColor="#5a6470"
        fadeDistance={60}
        fadeStrength={1.5}
        infiniteGrid
      />
      {project.scene.objects.map((o) => (
        <PlaceholderBox key={o.id} object={o} selected={o.id === selectedId} onSelect={onSelect} />
      ))}
      <OrbitControls
        makeDefault
        target={[0, 0.6, 0]}
        maxPolarAngle={Math.PI / 2 - 0.02}
        minDistance={2}
        maxDistance={80}
      />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={["#e5534b", "#57ab5a", "#539bf5"]} labelColor="#ffffff" />
      </GizmoHelper>
    </Canvas>
  );
}

interface BoxProps {
  object: SceneObject;
  selected: boolean;
  onSelect: (id: string) => void;
}

function PlaceholderBox({ object, selected, onSelect }: BoxProps) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const placement = placementOf(object);
  const style = KIND_STYLE[object.kind];

  function select(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    onSelect(object.id);
  }

  return (
    <group position={placement.position} rotation={placement.rotation}>
      <mesh
        position={placement.meshOffset}
        castShadow={object.kind !== "structure" || object.dimensions.height_m > 1}
        receiveShadow
        onClick={select}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={placement.size} />
        <meshStandardMaterial
          color={style.color}
          roughness={0.85}
          metalness={0.05}
          emissive={selected ? "#2c6db3" : "#000000"}
          emissiveIntensity={selected ? 0.45 : 0}
        />
        <Edges color={selected ? "#8fd0ff" : hovered ? "#d4dce5" : style.edge} />
      </mesh>
      {selected && (
        <Html position={[0, placement.size[1] + 0.7, 0]} center className="scene-label">
          <strong>{object.name}</strong>
          <span>{formatFootprint(object.dimensions)}</span>
        </Html>
      )}
    </group>
  );
}
