// "Run a day" in the 3D view (SIM-03): simple worker figures where the run's events put them,
// items in each station's queues, inside it or carried, and a ring around each station
// coloured by its state. The labels are ordinary page elements over the view (RunLabels); the
// projector here moves them to their figures on every frame. Everything is read from the run at the playback clock's
// moment; nothing here creates, moves or completes an item. The equipment models stay as they
// are: their insides are not simulated, only the station's state is shown.
import type { SceneObject } from "@replay-world/contracts";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type RefObject, useMemo } from "react";
import { Vector3 } from "three";
import { footprint } from "../checks/geometry";
import { type PlaybackClock, useClockTime } from "../hooks/usePlayback";
import { STATE_COLOUR } from "../run/words";
import type { Replay, StationFrame } from "../run/replay";

const WORKER_COLOURS = ["#4cc9f0", "#f78fb3", "#b5e48c", "#ffd166", "#c39bff", "#ff9f68"];
const ITEM_COLOUR = "#e9c46a";
const none = () => null;

interface Props {
  replay: Replay;
  clock: PlaybackClock;
  objects: readonly SceneObject[];
}

export function RunOverlay({ replay, clock, objects }: Props) {
  const t = useClockTime(clock);
  const frame = useMemo(() => replay.frame(t), [replay, t]);
  const byId = new Map(objects.map((o) => [o.id, o]));
  return (
    <group name="run-overlay">
      {frame.stations.map((s) => {
        const object = byId.get(s.objectId);
        return object ? <StationMarks key={s.id} station={s} object={object} /> : null;
      })}
      {frame.workers.map((w, i) => (
        <group key={w.id} position={[w.at.x, 0, w.at.z]} rotation={[0, w.heading, 0]}>
          <mesh raycast={none} position={[0, 0.55, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.24, 1.1, 16]} />
            <meshStandardMaterial color={WORKER_COLOURS[i % WORKER_COLOURS.length]!} roughness={0.6} />
          </mesh>
          <mesh raycast={none} position={[0, 1.3, 0]} castShadow>
            <sphereGeometry args={[0.15, 16, 12]} />
            <meshStandardMaterial color="#f1d3b3" roughness={0.7} />
          </mesh>
          {w.carrying && (
            <mesh raycast={none} position={[0, 0.85, 0.32]} castShadow>
              <boxGeometry args={[0.36, 0.26, 0.3]} />
              <meshStandardMaterial color={ITEM_COLOUR} roughness={0.8} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

function StationMarks({ station, object }: { station: StationFrame; object: SceneObject }) {
  const colour = station.supply ? "#7cc4ff" : STATE_COLOUR[station.state];
  const centre = object.transform.position_m;
  const ring = footprint(object).map((p) => {
    // A little outside the footprint, so the ring shows around the model.
    const dx = p.x - centre.x;
    const dz = p.z - centre.z;
    const d = Math.hypot(dx, dz) || 1;
    return [p.x + (dx / d) * 0.15, 0.05, p.z + (dz / d) * 0.15] as [number, number, number];
  });
  const top = object.dimensions.height.value_m;
  // Queues beside the access point: input on one side, output on the other.
  const ax = station.at.x - centre.x;
  const az = station.at.z - centre.z;
  const len = Math.hypot(ax, az) || 1;
  const side = { x: -az / len, z: ax / len };
  const stack = (count: number, sign: number) =>
    Array.from({ length: Math.min(count, 6) }, (_, i) => [station.at.x + side.x * 0.45 * sign, 0.15 + i * 0.27, station.at.z + side.z * 0.45 * sign] as [number, number, number]);
  return (
    <group>
      <Line raycast={none} points={[...ring, ring[0]!]} color={colour} lineWidth={4} depthTest={false} renderOrder={14} />
      {stack(station.input, 1).map((p, i) => (
        <mesh raycast={none} key={`in${i}`} position={p} castShadow>
          <boxGeometry args={[0.3, 0.24, 0.3]} />
          <meshStandardMaterial color={ITEM_COLOUR} roughness={0.8} />
        </mesh>
      ))}
      {stack(station.output, -1).map((p, i) => (
        <mesh raycast={none} key={`out${i}`} position={p} castShadow>
          <boxGeometry args={[0.3, 0.24, 0.3]} />
          <meshStandardMaterial color="#d4a373" roughness={0.8} />
        </mesh>
      ))}
      {station.hasItem && (
        <mesh raycast={none} position={[centre.x, top + 0.18, centre.z]}>
          <boxGeometry args={[0.34, 0.26, 0.34]} />
          <meshStandardMaterial color={ITEM_COLOUR} emissive={colour} emissiveIntensity={0.25} roughness={0.8} />
        </mesh>
      )}
    </group>
  );
}

/** Where each run label belongs in the view: "w:<worker id>" above a worker's head, "s:<station
 * id>" above a station. Moves the label elements in `layer` (plain page elements over the
 * canvas) on every rendered frame, so they follow both the run and the camera. */
export function RunLabelProjector({ replay, clock, objects, layer }: Props & { layer: RefObject<HTMLDivElement | null> }) {
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const root = layer.current;
    if (!root) return;
    const frame = replay.frame(clock.now());
    const anchors = new Map<string, [number, number, number]>();
    for (const w of frame.workers) anchors.set(`w:${w.id}`, [w.at.x, 1.62, w.at.z]);
    for (const s of frame.stations) {
      const object = objects.find((o) => o.id === s.objectId);
      if (object) anchors.set(`s:${s.id}`, [object.transform.position_m.x, Math.max(object.dimensions.height.value_m + 1.3, 2.6), object.transform.position_m.z]);
    }
    // Most important first; a label that would overlap one already shown is hidden this frame.
    const elements = (Array.from(root.children) as HTMLElement[]).sort((a, b) => Number(a.dataset.priority ?? 9) - Number(b.dataset.priority ?? 9));
    const shown: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const el of elements) {
      const anchor = anchors.get(el.dataset.anchor ?? "");
      if (!anchor) {
        el.style.visibility = "hidden";
        continue;
      }
      v.set(...anchor).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      const half = { w: el.offsetWidth / 2 + 3, h: el.offsetHeight / 2 + 2 };
      const rect = { x0: x - half.w, y0: y - half.h, x1: x + half.w, y1: y + half.h };
      const behind = v.z > 1 || v.z < -1;
      const overlaps = shown.some((r) => rect.x0 < r.x1 && rect.x1 > r.x0 && rect.y0 < r.y1 && rect.y1 > r.y0);
      const visible = !behind && !overlaps;
      el.style.visibility = visible ? "visible" : "hidden";
      el.dataset.shown = visible ? "true" : "false";
      if (visible) shown.push(rect);
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  });
  return null;
}
