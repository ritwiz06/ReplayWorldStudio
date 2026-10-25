"""Evidence bundles (REL-01): packaging a run, and opening a bundle someone sent.

A bundle holds only files the project names, each with the hash the project records; the
manifest lists every file with its sha256. Opening checks every name, size and hash before
anything is stored, refuses a changed or damaged bundle with the reason, never uses a different
file in place of a source, and says what is missing instead of guessing.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from replay_world_api.app import create_app
from replay_world_api.settings import AssistSettings, Settings
from replay_world_contracts import SCHEMA_VERSION

ROOT = Path(__file__).resolve().parents[3]
SAMPLE = json.loads((ROOT / "fixtures" / "scenes" / "sample-factory.json").read_text())
DXF = ROOT / "fixtures" / "drawings" / "layout-checks-mm.dxf"
DXF_URI = SAMPLE["sources"][0]["drawing"]["file"]["uri"]
FP = "0123456789abcd"


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(sources_dir=tmp_path / "sources", assist=AssistSettings())
    with TestClient(create_app(settings)) as c:
        yield c


def _run(layout: str, completed: int) -> dict[str, Any]:
    return {
        "layout": layout,
        "engine": "rws-run/1",
        "seed": 1,
        "scene_revision": 1,
        "layout_fingerprint": FP,
        "process_fingerprint": FP,
        "outcome": "ready",
        "reasons": [],
        "event_fingerprint": FP,
        "event_count": 2,
        "completed": completed,
        "created": completed,
        "unfinished": 0,
        "events_file": f"runs/{layout}/events.json",
        "metrics_file": f"runs/{layout}/metrics.json",
    }


def request(
    include: list[str] | None = None, replay: str = "full", **changes: Any
) -> dict[str, Any]:
    include = [DXF_URI] if include is None else include
    excluded = (
        []
        if DXF_URI in include
        else [{"what": "layout-checks-mm.dxf", "reason": "part of the repository, not selected"}]
    )
    manifest = {
        "format": "rws-evidence/1",
        "created_utc": "2026-10-19T12:00:00Z",
        "schema_version": SAMPLE["schema_version"],
        "engine": "rws-run/1",
        "project": {
            "file": "project.json",
            "id": SAMPLE["id"],
            "name": SAMPLE["name"],
            "synthetic": True,
            "note": "Synthetic example.",
        },
        "process": {"name": "Example", "fingerprint": FP, "seed": 1, "example_note": None},
        "runs": [_run("original", 102), _run("edited", 0)],
        "comparison": {"identical": False, "explanation": ["Output goes from 102 to 0."]},
        "inputs": [
            {
                "path": "shift.duration_s",
                "label": "Shift length",
                "value": 28800,
                "unit": "s",
                "detail": None,
                "basis": "example",
            }
        ],
        "layout_evidence": ["Read from layout-checks-mm.dxf."],
        "claims": ["Results under stated assumptions."],
        "conventions": ["Times in ms from the shift start."],
        "replay": replay,
        "files": [],
        "excluded": excluded,
    }
    manifest.update(changes)
    events = json.dumps(
        {"events": [{"t": 0, "type": "shift_start"}, {"t": 1, "type": "shift_end"}]}
    )
    texts = [
        {"path": "README.md", "role": "readme", "text": "# Bundle\n"},
        {"path": "summary.md", "role": "summary", "text": "# Summary\n"},
        {"path": "project.json", "role": "project", "text": json.dumps(SAMPLE, indent=2)},
    ]
    for layout in ("original", "edited"):
        texts.append({"path": f"runs/{layout}/events.json", "role": "events", "text": events})
        texts.append({"path": f"runs/{layout}/metrics.json", "role": "metrics", "text": "{}"})
    return {"manifest": manifest, "texts": texts, "include": include}


def export(client: TestClient, body: dict[str, Any]) -> bytes:
    response = client.post("/api/v1/exports", json=body)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    return response.content


def entries(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def rezip(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def open_bundle(client: TestClient, data: bytes) -> Any:
    return client.post(
        "/api/v1/exports/open", content=data, headers={"Content-Type": "application/zip"}
    )


def test_inventory_lists_the_sample_drawing_as_part_of_the_repository(client: TestClient) -> None:
    response = client.post("/api/v1/exports/inventory", json=SAMPLE)
    assert response.status_code == 200
    (asset,) = response.json()["assets"]
    assert asset["uri"] == DXF_URI
    assert asset["status"] == "repo_owned"
    assert asset["sha256"] == hashlib.sha256(DXF.read_bytes()).hexdigest()


def test_a_bundle_lists_every_file_with_its_sha256(client: TestClient) -> None:
    data = export(client, request())
    files = entries(data)
    manifest = json.loads(files["manifest.json"])
    listed = {f["path"]: f for f in manifest["files"]}
    assert set(files) == set(listed) | {"manifest.json"}
    for path, content in files.items():
        if path != "manifest.json":
            assert hashlib.sha256(content).hexdigest() == listed[path]["sha256"]
            assert len(content) == listed[path]["bytes"]
    assert files[f"files/{DXF_URI}"] == DXF.read_bytes()
    assert listed[f"files/{DXF_URI}"]["uri"] == DXF_URI
    # The same files give the same archive (fixed entry dates).
    assert export(client, request()) == data


def test_only_files_the_project_uses_can_be_included(client: TestClient) -> None:
    body = request(include=["photos/" + "a" * 64 + ".jpg"])
    response = client.post("/api/v1/exports", json=body)
    assert response.status_code == 422
    assert "not a file this project uses" in response.json()["detail"]


def test_the_replay_label_must_match_what_is_included(client: TestClient) -> None:
    response = client.post("/api/v1/exports", json=request(include=[]))
    assert response.status_code == 422
    assert "'full'" in response.json()["detail"]
    files = entries(export(client, request(include=[], replay="runs_only")))
    assert f"files/{DXF_URI}" not in files
    manifest = json.loads(files["manifest.json"])
    assert manifest["excluded"][0]["what"] == "layout-checks-mm.dxf"


def test_a_bundle_opens_and_returns_its_project_and_event_logs(client: TestClient) -> None:
    response = open_bundle(client, export(client, request()))
    assert response.status_code == 200, response.text
    opened = response.json()
    assert opened["project"]["id"] == SAMPLE["id"]
    assert opened["events"]["original"][0] == {"t": 0, "type": "shift_start"}
    assert any(v.startswith(f"files/{DXF_URI}") for v in opened["verified"])
    assert opened["stored"] == []  # the sample drawing is part of the repository
    assert opened["problems"] == []


def test_the_committed_rel01_bundle_written_at_0_14_0_still_opens(client: TestClient) -> None:
    # Bundles began at 0.14.0; an older bundle is read as written (its manifest unchanged) and
    # its project file is upgraded on opening, as a saved project is.
    bundle = ROOT / "docs" / "demo" / "sample-factory-hall-synthetic-run-0c9d70a92abb83.zip"
    response = open_bundle(client, bundle.read_bytes())
    assert response.status_code == 200, response.text
    opened = response.json()
    assert opened["manifest"]["schema_version"] == "0.14.0"
    assert opened["project"]["schema_version"] == SCHEMA_VERSION
    assert len(opened["verified"]) == 8
    assert opened["problems"] == []


def test_a_new_bundle_is_written_with_the_current_contract(client: TestClient) -> None:
    body = request()
    body["manifest"]["schema_version"] = "0.14.0"
    response = client.post("/api/v1/exports", json=body)
    assert response.status_code == 422
    assert "current contract" in response.json()["detail"]


def test_a_changed_file_is_refused_and_nothing_is_stored(
    client: TestClient, tmp_path: Path
) -> None:
    files = entries(export(client, request()))
    files["runs/edited/events.json"] = files["runs/edited/events.json"].replace(
        b'"t": 1', b'"t": 2'
    )
    response = open_bundle(client, rezip(files))
    assert response.status_code == 422
    assert "runs/edited/events.json differs from the manifest" in response.json()["detail"]
    assert not (tmp_path / "sources").exists() or not any((tmp_path / "sources").rglob("*.dxf"))


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda f: f.pop("project.json"), "project.json is listed in the manifest but missing"),
        (lambda f: f.update({"extra.txt": b"x"}), "files its manifest does not list"),
        (lambda f: f.pop("manifest.json"), "has no manifest.json"),
        (lambda f: f.update({"manifest.json": b"{}"}), "is not an rws-evidence/1 manifest"),
    ],
)
def test_a_damaged_bundle_gets_a_useful_error(
    client: TestClient, change: Any, message: str
) -> None:
    files = entries(export(client, request()))
    change(files)
    response = open_bundle(client, rezip(files))
    assert response.status_code == 422
    assert message in response.json()["detail"]


def test_unsafe_names_and_non_zips_are_refused(client: TestClient) -> None:
    files = entries(export(client, request()))
    files["../escape.txt"] = b"x"
    response = open_bundle(client, rezip(files))
    assert response.status_code == 422
    assert "unsafe names" in response.json()["detail"]
    response = open_bundle(client, b"not a zip")
    assert response.status_code == 422
    assert "not a ZIP" in response.json()["detail"]


def test_a_summary_only_bundle_says_it_cannot_be_rerun(client: TestClient) -> None:
    body = request(include=[], replay="summary_only")
    body["manifest"]["project"]["file"] = None
    body["manifest"]["excluded"] = [{"what": "The project file", "reason": "summary only"}]
    body["texts"] = [t for t in body["texts"] if t["role"] != "project"]
    response = open_bundle(client, export(client, body))
    assert response.status_code == 422
    assert "summary-only" in response.json()["detail"]


def test_a_source_another_computer_lacks_is_stored_from_the_bundle(tmp_path: Path) -> None:
    # A fresh library with no shared sample files: the bundle's drawing is stored by its hash.
    empty = tmp_path / "no-fixtures"
    (empty / "drawings").mkdir(parents=True)
    settings = Settings(
        sources_dir=tmp_path / "lib", fixtures_dir=ROOT / "fixtures", assist=AssistSettings()
    )
    with TestClient(create_app(settings)) as c:
        data = export(c, request())
    bare = Settings(sources_dir=tmp_path / "lib2", fixtures_dir=empty, assist=AssistSettings())
    with TestClient(create_app(bare)) as c:
        opened = open_bundle(c, data).json()
        assert opened["stored"] == [f"layout-checks-mm.dxf → {DXF_URI}"]
        assert (tmp_path / "lib2" / DXF_URI).read_bytes() == DXF.read_bytes()
        # Without the file in the bundle or on the computer, the gap is named, not filled.
        files = entries(export(c, request()))
    files.pop(f"files/{DXF_URI}")
    manifest = json.loads(files["manifest.json"])
    manifest["files"] = [f for f in manifest["files"] if f["role"] != "source"]
    manifest["replay"] = "runs_only"
    files["manifest.json"] = json.dumps(manifest).encode()
    with TestClient(
        create_app(
            Settings(sources_dir=tmp_path / "lib3", fixtures_dir=empty, assist=AssistSettings())
        )
    ) as c:
        opened = open_bundle(c, rezip(files)).json()
    assert "is not in the bundle or on this computer" in opened["problems"][0]


def test_a_different_file_is_never_used_in_place_of_a_source(client: TestClient) -> None:
    files = entries(export(client, request()))
    fake = b"0\nSECTION\n0\nENDSEC\n0\nEOF\n"
    files[f"files/{DXF_URI}"] = fake
    manifest = json.loads(files["manifest.json"])
    for f in manifest["files"]:
        if f["role"] == "source":
            f["sha256"] = hashlib.sha256(fake).hexdigest()
            f["bytes"] = len(fake)
    files["manifest.json"] = json.dumps(manifest).encode()
    response = open_bundle(client, rezip(files))
    assert response.status_code == 422
    assert "never used in place of a source" in response.json()["detail"]
