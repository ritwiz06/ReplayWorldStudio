"""Write the original synthetic DXF fixtures for IMP-01 / ONB-01 into fixtures/drawings/.

Every file is made here from code, deterministically: no real site, customer or vendor drawing
is involved. Run ``uv run python scripts/build_dxf_fixtures.py`` to (re)write them, or with
``--check`` to fail if a committed file differs from what this script writes.

* ``hall-mm.dxf`` - a dimensioned 24 m x 16 m hall in millimetres ($INSUNITS 4): wall outline,
  two columns, labelled equipment (one rotated, one L-shaped, one unlabelled), a walkway, a
  keep-clear zone, an open conveyor centre line, a title and a dimension.
* ``room-unitless.dxf`` - a 12 x 8 room whose header does not say its unit ($INSUNITS 0).
* ``cell-blocks-m.dxf`` - block instances in metres ($INSUNITS 6): plain, rotated, scaled,
  mirrored by scale and by extrusion, attributed, nested two deep, and one block whose own units
  (inches) differ from the drawing's.
* ``unsupported-mm.dxf`` - a small layout with geometry outside the subset: a circle, an arc,
  a spline, a hatch, a polyline with an arc segment, an array insert, an undefined block, a
  tilted polyline, a 3D face, a dimension and a paper-space line.
* ``warehouse-cm.dxf`` - made to fool the first reading (IMP-02): the site boundary is the largest
  outline, so it is proposed as the floor instead of the building; the header says millimetres
  but the geometry is in centimetres, which still reads as a plausible 6 m x 4 m, so no question
  is asked. A note gives a known length (column bays of 6.00 m). Also a round tank (circle), a
  door swing (arc), a title block and a drop zone drawn on the equipment layer.
* ``layout.dwg`` - not a drawing: a DWG signature and filler bytes, to check the DWG message.

``hall-mm.analysis.json`` and ``room-unitless.analysis.json`` are what the API's reader returns
for those two files (the web tests build worlds from them); ``--check`` also catches a change in
the reader's output.
"""

from __future__ import annotations

import math
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "drawings"

Pair = tuple[int, object]


def fmt(value: object) -> str:
    if isinstance(value, float):
        text = f"{value:.6f}".rstrip("0")
        return text + "0" if text.endswith(".") else text
    return str(value)


