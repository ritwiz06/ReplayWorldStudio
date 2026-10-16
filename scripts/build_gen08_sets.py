"""GEN-08: build the pilot set (development) and the frozen held-out set of revision cases.

    uv run python scripts/build_gen08_sets.py SCRATCH_TARGETS_DIR

SCRATCH_TARGETS_DIR holds templates.json (the builder templates dumped from
apps/web/src/assist/templates.ts) and classroom.jpg.json (the app's photo import of
fixtures/photos/classroom.jpg with recorded answers and an assumed 3.0 m floor width; see
docs/assist-evaluation/gen-05/README.md). Photo, described and GEN-03 targets are taken from the
frozen GEN-03/04 sets, unchanged. The frozen set only uses targets that no development or
inspection case has touched; the pilot uses builder templates already used in development.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Final

from replay_world_api.objects import fit_to_envelope
from replay_world_contracts import GeometryDraft, GeometrySpec

ROOT: Final = Path(__file__).resolve().parents[1]
EVAL: Final = ROOT / "docs" / "assist-evaluation"
RED: Final = "estop_red|paint_red|signal_red"
GREEN: Final = "paint_green|signal_green"
BLUE: Final = "paint_blue|motor_blue"
WHITE: Final = "paint_white|signal_white"
BLACK: Final = "plastic_black|rubber_black|label_black"
GLASS: Final = "glass_clear|polycarbonate"


def case(
    id: str,
    category: str,
    target: str,
    instruction: str,
    expect: str,
    visible: tuple[str, ...] = (),
    unrep: tuple[str, ...] = (),
    *,
    open_: bool = False,
    stated: tuple[tuple[str, float], ...] = (),
    va: bool = False,
    notes: str = "",
) -> dict[str, Any]:
    return {
        "id": id,
        "category": category,
        "target": target,
        "instruction": instruction,
        "expect": expect,
        "size": "keep",
        "visible_change": list(visible),
        "open": open_,
        "unrepresentable": list(unrep),
        "stated_parts": [{"label": label, "size_m": size} for label, size in stated],
        "keep_other_parts": False,
        "visible_additions": va,
        "notes": notes,
    }


def main(argv: list[str]) -> int:
    scratch = Path(argv[0])
    templates = json.loads((scratch / "templates.json").read_text())
    classroom = json.loads((scratch / "classroom.jpg.json").read_text())
    gen03 = json.loads((EVAL / "gen-03" / "revisions.json").read_text())["targets"]
    gen04 = json.loads((EVAL / "gen-04" / "revisions.json").read_text())["targets"]

    def builder(key: str, name: str) -> dict[str, Any]:
        spec = fit_to_envelope(GeometryDraft.model_validate(templates[key]["spec"]))[0]
        return {
            "origin": "builder",
            "name": name,
            "described_as": None,
            "spec": spec.model_dump(mode="json"),
        }

    chairs = [a for a in classroom if a["request"]["name"] == "Plastic chair"]
    black = next(
        a
        for a in chairs
        if any(
            p["material"] == "plastic_black" for p in a["response"]["generation"]["spec"]["parts"]
        )
        and abs(a["response"]["generation"]["spec"]["envelope_m"]["x"] - 0.688) < 0.01
    )
    g = black["response"]["generation"]

    pilot_targets = {
        "builder-table": builder("table", "Workbench"),
        "builder-rack": builder("rack", "Shelving rack"),
        "builder-screen": builder("screen", "Screen on a stand"),
    }
    pilot = [
        case(
            "pp1",
            "transparent",
            "builder-table",
            "add a clear glass shelf under the top",
            "proposal",
            (f"material:{GLASS}", "part:shelf"),
            va=True,
        ),
        case(
            "pp2",
            "explicit-colour",
            "builder-rack",
            "paint the posts white and the top beam red",
            "proposal",
            (f"material:{WHITE}", f"material:{RED}"),
        ),
        case(
            "pp3",
            "stated-size",
            "builder-screen",
            "add a 5 cm red indicator light on top of the frame",
            "proposal",
            ("part:light|indicator", f"material:{RED}"),
            stated=(("light|indicator", 0.05),),
            va=True,
        ),
    ]
    targets = {
        "classroom-black-chair": {
            "origin": "photo",
            "name": "Plastic chair",
            "described_as": g["description"],
            "spec": g["spec"],
        },
        "classroom-low-bookshelf": gen04["classroom-low-bookshelf"],
        "classroom-white-chair": gen04["classroom-white-chair"],
        "living-tv": gen04["living-tv"],
        "living-media-player": gen04["living-media-player"],
        "factory-left-conveyor": gen03["factory-left-conveyor"],
        "factory-left-machine": gen03["factory-left-machine"],
        "classroom-teacher-desk": gen03["classroom-teacher-desk"],
        "builder-cabinet": builder("cabinet", "Cabinet"),
        "builder-machine": builder("machine", "Machine"),
        "builder-pallet": builder("pallet", "Pallet with cartons"),
        "described-workbench": gen04["described-workbench"],
        "described-water-tank": gen04["described-water-tank"],
    }
    cases = [
        # Transparent parts
        case(
            "t1",
            "transparent",
            "classroom-low-bookshelf",
            "put clear glass doors on the front of the shelves",
            "proposal",
            (f"material:{GLASS}", "part:door"),
            va=True,
        ),
        case(
            "t2",
            "transparent",
            "builder-cabinet",
            "replace the door with a clear glass door",
            "proposal",
            (f"material:{GLASS}", "part:door"),
        ),
        case(
            "t3",
            "transparent",
            "factory-left-conveyor",
            "add clear plastic guards along both sides of the belt",
            "proposal",
            (f"material:{GLASS}", "part:guard"),
            va=True,
        ),
        case(
            "t4",
            "transparent",
            "described-workbench",
            "add a glass screen panel standing on the back edge of the worktop",
            "proposal",
            (f"material:{GLASS}", "part:panel|screen"),
            va=True,
        ),
        # Small named additions (no size given)
        case(
            "s1",
            "small-addition",
            "living-media-player",
            "add a small blue power light on the front",
            "proposal",
            ("part:light|led|indicator", f"material:{BLUE}"),
            va=True,
        ),
        case(
            "s2",
            "small-addition",
            "builder-machine",
            "add a red emergency stop button on the front of the body",
            "proposal",
            ("part:stop|button", f"material:{RED}"),
            va=True,
        ),
        case(
            "s3",
            "small-addition",
            "classroom-teacher-desk",
            "add a small desk lamp on the top",
            "proposal",
            ("part:lamp",),
            va=True,
        ),
        case(
            "s4",
            "small-addition",
            "described-water-tank",
            "add a small pressure gauge on the side of the tank",
            "proposal",
            ("part:gauge|dial",),
            va=True,
        ),
        # Explicit colour phrases
        case(
            "c1",
            "explicit-colour",
            "classroom-black-chair",
            "make the legs white and the seat dark green",
            "proposal",
            (f"material:{WHITE}", f"material:{GREEN}"),
        ),
        case(
            "c2",
            "explicit-colour",
            "builder-pallet",
            "paint the cartons blue and the pallet black",
            "proposal",
            (f"material:{BLUE}", f"material:{BLACK}"),
        ),
        case(
            "c3",
            "explicit-colour",
            "living-tv",
            "make the screen frame red and white",
            "proposal",
            (f"material:{RED}|{WHITE}",),
            notes="two colours for one part: one is drawn, the other may be listed",
        ),
        case(
            "c4",
            "explicit-colour",
            "classroom-white-chair",
            "give the seat a red leather cushion",
            "partial",
            ("part:cushion|pad", f"material:{RED}"),
            ("leather",),
            va=True,
        ),
        # Occluded placements (behind, under, at the back)
        case(
            "o1",
            "occluded",
            "builder-machine",
            "add a cable box behind the machine",
            "proposal",
            ("part:box|cable",),
            va=True,
        ),
        case(
            "o2",
            "occluded",
            "classroom-teacher-desk",
            "add a waste bin under the desk",
            "proposal",
            ("part:bin",),
            va=True,
        ),
        case(
            "o3",
            "occluded",
            "described-water-tank",
            "add a drain valve under the cone",
            "proposal",
            ("part:valve|drain",),
            va=True,
        ),
        case(
            "o4",
            "occluded",
            "living-tv",
            "add a speaker on the back of the screen that plays music",
            "partial",
            ("part:speaker",),
            ("music|play",),
            va=True,
        ),
        # Open structures
        case(
            "p1",
            "open-structure",
            "builder-cabinet",
            "make it an open shelf with three shelves and no door",
            "proposal",
            ("part:shelf",),
            open_=True,
        ),
        case(
            "p2",
            "open-structure",
            "living-media-player",
            "turn it into an open frame of four posts with a top and a bottom panel",
            "proposal",
            ("part:post",),
            open_=True,
        ),
        case(
            "p3",
            "open-structure",
            "factory-left-machine",
            "remove the solid body and show an open frame of posts and rails",
            "proposal",
            ("part:post|rail|frame",),
            open_=True,
        ),
        # Partial requests
        case(
            "q1",
            "partial",
            "builder-pallet",
            "add four wheels that roll so it can be pushed",
            "partial",
            ("part:wheel|caster",),
            ("roll|push",),
            va=True,
        ),
        case(
            "q2",
            "partial",
            "factory-left-conveyor",
            "add a motor at one end and make the belt run faster",
            "partial",
            ("part:motor",),
            ("faster|speed|run",),
            va=True,
        ),
        case(
            "q3",
            "partial",
            "described-workbench",
            "add a drawer with a lock that opens with a fingerprint",
            "partial",
            ("part:drawer",),
            ("fingerprint|lock",),
            va=True,
        ),
        # Stated dimensions (an estimate enlargement must not touch them)
        case(
            "d1",
            "stated-size",
            "builder-machine",
            "add a 4 cm green status light on top",
            "proposal",
            ("part:light|lamp", f"material:{GREEN}"),
            stated=(("light|lamp", 0.04),),
            va=True,
        ),
        case(
            "d2",
            "stated-size",
            "classroom-low-bookshelf",
            "add a 30 cm tall plant pot on the top shelf",
            "proposal",
            ("part:pot|plant",),
            stated=(("pot|plant", 0.30),),
            va=True,
        ),
        case(
            "d3",
            "stated-size",
            "described-workbench",
            "add a 10 cm wide red alarm button on the front edge",
            "proposal",
            ("part:button|alarm", f"material:{RED}"),
            stated=(("button|alarm", 0.10),),
            va=True,
        ),
        # Already satisfied
        case(
            "a1",
            "already-satisfied",
            "builder-pallet",
            "make the cartons cardboard",
            "already_satisfied",
        ),
    ]
    for c in cases:
        if c["open"]:
            s = GeometrySpec.model_validate(targets[c["target"]]["spec"])
            e = s.envelope_m
            share = max(p.size_m.x * p.size_m.y * p.size_m.z for p in s.parts) / (e.x * e.y * e.z)
            assert share >= 0.5, (c["id"], share)
    earlier: set[str] = set()
    for name in ("gen-03", "gen-04", "gen-05", "gen-05-pilot"):
        earlier |= {
            c["instruction"]
            for c in json.loads((EVAL / name / "revisions.json").read_text())["cases"]
        }
    earlier |= {
        c["instruction"]
        for c in json.loads((ROOT / "scripts" / "model_revision_cases.json").read_text())
    }
    earlier |= {
        c["instruction"]
        for c in json.loads((ROOT / "apps" / "web" / "e2e" / "inspection-cases.json").read_text())
    }
    assert not earlier & {c["instruction"] for c in cases + pilot}
    assert len(cases) == 26 and len({c["id"] for c in cases}) == 26
    (EVAL / "gen-08-pilot").mkdir(exist_ok=True)
    (EVAL / "gen-08").mkdir(exist_ok=True)
    (EVAL / "gen-08-pilot" / "revisions.json").write_text(
        json.dumps(
            {
                "set": "gen-08 pilot (development examples, not held out)",
                "targets": pilot_targets,
                "cases": pilot,
            },
            indent=1,
            ensure_ascii=False,
        )
        + "\n"
    )
    (EVAL / "gen-08" / "revisions.json").write_text(
        json.dumps(
            {
                "set": "gen-08 frozen model revisions",
                "frozen": "2026-10-16",
                "targets": targets,
                "cases": cases,
            },
            indent=1,
            ensure_ascii=False,
        )
        + "\n"
    )
    photo = sum(targets[c["target"]]["origin"] == "photo" for c in cases)
    print(
        Counter(c["category"] for c in cases),
        photo,
        "photo cases;",
        sum(c["visible_additions"] for c in cases),
        "visible additions",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
