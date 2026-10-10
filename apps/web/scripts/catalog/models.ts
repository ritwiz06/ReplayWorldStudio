// Original procedural equipment models for the catalog. Sizes are in metres and modelled on
// common industrial proportions, but they are illustrations of generic equipment, not any
// manufacturer's product. Each builder positions parts with +Y up and the front facing +Z;
// `assemble` (kit.ts) later moves the origin to the exact bounding-box bottom-centre.
import { type MaterialKey, ModelBuilder } from "./kit.ts";

const SIDES = [-1, 1] as const;

/** 3 m flat belt conveyor with guide rails, underslung gearmotor and pull-cord stops. */
function beltConveyor(): ModelBuilder {
  const m = new ModelBuilder();
  for (const s of SIDES) m.box("aluminium", [3.0, 0.12, 0.05], [0, 0.8, s * 0.335], 0.008); // side frames
  m.box("rubber_black", [2.9, 0.012, 0.6], [0, 0.856, 0], 0.004); // carrying belt, top at 0.862 m
  m.box("rubber_black", [2.8, 0.008, 0.58], [0, 0.752, 0]); // return belt
  for (const x of [-1.445, 1.445]) m.cylinder("aluminium", 0.045, 0.62, [x, 0.81, 0], "z"); // drums
  for (const x of [-1.1, -0.55, 0, 0.55, 1.1]) m.cylinder("steel_dark", 0.02, 0.6, [x, 0.765, 0], "z", 16); // return idlers
  for (const s of SIDES) {
    for (const x of [-1.3, -0.65, 0, 0.65, 1.3]) m.box("aluminium", [0.02, 0.07, 0.02], [x, 0.895, s * 0.36]);
    m.box("aluminium", [2.96, 0.025, 0.012], [0, 0.9375, s * 0.36], 0.004); // guide rail, top at 0.95 m
  }
  for (const x of [-1.3, 0, 1.3]) {
    for (const s of SIDES) {
      m.box("steel_dark", [0.045, 0.71, 0.045], [x, 0.385, s * 0.3], 0.004); // legs 0.03–0.74 m
      m.cylinder("rubber_black", 0.032, 0.03, [x, 0.015, s * 0.3], "y"); // levelling feet
    }
    m.box("steel_dark", [0.04, 0.04, 0.555], [x, 0.24, 0]); // cross brace
  }
  for (const s of SIDES) m.box("steel_dark", [2.6, 0.035, 0.035], [0, 0.18, s * 0.3]); // stringers
  // Underslung gearmotor near the discharge (+X) end.
  m.cylinder("motor_blue", 0.08, 0.3, [0.95, 0.58, 0.12], "x");
  for (const x of [0.86, 0.92, 0.98, 1.04]) m.cylinder("motor_blue", 0.087, 0.012, [x, 0.58, 0.12], "x");
  m.box("paint_anthracite", [0.12, 0.08, 0.1], [0.95, 0.68, 0.12], 0.006); // terminal box
  m.box("paint_anthracite", [0.17, 0.2, 0.17], [1.19, 0.6, 0.12], 0.01); // gearbox
  for (const x of [-1.478, 1.478]) m.box("safety_yellow", [0.03, 0.13, 0.64], [x, 0.81, 0], 0.006); // nip guards
  for (const s of SIDES) {
    m.box("safety_yellow", [0.08, 0.1, 0.05], [-1.22, 0.85, s * 0.39], 0.008); // pull-cord switch
    m.cylinder("estop_red", 0.004, 2.5, [0.05, 0.875, s * 0.39], "x", 8); // pull cord
    m.box("safety_yellow", [0.03, 0.04, 0.03], [1.3, 0.875, s * 0.39]); // cord anchor
  }
  return m;
}

/** Guarded machine cell: machine bed, yellow guard frame with polycarbonate panels, internal
 * gantry, front HMI with e-stop, rear control box and a stack light. */
