"""Attaching a .glb to an existing object (ENR-01's GLB part).

The files in fixtures/models/ have known answers (scripts/build_model_fixtures.py). A file is
read from its content, measured exactly through every node transform, stored unchanged by its
hash, and refused - with the reason, and nothing stored - when it is outside the supported
subset. The reviewed asset keeps the person's orientation, unit and fit, and its sizes are the
model's geometry (inferred), never a machine's measurement.
"""

from __future__ import annotations

import copy
import hashlib
import io
import json
import sys
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from replay_world_api.app import create_app
from replay_world_api.settings import AssistSettings, Settings
from replay_world_api.uploads import UploadError, inspect_glb
from replay_world_contracts import Project

ROOT = Path(__file__).resolve().parents[3]
MODELS = ROOT / "fixtures" / "models"
sys.path.insert(0, str(Path(__file__).parent))
from test_evidence import request as bundle_request  # type: ignore[import-not-found]  # noqa: E402

SAMPLE = json.loads((ROOT / "fixtures" / "scenes" / "sample-factory.json").read_text())


@pytest.fixture
def catalog(tmp_path: Path) -> Path:
    return tmp_path / "catalog"


@pytest.fixture
def client(tmp_path: Path, catalog: Path) -> Iterator[TestClient]:
    settings = Settings(
        sources_dir=tmp_path / "sources", catalog_dir=catalog, assist=AssistSettings()
    )
    with TestClient(create_app(settings)) as c:
        yield c


def bounds(name: str) -> tuple[tuple[float, ...], tuple[float, ...]]:
    b = inspect_glb((MODELS / name).read_bytes(), name).file_bounds

    def rounded(v: Any) -> tuple[float, ...]:
        return tuple(round(getattr(v, a), 6) + 0.0 for a in "xyz")

    return rounded(b.min), rounded(b.max)


@pytest.mark.parametrize(
    ("name", "low", "high"),
    [
        ("off-centre.glb", (2, 0, 3), (3, 1.5, 4)),
        # The accessor min/max describe only the untransformed box; the bounds come from the
        # vertices through the root's translation, quarter turn and scale and the child's offset.
        ("nested.glb", (0, 0, -2), (2, 2, 0)),
        ("textured.glb", (-0.5, 0, -0.5), (0.5, 1, 0.5)),
        ("tall-thin.glb", (-0.2, 0, -0.2), (0.2, 2.5, 0.2)),
        ("z-up.glb", (-0.6, -0.4, 0), (0.6, 0.4, 2)),
    ],
)
def test_bounds_are_exact_through_every_node_transform(
    name: str, low: tuple[float, ...], high: tuple[float, ...]
) -> None:
    assert bounds(name) == (low, high)


def test_what_the_file_holds_is_reported_and_an_implausible_size_is_only_pointed_out() -> None:
    textured = inspect_glb((MODELS / "textured.glb").read_bytes(), "textured.glb")
    assert (textured.triangles, textured.textures, textured.texture_pixels) == (12, 1, 16)
    millimetres = inspect_glb((MODELS / "millimetres.glb").read_bytes(), "millimetres.glb")
    assert millimetres.file_bounds.max.x == 600  # not silently rescaled
    assert millimetres.scale_hint is not None and "millimetres" in millimetres.scale_hint


@pytest.mark.parametrize(
    ("name", "kind", "words"),
    [
        ("draco-required.glb", "unsupported", "Draco-compressed geometry"),
        ("skinned.glb", "unsupported", "skinned"),
        ("external-buffer.glb", "external", "refers to an external file ('machine.bin')"),
        ("malformed.glb", "malformed", "runs outside its buffer view"),
    ],
)
def test_content_outside_the_subset_is_refused_with_the_reason(
    name: str, kind: str, words: str
) -> None:
    with pytest.raises(UploadError) as raised:
        inspect_glb((MODELS / name).read_bytes(), name)
    assert raised.value.kind == kind and words in raised.value.message


def test_the_content_decides_not_the_name() -> None:
    dxf = (ROOT / "fixtures" / "drawings" / "hall-mm.dxf").read_bytes()
    with pytest.raises(UploadError, match="not a binary glTF"):
        inspect_glb(dxf, "machine.glb")


