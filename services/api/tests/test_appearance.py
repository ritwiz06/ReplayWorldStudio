"""A new look for one existing object from a reference photo (ENR-01).

A scripted fake provider stands in for the vision model, so every check on a proposed look is
exercised deterministically; looks are built with the real generator in a temporary catalog
library. The permitted photo fixtures/photos/office.jpg stands in for the reviewed crop.
(Replays of real recorded answers are in test_assist_recorded.py.)
"""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import sys
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from replay_world_api.app import create_app
from replay_world_api.assist.appearance import appearance_key, propose_appearance
from replay_world_api.assist.proposals import AssistError
from replay_world_api.assist.provider import Completion, Task
from replay_world_api.assist.revisions import Cancelled
from replay_world_api.evidence import Libraries, inventory, project_assets
from replay_world_api.generated_assets import create_reference_asset
from replay_world_api.photos import check_source_files, store_photo
from replay_world_api.settings import AssistSettings, Settings
from replay_world_contracts import (
    AppearanceProposalRequest,
    CatalogAsset,
    Project,
    ReferenceAssetRequest,
    StoredPhoto,
)

ROOT = Path(__file__).resolve().parents[3]
OFFICE = (ROOT / "fixtures" / "photos" / "office.jpg").read_bytes()
OFFICE_SHA = hashlib.sha256(OFFICE).hexdigest()
SAMPLE = json.loads((ROOT / "fixtures" / "scenes" / "sample-factory.json").read_text())
DEMO = json.loads((ROOT / "fixtures" / "scenes" / "industrial-demo.json").read_text())
MACHINE_B = "obj-dxf-111"
ENVELOPE = {"x": 1.5, "y": 1.6, "z": 1.0}
CROP = {"left": 0.4, "top": 0.36, "right": 0.57, "bottom": 0.62}
VISION = {"service": "Fake provider", "base_url": "https://fake.invalid/v1", "model": "fake-vision"}


@dataclass
class Fake:
    """Answers with the given texts in order (the last one repeats)."""

    answers: list[str]
    service: str = "Fake provider"
    base_url: str = "https://fake.invalid/v1"
    model: str = "fake-vision"
    mode: Literal["live", "recorded"] = "recorded"
    on_call: Any = None
    calls: list[tuple[Task, str, list[dict[str, Any]]]] = field(default_factory=list)

    def complete(
        self,
        *,
        task: Task,
        key: str,
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        attempt: int,
        timeout_s: float | None = None,
    ) -> Completion:
        self.calls.append((task, key, copy.deepcopy(messages)))
        if self.on_call:
            self.on_call()
        return Completion(self.answers[min(attempt, len(self.answers) - 1)], latency_ms=10)


def part(
    pid: str,
    label: str,
    material: str,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
) -> dict[str, Any]:
    return {
        "id": pid,
        "label": label,
        "shape": "box",
        "material": material,
        "center_m": dict(zip("xyz", center, strict=True)),
        "size_m": dict(zip("xyz", size, strict=True)),
        "axis": "y",
        "taper": None,
        "narrow_end": None,
        "basis": "inferred",
    }


def guarded_cell(**changes: Any) -> str:
    """The answer a careful model gives for a guarded cell: a white base, a yellow frame, a
    control panel; the stand-in block removed."""
    posts = [
        part(f"post-{n}", "yellow guard post", "safety_yellow", (x, 1.2, z), (0.05, 0.8, 0.05))
        for n, (x, z) in enumerate(
            ((-0.725, -0.475), (0.725, -0.475), (-0.725, 0.475), (0.725, 0.475))
        )
    ]
    answer: dict[str, Any] = {
        "outcome": "revision",
        "message": None,
        "summary": "Added the yellow guard frame and the control panel seen in the photo; kept "
        "the recorded size.",
        "visible": ["yellow guard frame", "control panel with a screen", "white base with doors"],
        "estimated": ["the back of the cell is plain; its depth is guessed"],
        "remove": ["body"],
        "change": [],
        "add": [
            part("base", "white base with doors", "paint_white", (0, 0.4, -0.02), (1.5, 0.8, 0.96)),
            *posts,
            part("rail", "yellow guard top rail", "safety_yellow", (0, 1.575, 0), (1.5, 0.05, 1.0)),
            part(
                "panel",
                "control panel with a screen",
                "hmi_screen",
                (0.45, 0.45, 0.47),
                (0.3, 0.25, 0.02),
            ),
        ],
        "repeat": [],
        "not_representable": ["the guard's clear windows are drawn without their mesh"],
    }
    answer.update(changes)
    return json.dumps(answer)


