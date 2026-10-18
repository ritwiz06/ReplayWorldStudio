"""The public preview (ADR-054): AI off whatever the key, each visitor's files isolated (a content
hash is never permission to read someone else's copy), files deleted after the retention period,
bounded storage and requests, and the built web app served on the same origin."""

from __future__ import annotations

import hashlib
import os
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from replay_world_api.app import create_app
from replay_world_api.public import COOKIE, sweep
from replay_world_api.settings import AssistSettings, PublicLimits, Settings
from replay_world_contracts import GeneratedModel, PlanUpload, ValidationReport

ROOT = Path(__file__).resolve().parents[3]
SKETCH = (ROOT / "fixtures" / "plans" / "rough-cell.png").read_bytes()
FOUNDATION = (ROOT / "fixtures" / "scenes" / "foundation-scene.json").read_text()


def settings(tmp_path: Path, **limits: Any) -> Settings:
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<!doctype html><title>Replay World Studio</title>")
    (web / "assets" / "app-1234.js").write_text("console.log('app')")
    return Settings(
        public=True,
        data_dir=tmp_path / "data",
        web_dir=web,
        cors_origins=(),
        catalog_dir=ROOT / "assets" / "catalog",
        sources_dir=tmp_path / "unused-local-library",
        assist=AssistSettings(),
        limits=PublicLimits(**limits),
    )


@pytest.fixture
def app_settings(tmp_path: Path) -> Settings:
    return settings(tmp_path)


def visitor(s: Settings) -> TestClient:
    return TestClient(create_app(s))


@pytest.fixture
def a(app_settings: Settings) -> Iterator[TestClient]:
    with visitor(app_settings) as client:
        yield client


@pytest.fixture
def b(app_settings: Settings) -> Iterator[TestClient]:
    with visitor(app_settings) as client:
        yield client


def upload(client: TestClient, data: bytes, name: str = "plan.png") -> Any:
    return client.post("/api/v1/sources/plans", params={"filename": name}, content=data)


def test_a_key_never_turns_ai_on_in_the_public_preview() -> None:
    public = Settings.from_env({"RWS_PUBLIC": "1", "VOYAGER_API_KEY": "secret-test-value"})
    assert public.assist.provider == "off" and public.assist.api_key == ""
    assert (public.host, public.cors_origins) == ("0.0.0.0", ())
    local = Settings.from_env({"VOYAGER_API_KEY": "secret-test-value"})
    assert local.assist.provider == "voyager"  # local development is unchanged
    assert Settings.from_env({"RWS_PUBLIC": "1", "PORT": "8123"}).port == 8123


def test_ai_endpoints_answer_off(a: TestClient) -> None:
    status = a.get("/api/v1/assist/status").json()
    assert status["available"] is False
    response = a.post("/api/v1/assist/plan-proposals", json={})
    assert response.status_code in (422, 503)
    off = a.post("/api/v1/assist/object-proposals", json={"description": "a small table"})
    assert off.status_code == 503


def test_each_visitor_gets_a_private_cookie(a: TestClient) -> None:
    cookie = a.get("/health").headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE}=") and "HttpOnly" in cookie
    assert "samesite=lax" in cookie.lower()
    again = a.get("/health")
    assert "set-cookie" not in again.headers  # the same visitor from now on
    with TestClient(a.app) as fresh:  # behind the HTTPS proxy, the cookie is Secure
        secure = fresh.get("/health", headers={"x-forwarded-proto": "https"}).headers["set-cookie"]
        assert "Secure" in secure


def test_one_visitor_cannot_read_another_visitors_upload_even_knowing_its_hash(
    a: TestClient, b: TestClient, app_settings: Settings
) -> None:
    a.get("/health")
    b.get("/health")
    own = b"\x89PNG" + SKETCH[4:]  # identical bytes: the sketch itself is a shared sample
    digest = hashlib.sha256(own).hexdigest()
    private = own[:-12] + b"private tail"  # a visitor's own (non-sample) file
    plan = PlanUpload.model_validate(upload(a, private).json())
    assert plan.analysis is not None and plan.analysis.drawing.raster is not None
    uri = plan.analysis.drawing.raster.uri
    assert a.get(f"/api/v1/sources/files/{uri}").status_code == 200
    assert b.get(f"/api/v1/sources/files/{uri}").status_code == 404
    # The same bytes uploaded by the other visitor are their own copy, in their own folder.
    assert upload(b, private).status_code == 200
    folders = sorted(p.name for p in (app_settings.data_dir / "visitors").iterdir())
    assert len(folders) == 2 and all(COOKIE not in f for f in folders)
    a.post("/api/v1/visitor/clear")
    assert a.get(f"/api/v1/sources/files/{uri}").status_code == 404
    assert b.get(f"/api/v1/sources/files/{uri}").status_code == 200
    # The synthetic samples are shared, read-only, for everyone.
    assert digest == hashlib.sha256(SKETCH).hexdigest()
    assert b.get(f"/api/v1/sources/files/drawings/{digest}.png").status_code == 200


