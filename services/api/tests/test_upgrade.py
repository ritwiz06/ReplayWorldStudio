"""POST /api/v1/projects/upgrade: older documents are upgraded and validated for review only."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from replay_world_api.app import create_app
from replay_world_api.settings import Settings
from replay_world_contracts import (
    Project,
    UpgradeReport,
    ValidationErrorResponse,
    ValidationReport,
)

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"
LEGACY = FIXTURES / "legacy" / "foundation-scene-0.1.0.json"
JSON = {"Content-Type": "application/json"}


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app(Settings())) as c:
        yield c


def _read(path: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / path).read_text())
    return data


def _as_version(current: dict[str, Any], version: str) -> dict[str, Any]:
    scene = {k: v for k, v in current["scene"].items() if k != "edit_log"}
    return {**current, "schema_version": version, "scene": scene}


def _upgrade(client: TestClient, body: str) -> tuple[int, Any]:
    response = client.post("/api/v1/projects/upgrade", content=body, headers=JSON)
    return response.status_code, response.json()


def _issues(payload: Any) -> list[tuple[list[str | int], str]]:
    return [(i.loc, i.msg) for i in ValidationErrorResponse.model_validate(payload).detail]


def test_upgrades_a_0_1_0_file_through_every_step(client: TestClient) -> None:
    status, payload = _upgrade(client, LEGACY.read_text())
    assert status == 200
    report = UpgradeReport.model_validate(payload)
    assert (report.from_version, report.to_version) == ("0.1.0", "0.4.0")
    assert report.notes[0] == "schema_version 0.1.0 -> 0.2.0"
    assert report.notes[-1].startswith("schema_version 0.3.0 -> 0.4.0")
    inferred = "box origin 'inferred' applied to width, height and depth"
    assert any(inferred in note for note in report.notes)
    assert report.project.scene.edit_log == []
    assert report.validation.object_count == len(report.project.scene.objects) == 6
    # The upgraded project is a valid current document in its own right.
    assert Project.model_validate_json(report.project.model_dump_json()) == report.project


@pytest.mark.parametrize("version", ["0.2.0", "0.3.0"])
def test_upgrades_newer_legacy_versions_without_changing_values(
    client: TestClient, version: str
) -> None:
    current = _read("scenes/industrial-demo.json")
    status, payload = _upgrade(client, json.dumps(_as_version(current, version)))
    assert status == 200
    report = UpgradeReport.model_validate(payload)
    assert report.from_version == version
    assert report.project.model_dump(mode="json") == current
    assert report.validation.model_file_count == 4


def test_a_current_document_passes_through_with_no_notes(client: TestClient) -> None:
    status, payload = _upgrade(client, (FIXTURES / "scenes" / "foundation-scene.json").read_text())
    assert status == 200
    report = UpgradeReport.model_validate(payload)
    assert (report.from_version, report.notes) == ("0.4.0", [])


@pytest.mark.parametrize("version", ["9.9.9", "0.0.1", None, 3])
def test_unknown_versions_are_refused_at_schema_version(
    client: TestClient, version: object
) -> None:
    doc = {**_read("legacy/foundation-scene-0.1.0.json"), "schema_version": version}
    status, payload = _upgrade(client, json.dumps(doc))
    assert status == 422
    [(loc, msg)] = _issues(payload)
    assert loc == ["body", "schema_version"]
    assert "unsupported schema_version" in msg
    assert "supported: 0.1.0, 0.2.0, 0.3.0, 0.4.0" in msg


def test_a_malformed_legacy_document_fails_with_one_issue(client: TestClient) -> None:
    doc = _read("legacy/foundation-scene-0.1.0.json")
    del doc["scene"]["objects"][0]["dimensions"]["width_m"]
    status, payload = _upgrade(client, json.dumps(doc))
    assert status == 422
    [(loc, msg)] = _issues(payload)
    assert loc == ["body"]
    assert msg.startswith("The document could not be upgraded: malformed 0.1.0 document")


def test_an_upgrade_that_produces_an_invalid_project_is_located(client: TestClient) -> None:
    doc = _read("legacy/foundation-scene-0.1.0.json")
    doc["scene"]["objects"][1]["dimensions"]["width_m"] = -0.4
    status, payload = _upgrade(client, json.dumps(doc))
    assert status == 422
    [(loc, msg)] = _issues(payload)
    assert loc == ["body", "scene", "objects", 1, "dimensions", "width", "value_m"]
    assert msg == "After upgrading from 0.1.0: Input should be greater than 0"


def test_upgraded_model_references_are_checked_against_the_library(client: TestClient) -> None:
    doc = _as_version(_read("scenes/industrial-demo.json"), "0.3.0")
    doc["catalog"][2]["visual"]["sha256"] = "0" * 64
    status, payload = _upgrade(client, json.dumps(doc))
    assert status == 422
    [(loc, msg)] = _issues(payload)
    assert loc == ["body", "catalog", 2, "visual", "sha256"]
    assert "does not match the recorded sha256" in msg


@pytest.mark.parametrize("body", ["[]", '"text"', "{not json"])
def test_non_documents_are_refused(client: TestClient, body: str) -> None:
    status, payload = _upgrade(client, body)
    assert status == 422
    assert _issues(payload)


def test_openapi_documents_the_upgrade_endpoint(client: TestClient) -> None:
    operation = client.get("/openapi.json").json()["paths"]["/api/v1/projects/upgrade"]["post"]
    assert operation["requestBody"]["content"]["application/json"]["schema"]["type"] == "object"
    response_ref = operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert response_ref.endswith("/UpgradeReport")


def test_a_browser_edited_project_is_accepted_with_its_edit_count(client: TestClient) -> None:
    response = client.post(
        "/api/v1/projects/validate",
        content=(FIXTURES / "edited" / "foundation-edited.json").read_text(),
        headers=JSON,
    )
    assert response.status_code == 200
    report = ValidationReport.model_validate(response.json())
    assert (report.object_count, report.edit_record_count) == (7, 7)


def test_a_project_whose_log_disagrees_with_its_scene_is_rejected(client: TestClient) -> None:
    doc = _read("edited/foundation-edited.json")
    packing = next(o for o in doc["scene"]["objects"] if o["id"] == "obj-packing-station")
    packing["dimensions"]["width"]["value_m"] = 1.5  # changed outside the editor, no record
    response = client.post("/api/v1/projects/validate", content=json.dumps(doc), headers=JSON)
    assert response.status_code == 422
    [(loc, msg)] = _issues(response.json())
    assert loc == ["body", "scene"]
    assert "the log no longer describes the scene" in msg
