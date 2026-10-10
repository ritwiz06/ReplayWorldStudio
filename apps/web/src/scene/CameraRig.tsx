// The three camera modes. Orbit and walk share the canvas's perspective camera; the top view
// mounts an orthographic camera with world -Z pointing up the screen. Each rig remembers its
// last pose, so switching modes and back returns to the same view.
import { MapControls, OrbitControls, OrthographicCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { type Box3, type OrthographicCamera as OrthographicCameraImpl, type PerspectiveCamera, Vector3 } from "three";
import { type CameraPose, frameBox, PLAN_UP, planView } from "./cameras";
import type { Vec3Tuple } from "./fit";
import { isTyping } from "./modes";
import { EYE_HEIGHT_M, look, rectOf, stepWalker, walkPoseFacing, walkStart, type WalkPose, type WalkWorld } from "./walk";

export type CameraMode = "orbit" | "top" | "walk";

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;
type MapControlsImpl = ComponentRef<typeof MapControls>;

export interface ViewCommand {
  type: "frame-selection" | "frame-all" | "reset-walk";
  nonce: number;
}

/** Camera state reported to the page (for overlays and tests). */
export interface CameraProbe {
  mode: CameraMode;
  position: Vec3Tuple;
  target: Vec3Tuple;
  /** Top view only: screen pixels per world metre. */
  pixelsPerMetre: number | null;
}

export interface CameraMemory {
  orbit: CameraPose | null;
  top: { centre: Vec3Tuple; zoom: number } | null;
  walk: WalkPose | null;
}

interface RigProps {
  sceneBox: Box3;
  selectedBox: Box3 | null;
  command: ViewCommand | null;
  memory: RefObject<CameraMemory>;
  onProbe: (probe: CameraProbe) => void;
}

const ORBIT_FOV = 45;
const WALK_FOV = 70;
const ANIMATION_MS = 450;
const PROBE_INTERVAL_S = 0.15;

const round = (v: Vector3): Vec3Tuple => [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000, Math.round(v.z * 1000) / 1000];

/** Runs `handle` for each command issued after this rig mounted (not for earlier ones). */
function useCommand(command: ViewCommand | null, handle: (command: ViewCommand) => void) {
  const seen = useRef(command?.nonce);
  const latest = useRef(handle);
  useLayoutEffect(() => {
    latest.current = handle;
  });
  useEffect(() => {
    if (!command || command.nonce === seen.current) return;
    seen.current = command.nonce;
    latest.current(command);
  }, [command]);
}

/** Calls `report` at most every PROBE_INTERVAL_S seconds from the render loop. */
function useProbe(report: () => void) {
  const elapsed = useRef(PROBE_INTERVAL_S);
  useFrame((_, dt) => {
    elapsed.current += dt;
    if (elapsed.current >= PROBE_INTERVAL_S) {
      elapsed.current = 0;
      report();
    }
  });
}

export function CameraRig({ mode, walkWorld, ...props }: RigProps & { mode: CameraMode; walkWorld: WalkWorld }) {
  if (mode === "top") return <TopRig {...props} />;
  if (mode === "walk") return <WalkRig {...props} world={walkWorld} />;
  return <OrbitRig {...props} />;
}

function OrbitRig({ sceneBox, selectedBox, command, memory, onProbe }: RigProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useRef<OrbitControlsImpl>(null);
  const animation = useRef<{ from: CameraPose; to: CameraPose; start: number } | null>(null);

  useLayoutEffect(() => {
    camera.fov = ORBIT_FOV;
    camera.near = 0.1;
    camera.far = 600;
    camera.updateProjectionMatrix();
    const pose = memory.current.orbit ?? frameBox(sceneBox, ORBIT_FOV, size.width / size.height);
    camera.position.set(...pose.position);
    controls.current?.target.set(...pose.target);
    controls.current?.update();
    const saved = memory.current;
    const ctrl = controls.current;
    return () => {
      saved.orbit = { position: camera.position.toArray(), target: (ctrl?.target ?? new Vector3()).toArray() };
    };
    // Only on entering orbit mode; later changes come through commands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useCommand(command, (cmd) => {
    if (!controls.current) return;
    const aspect = size.width / size.height;
    const target = controls.current.target;
    const direction = camera.position.clone().sub(target).normalize().toArray();
    const to =
      cmd.type === "frame-selection" && selectedBox
        ? frameBox(selectedBox, ORBIT_FOV, aspect, direction, 0.6, 1.2)
        : cmd.type === "frame-all"
          ? frameBox(sceneBox, ORBIT_FOV, aspect)
          : null;
    if (to) animation.current = { from: { position: camera.position.toArray(), target: target.toArray() }, to, start: performance.now() };
  });

  useFrame(() => {
    const a = animation.current;
    if (!a || !controls.current) return;
    const t = Math.min(1, (performance.now() - a.start) / ANIMATION_MS);
    const ease = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(new Vector3(...a.from.position), new Vector3(...a.to.position), ease);
    controls.current.target.lerpVectors(new Vector3(...a.from.target), new Vector3(...a.to.target), ease);
    controls.current.update();
    if (t >= 1) animation.current = null;
  });

  useProbe(() =>
    onProbe({ mode: "orbit", position: round(camera.position), target: round(controls.current?.target ?? new Vector3()), pixelsPerMetre: null }),
  );

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      maxPolarAngle={Math.PI / 2 - 0.04}
      minDistance={1.2}
      maxDistance={160}
    />
  );
}

