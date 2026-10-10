"""Language assistance: grounding, retries, clarifications, settings and the HTTP boundary.

A scripted fake provider stands in for the model so every rule of the pipeline is exercised
deterministically. (Replays of real recorded answers are in test_assist_recorded.py.)
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import pytest
from fastapi.testclient import TestClient
from replay_world_api.app import create_app
from replay_world_api.assist.edits import propose_edit
from replay_world_api.assist.lengths import find_angles, find_lengths, find_stated
from replay_world_api.assist.proposals import AssistError, propose_object
from replay_world_api.assist.provider import Completion, Task
from replay_world_api.settings import AssistSettings, Settings, read_env_file
from replay_world_contracts import (
    AssistStatus,
    CatalogAsset,
    EditProposalRequest,
    GeneratedModel,
    GeneratedModelRestoreReport,
    ObjectProposalResult,
    Project,
)

ROOT = Path(__file__).resolve().parents[3]
DEMO = Project.model_validate_json(
    (ROOT / "fixtures" / "scenes" / "industrial-demo.json").read_text()
)
CONVEYOR = "a guarded conveyor about 2.2 m long with a control screen"


@dataclass
class Fake:
    """Answers with the given texts in order (the last one repeats)."""

    answers: list[str]
    service: str = "Fake provider"
    base_url: str = "https://fake.invalid/v1"
    model: str = "fake-model"
    mode: Literal["live", "recorded"] = "recorded"
    calls: list[list[dict[str, str]]] = field(default_factory=list)

    def complete(
        self,
        *,
        task: Task,
        key: str,
        messages: list[dict[str, str]],
        schema: dict[str, Any],
        attempt: int,
    ) -> Completion:
        self.calls.append(messages)
        return Completion(self.answers[min(attempt, len(self.answers) - 1)], latency_ms=10)


def part(
    pid: str, center: tuple[float, float, float], size: tuple[float, float, float], **extra: Any
) -> dict[str, Any]:
    return {
        "id": pid,
        "label": pid.replace("-", " "),
        "shape": "box",
        "material": "aluminium",
        "center_m": dict(zip("xyz", center, strict=True)),
        "size_m": dict(zip("xyz", size, strict=True)),
        "axis": "y",
        "taper": None,
        "narrow_end": None,
        "basis": "inferred",
    } | extra


def object_answer(**overrides: Any) -> str:
    answer: dict[str, Any] = {
        "outcome": "proposal",
        "question": None,
        "message": None,
        "name": "Guarded conveyor",
        "category": "conveyor",
        "appearance": "An aluminium conveyor with clear guards and a screen.",
        "dimensions": {
            "width": {"value_m": 2.2, "basis": "stated", "quote": "about 2.2 m long"},
            "height": {"value_m": 1.2, "basis": "inferred", "quote": None},
            "depth": {"value_m": 0.7, "basis": "inferred", "quote": None},
        },
        "stated_facts": ["About 2.2 m long", "Has a control screen"],
        "inferred_facts": ["Typical height assumed"],
        "not_modelled": [],
        "parts": [
            part("belt", (0, 0.85, 0), (2.2, 0.1, 0.7)),
            part("legs", (0, 0.4, 0), (2.0, 0.8, 0.5)),
            part(
                "screen", (0.9, 1.05, 0.3), (0.3, 0.3, 0.1), basis="stated", material="hmi_screen"
            ),
        ],
    }
    answer.update(overrides)
    return json.dumps(answer)


# --- Lengths in the user's words -----------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "metres"),
    [
        ("about 2.2 m long", [2.2]),
        ("a 1.2 x 0.8 m bench, 900mm high", [1.2, 0.8, 0.9]),
        ("3 metres tall and 1,5 m wide", [3.0, 1.5]),
        ("a 7 ft rack", [2.1336]),
        ("half a metre", [0.5]),
        ("a machine on a mat", []),
        ("move it left a bit", []),
    ],
)
def test_lengths_are_read_only_where_written_with_a_unit(text: str, metres: list[float]) -> None:
    assert [round(f.metres, 4) for f in find_lengths(text)] == metres


def test_a_stated_value_must_match_a_length_in_the_text() -> None:
    assert find_stated(CONVEYOR, 2.2) is not None
    assert find_stated(CONVEYOR, 2200 * 0.001) is not None
    assert find_stated(CONVEYOR, 2.5) is None
    assert find_angles("turn it 90 degrees, then a quarter turn") == [90.0, 90.0]
    assert find_angles("turn it a bit") == []


# --- Object proposals ------------------------------------------------------------------------


def test_a_proposal_keeps_stated_sizes_and_asks_to_confirm_estimates() -> None:
    result = propose_object(Fake([object_answer()]), CONVEYOR)
    proposal = result.proposal
    assert result.outcome == "proposal" and proposal is not None
    width, height = proposal.dimensions.width, proposal.dimensions.height
    assert (width.basis, width.quote, width.needs_confirmation) == (
        "stated",
        "about 2.2 m long",
        False,
    )
    assert (height.basis, height.needs_confirmation) == ("inferred", True)
    # The parts were fitted to the envelope by the deterministic generator.
    assert proposal.spec.envelope_m.model_dump() == {"x": 2.2, "y": 1.2, "z": 0.7}
    assert {u.property for u in proposal.unknown_properties} == {
        "mass",
        "strength",
        "chemical_composition",
        "operating_behaviour",
    }
    assert (result.provider.attempts, result.provider.first_attempt_valid) == (1, True)


def test_a_stated_size_that_is_not_in_the_words_becomes_an_estimate() -> None:
    dims = json.loads(object_answer())["dimensions"]
    dims["depth"] = {"value_m": 0.7, "basis": "stated", "quote": "0.7 m deep"}
    result = propose_object(Fake([object_answer(dimensions=dims)]), CONVEYOR)
    assert result.proposal is not None
    depth = result.proposal.dimensions.depth
    assert (depth.basis, depth.quote, depth.needs_confirmation) == ("inferred", None, True)
    assert any(
        "depth (0.7 m) was marked as coming from your description" in c for c in result.checks
    )


def test_an_invalid_answer_is_retried_once_with_the_problems_listed() -> None:
    fake = Fake(['{"outcome": "proposal", "name": 3}', object_answer()])
    result = propose_object(fake, CONVEYOR)
    assert (result.provider.attempts, result.provider.first_attempt_valid) == (2, False)
    assert "cannot be used" in fake.calls[1][-1]["content"]


def test_two_unusable_answers_are_an_error_not_a_guess() -> None:
    with pytest.raises(AssistError) as caught:
        propose_object(Fake(["not json at all"]), CONVEYOR)
    assert caught.value.status == 502
    assert "did not return a usable proposal after 2 attempts" in caught.value.message


def test_parts_are_cleaned_or_dropped_deterministically() -> None:
    parts = [
        part("belt", (0, 0.85, 0), (2.2, 0.1, 0.7)),
        part("roller", (0, 0.5, 0), (0.1, 0.1, 0.6), shape="cylinder", axis="z"),
        part("bad", (0, 0.5, 0), (0.0, 0.1, 0.1)),  # zero size
        part("legs", (0, 0.4, 0), (2.0, 0.8, 0.5), axis="x"),  # an axis on a box is ignored
    ]
    result = propose_object(Fake([object_answer(parts=parts)]), CONVEYOR)
    assert result.proposal is not None
    by_id = {p.id: p for p in result.proposal.spec.parts}
    assert list(by_id) == ["belt", "roller", "legs"]
    assert (by_id["roller"].axis, by_id["legs"].axis) == ("z", None)
    assert any("Parts left out" in c and "bad" in c for c in result.checks)


def test_a_cylinder_without_an_axis_is_a_schema_error_that_is_retried() -> None:
    no_axis = [part("roller", (0, 0.5, 0), (2.2, 1.2, 0.7), shape="cylinder", axis=None)]
    fake = Fake([object_answer(parts=no_axis), object_answer()])
    result = propose_object(fake, CONVEYOR)
    assert (result.provider.attempts, result.provider.first_attempt_valid) == (2, False)
    assert "parts/0/axis" in fake.calls[1][-1]["content"]


def test_mentioned_mass_and_rates_are_recorded_but_never_modelled() -> None:
    text = "a 500 kg press about 1.2 m wide doing 20 strokes per minute"
    dims = json.loads(object_answer())["dimensions"]
    dims["width"] = {"value_m": 1.2, "basis": "stated", "quote": "about 1.2 m wide"}
    result = propose_object(Fake([object_answer(dimensions=dims)]), text)
    assert result.proposal is not None
    joined = " ".join(result.proposal.not_modelled)
    assert "500 kg" in joined and "20 strokes per minute" in joined


@pytest.mark.parametrize(
    ("overrides", "outcome"),
    [
        ({"outcome": "clarification", "question": "What kind of object?"}, "clarification"),
        ({"outcome": "unsupported", "message": "Not an object."}, "unsupported"),
    ],
)
def test_questions_and_refusals_pass_through(overrides: dict[str, Any], outcome: str) -> None:
    empty: dict[str, Any] = {
        "name": None,
        "category": None,
        "appearance": None,
        "dimensions": None,
        "parts": [],
    }
    result = propose_object(Fake([object_answer(**empty, **overrides)]), "a thing for the line")
    assert (result.outcome, result.proposal) == (outcome, None)


# --- Edit proposals ----------------------------------------------------------------------------


def edit_request(text: str, selected: str | None) -> EditProposalRequest:
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
            "request": text,
            "context": {"revision": 0, "selected_object_id": selected, "objects": objects},
        }
    )


def move_answer(
    target: str | None,
    reference: str = "selected",
    phrase: str = "the selected cabinet",
    direction: str = "left",
    distance: float = 1.0,
    unit: str = "m",
) -> str:
    return json.dumps(
        {
            "outcome": "proposal",
            "question": None,
            "candidates": [],
            "message": None,
            "action": "move",
            "target": {"reference": reference, "object_id": target, "phrase": phrase},
            "move": {
                "direction": direction,
                "distance": distance,
                "unit": unit,
                "quote": "1 metre",
            },
            "rotate": None,
        }
    )


def test_a_clear_edit_becomes_a_typed_intent() -> None:
    request = edit_request("move the selected cabinet 1 metre left", "obj-cabinet-1")
    result = propose_edit(Fake([move_answer("obj-cabinet-1")]), request)
    assert result.outcome == "proposal" and result.intent is not None
    assert result.intent.target.object_ids == ["obj-cabinet-1"]
    assert result.intent.move is not None and result.intent.move.direction == "left"


def test_the_selection_must_match_the_words() -> None:
    request = edit_request("move the selected cabinet 1 metre left", "obj-conveyor-infeed")
    result = propose_edit(Fake([move_answer("obj-conveyor-infeed")]), request)
    assert result.outcome == "clarification"
    assert result.question is not None and "Infeed conveyor" in result.question
    assert result.candidates[0] == "obj-conveyor-infeed"
    assert {"obj-cabinet-1", "obj-cabinet-2"} <= set(result.candidates)


def test_words_that_fit_several_objects_get_a_question_even_if_the_model_picked_one() -> None:
    request = edit_request("move the cabinet 1 m left", None)
    answer = move_answer("obj-cabinet-2", reference="named", phrase="the cabinet")
    result = propose_edit(Fake([answer]), request)
    assert result.outcome == "clarification"
    assert {"obj-cabinet-1", "obj-cabinet-2"} <= set(result.candidates)


def test_a_distance_or_direction_missing_from_the_words_is_asked_for() -> None:
    no_distance = propose_edit(
        Fake([move_answer("obj-cabinet-2", distance=0.5)]),
        edit_request("move it left a bit", "obj-cabinet-2"),
    )
    assert no_distance.outcome == "clarification"
    assert no_distance.question is not None and "How far" in no_distance.question
    no_direction = propose_edit(
        Fake([move_answer("obj-cabinet-2", direction="right")]),
        edit_request("move it 1 m", "obj-cabinet-2"),
    )
    assert no_direction.outcome == "clarification"
    assert no_direction.question is not None and "Which way" in no_direction.question


def test_a_target_outside_the_scene_is_never_proposed() -> None:
    selected = edit_request("move the selected cabinet 1 metre left", "obj-cabinet-1")
    asked = propose_edit(Fake([move_answer("obj-not-here")]), selected)
    assert asked.outcome == "clarification" and "obj-not-here" not in asked.candidates
    named = edit_request("move the cabinet 1 metre left", None)
    unknown = move_answer("obj-not-here", reference="named", phrase="the cabinet")
    with pytest.raises(AssistError, match="did not return a usable edit"):
        propose_edit(Fake([unknown]), named)


def test_the_word_selected_refers_to_the_selection_even_when_the_model_named_another() -> None:
    request = edit_request("move the selected cabinet 1 metre left", "obj-conveyor-infeed")
    answer = move_answer("obj-cabinet-1", reference="named", phrase="cabinet")
    result = propose_edit(Fake([answer]), request)
    assert result.outcome == "clarification"
    assert (
        result.question is not None and "the selected object is Infeed conveyor" in result.question
    )
    assert result.candidates[0] == "obj-conveyor-infeed"


def test_a_distance_in_kilometres_is_understood_and_left_to_the_editor_to_refuse() -> None:
    request = edit_request("move the selected cabinet 2 km left", "obj-cabinet-1")
    result = propose_edit(Fake([move_answer("obj-cabinet-1", distance=2, unit="km")]), request)
    assert result.outcome == "proposal" and result.intent is not None
    assert result.intent.move is not None and (
        result.intent.move.distance,
        result.intent.move.unit,
    ) == (
        2,
        "km",
    )
    # The model silently converting 2 km to "2 m" would not survive the grounding check.
    converted = propose_edit(Fake([move_answer("obj-cabinet-1", distance=2, unit="m")]), request)
    assert converted.outcome == "clarification"


def test_a_turn_needs_its_angle_and_direction_in_the_words() -> None:
    def rotate(direction: str, angle: float) -> str:
        return json.dumps(
            {
                "outcome": "proposal",
                "question": None,
                "candidates": [],
                "message": None,
                "action": "rotate",
                "target": {
                    "reference": "named",
                    "object_id": "obj-pallet-staged",
                    "phrase": "staged pallet",
                },
                "move": None,
                "rotate": {"direction": direction, "angle_deg": angle, "quote": "90 degrees"},
            }
        )

    ok = propose_edit(
        Fake([rotate("clockwise", 90)]),
        edit_request("rotate the staged pallet 90 degrees clockwise", None),
    )
    assert ok.outcome == "proposal"
    guessed = propose_edit(
        Fake([rotate("clockwise", 90)]), edit_request("rotate the staged pallet 90 degrees", None)
    )
    assert guessed.outcome == "clarification"


# --- Settings ----------------------------------------------------------------------------------


def test_the_env_file_supplies_only_rws_and_voyager_names(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text(
        "# comment\nVOYAGER_API_KEY='secret-value'\nexport RWS_API_PORT=8123\nOTHER=1\n"
        'VOYAGER_MODEL="model-x"\n'
    )
    assert read_env_file(env) == {
        "VOYAGER_API_KEY": "secret-value",
        "RWS_API_PORT": "8123",
        "VOYAGER_MODEL": "model-x",
    }
    assert read_env_file(tmp_path / "missing") == {}


def test_a_key_selects_the_live_provider_and_never_appears_in_repr() -> None:
    settings = Settings.from_env({"VOYAGER_API_KEY": "secret-value"})
    assert settings.assist.provider == "voyager"
    assert settings.assist.model == "qwen3-235b-a22b-instruct-2507"
    assert "secret-value" not in repr(settings)
    assert Settings.from_env({}).assist.provider == "off"
    off = Settings.from_env({"VOYAGER_API_KEY": "k", "RWS_ASSIST_PROVIDER": "off"})
    assert off.assist.provider == "off"
    with pytest.raises(ValueError, match="RWS_ASSIST_PROVIDER"):
        Settings.from_env({"RWS_ASSIST_PROVIDER": "magic"})


# --- HTTP boundary -----------------------------------------------------------------------------


@pytest.fixture
def library(tmp_path: Path) -> Path:
    """A catalog library with the committed models, so generated files land in a temp folder."""
    shutil.copytree(ROOT / "assets" / "catalog" / "models", tmp_path / "models")
    return tmp_path


def make_client(library: Path, assist: AssistSettings) -> TestClient:
    return TestClient(create_app(Settings(catalog_dir=library, assist=assist)))


@pytest.fixture
def recorded(tmp_path: Path, library: Path) -> Iterator[TestClient]:
    recordings = tmp_path / "recordings"
    recordings.mkdir()
    (recordings / "object-conveyor.json").write_text(
        json.dumps(
            {
                "task": "object",
                "key": CONVEYOR,
                "model": "qwen3-235b-a22b-instruct-2507",
                "responses": [object_answer()],
            }
        )
    )
    assist = AssistSettings(provider="recorded", recordings_dir=recordings)
    with make_client(library, assist) as client:
        yield client


def test_without_a_provider_proposals_are_off_and_say_how_to_enable_them(library: Path) -> None:
    with make_client(library, AssistSettings()) as client:
        status = AssistStatus.model_validate(client.get("/api/v1/assist/status").json())
        assert (status.available, status.mode) == (False, "off")
        assert "VOYAGER_API_KEY" in status.message
        response = client.post("/api/v1/assist/object-proposals", json={"description": CONVEYOR})
        assert response.status_code == 503


def test_the_status_names_the_live_model_but_never_the_key(library: Path) -> None:
    assist = AssistSettings(provider="voyager", api_key="secret-value")
    with make_client(library, assist) as client:
        body = client.get("/api/v1/assist/status").text
    status = AssistStatus.model_validate_json(body)
    assert (status.mode, status.model) == ("live", "qwen3-235b-a22b-instruct-2507")
    assert "secret-value" not in body


def test_recorded_answers_are_labelled_and_unrecorded_requests_refused(
    recorded: TestClient,
) -> None:
    status = AssistStatus.model_validate(recorded.get("/api/v1/assist/status").json())
    assert status.mode == "recorded" and "Not live AI" in status.message
    ok = recorded.post("/api/v1/assist/object-proposals", json={"description": CONVEYOR})
    result = ObjectProposalResult.model_validate(ok.json())
    assert result.provider.mode == "recorded" and result.outcome == "proposal"
    missing = recorded.post("/api/v1/assist/object-proposals", json={"description": "a red chair"})
    assert missing.status_code == 503
    assert "no recorded answer" in missing.json()["detail"]


def _asset_request(result: ObjectProposalResult, confirmed: bool) -> dict[str, Any]:
    assert result.proposal is not None
    p = result.proposal

    def review(axis: str) -> dict[str, Any]:
        d = getattr(p.dimensions, axis)
        return {"basis": d.basis, "quote": d.quote, "confirmed": confirmed or d.basis == "stated"}

    return {
        "name": p.name,
        "kind": "equipment",
        "method": "described",
        "description": CONVEYOR,
        "language_model": {
            "service": result.provider.service,
            "base_url": result.provider.base_url,
            "model": result.provider.model,
        },
        "spec": p.spec.model_dump(mode="json"),
        "dimensions": {axis: review(axis) for axis in ("width", "height", "depth")},
        "stated_facts": p.stated_facts,
        "inferred_facts": p.inferred_facts,
        "not_modelled": p.not_modelled,
    }


def test_preview_returns_the_verified_bytes_without_storing_them(
    recorded: TestClient, library: Path
) -> None:
    proposal = ObjectProposalResult.model_validate(
        recorded.post("/api/v1/assist/object-proposals", json={"description": CONVEYOR}).json()
    )
    assert proposal.proposal is not None
    spec = proposal.proposal.spec.model_dump(mode="json")
    preview = GeneratedModel.model_validate(
        recorded.post("/api/v1/catalog/generated-models/preview", json={"spec": spec}).json()
    )
    assert preview.glb_base64 and not preview.stored
    assert not (library / "generated").exists()
    stored = GeneratedModel.model_validate(
        recorded.post("/api/v1/catalog/generated-models", json={"spec": spec}).json()
    )
    assert stored.visual == preview.visual and stored.glb_base64 is None
    assert (library / stored.visual.uri).is_file()


def test_estimates_must_be_confirmed_before_an_asset_is_created(
    recorded: TestClient, library: Path
) -> None:
    proposal = ObjectProposalResult.model_validate(
        recorded.post("/api/v1/assist/object-proposals", json={"description": CONVEYOR}).json()
    )
    refused = recorded.post(
        "/api/v1/catalog/generated-assets", json=_asset_request(proposal, confirmed=False)
    )
    assert refused.status_code == 422
    assert "Confirm the estimated height" in refused.json()["detail"]
    created = recorded.post(
        "/api/v1/catalog/generated-assets", json=_asset_request(proposal, confirmed=True)
    )
    asset = CatalogAsset.model_validate(created.json())
    width, height = asset.nominal_dimensions.width, asset.nominal_dimensions.height
    assert (width.origin, width.review_status) == ("user_supplied", "confirmed")
    assert width.source_ref == "Stated in the description: “about 2.2 m long”"
    assert (height.origin, height.review_status) == ("inferred", "confirmed")
    assert asset.source.kind == "generated" and asset.generation is not None
    assert asset.rights.license == "NOASSERTION"
    assert (library / asset.visual.uri).is_file()  # type: ignore[union-attr]


def _project_with(asset: CatalogAsset) -> dict[str, Any]:
    doc = DEMO.model_dump(mode="json")
    doc["catalog"].append(asset.model_dump(mode="json"))
    doc["scene"]["revision"] = 1
    doc["scene"]["objects"].append(
        {
            "id": "obj-gen-conveyor",
            "name": asset.name,
            "kind": "equipment",
            "asset_id": asset.id,
            "transform": {
                "position_m": {"x": 4.0, "y": 0.0, "z": 3.0},
                "rotation_rad": {"order": "XYZ", "x": 0.0, "y": 0.0, "z": 0.0},
            },
            "dimensions": asset.nominal_dimensions.model_dump(mode="json"),
            "parameters": [],
        }
    )
    doc["scene"]["edit_log"].append(
        {
            "type": "object_added",
            "revision": 1,
            "object_id": "obj-gen-conveyor",
            "asset_id": asset.id,
            "duplicate_of": None,
        }
    )
    return doc


def test_a_project_with_a_generated_model_saves_reopens_and_restores_a_missing_file(
    recorded: TestClient, library: Path
) -> None:
    proposal = ObjectProposalResult.model_validate(
        recorded.post("/api/v1/assist/object-proposals", json={"description": CONVEYOR}).json()
    )
    asset = CatalogAsset.model_validate(
        recorded.post(
            "/api/v1/catalog/generated-assets", json=_asset_request(proposal, confirmed=True)
        ).json()
    )
    doc = _project_with(asset)
    assert recorded.post("/api/v1/projects/validate", json=doc).status_code == 200

    # On another machine the generated file is missing: opening is refused at its location...
    model_file = library / asset.visual.uri  # type: ignore[union-attr]
    model_file.unlink()
    missing = recorded.post("/api/v1/projects/validate", json=doc)
    assert missing.status_code == 422
    assert missing.json()["detail"][0]["loc"][-2:] == ["visual", "uri"]
    # ...and rebuilding from the recorded specification restores the exact bytes.
    report = GeneratedModelRestoreReport.model_validate(
        recorded.post("/api/v1/catalog/generated-models/restore", json=doc).json()
    )
    assert [r.status for r in report.results] == ["restored"]
    assert recorded.post("/api/v1/projects/validate", json=doc).status_code == 200
    again = GeneratedModelRestoreReport.model_validate(
        recorded.post("/api/v1/catalog/generated-models/restore", json=doc).json()
    )
    assert [r.status for r in again.results] == ["present"]

    # A specification that no longer produces the recorded bytes writes nothing.
    model_file.unlink()
    tampered = json.loads(json.dumps(doc))
    tampered_part = tampered["catalog"][-1]["generation"]["spec"]["parts"][0]
    tampered_part["material"] = "paint_red"
    mismatch = GeneratedModelRestoreReport.model_validate(
        recorded.post("/api/v1/catalog/generated-models/restore", json=tampered).json()
    )
    assert [r.status for r in mismatch.results] == ["mismatch"]
    assert not model_file.exists()