@dataclass
class Dxf:
    insunits: int | None
    measurement: int | None
    layers: list[str]
    block_units: dict[str, int] = field(default_factory=dict)
    blocks: list[tuple[str, tuple[float, float], list[list[Pair]]]] = field(default_factory=list)
    entities: list[list[Pair]] = field(default_factory=list)
    _handle: int = 0x100

    def handle(self) -> str:
        self._handle += 1
        return f"{self._handle:X}"

    def render(self) -> bytes:
        out: list[Pair] = [(999, "Synthetic test drawing - Replay World Studio fixtures")]
        out += [(0, "SECTION"), (2, "HEADER"), (9, "$ACADVER"), (1, "AC1015")]
        if self.insunits is not None:
            out += [(9, "$INSUNITS"), (70, self.insunits)]
        if self.measurement is not None:
            out += [(9, "$MEASUREMENT"), (70, self.measurement)]
        out += [(0, "ENDSEC"), (0, "SECTION"), (2, "TABLES")]
        out += [(0, "TABLE"), (2, "LAYER"), (70, len(self.layers))]
        for layer in self.layers:
            out += [
                (0, "LAYER"),
                (5, self.handle()),
                (2, layer),
                (70, 0),
                (62, 7),
                (6, "CONTINUOUS"),
            ]
        out += [(0, "ENDTAB"), (0, "TABLE"), (2, "BLOCK_RECORD")]
        for name, _, _ in self.blocks:
            out += [(0, "BLOCK_RECORD"), (5, self.handle()), (2, name)]
            out += [(70, self.block_units.get(name, 0))]
        out += [(0, "ENDTAB"), (0, "ENDSEC"), (0, "SECTION"), (2, "BLOCKS")]
        for name, (bx, by), body in self.blocks:
            out += [(0, "BLOCK"), (5, self.handle()), (8, "0"), (2, name), (70, 0)]
            out += [(10, bx), (20, by), (30, 0.0), (3, name)]
            for entity in body:
                out += entity
            out += [(0, "ENDBLK"), (5, self.handle()), (8, "0")]
        out += [(0, "ENDSEC"), (0, "SECTION"), (2, "ENTITIES")]
        for entity in self.entities:
            out += entity
        out += [(0, "ENDSEC"), (0, "EOF")]
        return "".join(f"{code:>3}\r\n{fmt(value)}\r\n" for code, value in out).encode("utf-8")

    # --- entities ----------------------------------------------------------------------------

    def line(self, layer: str, a: tuple[float, float], b: tuple[float, float]) -> list[Pair]:
        return [
            (0, "LINE"), (5, self.handle()), (100, "AcDbEntity"), (8, layer),
            (100, "AcDbLine"), (10, a[0]), (20, a[1]), (30, 0.0), (11, b[0]), (21, b[1]), (31, 0.0),
        ]  # fmt: skip

    def poly(
        self,
        layer: str,
        points: Sequence[tuple[float, float]],
        closed: bool = True,
        bulges: dict[int, float] | None = None,
        extrusion: tuple[float, float, float] | None = None,
    ) -> list[Pair]:
        pairs: list[Pair] = [
            (0, "LWPOLYLINE"), (5, self.handle()), (100, "AcDbEntity"), (8, layer),
            (100, "AcDbPolyline"), (90, len(points)), (70, 1 if closed else 0),
        ]  # fmt: skip
        for i, (x, y) in enumerate(points):
            pairs += [(10, x), (20, y)]
            if bulges and i in bulges:
                pairs += [(42, bulges[i])]
        if extrusion:
            pairs += [(210, extrusion[0]), (220, extrusion[1]), (230, extrusion[2])]
        return pairs

    def rect(self, layer: str, x0: float, y0: float, x1: float, y1: float) -> list[Pair]:
        return self.poly(layer, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)])

    def text(self, layer: str, at: tuple[float, float], value: str, height: float) -> list[Pair]:
        return [
            (0, "TEXT"), (5, self.handle()), (100, "AcDbEntity"), (8, layer), (100, "AcDbText"),
            (10, at[0]), (20, at[1]), (30, 0.0), (40, height), (1, value),
        ]  # fmt: skip

    def insert(
        self,
        layer: str,
        name: str,
        at: tuple[float, float],
        rotation: float = 0.0,
        scale: tuple[float, float] = (1.0, 1.0),
        attribs: dict[str, str] | None = None,
        extrusion: tuple[float, float, float] | None = None,
        columns: int | None = None,
    ) -> list[Pair]:
        pairs: list[Pair] = [(0, "INSERT"), (5, self.handle()), (100, "AcDbEntity"), (8, layer)]
        pairs += [(100, "AcDbBlockReference")]
        if attribs:
            pairs += [(66, 1)]
        pairs += [(2, name), (10, at[0]), (20, at[1]), (30, 0.0)]
        pairs += [(41, scale[0]), (42, scale[1]), (43, 1.0), (50, rotation)]
        if columns:
            pairs += [(70, columns), (71, 1), (44, 1500.0), (45, 0.0)]
        if extrusion:
            pairs += [(210, extrusion[0]), (220, extrusion[1]), (230, extrusion[2])]
        for tag, value in (attribs or {}).items():
            pairs += [(0, "ATTRIB"), (5, self.handle()), (100, "AcDbEntity"), (8, layer)]
            pairs += [(100, "AcDbText"), (10, at[0]), (20, at[1]), (30, 0.0), (40, 0.2)]
            pairs += [(1, value), (100, "AcDbAttribute"), (2, tag), (70, 0)]
        if attribs:
            pairs += [(0, "SEQEND"), (5, self.handle()), (8, layer)]
        return pairs

    def raw(self, kind: str, layer: str, *groups: Pair) -> list[Pair]:
        return [(0, kind), (5, self.handle()), (100, "AcDbEntity"), (8, layer), *groups]


def rotated_rect(
    cx: float, cy: float, w: float, d: float, degrees: float
) -> list[tuple[float, float]]:
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    corners = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    return [(round(cx + x * c - y * s, 3), round(cy + x * s + y * c, 3)) for x, y in corners]


