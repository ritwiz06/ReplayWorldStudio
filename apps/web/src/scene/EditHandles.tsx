// Handles for moving, rotating and resizing the selected object. Each handle is drawn at a
// constant on-screen size and above the scene. A drag previews the object under the pointer and
// commits one command on release (Esc cancels), through the same command path as the inspector.
import type { SceneObject } from "@replay-world/contracts";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Euler, type Group, Raycaster, Vector2, Vector3 } from "three";
import type { CommandRequest } from "../editing/commands";
import { worldPerPixel } from "./cameras";
import { beginDrag, dragCommand, dragTo, type EditTool, handleAnchor, type HandleId, originOf, type Snap, TOOL_HANDLES, yawOnly } from "./drag";

const COLOR: Record<string, string> = { x: "#ef5b52", y: "#5cc160", z: "#4f9df7", xz: "#f2c94c", ring: "#f2c94c" };
const HOVER = "#ffffff";

/** Screen pixels of each handle part. */
const ARROW = { start: 16, length: 70, shaft: 1.6, head: 6, headLength: 16, hit: 9 };
const RING = { radius: 74, tube: 2.4, hit: 9 };
const KNOB = 11;
const NO_ROTATION = new Euler();

/** Screen points for tests and debugging: where each handle can be grabbed, in client pixels. */
export interface HandleProbe {
  objectId: string;
  tool: EditTool;
  points: Partial<Record<HandleId | "rotate-y@90", [number, number]>>;
}

interface Props {
  object: SceneObject;
  tool: Exclude<EditTool, "select">;
  snap: Snap;
  revision: number;
  /** False in the top view, where the vertical arrow would point at the viewer. */
  vertical: boolean;
  onPreview: (object: SceneObject | null) => void;
  onCommit: (request: CommandRequest) => void;
  onDragChange: (dragging: boolean) => void;
  onHover: (hovering: boolean) => void;
  onProbe: (probe: HandleProbe) => void;
}

const material = (color: string) => (
  <meshBasicMaterial color={color} depthTest={false} depthWrite={false} transparent opacity={0.95} toneMapped={false} />
);
/** Invisible but pickable: a generous target around a thin visible part. */
const hitMaterial = <meshBasicMaterial colorWrite={false} depthWrite={false} depthTest={false} />;