function guardedMachineCell(): ModelBuilder {
  const m = new ModelBuilder();
  m.box("paint_anthracite", [2.0, 0.78, 1.4], [0, 0.46, 0], 0.02); // bed 0.07–0.85 m
  m.box("rubber_black", [1.9, 0.07, 1.3], [0, 0.035, 0]); // recessed plinth
  for (const x of [-0.92, 0.92]) for (const s of SIDES) m.cylinder("steel_dark", 0.04, 0.07, [x, 0.035, s * 0.62], "y");
  m.box("paint_light_grey", [2.0, 0.02, 1.4], [0, 0.86, 0], 0.005); // bed top plate, 0.87 m
  for (const s of SIDES) {
    for (const x of [-0.5, 0.5]) {
      m.box("paint_light_grey", [0.9, 0.6, 0.012], [x, 0.45, s * 0.701], 0.006); // service doors
      m.box("aluminium", [0.02, 0.16, 0.03], [x - Math.sign(x) * 0.38, 0.47, s * 0.72], 0.005);
    }
  }
  // Transport belt running through the cell at conveyor height.
  m.box("rubber_black", [2.0, 0.012, 0.6], [0, 0.876, 0], 0.004);
  for (const s of SIDES) m.box("aluminium", [2.0, 0.06, 0.04], [0, 0.9, s * 0.33], 0.006);
  m.box("aluminium", [0.4, 0.06, 0.35], [0.15, 0.912, 0], 0.006); // work fixture

  // Guard frame and panels: the side openings above the belt let product in and out.
  const gy0 = 0.87;
  const gy1 = 2.15;
  for (const x of [-0.975, 0, 0.975]) {
    for (const s of SIDES) m.box("safety_yellow", [0.05, gy1 - gy0, 0.05], [x, (gy0 + gy1) / 2, s * 0.675], 0.008);
  }
  for (const y of [gy0 + 0.025, gy1 - 0.025, 1.2]) {
    if (y !== 1.2) for (const s of SIDES) m.box("safety_yellow", [2.0, 0.05, 0.05], [0, y, s * 0.675], 0.008);
    for (const x of [-0.975, 0.975]) m.box("safety_yellow", [0.05, 0.05, 1.4], [x, y, 0], 0.008);
  }
  for (const s of SIDES) {
    for (const x of [-0.4875, 0.4875]) m.box("polycarbonate", [0.9, 1.18, 0.008], [x, 1.51, s * 0.675]);
  }
  for (const x of [-0.975, 0.975]) m.box("polycarbonate", [0.008, 0.9, 1.3], [x, 1.65, 0]);

  // Internal gantry, visible through the guards.
  for (const x of [-0.7, 0.7]) m.box("aluminium", [0.08, 0.95, 0.08], [x, 1.345, -0.35], 0.006);
  m.box("aluminium", [1.52, 0.12, 0.12], [0, 1.88, -0.35], 0.01);
  m.box("rubber_black", [0.9, 0.05, 0.06], [-0.25, 1.965, -0.35], 0.01); // cable chain
  m.box("paint_anthracite", [0.22, 0.22, 0.2], [0.15, 1.88, -0.22], 0.015); // carriage
  m.cylinder("aluminium", 0.035, 0.55, [0.15, 1.52, -0.15], "y"); // vertical ram
  m.cylinder("steel_dark", 0.06, 0.12, [0.15, 1.19, -0.15], "y"); // tool head
  m.cylinder("steel_dark", 0.015, 0.08, [0.15, 1.09, -0.15], "y"); // tool

  // Rear control box.
  m.box("paint_light_grey", [0.7, 0.95, 0.22], [-0.45, 1.36, -0.81], 0.012);
  m.box("paint_anthracite", [0.035, 0.15, 0.03], [-0.15, 1.36, -0.935], 0.006);

  // Front HMI on a swing arm, with start, reset and emergency stop.
  m.box("steel_dark", [0.05, 0.05, 0.16], [0.83, 1.45, 0.76], 0.006);
  m.box("paint_anthracite", [0.44, 0.32, 0.07], [0.65, 1.45, 0.865], 0.012);
  m.box("hmi_screen", [0.36, 0.22, 0.006], [0.65, 1.47, 0.9]);
  m.box("paint_anthracite", [0.44, 0.1, 0.07], [0.65, 1.23, 0.865], 0.012);
  m.cylinder("signal_green", 0.018, 0.02, [0.5, 1.23, 0.905], "z", 16);
  m.cylinder("paint_light_grey", 0.018, 0.02, [0.58, 1.23, 0.905], "z", 16);
  m.box("safety_yellow", [0.08, 0.08, 0.01], [0.77, 1.23, 0.905], 0.004);
  m.cylinder("estop_red", 0.028, 0.035, [0.77, 1.23, 0.925], "z", 20);

  // Guard door handle and interlock, warning sign.
  m.box("aluminium", [0.025, 0.32, 0.03], [-0.08, 1.5, 0.705], 0.008);
  m.box("estop_red", [0.05, 0.08, 0.04], [0.06, 1.75, 0.71], 0.005);
  m.triangle("label_black", 0.13, 0.004, [-0.49, 1.85, 0.682]);
  m.triangle("safety_yellow", 0.11, 0.004, [-0.49, 1.85, 0.6845]);

  // Stack light on the rear-left post: green (lit), amber, red.
  m.cylinder("steel_dark", 0.012, 0.12, [-0.975, 2.21, -0.675], "y", 12);
  const lamps: [MaterialKey, number][] = [["signal_green", 2.3], ["signal_amber", 2.36], ["signal_red", 2.42]];
  for (const [material, y] of lamps) m.cylinder(material, 0.035, 0.06, [-0.975, y, -0.675], "y", 20);
  m.cylinder("steel_dark", 0.035, 0.02, [-0.975, 2.46, -0.675], "y", 20);
  return m;
}