def hall_mm() -> bytes:
    layers = [
        "0",
        "A-WALL",
        "S-COLS",
        "EQUIPMENT",
        "WALKWAY",
        "KEEP-CLEAR",
        "CONVEYOR",
        "TEXT",
        "DIMS",
    ]
    d = Dxf(insunits=4, measurement=1, layers=layers)
    e = d.entities
    e.append(d.rect("A-WALL", 0, 0, 24000, 16000))
    for cx in (10000, 18000):
        e.append(d.rect("S-COLS", cx - 200, 7800, cx + 200, 8200))
    labelled = [
        ("Press 1", (2000, 2000, 5000, 4000)),
        ("Press 2", (2000, 5500, 5000, 7500)),
        ("Pallet rack", (10000, 13500, 16000, 14600)),
        ("Electrical panel", (22800, 7000, 23600, 7400)),
    ]
    for name, (x0, y0, x1, y1) in labelled:
        e.append(d.rect("EQUIPMENT", x0, y0, x1, y1))
        e.append(d.text("TEXT", ((x0 + x1) / 2, (y0 + y1) / 2), name, 150.0))
    e.append(d.poly("EQUIPMENT", rotated_rect(12000, 4000, 2400, 1200, 15.0)))
    e.append(d.text("TEXT", (12000, 4000), "Packing table", 150.0))
    bench = [
        (18000, 2000),
        (21000, 2000),
        (21000, 3000),
        (19000, 3000),
        (19000, 4500),
        (18000, 4500),
    ]
    e.append(d.poly("EQUIPMENT", bench))
    e.append(d.text("TEXT", (18400, 2500), "Workbench", 150.0))
    e.append(d.rect("EQUIPMENT", 13000, 9500, 15000, 11000))  # unlabelled
    e.append(d.rect("WALKWAY", 6500, 500, 8300, 15500))
    e.append(d.rect("KEEP-CLEAR", 21600, 6800, 22800, 7600))
    e.append(d.poly("CONVEYOR", [(5000, 3000), (10800, 3000)], closed=False))
    e.append(d.text("TEXT", (12000, 15500), "Hall A - ground floor (synthetic)", 300.0))
    e.append(
        d.raw(
            "DIMENSION", "DIMS", (100, "AcDbDimension"), (2, "*D1"),
            (10, 24000.0), (20, -1000.0), (30, 0.0), (70, 32), (1, "24000"),
        )
    )  # fmt: skip
    return d.render()


def room_unitless() -> bytes:
    d = Dxf(insunits=0, measurement=None, layers=["0", "WALLS", "MACHINES", "LABELS"])
    e = d.entities
    e.append(d.rect("WALLS", 0, 0, 12000, 8000))
    for name, (x0, y0, x1, y1) in [
        ("Saw", (1000, 1000, 3000, 2200)),
        ("Drill press", (5000, 1000, 5800, 1800)),
        ("Assembly bench", (8000, 5000, 11000, 6000)),
    ]:
        e.append(d.rect("MACHINES", x0, y0, x1, y1))
        e.append(d.text("LABELS", ((x0 + x1) / 2, (y0 + y1) / 2), name, 120.0))
    return d.render()


def cell_blocks_m() -> bytes:
    layers = ["0", "OUTLINE", "MACHINES", "CELLS", "DETAIL"]
    d = Dxf(insunits=6, measurement=1, layers=layers, block_units={"PUMP_IN": 1})
    mill = [
        d.rect("0", -1.0, -0.75, 1.0, 0.75),
        d.poly("DETAIL", [(0.6, -0.75), (0.6, 0.75)], False),
    ]
    lathe = [
        d.rect("0", 0.0, 0.0, 3.0, 1.0),
        d.raw("ATTDEF", "0", (10, 0.2), (20, 0.4), (30, 0.0), (40, 0.2), (1, ""), (3, "Name"),
              (2, "NAME"), (70, 0)),
    ]  # fmt: skip
    cell = [
        d.insert("0", "CNC_MILL", (2.0, 0.0)),
        d.insert("0", "CNC_MILL", (-2.0, 0.0), rotation=180.0),
        d.rect("0", -4.0, -2.0, 4.0, 2.0),
    ]
    pump = [d.rect("0", 0.0, 0.0, 40.0, 20.0)]  # drawn in inches
    d.blocks = [
        ("CNC_MILL", (0.0, 0.0), mill),
        ("LATHE", (0.0, 0.0), lathe),
        ("CELL", (0.0, 0.0), cell),
        ("PUMP_IN", (0.0, 0.0), pump),
    ]
    e = d.entities
    e.append(d.rect("OUTLINE", 0.0, 0.0, 30.0, 20.0))
    e.append(d.insert("MACHINES", "CNC_MILL", (5.0, 5.0)))
    e.append(d.insert("MACHINES", "CNC_MILL", (10.0, 5.0), rotation=90.0))
    e.append(d.insert("MACHINES", "CNC_MILL", (15.0, 5.0), rotation=45.0, scale=(1.5, 1.5)))
    e.append(d.insert("MACHINES", "CNC_MILL", (20.0, 5.0), scale=(-1.0, 1.0)))
    e.append(d.insert("MACHINES", "LATHE", (5.0, 12.0), rotation=30.0, attribs={"NAME": "Lathe A"}))
    # Mirrored by a -Z extrusion: the insertion point is in object coordinates (X reversed).
    e.append(d.insert("MACHINES", "LATHE", (-25.0, 12.0), extrusion=(0.0, 0.0, -1.0)))
    e.append(d.insert("CELLS", "CELL", (18.0, 14.0)))
    e.append(d.insert("MACHINES", "PUMP_IN", (26.0, 2.0), scale=(0.0254, 0.0254)))
    return d.render()


