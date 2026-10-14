"""Source-plan to world mapping: scale, axis convention, rotation and translation."""

from __future__ import annotations

import math
import random

import pytest
from replay_world_contracts import Project, SourceToWorldTransform, Vec3
from replay_world_contracts.transforms import (
    METRES_PER_UNIT,
    source_point_to_world,
    world_point_to_source,
)


def _transform(rotation: float = 0.0, translation: Vec3 | None = None) -> SourceToWorldTransform:
    return SourceToWorldTransform(
        convention="plan_xy_to_world_x_neg_z",
        source_unit="mm",
        metres_per_source_unit=METRES_PER_UNIT["mm"],
        rotation_about_world_y_rad=rotation,
        translation_m=translation or Vec3(x=0.0, y=0.0, z=0.0),
    )


def test_plan_axes_map_to_world_x_and_negative_z() -> None:
    t = _transform()
    assert source_point_to_world(t, 1000.0, 0.0) == Vec3(x=1.0, y=0.0, z=0.0)
    assert source_point_to_world(t, 0.0, 1000.0) == Vec3(x=0.0, y=0.0, z=-1.0)


def test_quarter_turn_follows_the_right_hand_rule_about_y() -> None:
    # Rotating world +X by +90 degrees about +Y gives world -Z.
    p = source_point_to_world(_transform(rotation=math.pi / 2), 1000.0, 0.0)
    assert (p.x, p.y, p.z) == pytest.approx((0.0, 0.0, -1.0), abs=1e-12)


def test_fixture_column_plan_point_lands_at_its_world_position(fixture_text: str) -> None:
    project = Project.model_validate_json(fixture_text)
    source = project.sources[0]
    t = source.source_to_world
    assert t is not None, "a plan source always has a source-to-world transform"
    assert t.metres_per_source_unit == METRES_PER_UNIT[t.source_unit]
    column = next(o for o in project.scene.objects if o.id == "obj-column-c1")
    for axis in (column.dimensions.width, column.dimensions.depth):
        assert axis.origin == "measured"
        assert axis.source_ref is not None and "(14000,9000) mm" in axis.source_ref
    assert source_point_to_world(t, 14000.0, 9000.0) == column.transform.position_m


def test_world_to_source_inverts_source_to_world() -> None:
    rng = random.Random(20261009)
    t = _transform(rotation=0.7, translation=Vec3(x=-12.5, y=0.3, z=4.25))
    for _ in range(200):
        u, v = rng.uniform(-50_000, 50_000), rng.uniform(-50_000, 50_000)
        assert world_point_to_source(t, source_point_to_world(t, u, v)) == pytest.approx(
            (u, v), abs=1e-6
        )


@pytest.mark.parametrize("bad", [math.nan, math.inf])
def test_rejects_non_finite_source_points(bad: float) -> None:
    with pytest.raises(ValueError, match="must be finite"):
        source_point_to_world(_transform(), bad, 0.0)
