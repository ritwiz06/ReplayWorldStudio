"""Catalog-library file references: served safely, checked when a project is opened."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from replay_world_api.app import create_app
from replay_world_api.catalog_files import CatalogFileError, resolve_catalog_file, sha256_of
from replay_world_api.settings import Settings
from replay_world_contracts import ValidationErrorResponse, ValidationReport

REPO = Path(__file__).resolve().parents[3]
LIBRARY = REPO / "assets" / "catalog"
DEMO = REPO / "fixtures" / "scenes" / "industrial-demo.json"


JSON = {"Content-Type": "application/json"}


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app(Settings())) as c:
        yield c


@pytest.fixture
def library(tmp_path: Path) -> Path:
    root = tmp_path / "catalog"
    (root / "models").mkdir(parents=True)
    (root / "models" / "box.glb").write_bytes(b"glTF-bytes")
    (tmp_path / "outside.glb").write_bytes(b"secret")
    return root


def test_resolves_a_file_inside_the_library(library: Path) -> None:
    assert (
        resolve_catalog_file(library, "models/box.glb")
        == (library / "models" / "box.glb").resolve()
    )


@pytest.mark.parametrize(
    "uri", ["../outside.glb", "models/../../outside.glb", "/tmp/x.glb", "Box.glb"]
)
def test_refuses_unsafe_references(library: Path, uri: str) -> None:
    with pytest.raises(CatalogFileError) as info:
        resolve_catalog_file(library, uri)
    assert info.value.kind == "unsafe"


def test_refuses_a_symlink_that_escapes_the_library(library: Path) -> None:
    (library / "models" / "link.glb").symlink_to(library.parent / "outside.glb")
    with pytest.raises(CatalogFileError) as info:
        resolve_catalog_file(library, "models/link.glb")
    assert (info.value.kind, info.value.message) == (
        "unsafe",
        "'models/link.glb' resolves outside the catalog library",
    )


def test_reports_a_missing_file_with_a_rebuild_hint(library: Path) -> None:
    with pytest.raises(CatalogFileError) as info:
        resolve_catalog_file(library, "models/none.glb")
    assert info.value.kind == "missing"
    assert "pnpm assets:build" in info.value.message


def test_serves_model_bytes(client: TestClient) -> None:
    response = client.get("/api/v1/catalog/files/models/belt-conveyor-3m.glb")
    assert response.status_code == 200
    assert response.headers["content-type"] == "model/gltf-binary"
    assert response.content == (LIBRARY / "models" / "belt-conveyor-3m.glb").read_bytes()


@pytest.mark.parametrize(
    ("uri", "status"),
    [
        ("models/missing.glb", 404),
        ("manifest.json", 400),
        ("models/Belt.glb", 400),
        ("..%2Fpyproject.toml", 400),
    ],
)
def test_never_serves_anything_else(client: TestClient, uri: str, status: int) -> None:
    response = client.get(f"/api/v1/catalog/files/{uri}")
    assert response.status_code == status
    assert response.json()["detail"]


def test_demo_project_is_accepted_with_every_model_verified(client: TestClient) -> None:
    response = client.post("/api/v1/projects/validate", content=DEMO.read_text(), headers=JSON)
    assert response.status_code == 200
    report = ValidationReport.model_validate(response.json())
    assert (report.object_count, report.asset_count, report.model_file_count) == (15, 4, 4)


def _post(client: TestClient, doc: object) -> list[tuple[list[str | int], str]]:
    response = client.post("/api/v1/projects/validate", content=json.dumps(doc), headers=JSON)
    assert response.status_code == 422
    return [(i.loc, i.msg) for i in ValidationErrorResponse.model_validate(response.json()).detail]


def test_rejects_a_project_naming_a_missing_model(client: TestClient) -> None:
    doc = json.loads(DEMO.read_text())
    doc["catalog"][1]["visual"]["uri"] = "models/not-built.glb"
    [(loc, msg)] = _post(client, doc)
    assert loc == ["body", "catalog", 1, "visual", "uri"]
    assert "is not in the catalog library" in msg


def test_rejects_a_project_whose_model_bytes_differ(client: TestClient) -> None:
    doc = json.loads(DEMO.read_text())
    doc["catalog"][2]["visual"]["sha256"] = "0" * 64
    [(loc, msg)] = _post(client, doc)
    assert loc == ["body", "catalog", 2, "visual", "sha256"]
    actual = sha256_of(LIBRARY / doc["catalog"][2]["visual"]["uri"])
    assert f"file is {actual[:12]}" in msg
    assert "never loaded in its place" in msg


def test_library_location_is_configurable(tmp_path: Path) -> None:
    with TestClient(create_app(Settings(catalog_dir=tmp_path))) as c:
        response = c.post("/api/v1/projects/validate", content=DEMO.read_text(), headers=JSON)
    assert response.status_code == 422
    assert len(response.json()["detail"]) == 4  # every model is missing from the empty library