def unsupported_mm() -> bytes:
    layers = ["0", "WALLS", "EQUIPMENT", "S-COLS", "A-DOOR", "FLOOR-FINISH", "DIMS", "SHEET"]
    d = Dxf(insunits=4, measurement=1, layers=layers)
    d.blocks = [("SHELF", (0.0, 0.0), [d.rect("0", 0.0, 0.0, 1200.0, 400.0)])]
    e = d.entities
    e.append(d.rect("WALLS", 0, 0, 10000, 8000))
    e.append(d.rect("EQUIPMENT", 1000, 1000, 3000, 2500))
    e.append(d.text("EQUIPMENT", (2000, 1750), "Mixer", 120.0))
    e.append(
        d.raw(
            "CIRCLE",
            "S-COLS",
            (100, "AcDbCircle"),
            (10, 5000.0),
            (20, 4000.0),
            (30, 0.0),
            (40, 250.0),
        )
    )
    e.append(
        d.raw("ARC", "A-DOOR", (100, "AcDbCircle"), (10, 0.0), (20, 3000.0), (30, 0.0), (40, 900.0),
              (100, "AcDbArc"), (50, 0.0), (51, 90.0))
    )  # fmt: skip
    e.append(
        d.raw("SPLINE", "EQUIPMENT", (100, "AcDbSpline"), (70, 8), (71, 3), (72, 0), (73, 2),
              (10, 6000.0), (20, 1000.0), (30, 0.0), (10, 7000.0), (20, 2000.0), (30, 0.0))
    )  # fmt: skip
    e.append(d.raw("HATCH", "FLOOR-FINISH", (100, "AcDbHatch"), (2, "SOLID"), (70, 1), (91, 0)))
    e.append(
        d.poly(
            "EQUIPMENT", [(7000, 5000), (9000, 5000), (9000, 6000), (7000, 6000)], bulges={1: 1.0}
        )
    )
    e.append(d.insert("EQUIPMENT", "SHELF", (1000, 6000), columns=3))
    e.append(d.insert("EQUIPMENT", "GHOST", (4000, 6000)))
    e.append(d.poly("EQUIPMENT", [(0, 0), (500, 0), (500, 500)], extrusion=(1.0, 0.0, 0.0)))
    e.append(
        d.raw("3DFACE", "EQUIPMENT", (100, "AcDbFace"), (10, 0.0), (20, 0.0), (30, 0.0),
              (11, 1.0), (21, 0.0), (31, 0.0), (12, 1.0), (22, 1.0), (32, 0.0), (13, 0.0),
              (23, 1.0), (33, 0.0))
    )  # fmt: skip
    e.append(
        d.raw(
            "DIMENSION",
            "DIMS",
            (100, "AcDbDimension"),
            (2, "*D2"),
            (10, 0.0),
            (20, 0.0),
            (30, 0.0),
            (70, 32),
        )
    )
    sheet = d.line("SHEET", (0, 0), (100, 100))
    e.append([*sheet[:4], (67, 1), *sheet[4:]])  # in paper space
    return d.render()