/** 800 mm floor-standing electrical cabinet with isolator, pilot lights and filter fan. */
function electricalCabinet(): ModelBuilder {
  const m = new ModelBuilder();
  m.box("paint_anthracite", [0.8, 0.1, 0.5], [0, 0.05, 0], 0.004); // plinth
  m.box("paint_light_grey", [0.8, 1.9, 0.48], [0, 1.05, -0.01], 0.012); // body
  m.box("paint_anthracite", [0.772, 1.852, 0.01], [0, 1.05, 0.233]); // door seam
  m.box("paint_light_grey", [0.76, 1.84, 0.02], [0, 1.05, 0.24], 0.006); // door
  for (const y of [0.4, 1.7]) m.box("paint_anthracite", [0.02, 0.08, 0.02], [-0.39, y, 0.25]); // hinges
  m.box("paint_anthracite", [0.035, 0.2, 0.03], [0.32, 1.05, 0.265], 0.008); // swing handle
  m.cylinder("aluminium", 0.011, 0.012, [0.32, 1.19, 0.256], "z", 16); // lock
  m.box("safety_yellow", [0.12, 0.12, 0.01], [0, 1.52, 0.255], 0.004); // main isolator
  m.cylinder("estop_red", 0.03, 0.02, [0, 1.52, 0.265], "z", 20);
  m.box("estop_red", [0.025, 0.1, 0.022], [0, 1.52, 0.28], 0.006);
  const pilots: [MaterialKey, number][] = [["signal_white", -0.12], ["signal_green", 0], ["signal_amber", 0.12]];
  for (const [material, x] of pilots) m.cylinder(material, 0.013, 0.014, [x, 1.75, 0.257], "z", 16);
  m.box("paint_anthracite", [0.3, 0.3, 0.018], [0, 0.42, 0.259], 0.01); // filter fan
  for (let i = 0; i < 6; i++) m.box("rubber_black", [0.24, 0.012, 0.01], [0, 0.32 + i * 0.04, 0.27]);
  m.triangle("label_black", 0.12, 0.003, [0, 1.88, 0.2515]);
  m.triangle("safety_yellow", 0.1, 0.003, [0, 1.88, 0.2545]);
  m.box("paint_anthracite", [0.5, 0.012, 0.3], [0, 2.006, 0]); // gland plate
  for (const x of [-0.3, 0.3]) m.torus("steel_dark", 0.03, 0.008, [x, 2.04, 0]); // lifting eyes
  return m;
}

/** Euro-style 1200 × 800 mm wooden pallet with three layers of taped cartons. */
function palletOfCartons(): ModelBuilder {
  const m = new ModelBuilder();
  for (const z of [-0.35, 0, 0.35]) {
    m.box("pallet_wood", [1.2, 0.022, 0.1], [0, 0.011, z]); // bottom boards
    m.box("pallet_wood", [1.2, 0.022, 0.1], [0, 0.111, z]); // stringer boards
    for (const x of [-0.5275, 0, 0.5275]) m.box("pallet_wood", [0.145, 0.078, z === 0 ? 0.145 : 0.1], [x, 0.061, z]);
  }
  for (const [z, w] of [[-0.3275, 0.145], [-0.1625, 0.1], [0, 0.145], [0.1625, 0.1], [0.3275, 0.145]]) {
    m.box("pallet_wood", [1.2, 0.022, w!], [0, 0.133, z!]); // top deck, 0.144 m
  }
  const size = 0.392;
  const height = 0.29;
  for (let layer = 0; layer < 3; layer++) {
    const y = 0.144 + height / 2 + layer * (height + 0.002);
    for (const x of [-0.4, 0, 0.4]) {
      for (const z of [-0.2, 0.2]) {
        m.box("cardboard", [size, height, size], [x, y, z], 0.008);
        m.box("packing_tape", [size + 0.002, 0.003, 0.05], [x, y + height / 2, z]);
        for (const s of SIDES) m.box("packing_tape", [0.003, 0.07, 0.05], [x + s * (size / 2), y + height / 2 - 0.035, z]);
      }
    }
  }
  const stack = 3 * height + 0.004;
  for (const sx of SIDES) {
    for (const sz of SIDES) {
      const y = 0.144 + stack / 2;
      m.box("edge_protector", [0.05, stack, 0.005], [sx * 0.571, y, sz * 0.3985]);
      m.box("edge_protector", [0.005, stack, 0.05], [sx * 0.5985, y, sz * 0.371]);
    }
  }
  for (const x of [-0.3, 0.3]) {
    m.box("label_black", [0.02, 0.004, 0.8], [x, 0.144 + stack + 0.002, 0]); // straps over the top
    for (const s of SIDES) m.box("label_black", [0.02, stack, 0.004], [x, 0.144 + stack / 2, s * 0.4]);
  }
  return m;
}

export interface CatalogModelDefinition {
  key: string;
  name: string;
  build: () => ModelBuilder;
}

export const MODELS: CatalogModelDefinition[] = [
  { key: "belt-conveyor-3m", name: "Belt conveyor, 3 m", build: beltConveyor },
  { key: "guarded-machine-cell", name: "Guarded machine cell", build: guardedMachineCell },
  { key: "electrical-cabinet-800", name: "Electrical cabinet, 800 mm", build: electricalCabinet },
  { key: "pallet-cartons", name: "Pallet with cartons", build: palletOfCartons },
];
