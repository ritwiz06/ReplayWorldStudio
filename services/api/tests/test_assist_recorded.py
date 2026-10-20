"""Real answers from the live provider, replayed offline through the whole pipeline.

The recordings in fixtures/assist/recorded/ were made by `scripts/evaluate_assist.py --record`
against ASU Voyager. Replaying them checks parsing, grounding, clarification rules and model
generation on genuine model output, deterministically and without a network. A replay is a
test fixture, never live AI.
"""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from replay_world_api.assist.edits import propose_edit
from replay_world_api.assist.images import propose_image
from replay_world_api.assist.plans import propose_plan
from replay_world_api.assist.proposals import propose_object
from replay_world_api.assist.provider import RecordedProvider
from replay_world_api.assist.revisions import propose_revision, revision_key
from replay_world_api.objects import build_model, fit_to_envelope
from replay_world_api.photos import inspect_photo
from replay_world_api.settings import AssistSettings
from replay_world_contracts import (
    EditProposalRequest,
    GeometryDraft,
    ImageAnalysisRequest,
    ImageProposalResult,
    ModelRevisionProposalRequest,
    Project,
)

ROOT = Path(__file__).resolve().parents[3]
RECORDINGS = ROOT / "fixtures" / "assist" / "recorded"
DEMO = Project.model_validate_json(
    (ROOT / "fixtures" / "scenes" / "industrial-demo.json").read_text()
)
PROVIDER = RecordedProvider(AssistSettings(provider="recorded", recordings_dir=RECORDINGS))
VISION = RecordedProvider(
    AssistSettings(provider="recorded", recordings_dir=RECORDINGS), tasks=("image",)
)


