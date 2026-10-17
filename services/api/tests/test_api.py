"""HTTP boundary: health, fixture delivery, malformed-input rejection and CORS policy."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from replay_world_api.app import create_app
from replay_world_api.settings import Settings
from replay_world_contracts import (
    HealthResponse,
    Project,
    ValidationErrorResponse,
    ValidationReport,
)

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"
ALLOWED_ORIGIN = "http://127.0.0.1:5173"


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app(Settings())) as c:
        yield c


def _post_project(client: TestClient, body: str) -> tuple[int, object]:
    response = client.post(
        "/api/v1/projects/validate",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    return response.status_code, response.json()


def test_health_reports_service_and_schema_version(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    health = HealthResponse.model_validate_json(response.content)
    assert health.status == "ok"
    assert health.schema_version == "0.9.0"


def test_foundation_fixture_is_served_as_a_valid_project(client: TestClient) -> None:
    response = client.get("/api/v1/fixtures/foundation")
    assert response.status_code == 200
    served = Project.model_validate_json(response.content)
    on_disk = (FIXTURES / "scenes" / "foundation-scene.json").read_text()
    assert served == Project.model_validate_json(on_disk)


def test_unknown_fixture_name_is_not_found(client: TestClient) -> None:
    assert client.get("/api/v1/fixtures/..%2F..%2Fpyproject.toml").status_code == 404
    assert client.get("/api/v1/fixtures/missing").status_code == 404


def test_fixture_that_breaks_the_contract_is_a_server_error(tmp_path: Path) -> None:
    (tmp_path / "scenes").mkdir()
    (tmp_path / "scenes" / "foundation-scene.json").write_text('{"schema_version": "0.1.0"}')
    with TestClient(create_app(Settings(fixtures_dir=tmp_path))) as c:
        response = c.get("/api/v1/fixtures/foundation")
    assert response.status_code == 500
    assert response.json() == {"detail": "Fixture 'foundation' failed contract validation"}


def test_valid_project_is_accepted_with_evidence_counts(client: TestClient) -> None:
    status, body = _post_project(
        client, (FIXTURES / "scenes" / "foundation-scene.json").read_text()
    )
    assert status == 200
    report = ValidationReport.model_validate(body)
    assert (report.schema_version, report.object_count, report.asset_count) == ("0.9.0", 6, 3)
    assert (report.known_parameter_count, report.unknown_parameter_count) == (3, 3)
    assert report.edit_record_count == 0


@pytest.mark.parametrize(
    ("filename", "expected_loc"),
    [
        (
            "negative-dimension.json",
            ["body", "scene", "objects", 4, "dimensions", "width", "value_m"],
        ),
        (
            "nonfinite-coordinate.json",
            ["body", "scene", "objects", 2, "transform", "position_m", "x"],
        ),
        ("duplicate-object-id.json", ["body", "scene"]),
        ("dangling-asset-reference.json", ["body"]),
    ],
)
def test_invalid_projects_are_rejected_with_a_location(
    client: TestClient, filename: str, expected_loc: list[str | int]
) -> None:
    status, body = _post_project(client, (FIXTURES / "invalid" / filename).read_text())
    assert status == 422
    errors = ValidationErrorResponse.model_validate(body)
    assert [issue.loc for issue in errors.detail] == [expected_loc]


def test_legacy_schema_gets_one_actionable_rejection(client: TestClient) -> None:
    status, body = _post_project(
        client, (FIXTURES / "legacy" / "foundation-scene-0.1.0.json").read_text()
    )
    assert status == 422
    [issue] = ValidationErrorResponse.model_validate(body).detail
    assert (issue.loc, issue.type) == (["body", "schema_version"], "schema_version_outdated")
    assert "Schema 0.1.0 is an older contract; this API accepts 0.9.0" in issue.msg
    assert "Open the file in the editor to review the upgrade" in issue.msg
    assert "python -m replay_world_contracts.migrate" in issue.msg


def test_union_variant_tags_are_not_reported_as_document_keys(client: TestClient) -> None:
    doc = json.loads((FIXTURES / "scenes" / "industrial-demo.json").read_text())
    doc["catalog"][0]["visual"]["uri"] = "../escape.glb"
    doc["scene"]["objects"][4]["parameters"][0]["value"] = "fast"
    status, body = _post_project(client, json.dumps(doc))
    assert status == 422
    locs = [issue.loc for issue in ValidationErrorResponse.model_validate(body).detail]
    assert ["body", "catalog", 0, "visual", "uri"] in locs
    assert ["body", "scene", "objects", 4, "parameters", 0, "value"] in locs


def test_openapi_still_documents_the_project_request_body(client: TestClient) -> None:
    operation = client.get("/openapi.json").json()["paths"]["/api/v1/projects/validate"]["post"]
    schema = operation["requestBody"]["content"]["application/json"]["schema"]
    assert schema["$ref"] == "#/components/schemas/Project"


def test_rejection_does_not_echo_the_submitted_input(client: TestClient) -> None:
    status, body = _post_project(
        client, (FIXTURES / "invalid" / "negative-dimension.json").read_text()
    )
    assert status == 422
    assert "input" not in json.dumps(body)


@pytest.mark.parametrize("body", ["{not json", "", "[]", '"a string"'])
def test_malformed_json_is_rejected(client: TestClient, body: str) -> None:
    status, payload = _post_project(client, body)
    assert status == 422
    assert ValidationErrorResponse.model_validate(payload).detail


def test_invalid_json_is_reported_at_the_document_level(client: TestClient) -> None:
    status, payload = _post_project(client, "{ this is not json")
    assert status == 422
    assert payload == {
        "detail": [
            {
                "loc": ["body"],
                "msg": "Invalid JSON at character 2: Expecting property name enclosed in "
                "double quotes",
                "type": "json_invalid",
            }
        ]
    }


def test_cors_allows_only_configured_origins(client: TestClient) -> None:
    allowed = client.get("/health", headers={"Origin": ALLOWED_ORIGIN})
    assert allowed.headers.get("access-control-allow-origin") == ALLOWED_ORIGIN
    other = client.get("/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in other.headers

    preflight_headers = {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }
    ok = client.options(
        "/api/v1/projects/validate", headers={"Origin": ALLOWED_ORIGIN, **preflight_headers}
    )
    assert ok.status_code == 200
    denied = client.options(
        "/api/v1/projects/validate",
        headers={"Origin": "http://evil.example", **preflight_headers},
    )
    assert denied.status_code == 400


def test_settings_default_to_loopback_and_reject_wildcard_cors() -> None:
    settings = Settings.from_env({})
    assert settings.host == "127.0.0.1"
    assert settings.port == 8000
    custom = Settings.from_env({"RWS_CORS_ORIGINS": " http://a.test , http://b.test "})
    assert custom.cors_origins == ("http://a.test", "http://b.test")
    with pytest.raises(ValueError, match="explicit origins"):
        Settings.from_env({"RWS_CORS_ORIGINS": "*"})
    with pytest.raises(ValueError, match="must be an integer"):
        Settings.from_env({"RWS_API_PORT": "eighty"})
