"""0.1.0 documents are upgraded explicitly and losslessly, never accepted as they are."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError
from replay_world_contracts import SCHEMA_VERSION, Project
from replay_world_contracts.migrations import MigrationError, upgrade_document

from .conftest import FIXTURES

LEGACY = FIXTURES / "legacy" / "foundation-scene-0.1.0.json"


@pytest.fixture
def legacy() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(LEGACY.read_text())
    return data


def test_current_model_refuses_the_legacy_document(legacy: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        Project.model_validate(legacy)


def test_legacy_document_upgrades_to_a_valid_project(legacy: dict[str, Any]) -> None:
    upgrade = upgrade_document(legacy)
    project = Project.model_validate(upgrade.document)
    assert (upgrade.from_version, project.schema_version) == ("0.1.0", SCHEMA_VERSION)
    assert upgrade.changed
    assert project.catalog == []
    assert any(
        "box origin 'inferred' applied to width, height and depth" in n for n in upgrade.notes
    )


def test_upgrade_preserves_every_value_and_never_strengthens_evidence(
    legacy: dict[str, Any],
) -> None:
    project = Project.model_validate(upgrade_document(legacy).document)
    for old, new in zip(legacy["scene"]["objects"], project.scene.objects, strict=True):
        assert new.id == old["id"] and new.kind == old["kind"]
        assert new.asset_id is None
        assert new.transform.model_dump() == old["transform"]
        assert [p.model_dump() for p in new.parameters] == old["parameters"]
        for axis in ("width", "height", "depth"):
            length = getattr(new.dimensions, axis)
            assert length.value_m == old["dimensions"][f"{axis}_m"]
            assert length.origin == old["dimensions"]["origin"]
            assert length.source_ref == old["dimensions"]["source_ref"]
            assert length.review_status == old["dimensions"]["review_status"]
            assert length.uncertainty_m is None
    assert [s.model_dump() for s in project.sources] == legacy["sources"]


def test_upgrade_does_not_modify_its_input(legacy: dict[str, Any]) -> None:
    before = copy.deepcopy(legacy)
    upgrade_document(legacy)
    assert legacy == before


def test_0_2_0_documents_only_change_version(fixture_data: dict[str, Any]) -> None:
    old = {**fixture_data, "schema_version": "0.2.0"}
    upgrade = upgrade_document(old)
    assert upgrade.document == fixture_data
    assert upgrade.from_version == "0.2.0"
    assert upgrade.notes == [
        "schema_version 0.2.0 -> 0.3.0 (additive: glTF visuals, walkway/keep_clear kinds, "
        "demonstration fixtures; no values changed)"
    ]


def test_legacy_upgrade_runs_every_step_in_order(legacy: dict[str, Any]) -> None:
    notes = upgrade_document(legacy).notes
    assert notes[0] == "schema_version 0.1.0 -> 0.2.0"
    assert notes[-1].startswith("schema_version 0.2.0 -> 0.3.0")


def test_current_documents_pass_through_unchanged(fixture_data: dict[str, Any]) -> None:
    upgrade = upgrade_document(fixture_data)
    assert (upgrade.document, upgrade.changed, upgrade.notes) == (fixture_data, False, [])


@pytest.mark.parametrize("version", ["0.0.1", "0.4.0", "1.0.0", None])
def test_unknown_versions_are_refused(legacy: dict[str, Any], version: str | None) -> None:
    legacy["schema_version"] = version
    with pytest.raises(MigrationError, match="unsupported schema_version"):
        upgrade_document(legacy)


def test_malformed_legacy_documents_are_refused(legacy: dict[str, Any]) -> None:
    del legacy["scene"]["objects"][0]["dimensions"]["width_m"]
    with pytest.raises(MigrationError, match=r"malformed 0\.1\.0 document"):
        upgrade_document(legacy)


def _migrate(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "replay_world_contracts.migrate", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_migrate_command_writes_a_validated_upgrade(tmp_path: Path) -> None:
    out = tmp_path / "upgraded.json"
    result = _migrate(str(LEGACY), "-o", str(out))
    assert result.returncode == 0, result.stderr
    assert "note: schema_version 0.1.0 -> 0.2.0" in result.stderr
    project = Project.model_validate_json(out.read_text())
    assert project.schema_version == "0.3.0"
    assert "note: schema_version 0.2.0 -> 0.3.0" in result.stderr
    assert LEGACY.read_text().startswith('{\n  "schema_version": "0.1.0"')  # input untouched


def test_migrate_command_refuses_invalid_input(tmp_path: Path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text(LEGACY.read_text().replace('"width_m": 20.0', '"width_m": -20.0'))
    result = _migrate(str(bad))
    assert result.returncode == 1
    assert "greater than 0" in result.stderr
    assert result.stdout == ""