def test_generated_models_are_private_too(a: TestClient, b: TestClient) -> None:
    spec = {
        "format": "rws-geometry/1",
        "envelope_m": {"x": 1.0, "y": 0.8, "z": 0.6},
        "parts": [
            {
                "id": "body",
                "label": "Body",
                "shape": "box",
                "material": "paint_light_grey",
                "center_m": {"x": 0.0, "y": 0.4, "z": 0.0},
                "size_m": {"x": 1.0, "y": 0.8, "z": 0.6},
                "axis": None,
                "taper": None,
                "narrow_end": None,
                "basis": "inferred",
            }
        ],
    }
    stored = a.post("/api/v1/catalog/generated-models", json={"spec": spec})
    assert stored.status_code == 200, stored.json()
    uri = GeneratedModel.model_validate(stored.json()).visual.uri
    assert a.get(f"/api/v1/catalog/files/{uri}").status_code == 200
    assert b.get(f"/api/v1/catalog/files/{uri}").status_code == 404
    shared = "models/belt-conveyor-3m.glb"
    assert b.get(f"/api/v1/catalog/files/{shared}").status_code == 200


def test_old_files_are_swept_and_recent_ones_kept(tmp_path: Path) -> None:
    folder = tmp_path / "visitors" / "abc" / "sources" / "drawings"
    folder.mkdir(parents=True)
    old, new = folder / "old.png", folder / "new.png"
    old.write_bytes(b"x")
    new.write_bytes(b"y")
    day_ago = time.time() - 25 * 3600
    os.utime(old, (day_ago, day_ago))
    assert sweep(tmp_path, 24) == 1
    assert not old.exists() and new.exists()
    os.utime(new, (day_ago, day_ago))
    assert sweep(tmp_path, 24) == 1
    assert not (tmp_path / "visitors" / "abc").exists()  # empty folders go too


def test_a_visitors_quota_and_the_storage_cap_are_enforced(tmp_path: Path) -> None:
    with visitor(settings(tmp_path / "q", visitor_quota_mb=1)) as small:
        refused = upload(small, SKETCH[:-12] + b"private tail")  # 1.1 MB > 1 MB
        assert refused.status_code == 413 and "per visitor" in refused.json()["detail"]
    with visitor(settings(tmp_path / "c", storage_cap_mb=1)) as full:
        refused = upload(full, SKETCH[:-12] + b"private tail")
        assert refused.status_code == 507 and "storage is full" in refused.json()["detail"]


def test_requests_and_bodies_are_bounded(tmp_path: Path) -> None:
    with visitor(settings(tmp_path, requests_per_minute=3)) as busy:
        codes = [busy.get("/health").status_code for _ in range(4)]
        assert codes == [200, 200, 200, 429]
    with visitor(settings(tmp_path / "b", max_body_mb=1)) as bounded:
        big = bounded.post("/api/v1/projects/validate", content=b"{" + b" " * 1_100_000 + b"}")
        assert big.status_code == 413

        def chunks() -> Iterator[bytes]:
            yield b"{}"

        streamed = bounded.post("/api/v1/projects/validate", content=chunks())
        assert streamed.status_code == 411


def test_the_web_app_is_served_on_the_same_origin_with_safe_headers(a: TestClient) -> None:
    page = a.get("/")
    assert page.status_code == 200 and "Replay World Studio" in page.text
    assert page.headers["cache-control"] == "no-cache"
    assert "frame-ancestors 'none'" in page.headers["content-security-policy"]
    assert page.headers["x-content-type-options"] == "nosniff"
    assert a.get("/projects/anything").text == page.text  # the app's own routes
    script = a.get("/assets/app-1234.js")
    assert "immutable" in script.headers["cache-control"]
    assert a.get("/api/v1/nothing-here").status_code == 404
    assert a.get("/../pyproject.toml").text == page.text  # never outside the web folder
    assert a.get("/docs").text == page.text and a.get("/openapi.json").text == page.text


def test_a_project_still_validates_and_reports_files_it_cannot_reach(a: TestClient) -> None:
    report = a.post(
        "/api/v1/projects/validate",
        content=FOUNDATION,
        headers={"Content-Type": "application/json"},
    )
    assert report.status_code == 200
    assert ValidationReport.model_validate(report.json()).valid
