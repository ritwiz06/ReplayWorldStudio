"""HTTP boundary for photos: upload, serving, project validation and photo analysis."""

from __future__ import annotations

import base64
import hashlib
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from replay_world_api.app import create_app
from replay_world_api.photos import MAX_PHOTO_BYTES, inspect_photo
from replay_world_api.settings import AssistSettings, Settings
from replay_world_contracts import (
    ImageAnalysisRequest,
    ImageProposalResult,
    StoredPhoto,
    ValidationErrorResponse,
    ValidationReport,
)

ROOT = Path(__file__).resolve().parents[3]
OFFICE = (ROOT / "fixtures" / "photos" / "office.jpg").read_bytes()
OFFICE_SHA = hashlib.sha256(OFFICE).hexdigest()
RECORDINGS = ROOT / "fixtures" / "assist" / "recorded"
FOUNDATION = ROOT / "fixtures" / "scenes" / "foundation-scene.json"


def analysis(data: bytes) -> dict[str, Any]:
    """The editor's analysis request for a photo (here the photo itself is the copy)."""
    info = inspect_photo(data)
    request = ImageAnalysisRequest.model_validate(
        {
            "media_type": info.media_type,
            "data_base64": base64.b64encode(data).decode("ascii"),
            "width_px": info.width_px,
            "height_px": info.height_px,
            "original_sha256": hashlib.sha256(data).hexdigest(),
        }
    )
    return request.model_dump(mode="json")


def photo_project(stored: StoredPhoto) -> str:
    """The foundation fixture with one photo source (calibrated, one rejected observation)."""
    corners = [{"u": u, "v": v} for u, v in ((0.3, 0.8), (0.7, 0.8), (0.65, 0.6), (0.35, 0.6))]
    side: dict[str, Any] = {
        "origin": "user_supplied",
        "source_ref": "rug size",
        "review_status": "unreviewed",
    }
    source: dict[str, Any] = {
        "id": "src-photo-office",
        "kind": "photo",
        "filename": stored.filename,
        "sha256": stored.sha256,
        "source_to_world": None,
        "import_warnings": [],
        "image": stored.image.model_dump(mode="json"),
        "photo_import": {
            "vision_model": None,
            "calibration": {
                "reference": {
                    "feature": "rug",
                    "corners": corners,
                    "width": {"value_m": 2.0, **side, "uncertainty_m": None},
                    "depth": {"value_m": 1.4, **side, "uncertainty_m": None},
                    "size_basis": "measured",
                },
                "image_to_floor": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
                "camera": {
                    "vertical_fov_deg": 55.0,
                    "fov_basis": "assumed",
                    "position_m": {"x": 0.0, "y": 1.6, "z": 4.0},
                },
                "notes": [],
            },
            "observations": [
                {
                    "id": "obs-1",
                    "label": "chair",
                    "box": {"left": 0.1, "top": 0.2, "right": 0.3, "bottom": 0.5},
                    "floor_contact": None,
                    "contact_basis": None,
                    "found_by": "user",
                    "decision": "rejected",
                    "object_id": None,
                    "visibility": "visible",
                    "derived_from": None,
                    "replaced_by": None,
                    "corrections": [],
                    "notes": [],
                }
            ],
            "visible_text": [],
        },
        "drawing": None,
        "reference": None,
    }
    document = json.loads(FOUNDATION.read_text())
    document["sources"].append(source)
    return json.dumps(document)


@pytest.fixture
def sources(tmp_path: Path) -> Path:
    return tmp_path / "sources"


def make_client(sources: Path, assist: AssistSettings | None = None) -> TestClient:
    return TestClient(create_app(Settings(sources_dir=sources, assist=assist or AssistSettings())))


@pytest.fixture
def client(sources: Path) -> Iterator[TestClient]:
    with make_client(sources) as c:
        yield c


