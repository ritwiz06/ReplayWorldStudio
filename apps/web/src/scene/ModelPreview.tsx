// A small 3D preview of a generated model. The bytes come from the API's preview build and are
// checked exactly like catalog models (sha256 and bounds against the returned record) before
// anything is drawn, so the preview shows the same verified file that would be stored.
//
// One canvas lives for the whole review: while a corrected model is being built, the previous
// one stays on screen (marked as building), and the camera re-frames when the size changes.
import type { GeneratedModel } from "@replay-world/contracts";
import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { BoxGeometry, EdgesGeometry, type Group, LineBasicMaterial, LineSegments, PMREMGenerator } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { formatFixed } from "../editing/units";
import { modelExtents, type Vec3Tuple } from "./fit";
import { parseCatalogModel } from "./modelLoader";
import { type RevisionView, viewCamera } from "./views";

export type { RevisionView } from "./views";
interface Verified {
  key: string;
  template: Group;
  extents: Vec3Tuple;
}

function decode(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function Environment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    scene.environmentIntensity = 0.5;
    invalidate();
    return () => {
      scene.environment = null;
      environment.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}

/** Frame the whole model from the chosen view; again whenever its size or the view changes. */
function Frame({ extents, view }: { extents: Vec3Tuple; view: RevisionView }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  const [w, h, d] = extents;
  useEffect(() => {
    const { eye, target } = viewCamera(view, [w, h, d]);
    camera.position.set(...eye);
    camera.lookAt(...target);
    controls?.target.set(...target);
    controls?.update();
    invalidate();
  }, [camera, controls, invalidate, w, h, d, view]);
  return null;
}

/** A box to point out in the preview (a part a warning refers to); drawn on top, never stored. */
export interface Highlight {
  center: Vec3Tuple;
  size: Vec3Tuple;
}

/** A part that can be picked by clicking it in the preview (GEN-09). */
export interface Pickable extends Highlight {
  id: string;
}

/** Invisible boxes, one per part: the file merges parts by colour, so clicks are matched here. */
function Pickables({ parts, onPick }: { parts: readonly Pickable[]; onPick: (id: string) => void }) {
  return (
    <>
      {parts.map((p) => (
        <mesh
          key={p.id}
          position={p.center}
          onClick={(e) => {
            if (e.delta > 4) return; // a drag that turned the view, not a click
            e.stopPropagation(); // the nearest part only
            onPick(p.id);
          }}
        >
          <boxGeometry args={p.size} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ))}
    </>
  );
}

function Highlights({ boxes }: { boxes: readonly Highlight[] }) {
  const lines = useMemo(
    () =>
      boxes.map((b) => {
        const pad = Math.max(...b.size) * 0.08 + 0.01;
        const line = new LineSegments(
          new EdgesGeometry(new BoxGeometry(b.size[0] + pad, b.size[1] + pad, b.size[2] + pad)),
          new LineBasicMaterial({ color: "#ffb020", depthTest: false, transparent: true, opacity: 0.95 }),
        );
        line.position.set(...b.center);
        line.renderOrder = 10;
        return line;
      }),
    [boxes],
  );
  useEffect(
    () => () => {
      for (const l of lines) {
        l.geometry.dispose();
        (l.material as LineBasicMaterial).dispose();
      }
    },
    [lines],
  );
  return (
    <>
      {lines.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </>
  );
}

export function ModelPreview({
  model,
  busy,
  testId = "model-preview",
  view = "front-right",
  highlight = [],
  pickable = [],
  onPick,
}: {
  model: GeneratedModel | null;
  busy: boolean;
  testId?: string;
  view?: RevisionView;
  highlight?: readonly Highlight[];
  pickable?: readonly Pickable[];
  onPick?: (id: string) => void;
}) {
  const [shown, setShown] = useState<Verified | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const key = model?.visual.sha256 ?? "";

  useEffect(() => {
    if (!model?.glb_base64) return;
    let cancelled = false;
    void parseCatalogModel(decode(model.glb_base64), model.visual).then((result) => {
      if (cancelled) return;
      if (result.ok) setShown({ key, template: result.scene, extents: modelExtents(model.visual) });
      else setFailure({ key, message: result.failure.message });
    });
    return () => {
      cancelled = true;
    };
  }, [model, key]);

  const current = shown?.key === key;
  const failed = failure?.key === key && !current;
  const state = busy ? "building" : failed ? "failed" : current ? "ready" : "loading";
  const object = useMemo(() => shown?.template.clone(true) ?? null, [shown]);
  const extents = model ? modelExtents(model.visual) : null;
  const [w, h, d] = shown?.extents ?? [1, 1, 1];
  const reach = Math.max(w, h, d);

  return (
    <div
      className="model-preview"
      data-testid={testId}
      data-state={state}
      data-sha256={current ? key : ""}
      data-extents={extents ? extents.map((v) => formatFixed(v, 3)).join(",") : ""}
      data-view={view}
      data-highlights={highlight.length}
    >
      {object && shown && (
        <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 35, near: 0.01, far: 500 }}>
          <color attach="background" args={["#1f2329"]} />
          <Environment />
          <hemisphereLight args={["#e8edf2", "#4a4e53", 0.6]} />
          <directionalLight position={[reach * 2, reach * 3, reach * 2.5]} intensity={1.6} />
          <directionalLight position={[-reach * 2, reach, -reach * 2]} intensity={0.3} />
          <Grid position={[0, 0.001, 0]} cellSize={0.1} sectionSize={1} cellColor="#4a5058" sectionColor="#5e666f" fadeDistance={reach * 6} infiniteGrid />
          <primitive object={object} />
          <Highlights boxes={highlight} />
          {onPick && <Pickables parts={pickable} onPick={onPick} />}
          <OrbitControls makeDefault enableDamping={false} />
          <Frame extents={shown.extents} view={view} />
        </Canvas>
      )}
      {state !== "ready" && !failed && <p className="model-preview-status">{object ? "Updating the model…" : "Building the model…"}</p>}
      {failed && (
        <p className="model-preview-status status-error" role="alert">
          The preview could not be verified: {failure.message}
        </p>
      )}
      {extents && (
        <p className="model-preview-caption">
          {formatFixed(extents[0], 3)} × {formatFixed(extents[1], 3)} × {formatFixed(extents[2], 3)} m (W × H × D) · drag to turn
        </p>
      )}
    </div>
  );
}