def test_limits_are_checked_before_the_vertices_are_read(monkeypatch: pytest.MonkeyPatch) -> None:
    import replay_world_api.uploads as uploads

    monkeypatch.setattr(uploads, "MAX_IMAGE_SIDE", 2)
    with pytest.raises(UploadError, match="Image 0 is 4 x 4 pixels"):
        inspect_glb((MODELS / "textured.glb").read_bytes(), "textured.glb")
    monkeypatch.setattr(uploads, "MAX_VERTICES", 4)
    with pytest.raises(UploadError, match="more than 4 vertices"):
        inspect_glb((MODELS / "off-centre.glb").read_bytes(), "off-centre.glb")


def upload(client: TestClient, name: str) -> Any:
    return client.post(
        "/api/v1/catalog/uploaded-models",
        content=(MODELS / name).read_bytes(),
        headers={"Content-Type": "model/gltf-binary", "X-Filename": name},
    )


def test_a_file_is_stored_unchanged_by_its_hash_and_a_refused_one_not_at_all(
    client: TestClient, catalog: Path
) -> None:
    data = (MODELS / "textured.glb").read_bytes()
    report = upload(client, "textured.glb").json()
    sha = hashlib.sha256(data).hexdigest()
    assert report["uri"] == f"uploaded/{sha}.glb"
    assert (catalog / report["uri"]).read_bytes() == data
    assert upload(client, "textured.glb").json() == report  # the same file again: no change
    refused = upload(client, "external-buffer.glb")
    assert refused.status_code == 422 and "external file" in refused.json()["detail"]
    assert [p.name for p in (catalog / "uploaded").iterdir()] == [f"{sha}.glb"]


def asset_for(client: TestClient, name: str, **choices: Any) -> dict[str, Any]:
    report = upload(client, name).json()
    body = {
        "sha256": report["sha256"],
        "filename": name,
        "name": "Attached model",
        "up_axis": "+Y",
        "turns": 0,
        "unit": "m",
        "fit": "contain",
        "note": None,
        **choices,
    }
    response = client.post("/api/v1/catalog/uploaded-assets", json=body)
    assert response.status_code == 200, response.text
    asset: dict[str, Any] = response.json()
    return asset


def size(asset: dict[str, Any]) -> tuple[float, float, float]:
    d = asset["nominal_dimensions"]
    return (d["width"]["value_m"], d["height"]["value_m"], d["depth"]["value_m"])


def test_the_persons_orientation_unit_and_fit_are_recorded_not_guessed(client: TestClient) -> None:
    upright = asset_for(client, "z-up.glb", up_axis="+Z")
    assert size(upright) == (1.2, 2.0, 0.8)
    assert upright["visual"]["correction"]["up_axis"] == "+Z"
    turned = asset_for(client, "z-up.glb", up_axis="+Z", turns=1)
    assert size(turned) == (0.8, 2.0, 1.2)
    assert turned["id"] != upright["id"]  # a different choice is a different, reviewed version
    millimetres = asset_for(client, "millimetres.glb", unit="mm", fit="scale_to_dimensions")
    assert size(millimetres) == (1.2, 1.0, 0.8)
    assert millimetres["visual"]["fit"] == "scale_to_dimensions"
    # The model's own geometry, bottom-centred: never claimed as a machine's measurement.
    off = asset_for(client, "off-centre.glb", note="From the supplier's portal")
    visual = off["visual"]
    assert visual["model_bounds_m"] == {
        "min": {"x": -0.5, "y": 0, "z": -0.5},
        "max": {"x": 0.5, "y": 1.5, "z": 0.5},
    }
    assert visual["correction"]["offset"] == {"x": -2.5, "y": 0, "z": -3.5}
    width = off["nominal_dimensions"]["width"]
    assert (width["origin"], width["review_status"]) == ("inferred", "unreviewed")
    assert "not a measurement of the machine" in width["source_ref"]
    assert off["source"]["kind"] == "uploaded"
    assert off["rights"] == {
        "license": "NOASSERTION",
        "redistribution": "unknown",
        "attribution": None,
        "terms_ref": "From the supplier's portal",
    }
    assert off["upload"] == {
        "filename": "off-centre.glb",
        "bytes": 860,
        "triangles": 12,
        "note": "From the supplier's portal",
    }