function TopRig({ sceneBox, selectedBox, command, memory, onProbe }: RigProps) {
  const size = useThree((s) => s.size);
  const cameraRef = useRef<OrthographicCameraImpl>(null);
  const controls = useRef<MapControlsImpl>(null);
  const height = sceneBox.max.y + 50;

  const place = (centre: Vec3Tuple, zoom: number) => {
    const cam = cameraRef.current;
    if (!cam || !controls.current) return;
    cam.position.set(centre[0], height, centre[2]);
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
    controls.current.target.set(centre[0], 0, centre[2]);
    controls.current.update();
  };

  useLayoutEffect(() => {
    const view = memory.current.top ?? { centre: planView(sceneBox, size.width, size.height).position, zoom: planView(sceneBox, size.width, size.height).zoom };
    place(view.centre, view.zoom);
    const saved = memory.current;
    const cam = cameraRef.current;
    return () => {
      if (cam) saved.top = { centre: cam.position.toArray(), zoom: cam.zoom };
    };
    // Only on entering top mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useCommand(command, (cmd) => {
    if (cmd.type === "frame-all") {
      const view = planView(sceneBox, size.width, size.height);
      place(view.position, view.zoom);
    } else if (cmd.type === "frame-selection" && selectedBox) {
      const view = planView(selectedBox.clone().expandByScalar(2), size.width, size.height);
      place(view.position, Math.min(view.zoom, 120));
    }
  });

  useProbe(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    onProbe({ mode: "top", position: round(cam.position), target: round(controls.current?.target ?? new Vector3()), pixelsPerMetre: Math.round(cam.zoom * 100) / 100 });
  });

  return (
    <>
      <OrthographicCamera makeDefault ref={cameraRef} up={PLAN_UP} near={0.1} far={height + 60} position={[0, height, 0]} />
      <MapControls ref={controls} makeDefault enableRotate={false} screenSpacePanning zoomToCursor minZoom={2} maxZoom={400} />
    </>
  );
}

const WALK_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);

function WalkRig({ selectedBox, command, memory, onProbe, world }: RigProps & { world: WalkWorld }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const element = useThree((s) => s.gl.domElement);
  const pose = useRef<WalkPose>(
    memory.current.walk ?? (selectedBox ? walkPoseFacing(rectOf(selectedBox), world) : walkStart(world)),
  );
  const keys = useRef(new Set<string>());

  useLayoutEffect(() => {
    camera.fov = WALK_FOV;
    camera.near = 0.05;
    camera.updateProjectionMatrix();
    const saved = memory.current;
    return () => {
      saved.walk = pose.current;
    };
  }, [camera, memory]);

  useEffect(() => {
    const pressed = keys.current;
    const down = (e: KeyboardEvent) => {
      if (!WALK_KEYS.has(e.code) || isTyping(e.target)) return;
      pressed.add(e.code);
      if (e.code.startsWith("Arrow")) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => pressed.delete(e.code);
    const clear = () => pressed.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    // Drag anywhere in the viewport to look around; no pointer lock, so Esc and the UI always work.
    let last: { x: number; y: number } | null = null;
    const press = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!last || e.buttons === 0) return;
      pose.current = look(pose.current, -(e.clientX - last.x) * 0.004, -(e.clientY - last.y) * 0.004);
      last = { x: e.clientX, y: e.clientY };
    };
    const release = () => {
      last = null;
    };
    element.addEventListener("pointerdown", press);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      element.removeEventListener("pointerdown", press);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      pressed.clear();
    };
  }, [element]);

  useCommand(command, (cmd) => {
    if (cmd.type === "reset-walk" || cmd.type === "frame-all") pose.current = walkStart(world);
    else if (cmd.type === "frame-selection" && selectedBox) pose.current = walkPoseFacing(rectOf(selectedBox), world);
  });

  useFrame((_, dt) => {
    const k = keys.current;
    const axis = (plus: string[], minus: string[]) => (plus.some((c) => k.has(c)) ? 1 : 0) - (minus.some((c) => k.has(c)) ? 1 : 0);
    pose.current = stepWalker(
      pose.current,
      {
        forward: axis(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]),
        strafe: axis(["KeyD"], ["KeyA"]),
        turn: axis(["ArrowRight", "KeyE"], ["ArrowLeft", "KeyQ"]),
        run: k.has("ShiftLeft") || k.has("ShiftRight"),
      },
      Math.min(dt, 0.1),
      world,
    );
    const { x, z, yaw, pitch } = pose.current;
    camera.position.set(x, EYE_HEIGHT_M, z);
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  });

  useProbe(() => {
    const ahead = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
    onProbe({ mode: "walk", position: round(camera.position), target: round(ahead), pixelsPerMetre: null });
  });
  return null;
}
