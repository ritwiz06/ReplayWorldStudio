// Building blocks for the procedural catalog models: parts are simple solids with a material
// key; `assemble` merges them into one mesh per material, moves the origin to the bounding-box
// bottom-centre and returns a scene ready for GLB export. Everything is in metres, +Y up,
// with the equipment's front facing +Z (the conventions recorded in the catalog contract).
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Shape,
  TorusGeometry,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type V3 = [x: number, y: number, z: number];

export interface MaterialSpec {
  color: string;
  metalness: number;
  roughness: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
}

/** Industrial PBR palette shared by every catalog model. */
export const PALETTE = {
  paint_light_grey: { color: "#c9cdcf", metalness: 0.1, roughness: 0.55 }, // RAL 7035-like
  paint_anthracite: { color: "#3a4045", metalness: 0.25, roughness: 0.5 }, // RAL 7016-like
  safety_yellow: { color: "#e5ad0c", metalness: 0.1, roughness: 0.45 },
  aluminium: { color: "#b9bfc5", metalness: 0.85, roughness: 0.32 },
  steel_dark: { color: "#555b62", metalness: 0.7, roughness: 0.42 },
  rubber_black: { color: "#1d1e20", metalness: 0, roughness: 0.88 },
  polycarbonate: { color: "#d8ebf5", metalness: 0, roughness: 0.06, opacity: 0.2 },
  hmi_screen: { color: "#0b1620", metalness: 0, roughness: 0.2, emissive: "#3c8fe0", emissiveIntensity: 0.55 },
  signal_green: { color: "#1c8a3c", metalness: 0, roughness: 0.3, emissive: "#28e060", emissiveIntensity: 0.9 },
  signal_amber: { color: "#a86d0c", metalness: 0, roughness: 0.3 },
  signal_red: { color: "#8a1c1c", metalness: 0, roughness: 0.3 },
  signal_white: { color: "#e8eef2", metalness: 0, roughness: 0.3, emissive: "#ffffff", emissiveIntensity: 0.5 },
  estop_red: { color: "#c3122a", metalness: 0, roughness: 0.38 },
  motor_blue: { color: "#2d5c8a", metalness: 0.35, roughness: 0.42 },
  cardboard: { color: "#b98c5e", metalness: 0, roughness: 0.92 },
  packing_tape: { color: "#d9c79f", metalness: 0, roughness: 0.55 },
  edge_protector: { color: "#e4e1d8", metalness: 0, roughness: 0.8 },
  pallet_wood: { color: "#c49a62", metalness: 0, roughness: 0.9 },
  label_black: { color: "#141414", metalness: 0, roughness: 0.6 },
  wood_top: { color: "#b5895a", metalness: 0, roughness: 0.72 }, // beech-like bench tops
  rack_blue: { color: "#2f5d9e", metalness: 0.3, roughness: 0.45 }, // shelving uprights
  rack_orange: { color: "#d8641c", metalness: 0.25, roughness: 0.45 }, // shelving beams
} satisfies Record<string, MaterialSpec>;

export type MaterialKey = keyof typeof PALETTE;

interface Part {
  geometry: BufferGeometry;
  material: MaterialKey;
}

export class ModelBuilder {
  readonly parts: Part[] = [];

  private add(geometry: BufferGeometry, material: MaterialKey, at: V3, rotation?: V3): this {
    const matrix = new Matrix4().compose(
      new Vector3(...at),
      new Quaternion().setFromEuler(new Euler(...(rotation ?? [0, 0, 0]))),
      new Vector3(1, 1, 1),
    );
    this.parts.push({ geometry: geometry.applyMatrix4(matrix), material });
    return this;
  }

  /** Axis-aligned box of `size` centred at `at`; a radius rounds its edges. */
  box(material: MaterialKey, size: V3, at: V3, radius = 0, rotation?: V3): this {
    const [w, h, d] = size;
    const r = Math.min(radius, w / 2, h / 2, d / 2);
    const geometry = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new BoxGeometry(w, h, d);
    return this.add(geometry, material, at, rotation);
  }

