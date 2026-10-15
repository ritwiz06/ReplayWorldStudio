"""Scene edit log (0.4.0): edits keep the evidence they replace; the log describes the scene.

fixtures/edited/foundation-edited.json is written by the browser's command engine (see
apps/web/src/editing/sample.test.ts); these tests validate the same file with the Pydantic
models, so both sides agree on what a saved, edited project is.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Callable
from typing import Any

import pytest
from pydantic import ValidationError
from replay_world_contracts import ObjectAdded, ObjectEdited, ObjectRemoved, Project
from replay_world_contracts.migrations import upgrade_document

from .conftest import FIXTURES

SAMPLE = FIXTURES / "edited" / "foundation-edited.json"
EDIT_REF = "Entered in the editor; the previous value and its evidence are in the scene edit log"


@pytest.fixture
def sample() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(SAMPLE.read_text())
    return data


def _record(data: dict[str, Any], revision: int) -> dict[str, Any]:
    record: dict[str, Any] = next(r for r in data["scene"]["edit_log"] if r["revision"] == revision)
    return record


def _object(data: dict[str, Any], object_id: str) -> dict[str, Any]:
    obj: dict[str, Any] = next(o for o in data["scene"]["objects"] if o["id"] == object_id)
    return obj


def test_the_browser_written_sample_is_a_valid_project(sample: dict[str, Any]) -> None:
    project = Project.model_validate(sample)
    log = project.scene.edit_log
    assert project.scene.revision == 9
    assert [(r.revision, r.type) for r in log] == [
        (1, "object_edited"),
        (2, "object_edited"),
        (3, "object_edited"),
        (4, "object_added"),
        (5, "object_added"),
        (8, "object_edited"),
        (9, "object_removed"),
    ]
    assert project.fixture is not None and project.fixture.kind == "foundation"


def test_sample_round_trips_exactly(sample: dict[str, Any]) -> None:
    project = Project.model_validate(sample)
    assert json.loads(project.model_dump_json()) == sample
    assert Project.model_validate_json(project.model_dump_json()) == project
    assert upgrade_document(sample).document == sample  # current version: nothing to upgrade


def test_an_edited_axis_is_user_supplied_and_the_record_keeps_the_measurement(
    sample: dict[str, Any],
) -> None:
    project = Project.model_validate(sample)
    packing = next(o for o in project.scene.objects if o.id == "obj-packing-station")
    width = packing.dimensions.width
    assert (width.value_m, width.origin) == (1.35, "user_supplied")
    assert width.review_status == "unreviewed"
    assert (width.source_ref, width.uncertainty_m) == (EDIT_REF, None)
    assert packing.dimensions.height.origin == "inferred"  # untouched axes keep their evidence
    record = project.scene.edit_log[1]
    assert isinstance(record, ObjectEdited)
    [change] = record.dimensions
    assert change.axis == "width"
    assert change.before.origin == "measured"
    assert change.before.source_ref == "src-synthetic-plan#PK1 outline, 1200 mm side"
    assert change.before.uncertainty_m is not None
    assert (change.before.uncertainty_m.lower, change.before.uncertainty_m.upper) == (1.19, 1.21)
    assert change.after == width


def test_added_copied_and_removed_objects_are_recorded(sample: dict[str, Any]) -> None:
    project = Project.model_validate(sample)
    added, copied = project.scene.edit_log[3], project.scene.edit_log[4]
    assert isinstance(added, ObjectAdded) and isinstance(copied, ObjectAdded)
    assert (added.object_id, added.asset_id, added.duplicate_of) == (
        "obj-generic-processing-station",
        "asset-generic-processing-station",
        None,
    )
    assert (copied.object_id, copied.duplicate_of) == ("obj-reference-cube-2", "obj-reference-cube")
    removed = project.scene.edit_log[-1]
    assert isinstance(removed, ObjectRemoved)
    assert removed.object.id == "obj-process-station"
    assert removed.object.dimensions.width.origin == "default"  # its evidence travels with it
    assert "obj-process-station" not in {o.id for o in project.scene.objects}


Mutation = Callable[[dict[str, Any]], None]


def _swap_first_two(d: dict[str, Any]) -> None:
    log = d["scene"]["edit_log"]
    log[0], log[1] = log[1], log[0]


def _set(path: list[str | int], value: Any) -> Mutation:
    def apply(d: dict[str, Any]) -> None:
        node: Any = d
        for key in path[:-1]:
            node = node[key]
        node[path[-1]] = value

    return apply


def _record_set(revision: int, key: str, value: Any) -> Mutation:
    return lambda d: _record(d, revision).__setitem__(key, value)


def _restore_removed(d: dict[str, Any]) -> None:
    d["scene"]["objects"].append(copy.deepcopy(_record(d, 9)["object"]))


def _drift_width(d: dict[str, Any]) -> None:
    _object(d, "obj-packing-station")["dimensions"]["width"]["value_m"] = 1.4


def _measured_after(d: dict[str, Any]) -> None:
    _record(d, 2)["dimensions"][0]["after"]["origin"] = "measured"


def _same_axis_twice(d: dict[str, Any]) -> None:
    changes = _record(d, 2)["dimensions"]
    changes.append(copy.deepcopy(changes[0]))


def _unchanged_transform(d: dict[str, Any]) -> None:
    transform = _record(d, 1)["transform"]
    transform["after"] = copy.deepcopy(transform["before"])


def _ghost_edit(d: dict[str, Any]) -> None:
    _record(d, 8)["object_id"] = "obj-never-existed"


def _asset_swap(d: dict[str, Any]) -> None:
    _record(d, 4)["asset_id"] = "asset-generic-belt-conveyor"


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (_swap_first_two, "edit_log revisions must increase; 1 follows 2"),
        (_set(["scene", "revision"], 8), "after the scene revision 8"),
        (_record_set(1, "transform", None), "changes neither the transform nor a dimension"),
        (_measured_after, "an edited width must be 'user_supplied', not 'measured'"),
        (_same_axis_twice, "duplicate axis in edit 2: 'width'"),
        (_unchanged_transform, "edit at revision 1 records an unchanged transform"),
        (_restore_removed, "'obj-process-station' was removed at revision 9; IDs are never reused"),
        (_drift_width, "a width for object 'obj-packing-station' that differs from the scene"),
        (_ghost_edit, "refers to object 'obj-never-existed', which is not in the scene"),
        (
            _asset_swap,
            "revision 4 leaves object 'obj-generic-processing-station' referencing asset "
            "'asset-generic-belt-conveyor', but it now references 'asset-generic-processing-",
        ),
        (_record_set(4, "asset_id", None), "must name a catalog asset or the object it copies"),
    ],
    ids=[
        "out-of-order",
        "log-after-scene",
        "empty-edit",
        "edited-axis-not-user-supplied",
        "axis-twice",
        "unchanged-transform",
        "removed-id-reused",
        "log-disagrees-with-scene",
        "edit-of-unknown-object",
        "added-asset-mismatch",
        "added-without-origin",
    ],
)
def test_inconsistent_edit_logs_are_rejected(
    sample: dict[str, Any], mutate: Mutation, message: str
) -> None:
    mutate(sample)
    with pytest.raises(ValidationError) as info:
        Project.model_validate(sample)
    assert message in str(info.value)


def test_an_added_instance_must_name_a_catalog_asset(sample: dict[str, Any]) -> None:
    record = _record(sample, 4)
    record["asset_id"] = "asset-not-in-catalog"
    _object(sample, record["object_id"])["asset_id"] = "asset-not-in-catalog"
    with pytest.raises(ValidationError, match="which is not in the catalog"):
        Project.model_validate(sample)