def request(**changes: Any) -> AppearanceProposalRequest:
    body: dict[str, Any] = {
        "name": "Machine B",
        "envelope_m": ENVELOPE,
        "spec": None,
        "instruction": None,
        "media_type": "image/jpeg",
        "data_base64": base64.b64encode(OFFICE).decode("ascii"),
        "width_px": 1024,
        "height_px": 678,
        "photo_sha256": OFFICE_SHA,
        "crop": CROP,
    }
    body.update(changes)
    return AppearanceProposalRequest.model_validate(body)


# --- The proposal ----------------------------------------------------------------------------


def test_a_proposal_keeps_the_recorded_size_and_says_what_was_seen_guessed_and_left_out() -> None:
    fake = Fake([guarded_cell()])
    result = propose_appearance(fake, request())
    assert result.outcome == "proposal" and result.spec is not None
    e = result.spec.envelope_m
    assert (e.x, e.y, e.z) == (1.5, 1.6, 1.0)  # a photo is not a measurement
    assert result.base.parts[0].id == "body"  # it started from the stand-in block
    assert result.visible == [
        "yellow guard frame",
        "control panel with a screen",
        "white base with doors",
    ]
    assert result.estimated == ["the back of the cell is plain; its depth is guessed"]
    assert result.not_represented == ["the guard's clear windows are drawn without their mesh"]
    assert any("Size kept" in c for c in result.checks)
    assert result.prompt == "rws-appearance-prompt/3"
    assert result.crop_sha256 == OFFICE_SHA  # the bytes sent (here the photo itself)
    assert {p.material for p in result.spec.parts} >= {"safety_yellow", "hmi_screen"}