  /** Cylinder of `length` along `axis`, centred at `at`. */
  cylinder(material: MaterialKey, radius: number, length: number, at: V3, axis: "x" | "y" | "z", segments = 24): this {
    const rotation: V3 = axis === "x" ? [0, 0, Math.PI / 2] : axis === "z" ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    return this.add(new CylinderGeometry(radius, radius, length, segments), material, at, rotation);
  }

  /** Ring of `radius` with tube `tube`, standing in the X-Y plane, centred at `at`. */
  torus(material: MaterialKey, radius: number, tube: number, at: V3, rotation?: V3): this {
    return this.add(new TorusGeometry(radius, tube, 8, 24), material, at, rotation);
  }

  /** Equilateral triangle plate of side `side` and `depth` facing +Z, centred at `at`. */
  triangle(material: MaterialKey, side: number, depth: number, at: V3): this {
    const h = (side * Math.sqrt(3)) / 2;
    const shape = new Shape();
    shape.moveTo(-side / 2, -h / 3);
    shape.lineTo(side / 2, -h / 3);
    shape.lineTo(0, (2 * h) / 3);
    shape.closePath();
    const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geometry.translate(0, 0, -depth / 2);
    return this.add(geometry, material, at);
  }
}

export interface AssembledModel {
  scene: Scene;
  bounds: { min: V3; max: V3 };
  materials: MaterialKey[];
  triangles: number;
}

/** Merge parts per material and move the origin to the bounding-box bottom-centre. */
export function assemble(name: string, builder: ModelBuilder, metadata: Record<string, string>): AssembledModel {
  const byMaterial = new Map<MaterialKey, BufferGeometry[]>();
  for (const { geometry, material } of builder.parts) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const attribute of Object.keys(flat.attributes)) {
      if (attribute !== "position" && attribute !== "normal") flat.deleteAttribute(attribute);
    }
    byMaterial.set(material, [...(byMaterial.get(material) ?? []), flat]);
  }

  const merged = [...byMaterial].map(([material, geometries]) => {
    const geometry = mergeGeometries(geometries);
    if (!geometry) throw new Error(`${name}: could not merge ${material} parts`);
    return { material, geometry: mergeVertices(geometry, 1e-6) };
  });

  const box = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
  for (const { geometry } of merged) {
    geometry.computeBoundingBox();
    box.min.min(geometry.boundingBox!.min);
    box.max.max(geometry.boundingBox!.max);
  }
  const shift = new Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);

  const scene = new Scene();
  scene.name = name;
  scene.userData = metadata;
  let triangles = 0;
  const final = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
  for (const { material, geometry } of merged) {
    geometry.translate(shift.x, shift.y, shift.z);
    geometry.computeBoundingBox();
    final.min.min(geometry.boundingBox!.min);
    final.max.max(geometry.boundingBox!.max);
    triangles += (geometry.index ? geometry.index.count : geometry.attributes.position!.count) / 3;
    const spec: MaterialSpec = PALETTE[material];
    const mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({
        name: material,
        color: spec.color,
        metalness: spec.metalness,
        roughness: spec.roughness,
        emissive: spec.emissive ?? "#000000",
        emissiveIntensity: spec.emissiveIntensity ?? 1,
        transparent: spec.opacity !== undefined,
        opacity: spec.opacity ?? 1,
      }),
    );
    mesh.name = material;
    scene.add(mesh);
  }
  const round = (v: number) => Math.round(v * 1e6) / 1e6 + 0; // + 0 normalises -0
  return {
    scene,
    bounds: {
      min: [round(final.min.x), round(final.min.y), round(final.min.z)],
      max: [round(final.max.x), round(final.max.y), round(final.max.z)],
    },
    materials: merged.map((m) => m.material),
    triangles,
  };
}