def recording(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((RECORDINGS / f"{name}.json").read_text())
    return data


# Three substantially different descriptions, each with the size the user stated.
DESCRIBED = {
    "object-guarded-conveyor": ("width", 2.2),
    "object-water-tank": ("height", 1.5),
    "object-workbench": ("width", 1.8),
}


# Photos are answered by the vision model; descriptions, edits and revisions by the language
# model.
LIVE_MODELS = {
    "object": "qwen3-235b-a22b-instruct-2507",
    "edit": "qwen3-235b-a22b-instruct-2507",
    "revision": "qwen3-235b-a22b-instruct-2507",
    "image": "qwen3-vl-32b-instruct",
    "plan": "qwen3-vl-32b-instruct",
    "setup": "qwen3-235b-a22b-instruct-2507",
    "chat": "qwen3-235b-a22b-instruct-2507",
}


def test_recordings_name_the_live_model_and_hold_no_secrets() -> None:
    files = sorted(RECORDINGS.glob("*.json"))
    assert len(files) >= 10
    for path in files:
        data = json.loads(path.read_text())
        assert data["service"] == "ASU Voyager"
        assert data["model"] == LIVE_MODELS[data["task"]]
        if data["task"] == "image":
            # Keyed by the original photo's bytes, which are committed beside the recording.
            photo = (ROOT / "fixtures" / "photos" / data["photo"]).read_bytes()
            assert data["key"] == hashlib.sha256(photo).hexdigest()
        if data["task"] == "plan":
            # Keyed by the synthetic plan's bytes, committed in fixtures/plans/.
            plan = (ROOT / "fixtures" / "plans" / data["plan"]).read_bytes()
            assert data["key"] == hashlib.sha256(plan).hexdigest()
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


PHOTOS = sorted(path.stem for path in RECORDINGS.glob("image-*.json"))


def photo_proposal(name: str) -> ImageProposalResult:
    """Replay as scripts/evaluate_image_import.py recorded it: the photo as its own copy."""
    photo = (ROOT / "fixtures" / "photos" / recording(name)["photo"]).read_bytes()
    info = inspect_photo(photo)
    request = ImageAnalysisRequest.model_validate(
        {
            "media_type": info.media_type,
            "data_base64": base64.b64encode(photo).decode("ascii"),
            "width_px": info.width_px,
            "height_px": info.height_px,
            "original_sha256": hashlib.sha256(photo).hexdigest(),
        }
    )
    return propose_image(VISION, request)


def test_every_committed_photo_has_a_recorded_answer() -> None:
    # The permitted photos in fixtures/photos/, and three IMG-03 renders (a development one for the
    # browser cross-check, two held-out ones only to show their scored errors; "photo" is a path
    # from fixtures/photos/ to docs/assist-evaluation/img-03/photos/).
    fixtures = {
        p.name
        for p in (ROOT / "fixtures" / "photos").iterdir()
        if p.suffix in (".jpg", ".png", ".webp")
    }
    recorded = {recording(name)["photo"] for name in PHOTOS}
    assert fixtures <= recorded
    assert recorded - fixtures == {
        f"../../docs/assist-evaluation/img-03/photos/{name}.jpg"
        for name in ("dev-office-a", "office-a", "store-a")
    }


@pytest.mark.parametrize("name", PHOTOS)
def test_recorded_photos_become_proposals_with_placeable_objects(name: str) -> None:
    result = photo_proposal(name)
    assert result.outcome == "proposal" and result.proposal is not None
    assert (result.provider.mode, result.provider.model) == ("recorded", "qwen3-vl-32b-instruct")
    objects = result.proposal.objects
    assert len(objects) >= 3
    placeable = [o for o in objects if o.suggest_accept and o.on_floor and o.floor_contact]
    assert len(placeable) >= 3
    # Only floor objects are suggested, and each one has a point to stand on.
    assert all(o.on_floor and o.floor_contact is not None for o in objects if o.suggest_accept)


def test_a_sign_telling_the_model_what_to_report_is_only_text() -> None:
    result = photo_proposal("image-factory-walk-sign")
    assert result.proposal is not None
    assert any(
        "ignore all previous instructions" in text.lower() for text in result.proposal.visible_text
    )
    labels = [o.label.lower() for o in result.proposal.objects]
    assert len(labels) < 50
    assert not any("robot" in label for label in labels)
    assert any("conveyor" in label for label in labels)
    assert any("machine" in label for label in labels)


def test_the_classroom_tables_named_with_their_chairs_are_flagged() -> None:
    result = photo_proposal("image-classroom")
    assert result.proposal is not None
    grouped = [o for o in result.proposal.objects if "with chairs" in o.label]
    assert grouped and all(
        any("the label names a group" in note for note in o.notes) for o in grouped
    )
    assert {o.template for o in grouped} == {"table"}


# Revision cases, as scripts/evaluate_model_revisions.py runs and records them.
REVISION_CASES = {
    case["label"]: case
    for case in json.loads((ROOT / "scripts" / "model_revision_cases.json").read_text())
}
# The inspect-* and review-* recordings (GEN-06/07, scripts/build_inspection_recordings.py) are
# keyed against builder and legacy objects, not these cases; e2e/review.spec.ts and
# e2e/inspect-revisions.spec.ts replay them through the app. The gen09-* recordings are keyed
# against fixtures/gen09/gen08-regressions.json; tests/test_misleading.py replays them.
REVISED = sorted(
    path.stem.removeprefix("revision-")
    for path in RECORDINGS.glob("revision-*.json")
    if not path.stem.startswith(("revision-inspect-", "revision-review-", "revision-gen09-"))
)


def revision_request(label: str) -> ModelRevisionProposalRequest:
    case = REVISION_CASES[label]
    spec, _scale, _notes = fit_to_envelope(GeometryDraft.model_validate(case["spec"]))
    return ModelRevisionProposalRequest(
        name=case["name"], spec=spec, instruction=case["instruction"]
    )


@pytest.mark.parametrize("label", REVISED)
def test_every_revision_recording_replays_for_its_case(label: str) -> None:
    request = revision_request(label)
    assert recording(f"revision-{label}")["key"] == revision_key(request)
    result = propose_revision(PROVIDER, request)
    assert result.provider.mode == "recorded"
    if result.spec is not None:
        model = build_model(result.spec)
        assert model.sha256 != build_model(request.spec).sha256


def test_the_recorded_open_shelf_has_separate_panels_and_keeps_its_size() -> None:
    request = revision_request("cabinet-open-shelves")
    result = propose_revision(PROVIDER, request)
    assert result.outcome == "proposal" and result.spec is not None
    assert result.spec.envelope_m == request.spec.envelope_m and not result.size_changed
    e = result.spec.envelope_m
    shares = [p.size_m.x * p.size_m.y * p.size_m.z / (e.x * e.y * e.z) for p in result.spec.parts]
    assert max(shares) < 0.1  # panels and shelves, no solid block standing in for the opening
    # At least two thin horizontal boards across the width (shelves, top or bottom), whatever
    # the model calls them.
    boards = [p for p in result.spec.parts if p.size_m.y < 0.05 and p.size_m.x > 0.5 * e.x]
    assert len(boards) >= 2


def test_the_recorded_colour_change_keeps_the_size_and_uses_the_colours() -> None:
    request = revision_request("cabinet-blue-red-top")
    result = propose_revision(PROVIDER, request)
    assert result.outcome == "proposal" and result.spec is not None
    assert result.spec.envelope_m == request.spec.envelope_m and not result.size_changed
    assert {"paint_blue", "paint_red"} <= {p.material for p in result.spec.parts}
    assert "Size kept: the instruction did not ask for a different size." in result.checks


PLAN_PROVIDER = RecordedProvider(
    AssistSettings(provider="recorded", recordings_dir=RECORDINGS), tasks=("plan",)
)


def plan_request(name: str) -> ImageAnalysisRequest:
    data = (ROOT / "fixtures" / "plans" / name).read_bytes()
    sketch = (ROOT / "fixtures" / "plans" / "rough-cell.png").read_bytes()
    # The recording is keyed by the plan's bytes; the picture sent is replayed, not looked at.
    return ImageAnalysisRequest(
        media_type="image/png",
        data_base64=base64.b64encode(sketch).decode("ascii"),
        width_px=1600,
        height_px=1100,
        original_sha256=hashlib.sha256(data).hexdigest(),
    )


def test_the_recorded_hall_draft_has_its_six_objects_and_obeys_no_note_on_the_plan() -> None:
    result = propose_plan(PLAN_PROVIDER, plan_request("packing-hall.pdf"))
    assert result.outcome == "proposal" and result.proposal is not None
    assert result.provider.mode == "recorded"
    labels = sorted(o.label for o in result.proposal.objects)
    assert labels == ["Conveyor", "KEEP CLEAR", "Packing table", "Rack 1", "Rack 2", "Wrapper"]
    assert result.proposal.floor is not None
    texts = [t.text for t in result.proposal.texts]
    assert any("NOTE FOR AUTOMATED TOOLS" in t for t in texts)  # reported as content, not obeyed


def test_the_recorded_sketch_draft_proposes_the_dashed_idea_as_an_object() -> None:
    result = propose_plan(PLAN_PROVIDER, plan_request("rough-cell.png"))
    assert result.proposal is not None
    assert "future cart?" in [o.label for o in result.proposal.objects]  # for the person to remove
