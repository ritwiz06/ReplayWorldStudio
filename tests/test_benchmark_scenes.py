"""The synthetic benchmark scenes (WRL-04) stay valid, labelled and on their extended floor."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
from replay_world_contracts import ObjectAdded, ObjectEdited

ROOT = Path(__file__).resolve().parents[1]


def _builder() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "build_benchmark_scenes", ROOT / "scripts" / "build_benchmark_scenes.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("count", [15, 105])
def test_benchmark_scene_is_the_demo_plus_recorded_instances(count: int) -> None:
    project = _builder().build(count)
    objects = project.scene.objects
    log = project.scene.edit_log
    assert len(objects) == 15 + count
    assert project.fixture is not None and project.fixture.kind == "demonstration"
    assert "Synthetic benchmark layout" in project.fixture.note
    # Two floor edits (resize, then move) and one record per added instance.
    assert [type(r) for r in log[:2]] == [ObjectEdited, ObjectEdited]
    assert all(isinstance(r, ObjectAdded) for r in log[2:]) and len(log) == count + 2
    assert project.scene.revision == count + 2
    assert len({o.id for o in objects}) == len(objects)

    floor = next(o for o in objects if o.id == "obj-floor")
    z0 = floor.transform.position_m.z - floor.dimensions.depth.value_m / 2
    z1 = floor.transform.position_m.z + floor.dimensions.depth.value_m / 2
    x1 = floor.dimensions.width.value_m / 2
    for added in objects[15:]:
        p = added.transform.position_m
        assert z0 < p.z < z1 and -x1 < p.x < x1, added.id
