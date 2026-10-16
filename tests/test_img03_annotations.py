"""IMG-03 ground truth: every committed annotation is valid; what is not ground truth is refused.

Synthetic annotations must be exact and carry their camera; a real one must state how and how
precisely each value was measured, may not claim a render's exactness, may not use a "typical" or
photo-derived value, and must stay local (outside the repository) when its rights do not allow
publication. The frozen held-out set has the composition the criteria state.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
SET = ROOT / "docs" / "assist-evaluation" / "img-03"


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


img03 = load("img03_annotations")
FILES = sorted((SET / "annotations").glob("*.annotation.json"))


@pytest.mark.parametrize("path", FILES, ids=[p.name for p in FILES])
def test_every_committed_annotation_is_valid_and_matches_its_photo(path: Path) -> None:
    annotation = img03.validate_file(path)
    assert annotation.image.stratum == "synthetic"  # no real measured photo exists yet


def test_the_held_out_set_has_its_stated_composition() -> None:
    held = [json.loads(p.read_text()) for p in FILES]
    held = [a for a in held if a["image"]["split"] == "held_out"]
    assert len(held) == 8
    assert Counter(a["image"]["scene_type"] for a in held) == {
        "industrial": 2,
        "storage": 2,
        "office": 2,
        "lounge": 2,
    }
    assert sum(o["counted"] for a in held for o in a["objects"]) >= 60
    assert sum(o["visibility"] == "partly_visible" for a in held for o in a["objects"]) >= 15


def real(**changes: Any) -> dict[str, Any]:
    """A real-site annotation built from a synthetic one, measured as the protocol says."""
    a: dict[str, Any] = json.loads(FILES[0].read_text())
    a = copy.deepcopy(a)
    a["image"] |= {
        "stratum": "real",
        "split": "held_out",
        "rights": {
            "source": "Site owner, by written permission (on file, not in the repository)",
            "license": "permission to analyse; not for publication",
            "analysis_permitted": True,
            "publishable": False,
        },
        "local_only": True,
    }
    a["camera"] = None
    a["rectangle"] |= {
        "tolerance_m": 0.005,
        "method": "tape",
        "measured_by": "steel tape, two people, 2026-10",
    }
    for o in a["objects"]:
        o |= {"tolerance_m": 0.02, "method": "tape"}
    for key, value in changes.items():
        section, _, field = key.partition("__")
        if field:
            a[section][field] = value
        else:
            a[section] = value
    return a


def test_a_real_measured_annotation_is_accepted() -> None:
    img03.Annotation.model_validate(real())


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"rectangle__tolerance_m": 0.0}, "measurement tolerance"),
        ({"rectangle__method": "render_exact"}, "only a render is exact"),
        ({"rectangle__method": "typical"}, "Input should be"),
        ({"image__local_only": False}, "must be local only"),
        ({"rectangle__check_length_m": 3.2}, "check length needs its two points"),
    ],
)
def test_what_is_not_ground_truth_is_refused(changes: dict[str, Any], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        img03.Annotation.model_validate(real(**changes))


def test_an_object_must_be_measured_on_site_not_estimated() -> None:
    a = real()
    a["objects"][0]["method"] = "render_exact"
    with pytest.raises(ValidationError, match="states its method and tolerance"):
        img03.Annotation.model_validate(a)
    b = real()
    b["objects"][0]["method"] = "typical_size"
    with pytest.raises(ValidationError, match="Input should be"):
        img03.Annotation.model_validate(b)
    c = copy.deepcopy(real())
    c["objects"][0]["counted"] = not c["objects"][0]["counted"]
    with pytest.raises(ValidationError, match="counted must follow the protocol"):
        img03.Annotation.model_validate(c)


def test_a_local_only_photo_is_never_looked_for_inside_the_repository(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a = img03.Annotation.model_validate(real())
    monkeypatch.setenv("RWS_IMG03_LOCAL_DIR", str(SET / "photos"))
    with pytest.raises(ValueError, match="must not be inside the repository"):
        img03.image_path(a, SET / "annotations")
    monkeypatch.delenv("RWS_IMG03_LOCAL_DIR")
    with pytest.raises(FileNotFoundError, match="RWS_IMG03_LOCAL_DIR"):
        img03.image_path(a, SET / "annotations")