def warehouse_cm() -> bytes:
    layers = ["0", "SITE-BOUNDARY", "A-WALL", "S-COLS", "RACKS", "EQUIPMENT", "WALKWAY"]
    layers += ["A-DOOR", "TANKS", "NOTES", "BORDER"]
    d = Dxf(insunits=4, measurement=1, layers=layers)  # says mm; drawn in cm
    e = d.entities
    e.append(d.rect("SITE-BOUNDARY", 0, 0, 6000, 4000))
    e.append(d.rect("A-WALL", 1000, 1000, 4000, 3000))
    for x in (1600, 2200, 2800, 3400):
        e.append(d.rect("S-COLS", x - 20, 1980, x + 20, 2020))
    e.append(d.text("NOTES", (1900, 2080), "Column bays are 6.00 m", 30.0))
    for name, y in (("Rack A", 2500), ("Rack B", 2800)):
        e.append(d.rect("RACKS", 1200, y, 2800, y + 120))
        e.append(d.text("RACKS", (2000, y + 60), name, 40.0))
    e.append(d.rect("WALKWAY", 1100, 2200, 3900, 2400))
    e.append(d.rect("EQUIPMENT", 3200, 1200, 3700, 1600))
    e.append(d.text("EQUIPMENT", (3450, 1400), "Pallet drop zone", 30.0))
    e.append(d.rect("EQUIPMENT", 1200, 1100, 1350, 1200))
    e.append(d.text("EQUIPMENT", (1275, 1150), "Forklift charger", 10.0))
    e.append(
        d.raw(
            "CIRCLE",
            "TANKS",
            (100, "AcDbCircle"),
            (10, 3600.0),
            (20, 2600.0),
            (30, 0.0),
            (40, 60.0),
        )
    )
    e.append(d.text("TANKS", (3600, 2600), "Water tank", 15.0))
    e.append(
        d.raw("ARC", "A-DOOR", (100, "AcDbCircle"), (10, 1000.0), (20, 1500.0), (30, 0.0),
              (40, 100.0), (100, "AcDbArc"), (50, 0.0), (51, 90.0))
    )  # fmt: skip
    e.append(d.line("A-DOOR", (1000, 1500), (1100, 1500)))
    e.append(d.rect("BORDER", 4600, 100, 5900, 700))
    e.append(d.text("BORDER", (5250, 400), "Warehouse W2 (synthetic)", 60.0))
    return d.render()


def dwg_stub() -> bytes:
    return b"AC1032" + bytes((i * 37) % 251 for i in range(250))


FILES = {
    "hall-mm.dxf": hall_mm,
    "room-unitless.dxf": room_unitless,
    "cell-blocks-m.dxf": cell_blocks_m,
    "unsupported-mm.dxf": unsupported_mm,
    "warehouse-cm.dxf": warehouse_cm,
    "layout.dwg": dwg_stub,
}


def analysis(name: str) -> bytes:
    """The API reader's answer for a fixture, as the upload endpoint returns it."""
    import hashlib
    import json

    from replay_world_api.drawings import read_drawing
    from replay_world_contracts import DrawingAnalysis

    data = FILES[name]()
    drawing, warnings = read_drawing(data, name)
    result = DrawingAnalysis(
        filename=name, sha256=hashlib.sha256(data).hexdigest(), drawing=drawing, warnings=warnings
    )
    return (json.dumps(result.model_dump(mode="json"), indent=2) + "\n").encode()


def same(name: str, committed: bytes, built: bytes) -> bool:
    """Drawings must match byte for byte. A reader's output may differ in the last digits of a
    float between platforms' maths libraries (a rotated outline's sine and cosine), so it is
    compared as JSON with a 1e-9 tolerance."""
    if not name.endswith(".json"):
        return committed == built
    import json

    def close(a: object, b: object) -> bool:
        if isinstance(a, float) or isinstance(b, float):
            return (
                isinstance(a, int | float)
                and isinstance(b, int | float)
                and math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
            )
        if isinstance(a, dict) and isinstance(b, dict):
            return a.keys() == b.keys() and all(close(a[k], b[k]) for k in a)
        if isinstance(a, list) and isinstance(b, list):
            return len(a) == len(b) and all(close(x, y) for x, y in zip(a, b, strict=True))
        return a == b

    return close(json.loads(committed), json.loads(built))


ANALYSES = {
    f"{name[:-4]}.analysis.json": name
    for name in ("hall-mm.dxf", "room-unitless.dxf", "warehouse-cm.dxf")
}


def main(argv: list[str]) -> int:
    check = "--check" in argv
    stale = []
    outputs = [(name, build) for name, build in FILES.items()]
    outputs += [(out, partial(analysis, name)) for out, name in ANALYSES.items()]
    for name, build in outputs:
        data = build()
        path = OUT / name
        if check:
            if not path.exists() or not same(name, path.read_bytes(), data):
                stale.append(name)
        else:
            OUT.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            print(f"wrote {path.relative_to(ROOT)} ({len(data)} bytes)")
    if stale:
        print(
            f"Out of date: {', '.join(stale)}; run scripts/build_dxf_fixtures.py", file=sys.stderr
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