def _upload(
    client: TestClient, data: bytes, filename: str = "office.jpg", expected: str | None = None
) -> tuple[int, object]:
    params = {"filename": filename} | ({"expected_sha256": expected} if expected else {})
    response = client.post(
        "/api/v1/sources/photos",
        params=params,
        content=data,
        headers={"Content-Type": "application/octet-stream"},
    )
    return response.status_code, response.json()


def _files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if not p.is_dir()) if root.exists() else []


# --- Upload and serving ----------------------------------------------------------------------


def test_uploads_a_photo_named_by_its_sha256(client: TestClient, sources: Path) -> None:
    status, payload = _upload(client, OFFICE)
    assert status == 200
    stored = StoredPhoto.model_validate(payload)
    assert (stored.filename, stored.sha256) == ("office.jpg", OFFICE_SHA)
    assert stored.image.uri == f"photos/{OFFICE_SHA}.jpg"
    assert (stored.image.media_type, stored.image.bytes) == ("image/jpeg", len(OFFICE))
    assert (sources / stored.image.uri).read_bytes() == OFFICE


def test_uploading_the_same_photo_again_is_idempotent(client: TestClient, sources: Path) -> None:
    _, first = _upload(client, OFFICE)
    status, second = _upload(client, OFFICE, "copy.jpg", expected=OFFICE_SHA)
    assert status == 200
    assert StoredPhoto.model_validate(second).image == StoredPhoto.model_validate(first).image
    assert _files(sources) == [sources / "photos" / f"{OFFICE_SHA}.jpg"]


def test_an_unexpected_photo_is_refused_and_nothing_written(
    client: TestClient, sources: Path
) -> None:
    status, payload = _upload(client, OFFICE, expected="0" * 64)
    assert status == 409
    assert isinstance(payload, dict) and "detail" in payload
    assert _files(sources) == []


def test_an_oversized_photo_is_refused(client: TestClient, sources: Path) -> None:
    status, payload = _upload(client, OFFICE + b"\x00" * (MAX_PHOTO_BYTES + 1 - len(OFFICE)))
    assert (status, payload) == (413, {"detail": "The photo is larger than 15 MB."})
    assert _files(sources) == []


@pytest.mark.parametrize(
    "data",
    [b"GIF89a" + b"\x00" * 20, b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"", OFFICE[:200]],
)
def test_bytes_that_are_not_a_usable_photo_are_refused(
    client: TestClient, sources: Path, data: bytes
) -> None:
    status, _ = _upload(client, data, "photo.jpg")
    assert status == 422
    assert _files(sources) == []


def test_a_malformed_expected_hash_is_refused(client: TestClient, sources: Path) -> None:
    status, _ = _upload(client, OFFICE, expected="NOT-A-HASH")
    assert status == 422
    assert _files(sources) == []


def test_serves_a_stored_photo(client: TestClient) -> None:
    _upload(client, OFFICE)
    response = client.get(f"/api/v1/sources/files/photos/{OFFICE_SHA}.jpg")
    assert response.status_code == 200
    assert response.content == OFFICE
    assert response.headers["content-type"] == "image/jpeg"


def test_a_photo_not_in_the_library_is_not_found(client: TestClient) -> None:
    response = client.get(f"/api/v1/sources/files/photos/{'d' * 64}.png")
    assert response.status_code == 404


@pytest.mark.parametrize(
    "uri",
    [
        "photos/..%2F..%2Fsecret.jpg",
        f"photos/%2E%2E/{OFFICE_SHA}.jpg",
        f"..%2Fphotos/{OFFICE_SHA}.jpg",
        f"photos/{OFFICE_SHA}.gif",
        "photos/secret.jpg",
        "%2Fetc%2Fpasswd",
    ],
)
def test_refuses_paths_outside_the_photo_library(
    client: TestClient, sources: Path, tmp_path: Path, uri: str
) -> None:
    _upload(client, OFFICE)
    (tmp_path / "secret.jpg").write_bytes(b"secret")
    response = client.get(f"/api/v1/sources/files/{uri}")
    assert response.status_code == 400
    assert "not a source-library photo path" in response.json()["detail"]
    assert b"secret" not in response.content


