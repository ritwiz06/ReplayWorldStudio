"""Explicit, lossless upgrades of older project documents to the current contract.

The current :class:`~replay_world_contracts.models.Project` model only accepts the current
schema version. Older documents are upgraded here, on purpose and with a written account of
each change, and the result is then validated like any other document.

0.1.0 -> 0.2.0
    * one ``origin``/``source_ref``/``review_status`` per box becomes the same evidence on
      each of width, height and depth (no axis becomes more certain than it was);
    * ``representation: placeholder_box`` becomes ``asset_id: null`` (scene geometry);
    * an empty ``catalog`` is added.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Final

from .models import SCHEMA_VERSION

LEGACY_SCHEMA_VERSIONS: Final = ("0.1.0",)
_AXES: Final = ("width", "height", "depth")


class MigrationError(ValueError):
    """The document cannot be upgraded: unknown version or malformed legacy content."""


@dataclass(frozen=True)
class Upgrade:
    document: dict[str, Any]
    from_version: str
    notes: list[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return self.from_version != SCHEMA_VERSION


def upgrade_document(document: Mapping[str, Any]) -> Upgrade:
    """Return the document in the current schema. The input is never modified."""
    version = document.get("schema_version")
    if version == SCHEMA_VERSION:
        return Upgrade(copy.deepcopy(dict(document)), SCHEMA_VERSION)
    if version == "0.1.0":
        try:
            return _from_0_1_0(document)
        except (KeyError, TypeError, AttributeError) as exc:
            raise MigrationError(f"malformed 0.1.0 document: {exc!r}") from None
    supported = ", ".join((*LEGACY_SCHEMA_VERSIONS, SCHEMA_VERSION))
    raise MigrationError(f"unsupported schema_version {version!r}; supported: {supported}")


def _from_0_1_0(old: Mapping[str, Any]) -> Upgrade:
    notes = [
        f"schema_version 0.1.0 -> {SCHEMA_VERSION}",
        "catalog: added an empty catalog (0.1.0 had no catalog assets)",
    ]
    objects = []
    for obj in old["scene"]["objects"]:
        dims = obj["dimensions"]
        evidence = {key: dims[key] for key in ("origin", "source_ref", "review_status")}
        objects.append(
            {
                "id": obj["id"],
                "name": obj["name"],
                "kind": obj["kind"],
                "asset_id": None,
                "transform": copy.deepcopy(obj["transform"]),
                "dimensions": {
                    axis: {"value_m": dims[f"{axis}_m"], **evidence, "uncertainty_m": None}
                    for axis in _AXES
                },
                "parameters": copy.deepcopy(obj["parameters"]),
            }
        )
        notes.append(
            f"{obj['id']}: box origin '{dims['origin']}' applied to width, height and depth; "
            f"representation '{obj.get('representation')}' -> asset_id null"
        )
    upgraded = {
        "schema_version": SCHEMA_VERSION,
        "id": old["id"],
        "name": old["name"],
        "units": copy.deepcopy(old["units"]),
        "world_frame": copy.deepcopy(old["world_frame"]),
        "fixture": copy.deepcopy(old["fixture"]),
        "sources": copy.deepcopy(old["sources"]),
        "catalog": [],
        "scene": {**copy.deepcopy(dict(old["scene"])), "objects": objects},
    }
    return Upgrade(upgraded, "0.1.0", notes)
