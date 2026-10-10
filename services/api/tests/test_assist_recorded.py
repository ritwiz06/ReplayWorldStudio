"""Real answers from the live provider, replayed offline through the whole pipeline.

The recordings in fixtures/assist/recorded/ were made by `scripts/evaluate_assist.py --record`
against ASU Voyager. Replaying them checks parsing, grounding, clarification rules and model
generation on genuine model output, deterministically and without a network. A replay is a
test fixture, never live AI.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from replay_world_api.assist.edits import propose_edit
from replay_world_api.assist.proposals import propose_object
from replay_world_api.assist.provider import RecordedProvider
from replay_world_api.objects import build_model
from replay_world_api.settings import AssistSettings
from replay_world_contracts import EditProposalRequest, Project

ROOT = Path(__file__).resolve().parents[3]
RECORDINGS = ROOT / "fixtures" / "assist" / "recorded"
DEMO = Project.model_validate_json(
    (ROOT / "fixtures" / "scenes" / "industrial-demo.json").read_text()
)
PROVIDER = RecordedProvider(AssistSettings(provider="recorded", recordings_dir=RECORDINGS))


def recording(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((RECORDINGS / f"{name}.json").read_text())
    return data


# Three substantially different descriptions, each with the size the user stated.
DESCRIBED = {
    "object-guarded-conveyor": ("width", 2.2),
    "object-water-tank": ("height", 1.5),
    "object-workbench": ("width", 1.8),
}


def test_recordings_name_the_live_model_and_hold_no_secrets() -> None:
    files = sorted(RECORDINGS.glob("*.json"))
    assert len(files) >= 10
    for path in files:
        data = json.loads(path.read_text())
        assert data["service"] == "ASU Voyager"
        assert data["model"] == "qwen3-235b-a22b-instruct-2507"
        text = path.read_text().lower()
        assert "authorization" not in text and "bearer" not in text and "api_key" not in text


@pytest.mark.parametrize("name", sorted(DESCRIBED))
def test_described_objects_become_grounded_proposals_and_valid_models(name: str) -> None:
    result = propose_object(PROVIDER, recording(name)["key"])
    assert result.outcome == "proposal" and result.proposal is not None
    assert result.provider.mode == "recorded"
    axis, value = DESCRIBED[name]
    stated = getattr(result.proposal.dimensions, axis)
    assert (stated.basis, stated.value_m, stated.needs_confirmation) == ("stated", value, False)
    assert stated.quote is not None and stated.quote.lower() in recording(name)["key"].lower()
    # Every estimate waits for the user's confirmation.
    for other in ("width", "height", "depth"):
        length = getattr(result.proposal.dimensions, other)
        assert length.needs_confirmation == (length.basis == "inferred")
    model = build_model(result.proposal.spec)
    e = result.proposal.spec.envelope_m
    lo, hi = model.bounds.min, model.bounds.max
    assert (hi.x - lo.x, hi.y - lo.y, hi.z - lo.z) == pytest.approx((e.x, e.y, e.z), abs=1e-4)
    assert lo.y == pytest.approx(0, abs=1e-6)


# sha256 of the models built from the recorded proposals, computed on macOS (arm64). CI builds
# them on Linux: equal hashes show the generator is byte-identical across platforms, which is
# what lets a project rebuild a missing model on another machine.
GOLDEN_SHA256 = {
    "object-guarded-conveyor": "8b0595ca61d9bdc7ee3c4ba07faa2e0d18151f8e94364d704bb5fa5e8c5e8803",
    "object-water-tank": "566b60e35d588927623a1e55ffdcac252a594bc96293f30bc072ea8fa7cc1352",
    "object-workbench": "4900b9e91f5aaa3686cae7f4b0d9eef61246e61680be89ffe049d58489c5d8d0",
}


@pytest.mark.parametrize("name", sorted(GOLDEN_SHA256))
def test_the_same_specification_builds_the_same_bytes_on_every_platform(name: str) -> None:
    result = propose_object(PROVIDER, recording(name)["key"])
    assert result.proposal is not None
    assert build_model(result.proposal.spec).sha256 == GOLDEN_SHA256[name]


def test_a_stated_length_on_the_depth_axis_is_turned_to_run_along_x() -> None:
    result = propose_object(PROVIDER, recording("object-guarded-conveyor")["key"])
    assert result.proposal is not None
    assert result.proposal.dimensions.width.quote == "about 2.2 m long"
    assert any(check.startswith("Turned so that its stated length") for check in result.checks)


def test_different_descriptions_give_visibly_different_models() -> None:
    models = {}
    for name in DESCRIBED:
        result = propose_object(PROVIDER, recording(name)["key"])
        assert result.proposal is not None
        model = build_model(result.proposal.spec)
        models[name] = (model.sha256, frozenset(model.materials), result.proposal.spec.envelope_m)
    hashes = {sha for sha, _, _ in models.values()}
    assert len(hashes) == len(DESCRIBED)
    materials = [m for _, m, _ in models.values()]
    assert len(set(materials)) == len(materials), "each object uses a different set of materials"


@pytest.mark.parametrize(
    ("name", "outcome"),
    [("object-vague", "clarification"), ("object-hostile", "unsupported")],
)
def test_vague_and_hostile_descriptions_are_not_turned_into_objects(
    name: str, outcome: str
) -> None:
    result = propose_object(PROVIDER, recording(name)["key"])
    assert (result.outcome, result.proposal) == (outcome, None)


EDITS: dict[str, tuple[str, str | None]] = {
    "edit-move-selected-cabinet": ("proposal", "obj-cabinet-1"),
    "edit-named-conveyor": ("proposal", "obj-conveyor-infeed"),
    "edit-rotate-pallet": ("proposal", "obj-pallet-staged"),
    "edit-too-far": ("proposal", "obj-cabinet-1"),  # the editor, not the model, refuses 2 km
    "edit-ambiguous-cabinet": ("clarification", None),
    "edit-selection-mismatch": ("clarification", None),
    "edit-no-distance": ("clarification", None),
    "edit-unsupported-colour": ("unsupported", None),
    "edit-hostile-edit": ("unsupported", None),
}


def edit_request(name: str) -> EditProposalRequest:
    request, _, selected = recording(name)["key"].rpartition(" | selected=")
    objects = [
        {
            "id": o.id,
            "name": o.name,
            "kind": o.kind,
            "position_m": o.transform.position_m.model_dump(),
            "rotation_y_rad": o.transform.rotation_rad.y,
            "size_m": {
                "x": o.dimensions.width.value_m,
                "y": o.dimensions.height.value_m,
                "z": o.dimensions.depth.value_m,
            },
        }
        for o in DEMO.scene.objects
    ]
    return EditProposalRequest.model_validate(
        {
            "request": request,
            "context": {
                "revision": 0,
                "selected_object_id": None if selected == "none" else selected,
                "objects": objects,
            },
        }
    )


@pytest.mark.parametrize("name", sorted(EDITS))
def test_recorded_edit_requests_get_the_expected_outcome(name: str) -> None:
    outcome, target = EDITS[name]
    result = propose_edit(PROVIDER, edit_request(name))
    assert result.outcome == outcome, (result.question, result.message)
    if target is not None:
        assert result.intent is not None and result.intent.target.object_ids == [target]


def test_the_ambiguous_request_offers_both_cabinets() -> None:
    result = propose_edit(PROVIDER, edit_request("edit-ambiguous-cabinet"))
    assert {"obj-cabinet-1", "obj-cabinet-2"} <= set(result.candidates)


def test_two_kilometres_reach_the_editor_as_two_kilometres() -> None:
    result = propose_edit(PROVIDER, edit_request("edit-too-far"))
    assert result.intent is not None and result.intent.move is not None
    move = result.intent.move
    assert move.distance * {"km": 1000.0, "m": 1.0}[move.unit] == 2000.0