export function EditHandles({ object, tool, snap, revision, vertical, onPreview, onCommit, onDragChange, onHover, onProbe }: Props) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const [hovered, setHovered] = useState<HandleId | null>(null);
  const [active, setActive] = useState<HandleId | null>(null);
  const groups = useRef(new Map<HandleId, Group>());
  const cleanup = useRef<(() => void) | null>(null);
  const sinceProbe = useRef(1);

  const handles = TOOL_HANDLES[tool].filter((h) => (h !== "move-y" || vertical) && (h !== "rotate-y" || yawOnly(object)));

  useEffect(() => () => cleanup.current?.(), []); // a drag never outlives the handles

  useEffect(() => {
    onHover(hovered !== null || active !== null);
  }, [hovered, active, onHover]);

  // Keep every handle the same size on screen, and report where to grab it.
  useFrame((_, dt) => {
    for (const group of groups.current.values()) group.scale.setScalar(worldPerPixel(camera, group.position, size.height));
    sinceProbe.current += dt;
    if (sinceProbe.current < 0.15) return;
    sinceProbe.current = 0;
    const rect = gl.domElement.getBoundingClientRect();
    const screen = (p: Vector3): [number, number] => {
      const ndc = p.clone().project(camera);
      return [Math.round(rect.left + ((ndc.x + 1) / 2) * rect.width), Math.round(rect.top + ((1 - ndc.y) / 2) * rect.height)];
    };
    const origin = originOf(object);
    const px = worldPerPixel(camera, origin, size.height);
    const along = (axis: Vector3, pixels: number) => origin.clone().addScaledVector(axis, pixels * px);
    const points: HandleProbe["points"] = {};
    for (const h of handles) {
      if (h === "move-x") points[h] = screen(along(new Vector3(1, 0, 0), ARROW.start + ARROW.length * 0.6));
      else if (h === "move-y") points[h] = screen(along(new Vector3(0, 1, 0), ARROW.start + ARROW.length * 0.6));
      else if (h === "move-z") points[h] = screen(along(new Vector3(0, 0, 1), ARROW.start + ARROW.length * 0.6));
      else if (h === "move-xz") points[h] = screen(origin);
      else if (h === "rotate-y") {
        points[h] = screen(along(new Vector3(1, 0, 0), RING.radius));
        points["rotate-y@90"] = screen(along(new Vector3(0, 0, -1), RING.radius));
      } else points[h] = screen(handleAnchor(object, h));
    }
    onProbe({ objectId: object.id, tool, points });
  });

  const startDrag = (handle: HandleId, event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || cleanup.current) return;
    event.stopPropagation();
    const frame = beginDrag(handle, object, event.ray, camera.getWorldDirection(new Vector3()));
    if (!frame) return;
    if (controls) controls.enabled = false; // the camera must not orbit while a handle is held
    const baseRevision = revision;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    let preview = object;

    const move = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      preview = dragTo(frame, raycaster.ray, snap);
      onPreview(preview === object ? null : preview);
    };
    const finish = (commit: boolean) => {
      cleanup.current?.();
      onPreview(null);
      const command = commit ? dragCommand(object, preview) : null;
      if (command) onCommit({ baseRevision, command });
    };
    const release = () => finish(true);
    const abandon = () => finish(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // Esc cancels the drag only, not the selection
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", abandon);
    window.addEventListener("blur", abandon);
    window.addEventListener("keydown", key, true);
    cleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", abandon);
      window.removeEventListener("blur", abandon);
      window.removeEventListener("keydown", key, true);
      if (controls) controls.enabled = true;
      cleanup.current = null;
      setActive(null);
      onDragChange(false);
    };
    setActive(handle);
    onDragChange(true);
  };

  const r = object.transform.rotation_rad;
  const handleProps = (id: HandleId) => ({
    userData: { editHandle: id },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => startDrag(id, e),
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHovered(id);
    },
    onPointerOut: () => setHovered((h) => (h === id ? null : h)),
  });
  const colorOf = (id: HandleId, base: string) => (hovered === id || active === id ? HOVER : base);
  const place = (id: HandleId, anchor: Vector3, rotation: Euler, children: ReactNode) => (
    <group
      key={id}
      ref={(g) => {
        if (g) groups.current.set(id, g);
        else groups.current.delete(id);
      }}
      position={anchor}
      rotation={rotation}
      renderOrder={20}
      {...handleProps(id)}
    >
      {children}
    </group>
  );
  const origin = originOf(object);
  const objectRotation = new Euler(r.x, r.y, r.z, r.order);

  return (
    <group name="edit-handles">
      {handles.map((id) => {
        if (id === "move-x" || id === "move-y" || id === "move-z") {
          const axis = id.slice(-1);
          const turn: [number, number, number] = axis === "x" ? [0, 0, -Math.PI / 2] : axis === "z" ? [Math.PI / 2, 0, 0] : [0, 0, 0];
          return place(id, origin, NO_ROTATION, <Arrow rotation={turn} color={colorOf(id, COLOR[axis]!)} />);
        }
        if (id === "move-xz") {
          return place(
            id,
            origin,
            NO_ROTATION,
            <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={21}>
              <circleGeometry args={[11, 32]} />
              {material(colorOf(id, COLOR.xz!))}
            </mesh>,
          );
        }
        if (id === "rotate-y") {
          return place(
            id,
            origin,
            new Euler(0, r.y, 0),
            <>
              <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={21}>
                <torusGeometry args={[RING.radius, RING.tube, 8, 96]} />
                {material(colorOf(id, COLOR.ring!))}
              </mesh>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[RING.radius, RING.hit, 6, 64]} />
                {hitMaterial}
              </mesh>
              {/* The equipment's front (+Z) */}
              <mesh position={[0, 0, RING.radius]} renderOrder={22}>
                <sphereGeometry args={[6, 16, 12]} />
                {material(colorOf(id, COLOR.z!))}
              </mesh>
            </>,
          );
        }
        const axis = id.charAt(5);
        return place(
          id,
          handleAnchor(object, id),
          objectRotation,
          <>
            <mesh renderOrder={22}>
              <boxGeometry args={[KNOB, KNOB, KNOB]} />
              {material(colorOf(id, COLOR[axis]!))}
            </mesh>
            <mesh>
              <boxGeometry args={[KNOB * 2, KNOB * 2, KNOB * 2]} />
              {hitMaterial}
            </mesh>
          </>,
        );
      })}
    </group>
  );
}

function Arrow({ rotation, color }: { rotation: [number, number, number]; color: string }) {
  const tip = ARROW.start + ARROW.length;
  return (
    <group rotation={rotation}>
      <mesh position={[0, ARROW.start + ARROW.length / 2, 0]} renderOrder={21}>
        <cylinderGeometry args={[ARROW.shaft, ARROW.shaft, ARROW.length, 8]} />
        {material(color)}
      </mesh>
      <mesh position={[0, tip, 0]} renderOrder={21}>
        <coneGeometry args={[ARROW.head, ARROW.headLength, 16]} />
        {material(color)}
      </mesh>
      <mesh position={[0, ARROW.start + (ARROW.length + ARROW.headLength) / 2, 0]}>
        <cylinderGeometry args={[ARROW.hit, ARROW.hit, ARROW.length + ARROW.headLength, 8]} />
        {hitMaterial}
      </mesh>
    </group>
  );
}