def test_only_the_crop_the_name_and_the_size_are_sent() -> None:
    fake = Fake([guarded_cell()])
    propose_appearance(fake, request())
    [(task, key, messages)] = fake.calls
    assert task == "appearance"
    assert key == appearance_key(request())
    assert OFFICE_SHA in key and "0.400,0.360,0.570,0.620" in key and "block" in key
    image, text = messages[-1]["content"]
    assert image["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert "Machine B" in text["text"] and '"envelope_m":{"x":1.5,"y":1.6,"z":1.0}' in text["text"]
    sent = json.dumps(messages)
    assert OFFICE_SHA not in sent  # the original's hash selects recordings; it is not sent
    for other in SAMPLE["scene"]["objects"]:
        if other["id"] != MACHINE_B:
            assert other["name"] not in sent


def test_physical_properties_are_never_taken_from_a_photo() -> None:
    answer = guarded_cell(
        visible=["yellow guard frame", "stainless steel 304 grade frame, 500 kg"],
        estimated=["cycle time of about 12 s per part"],
    )
    result = propose_appearance(Fake([answer]), request())
    assert result.visible == ["yellow guard frame"]
    assert result.estimated == []
    assert any("cannot establish" in c for c in result.checks)


def test_an_unusable_answer_is_asked_again_once_and_reported() -> None:
    fake = Fake(["not json", guarded_cell()])
    result = propose_appearance(fake, request())
    assert (result.provider.attempts, result.provider.first_attempt_valid) == (2, False)
    nothing_seen = guarded_cell(visible=[])
    with pytest.raises(AssistError, match="did not return a usable appearance"):
        propose_appearance(Fake([nothing_seen]), request())


def test_unsupported_and_unchanged_answers_change_nothing() -> None:
    unsupported = guarded_cell(
        outcome="unsupported", message="The crop shows a wall.", remove=[], add=[], visible=[]
    )
    result = propose_appearance(Fake([unsupported]), request())
    assert (result.outcome, result.spec, result.message) == (
        "unsupported",
        None,
        "The crop shows a wall.",
    )
    same = guarded_cell(remove=[], add=[])
    result = propose_appearance(Fake([same]), request())
    assert result.outcome == "unsupported" and "does not change" in (result.message or "")


def test_a_generated_model_is_the_start_only_at_the_recorded_size() -> None:
    start = propose_appearance(Fake([guarded_cell()]), request()).spec
    assert start is not None
    again = propose_appearance(
        Fake([guarded_cell(remove=[], add=[], change=[])]), request(spec=start.model_dump())
    )
    assert again.base == start
    fake = Fake([guarded_cell()])
    with pytest.raises(AssistError, match="recorded size"):
        # The object was resized after the model was made: the model is not the start.
        propose_appearance(
            fake, request(spec=start.model_dump(), envelope_m={**ENVELOPE, "x": 2.0})
        )
    assert fake.calls == []  # refused before anything was sent


def test_cancelling_stops_further_calls_and_discards_a_late_answer() -> None:
    cancelled = threading.Event()
    fake = Fake(["not json", guarded_cell()], on_call=cancelled.set)
    with pytest.raises(Cancelled):
        propose_appearance(fake, request(), cancelled=cancelled)
    assert len(fake.calls) == 1  # the corrected answer was never asked for


def test_one_budget_covers_both_answers() -> None:
    now = [0.0]

    def slow() -> None:
        now[0] += 140.0  # the first answer took most of the 150 s budget

    fake = Fake(["not json", guarded_cell()], on_call=slow)
    with pytest.raises(AssistError, match="no time left"):
        propose_appearance(fake, request(), budget_s=150.0, clock=lambda: now[0])
    assert len(fake.calls) == 1


# --- The asset, the project and its files -----------------------------------------------------


def stored_office(sources: Path) -> StoredPhoto:
    return store_photo(OFFICE, "office.jpg", sources, None)


def reference_source(stored: StoredPhoto, object_ids: list[str]) -> dict[str, Any]:
    return {
        "id": f"src-ref-{stored.sha256[:12]}",
        "kind": "reference_photo",
        "filename": stored.filename,
        "sha256": stored.sha256,
        "source_to_world": None,
        "import_warnings": [],
        "image": stored.image.model_dump(mode="json"),
        "photo_import": None,
        "drawing": None,
        "reference": {"object_ids": object_ids, "note": None},
    }


def reference_asset(
    catalog: Path, stored: StoredPhoto, by_model: bool = True, object_id: str = MACHINE_B
) -> CatalogAsset:
    result = propose_appearance(Fake([guarded_cell()]), request())
    assert result.spec is not None
    return create_reference_asset(
        ReferenceAssetRequest.model_validate(
            {
                "name": "Machine B (from photo)",
                "kind": "equipment",
                "object_name": "Machine B",
                "spec": result.spec.model_dump(),
                "summary": result.summary,
                "language_model": VISION if by_model else None,
                "reference": {
                    "source_id": f"src-ref-{stored.sha256[:12]}",
                    "photo_sha256": stored.sha256,
                    "crop": CROP,
                    "orientation": "exif_applied",
                    "crop_sha256": result.crop_sha256 if by_model else None,
                    "crop_width_px": 226 if by_model else None,
                    "crop_height_px": 260 if by_model else None,
                    "object_id": object_id,
                    "instruction": None,
                    "prompt": result.prompt if by_model else None,
                    "based_on": None,
                    "visible": result.visible if by_model else [],
                    "estimated": result.estimated if by_model else [],
                    "adjusted_by_user": False,
                },
                "changes": ["Added the guard"],
                "not_represented": result.not_represented,
            }
        ),
        catalog,
    )


def with_look(
    base: dict[str, Any], asset: CatalogAsset, source: dict[str, Any], object_id: str = MACHINE_B
) -> dict[str, Any]:
    """The project after the common appearance command: only the object's asset_id changes."""
    project = copy.deepcopy(base)
    obj = next(o for o in project["scene"]["objects"] if o["id"] == object_id)
    before = obj["asset_id"]
    obj["asset_id"] = asset.id
    project["catalog"].append(asset.model_dump(mode="json"))
    project["sources"].append(source)
    project["scene"]["revision"] += 1
    project["scene"]["edit_log"].append(
        {
            "type": "appearance_changed",
            "revision": project["scene"]["revision"],
            "summary": f"Appearance (display only): {obj['name']} → {asset.name}",
            "objects": [
                {
                    "object_id": object_id,
                    "asset_before": before,
                    "asset_after": asset.id,
                    "reason": None,
                }
            ],
            "reference_source_id": source["id"],
        }
    )
    return project


def test_a_look_from_a_photo_is_a_new_asset_whose_size_is_never_evidence(tmp_path: Path) -> None:
    stored = stored_office(tmp_path / "sources")
    asset = reference_asset(tmp_path / "catalog", stored)
    assert asset.source.kind == "generated" and asset.generation is not None
    assert asset.generation.method == "reference_photo"
    assert asset.generation.reference is not None
    assert asset.generation.reference.photo_sha256 == OFFICE_SHA
    assert asset.generation.not_modelled == [
        "the guard's clear windows are drawn without their mesh"
    ]
    for axis in ("width", "height", "depth"):
        length = getattr(asset.nominal_dimensions, axis)
        assert length.origin == "inferred" and length.review_status == "unreviewed"
        assert "not measured from the photo" in (length.source_ref or "")
    assert asset.rights.license == "NOASSERTION"
    assert (tmp_path / "catalog" / asset.visual.uri).is_file()  # type: ignore[union-attr]
    manual = reference_asset(tmp_path / "catalog", stored, by_model=False)
    assert manual.generation is not None and manual.generation.language_model is None


def test_a_proposal_without_its_prompt_or_model_is_refused(tmp_path: Path) -> None:
    stored = stored_office(tmp_path / "sources")
    good = reference_asset(tmp_path / "catalog", stored)
    assert good.generation is not None and good.generation.reference is not None
    body = {
        "name": "x",
        "kind": "equipment",
        "object_name": "Machine B",
        "spec": good.generation.spec.model_dump(),
        "summary": "x",
        "language_model": VISION,
        "reference": {**good.generation.reference.model_dump(mode="json"), "prompt": None},
        "changes": [],
        "not_represented": [],
    }
    with pytest.raises(ValidationError):
        ReferenceAssetRequest.model_validate(body)  # the crop's hash then needs the prompt


def test_the_drawing_world_and_a_world_without_a_drawing_keep_ids_sizes_and_links(
    tmp_path: Path,
) -> None:
    stored = stored_office(tmp_path / "sources")
    for base, object_id in ((SAMPLE, MACHINE_B), (DEMO, "obj-cabinet-1")):
        asset = reference_asset(tmp_path / "catalog", stored, object_id=object_id)
        source = reference_source(stored, [object_id])
        project = Project.model_validate(with_look(base, asset, source, object_id))
        before = next(o for o in base["scene"]["objects"] if o["id"] == object_id)
        after = next(o for o in project.scene.objects if o.id == object_id).model_dump(mode="json")
        assert {**after, "asset_id": None} == {**before, "asset_id": None}
        assert project.model_dump(mode="json")["process"] == base["process"]
        assert [s["id"] for s in base["sources"]] == [s.id for s in project.sources][:-1]


def test_the_log_must_follow_the_look_and_the_photo_must_be_this_projects(tmp_path: Path) -> None:
    stored = stored_office(tmp_path / "sources")
    asset = reference_asset(tmp_path / "catalog", stored)
    source = reference_source(stored, [MACHINE_B])
    good = with_look(SAMPLE, asset, source)
    wrong_before = copy.deepcopy(good)
    wrong_before["scene"]["edit_log"][-1]["objects"][0]["asset_before"] = asset.id
    with pytest.raises(ValidationError, match="unchanged look"):
        Project.model_validate(wrong_before)
    no_photo = copy.deepcopy(good)
    no_photo["sources"].pop()
    no_photo["scene"]["edit_log"][-1]["reference_source_id"] = None
    with pytest.raises(ValidationError, match="not a reference photo of this project"):
        Project.model_validate(no_photo)
    ghost = copy.deepcopy(good)
    ghost["sources"][-1]["reference"]["object_ids"] = ["obj-nowhere"]
    with pytest.raises(ValidationError, match="not in the scene"):
        Project.model_validate(ghost)


def test_a_photo_object_keeps_its_room_photo_link_when_a_reference_is_added(
    tmp_path: Path,
) -> None:
    """A room photo (IMG-01) and the same file as a reference photo are different sources: the
    observation linking the object to the room photo stays as it was."""
    sys.path.insert(0, str(Path(__file__).parent))
    from test_photos import photo_source  # type: ignore[import-not-found]

    stored = stored_office(tmp_path / "sources")
    room = photo_source(stored)
    base = copy.deepcopy(DEMO)
    base["sources"].append(room)
    linked = room["photo_import"]["observations"]
    asset = reference_asset(tmp_path / "catalog", stored, object_id="obj-cabinet-1")
    project = Project.model_validate(
        with_look(base, asset, reference_source(stored, ["obj-cabinet-1"]), "obj-cabinet-1")
    )
    kept = next(s for s in project.sources if s.kind == "photo")
    assert kept.photo_import is not None
    assert [o.model_dump(mode="json") for o in kept.photo_import.observations] == linked
    assert [s.kind for s in project.sources][-2:] == ["photo", "reference_photo"]


def test_a_missing_reference_photo_never_blocks_opening_and_a_changed_one_is_refused(
    tmp_path: Path,
) -> None:
    library = tmp_path / "sources"
    stored = stored_office(library)
    asset = reference_asset(tmp_path / "catalog", stored)
    project = Project.model_validate(
        with_look(SAMPLE, asset, reference_source(stored, [MACHINE_B]))
    )
    assert check_source_files(project, library, allow_missing=False) == (1, [], [])
    photo = library / stored.image.uri
    photo.unlink()
    verified, issues, missing = check_source_files(project, library, allow_missing=False)
    assert (verified, issues, missing) == (0, [], [stored.image.uri])
    photo.write_bytes(OFFICE[:-10] + b"0123456789")
    _, issues, _ = check_source_files(project, library, allow_missing=True)
    assert issues and issues[0]["type"] == "source_hash_mismatch"


def test_reference_photos_are_named_for_bundles_and_left_out_unless_chosen(tmp_path: Path) -> None:
    library = tmp_path / "sources"
    stored = stored_office(library)
    asset = reference_asset(tmp_path / "catalog", stored)
    project = Project.model_validate(
        with_look(SAMPLE, asset, reference_source(stored, [MACHINE_B]))
    )
    [photo] = [a for a in project_assets(project) if a.kind == "photo"]
    assert (photo.uri, photo.label) == (stored.image.uri, "office.jpg (reference photo)")
    libs = Libraries(sources=library, shared={}, catalog=tmp_path / "catalog")
    listed = {a.uri: a for a in inventory(project, libs).assets}
    assert listed[stored.image.uri].status == "library"  # the person's own: not included by default


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    recordings = tmp_path / "recorded"
    recordings.mkdir()
    (recordings / "appearance-test.json").write_text(
        json.dumps(
            {
                "task": "appearance",
                "key": appearance_key(request()),
                "model": "fake-vision",
                "responses": [guarded_cell()],
            }
        )
    )
    settings = Settings(
        sources_dir=tmp_path / "sources",
        catalog_dir=tmp_path / "catalog",
        assist=AssistSettings(provider="recorded", recordings_dir=recordings),
    )
    with TestClient(create_app(settings)) as c:
        yield c


def test_the_api_proposes_from_a_recorded_answer_and_builds_the_reviewed_look(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/assist/appearance-proposals", json=request().model_dump(mode="json")
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["outcome"] == "proposal" and result["provider"]["mode"] == "recorded"
    unknown = request(crop={"left": 0, "top": 0, "right": 1, "bottom": 1})
    response = client.post(
        "/api/v1/assist/appearance-proposals", json=unknown.model_dump(mode="json")
    )
    assert response.status_code == 503  # no recorded answer for another crop: nothing invented


def test_without_a_vision_model_the_api_says_the_look_is_manual_work(tmp_path: Path) -> None:
    settings = Settings(sources_dir=tmp_path / "s", assist=AssistSettings())
    with TestClient(create_app(settings)) as off:
        response = off.post(
            "/api/v1/assist/appearance-proposals", json=request().model_dump(mode="json")
        )
    assert response.status_code == 503
    assert "build the look by hand" in response.json()["detail"]


def test_buried_and_floating_parts_are_placed_where_they_can_be_seen_and_said_so() -> None:
    """A drawer floating above the base settles onto it, its handle drawn inside it goes onto its
    front and moves with it; nothing that would change the overall size is moved."""
    answer = guarded_cell(
        visible=["dark drawers", "handles"],
        add=[
            part("base", "base", "paint_anthracite", (0, 0.1, 0), (1.5, 0.2, 1.0)),
            part("drawer", "drawer", "wood", (0, 0.6, 0), (1.5, 0.4, 1.0)),
            part("handle", "drawer handle", "aluminium", (0, 0.6, 0.45), (0.3, 0.04, 0.02)),
            part("top", "top drawer", "wood", (0, 1.4, 0), (1.5, 0.4, 1.0)),
        ],
    )
    result = propose_appearance(Fake([answer, answer]), request())
    assert result.spec is not None
    parts = {p.id: p for p in result.spec.parts}
    drawer, handle = parts["drawer"], parts["handle"]
    assert drawer.center_m.y - drawer.size_m.y / 2 == pytest.approx(0.2)  # rests on the base
    assert handle.center_m.y == pytest.approx(drawer.center_m.y)  # moved with its drawer
    assert handle.center_m.z - handle.size_m.z / 2 == pytest.approx(
        drawer.center_m.z + drawer.size_m.z / 2
    )  # on its front, the drawer set back to make room
    e = result.spec.envelope_m
    assert (e.x, e.y, e.z) == (1.5, 1.6, 1.0)
    placed = [a.text for a in result.adjustments if a.kind == "placed"]
    assert any("on the front of “drawer”" in t for t in placed)
    assert any("Lowered “drawer”" in t for t in placed)
    # The top drawer sets the height: lowering it would change the size, so it is only reported.
    assert any(p.kind == "floating" and "top drawer" in p.text for p in result.problems)


def test_a_photo_look_is_rebuilt_from_its_specification_like_any_generated_model(
    tmp_path: Path,
) -> None:
    from replay_world_api.generated_assets import restore_generated_models

    stored = stored_office(tmp_path / "sources")
    asset = reference_asset(tmp_path / "catalog", stored)
    project = Project.model_validate(
        with_look(SAMPLE, asset, reference_source(stored, [MACHINE_B]))
    )
    model = tmp_path / "catalog" / asset.visual.uri  # type: ignore[union-attr]
    first = model.read_bytes()
    model.unlink()
    [result] = restore_generated_models(project, tmp_path / "catalog").results
    assert result.status == "restored" and model.read_bytes() == first


def test_a_bundle_takes_a_reference_photo_only_when_chosen_and_checks_it_on_opening(
    tmp_path: Path,
) -> None:
    import io
    import zipfile

    sys.path.insert(0, str(Path(__file__).parent))
    from test_evidence import request as bundle_request  # type: ignore[import-not-found]

    def app(name: str) -> TestClient:
        return TestClient(
            create_app(
                Settings(
                    sources_dir=tmp_path / f"s-{name}",
                    catalog_dir=tmp_path / f"c-{name}",
                    fixtures_dir=ROOT / "fixtures",
                    assist=AssistSettings(),
                )
            )
        )

    with app("a") as c:
        stored = StoredPhoto.model_validate(
            c.post(
                "/api/v1/sources/photos",
                content=OFFICE,
                headers={"Content-Type": "image/jpeg", "X-Filename": "office.jpg"},
            ).json()
        )
        asset = reference_asset(tmp_path / "c-a", stored)
        project = with_look(SAMPLE, asset, reference_source(stored, [MACHINE_B]))
        listed = c.post("/api/v1/exports/inventory", json=project).json()["assets"]
        photo = next(a for a in listed if a["kind"] == "photo")
        assert (photo["label"], photo["status"]) == ("office.jpg (reference photo)", "library")
        body = bundle_request()
        body["texts"][2]["text"] = json.dumps(project)
        model = asset.visual.uri  # type: ignore[union-attr]
        body["include"] = [body["include"][0], model, stored.image.uri]
        included = c.post("/api/v1/exports", json=body)
        assert included.status_code == 200, included.text
        body["include"] = [body["include"][0], model]
        body["manifest"]["excluded"] = [
            {"what": "office.jpg (reference photo)", "reason": "your own file; not selected"}
        ]
        body["manifest"]["replay"] = "runs_only"
        excluded = c.post("/api/v1/exports", json=body)
        assert excluded.status_code == 200, excluded.text
    with zipfile.ZipFile(io.BytesIO(included.content)) as archive:
        assert archive.read(f"files/{stored.image.uri}") == OFFICE
    with zipfile.ZipFile(io.BytesIO(excluded.content)) as archive:
        assert f"files/{stored.image.uri}" not in archive.namelist()
    with app("b") as c:
        opened = c.post(
            "/api/v1/exports/open",
            content=included.content,
            headers={"Content-Type": "application/zip"},
        ).json()
        assert (tmp_path / "s-b" / stored.image.uri).read_bytes() == OFFICE
        assert opened["problems"] == []
    with app("c") as c:
        opened = c.post(
            "/api/v1/exports/open",
            content=excluded.content,
            headers={"Content-Type": "application/zip"},
        ).json()
        missing = [p for p in opened["problems"] if "office.jpg (reference photo)" in p]
        assert missing and "is not in the bundle or on this computer" in missing[0]
        assert not (tmp_path / "s-c" / stored.image.uri).exists()  # nothing invented
