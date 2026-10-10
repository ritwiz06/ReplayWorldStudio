// Shows where a new or copied object will be placed before anything changes: a translucent box
// at the object's recorded size follows the pointer across the floor (snapped like the move
// handles). Click places it; Enter places it where it is shown; Esc (handled by the app) cancels.
import { Edges, Html } from "@react-three/drei";
import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { type Camera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { formatFixed, quantizeMetres } from "../editing/units";
import type { Vec3Tuple } from "./fit";

export interface GhostSpec {
  /** Changes for every new placement, so each starts afresh. */
  nonce: number;
  label: string;
  /** Width, height, depth in metres. */
  size: Vec3Tuple;
  rotation: [x: number, y: number, z: number, order: "XYZ"];
  /** Floor level the object stands on (its position y). */
  y: number;
  /** Initial plan position (x, z), used exactly; null starts at the snapped centre of the view. */
  start: [x: number, z: number] | null;
}

interface Props {
  spec: GhostSpec;
  stepMm: number;
  onPlace: (position: Vec3Tuple) => void;
}

/** Where the centre of the view meets the floor plane at `y`. */
function viewCentre(camera: Camera, y: number): [number, number] {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(0, 0), camera);
  const hit = raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -y), new Vector3());
  return hit ? [hit.x, hit.z] : [0, 0];
}

export function PlacementGhost({ spec, stepMm, onPlace }: Props) {
  const camera = useThree((s) => s.camera);
  const snap = (x: number, z: number): [number, number] => [quantizeMetres(x, stepMm), quantizeMetres(z, stepMm)];
  // A given start (beside a copied object) is kept exactly, so a copy placed with Enter stays
  // aligned with its source; the view centre and pointer positions snap.
  const [position, setPosition] = useState<[number, number]>(() => spec.start ?? snap(...viewCentre(camera, spec.y)));
  const [x, z] = position;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat) return;
      e.preventDefault();
      onPlace([x, spec.y, z]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPlace, spec.y, x, z]);

  const [w, h, d] = spec.size;
  return (
    <>
      {/* An invisible floor that catches the pointer everywhere, even behind equipment. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, spec.y, 0]}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => setPosition(snap(e.point.x, e.point.z))}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (e.delta > 4) return; // the end of a camera drag, not a click
          e.stopPropagation();
          const [px, pz] = snap(e.point.x, e.point.z);
          onPlace([px, spec.y, pz]);
        }}
      >
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <group position={[x, spec.y, z]} rotation={spec.rotation}>
        <mesh position={[0, h / 2, 0]} renderOrder={12}>
          <boxGeometry args={[w, h, d]} />
          <meshBasicMaterial color="#7cc4ff" transparent opacity={0.22} depthWrite={false} />
          <Edges color="#bfe3ff" />
        </mesh>
        <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={11}>
          <planeGeometry args={[w, d]} />
          <meshBasicMaterial color="#7cc4ff" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      </group>
      <Html position={[x, spec.y + h + 0.35, z]} center zIndexRange={[30, 0]} pointerEvents="none">
        <div className="scene-label scene-label-strong placement-label" data-testid="placement-readout">
          <strong>{spec.label}</strong>
          <span>
            x {formatFixed(x, 3)} m · z {formatFixed(z, 3)} m
          </span>
        </div>
      </Html>
    </>
  );
}
