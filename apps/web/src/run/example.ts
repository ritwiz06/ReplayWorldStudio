// The sample hall's example shift (Run a day): batches are taken from Rack A in the aisle,
// mixed, formed on Machine B and packed at the packing table, by three workers over an eight-hour
// shift with two breaks and one planned changeover. Every value is an example assumption made up
// for this synthetic hall; none is read from the drawing, and none describes a real factory.
import type { OperatingValue, ProcessModel } from "@replay-world/contracts";

const ex = (value: number): OperatingValue => ({ value, basis: "example" });
const carry = (id: string, from: string, to: string) => ({
  id,
  from_station: from,
  to_station: to,
  method: "carry" as const,
  item_width_m: ex(0.6),
  allowance_m: ex(0.1),
  speed_m_s: ex(1.0),
  handling_s: ex(10),
});
const worker = (id: string, name: string, tasks: [string, ...string[]]) => ({ id, name, tasks, walk_speed_m_s: ex(1.2), width_m: ex(0.8) });

export const SAMPLE_PROCESS: ProcessModel = {
  format: "rws-process/1",
  name: "Example shift: mixing, forming and packing",
  item_name: "batch",
  example_note:
    "An example to show how Run a day works. Every time, capacity, speed, break and worker assignment here is an assumption made up for this synthetic hall: not data from a real factory, and nothing is read from the drawing.",
  shift: {
    start_clock_s: ex(6 * 3600),
    duration_s: ex(8 * 3600),
    breaks: [
      { id: "break-morning", name: "Morning break", start_s: ex(3 * 3600), duration_s: ex(15 * 60) },
      { id: "break-lunch", name: "Lunch", start_s: ex(5.5 * 3600), duration_s: ex(30 * 60) },
    ],
  },
  stations: [
    {
      id: "rack-a",
      object_id: "obj-dxf-106",
      name: "Rack A (material)",
      role: "supply",
      access_m: { x: -3.5, z: 1.5 },
      access_basis: "example",
      worker_s: null,
      machine_s: null,
      input_capacity: null,
      output_capacity: null,
      planned_stops: [],
      random_stops: null,
    },
    {
      id: "mixer",
      object_id: "obj-dxf-10a",
      name: "Mixer",
      role: "process",
      access_m: { x: 1.591, z: 1.591 },
      access_basis: "example",
      worker_s: ex(60),
      machine_s: ex(150),
      input_capacity: ex(1),
      output_capacity: ex(1),
      planned_stops: [],
      random_stops: null,
    },
    {
      id: "machine-b",
      object_id: "obj-dxf-111",
      name: "Machine B",
      role: "process",
      access_m: { x: 0, z: 1.1 },
      access_basis: "example",
      worker_s: ex(20),
      machine_s: ex(120),
      input_capacity: ex(2),
      output_capacity: ex(2),
      planned_stops: [{ id: "changeover", reason: "Changeover (example)", start_s: ex(4 * 3600), duration_s: ex(20 * 60) }],
      random_stops: null,
    },
    {
      id: "packing",
      object_id: "obj-dxf-113",
      name: "Packing table",
      role: "process",
      access_m: { x: 0, z: -0.9 },
      access_basis: "example",
      worker_s: ex(240),
      machine_s: ex(0),
      input_capacity: ex(4),
      output_capacity: ex(1),
      planned_stops: [],
      random_stops: null,
    },
  ],
  transfers: [carry("carry-material", "rack-a", "mixer"), carry("carry-mixed", "mixer", "machine-b"), carry("carry-formed", "machine-b", "packing")],
  workers: [
    worker("worker-1", "Worker 1 (mixing)", ["transfer:carry-mixed", "station:mixer", "transfer:carry-material"]),
    worker("worker-2", "Worker 2 (forming)", ["transfer:carry-formed", "station:machine-b"]),
    worker("worker-3", "Worker 3 (packing)", ["station:packing"]),
  ],
  seed: 1,
};
