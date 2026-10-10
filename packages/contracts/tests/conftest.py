from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "fixtures"


@pytest.fixture
def fixture_text() -> str:
    return (FIXTURES / "scenes" / "foundation-scene.json").read_text()


@pytest.fixture
def fixture_data(fixture_text: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(fixture_text)
    return data