# --- Validating a project with a photo source -------------------------------------------------


def _validate(client: TestClient, body: str, missing: str | None = None) -> tuple[int, object]:
    response = client.post(
        "/api/v1/projects/validate",
        params={"missing_sources": missing} if missing else {},
        content=body,
        headers={"Content-Type": "application/json"},
    )
    return response.status_code, response.json()


def _photo_project(client: TestClient) -> str:
    _, payload = _upload(client, OFFICE)
    return photo_project(StoredPhoto.model_validate(payload))


def test_a_project_with_its_photo_present_is_accepted(client: TestClient) -> None:
    status, payload = _validate(client, _photo_project(client))
    assert status == 200
    report = ValidationReport.model_validate(payload)
    assert (report.photo_file_count, report.missing_source_files) == (1, [])


def test_a_missing_photo_is_refused_unless_allowed(client: TestClient, sources: Path) -> None:
    body = _photo_project(client)
    (sources / "photos" / f"{OFFICE_SHA}.jpg").unlink()
    status, payload = _validate(client, body)
    assert status == 422
    [issue] = ValidationErrorResponse.model_validate(payload).detail
    assert (issue.loc, issue.type) == (["body", "sources", 1, "image", "uri"], "source_missing")
    status, payload = _validate(client, body, "allow")
    assert status == 200
    report = ValidationReport.model_validate(payload)
    assert (report.photo_file_count, report.missing_source_files) == (
        0,
        [f"photos/{OFFICE_SHA}.jpg"],
    )


@pytest.mark.parametrize("missing", [None, "allow"])
def test_an_altered_photo_is_always_refused(
    client: TestClient, sources: Path, missing: str | None
) -> None:
    body = _photo_project(client)
    (sources / "photos" / f"{OFFICE_SHA}.jpg").write_bytes(OFFICE[:-1] + b"\x00")
    status, payload = _validate(client, body, missing)
    assert status == 422
    [issue] = ValidationErrorResponse.model_validate(payload).detail
    assert (issue.loc, issue.type) == (["body", "sources", 1, "sha256"], "source_hash_mismatch")


def test_an_unknown_missing_sources_policy_is_refused(client: TestClient) -> None:
    status, _ = _validate(client, _photo_project(client), "ignore")
    assert status == 422


# --- Photo analysis --------------------------------------------------------------------------


def test_photo_analysis_is_unavailable_without_a_provider(client: TestClient) -> None:
    response = client.post("/api/v1/assist/image-proposals", json=analysis(OFFICE))
    assert response.status_code == 503
    assert "Photo analysis is off" in response.json()["detail"]


def test_photo_analysis_replays_a_recorded_answer(sources: Path) -> None:
    assist = AssistSettings(provider="recorded", recordings_dir=RECORDINGS)
    with make_client(sources, assist) as client:
        response = client.post("/api/v1/assist/image-proposals", json=analysis(OFFICE))
        assert response.status_code == 200
        result = ImageProposalResult.model_validate(response.json())
        assert result.outcome == "proposal" and result.proposal is not None
        assert result.provider.mode == "recorded"
        assert len(result.proposal.objects) >= 3
        # A photo without a recording is not answered, and nothing pretends to be live.
        unknown = analysis(OFFICE + b"\x00" * 16)  # a different file: never recorded
        response = client.post("/api/v1/assist/image-proposals", json=unknown)
        assert response.status_code == 503
        assert "no recorded answer" in response.json()["detail"]
    assert _files(sources) == []  # analysis stores nothing


def test_photo_analysis_refuses_a_bad_copy_before_asking_the_model(sources: Path) -> None:
    assist = AssistSettings(provider="recorded", recordings_dir=RECORDINGS)
    with make_client(sources, assist) as client:
        body = analysis(OFFICE) | {"media_type": "image/webp"}
        response = client.post("/api/v1/assist/image-proposals", json=body)
        assert response.status_code == 422
        assert response.json()["detail"] == "The photo copy is image/jpeg, not image/webp."