def project_with(asset: dict[str, Any]) -> dict[str, Any]:
    project: dict[str, Any] = copy.deepcopy(SAMPLE)
    project["catalog"] = [asset]
    for o in project["scene"]["objects"]:
        if o["id"] == "obj-dxf-111":
            o["asset_id"] = asset["id"]
    Project.model_validate(project)
    return project


def test_a_missing_upload_opens_for_recovery_and_a_different_file_is_refused(
    client: TestClient, catalog: Path
) -> None:
    project = project_with(asset_for(client, "nested.glb"))
    assert client.post("/api/v1/projects/validate", json=project).json()["valid"]
    path = catalog / project["catalog"][0]["visual"]["uri"]
    path.unlink()
    # Missing, it opens (drawn as unavailable, with its recovery in the app); never rebuilt.
    report = client.post("/api/v1/projects/validate", json=project).json()
    assert report["valid"] and report["model_file_count"] == 0
    served = client.get(f"/api/v1/catalog/files/{project['catalog'][0]['visual']['uri']}")
    assert served.status_code == 404 and "Attach the same file again" in served.json()["detail"]
    # A different file under its name is refused: never used in its place.
    path.write_bytes((MODELS / "textured.glb").read_bytes())
    refused = client.post("/api/v1/projects/validate", json=project)
    assert refused.status_code == 422 and "does not match the recorded sha256" in refused.text


def test_a_bundle_includes_an_upload_only_when_chosen_and_checks_it_on_opening(
    tmp_path: Path,
) -> None:
    settings = Settings(
        sources_dir=tmp_path / "s1",
        catalog_dir=tmp_path / "c1",
        fixtures_dir=ROOT / "fixtures",
        assist=AssistSettings(),
    )
    with TestClient(create_app(settings)) as c:
        project = project_with(asset_for(c, "textured.glb"))
        uri = project["catalog"][0]["visual"]["uri"]
        inventory = c.post("/api/v1/exports/inventory", json=project).json()["assets"]
        model = next(a for a in inventory if a["uri"] == uri)
        assert model["status"] == "library"  # the person's file, not the repository's
        body = bundle_request()
        body["texts"][2]["text"] = json.dumps(project)
        body["manifest"]["schema_version"] = project["schema_version"]
        body["include"] = [body["include"][0], uri]
        included = c.post("/api/v1/exports", json=body).content
        body["include"] = body["include"][:1]
        body["manifest"]["excluded"] = [
            {"what": "Attached model (model)", "reason": "not selected"}
        ]
        body["manifest"]["replay"] = "runs_only"  # REL-01: a named file is left out
        response = c.post("/api/v1/exports", json=body)
        assert response.status_code == 200, response.text
        excluded = response.content
    with zipfile.ZipFile(io.BytesIO(included)) as archive:
        assert f"models/{uri}" in archive.namelist()
    with zipfile.ZipFile(io.BytesIO(excluded)) as archive:
        assert f"models/{uri}" not in archive.namelist()
    fresh = Settings(
        sources_dir=tmp_path / "s2",
        catalog_dir=tmp_path / "c2",
        fixtures_dir=ROOT / "fixtures",
        assist=AssistSettings(),
    )
    with TestClient(create_app(fresh)) as c:
        opened = c.post(
            "/api/v1/exports/open", content=included, headers={"Content-Type": "application/zip"}
        ).json()
        assert (tmp_path / "c2" / uri).read_bytes() == (MODELS / "textured.glb").read_bytes()
        assert any(uri in s for s in opened["stored"])
    other = Settings(
        sources_dir=tmp_path / "s3",
        catalog_dir=tmp_path / "c3",
        fixtures_dir=ROOT / "fixtures",
        assist=AssistSettings(),
    )
    with TestClient(create_app(other)) as c:
        opened = c.post(
            "/api/v1/exports/open", content=excluded, headers={"Content-Type": "application/zip"}
        ).json()
        assert any("is not in the bundle or on this computer" in p for p in opened["problems"])
