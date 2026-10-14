"""Explicit, lossless upgrades of older project documents to the current contract.

The current :class:`~replay_world_contracts.models.Project` model only accepts the current
schema version. Older documents are upgraded here, on purpose and with a written account of
each change, and the result is then validated like any other document.

0.1.0 -> 0.2.0
    * one ``origin``/``source_ref``/``review_status`` per box becomes the same evidence on
      each of width, height and depth (no axis becomes more certain than it was);
    * ``representation: placeholder_box`` becomes ``asset_id: null`` (scene geometry);
    * an empty ``catalog`` is added.

0.2.0 -> 0.3.0
    * version only. 0.3.0 is additive (glTF visuals, ``walkway``/``keep_clear`` kinds,
      ``demonstration`` fixture label), so every 0.2.0 document is valid 0.3.0 content.

0.3.0 -> 0.4.0
    * an empty ``scene.edit_log`` is added. A file saved before the editor existed has no
      recorded edits; its values and evidence are carried over unchanged.

0.4.0 -> 0.5.0
    * every catalog asset gains ``generation: null``. Generated assets (and the ``generated``
      source kind) did not exist before 0.5.0, so no asset changes meaning.

0.5.0 -> 0.6.0
    * every source document gains ``image: null`` and ``photo_import: null``. Photo sources did
      not exist before 0.6.0, so every existing source keeps its source-to-world transform.

Steps run in sequence, so a 0.1.0 document passes through 0.2.0 on its way to the current
version and its notes describe every step.
"""

from __future__ import annotations

import copy
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Final

from .models import SCHEMA_VERSION

_AXES: Final = ("width", "height", "depth")

Step = Callable[[Mapping[str, Any]], tuple[dict[str, Any], list[str]]]


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
    original = document.get("schema_version")
    current: dict[str, Any] = copy.deepcopy(dict(document))
    notes: list[str] = []
    version = original
    while version != SCHEMA_VERSION:
        if not isinstance(version, str) or version not in _STEPS:
            supported = ", ".join((*LEGACY_SCHEMA_VERSIONS, SCHEMA_VERSION))
            raise MigrationError(f"unsupported schema_version {version!r}; supported: {supported}")
        try:
            current, step_notes = _STEPS[version](current)
        except (KeyError, TypeError, AttributeError) as exc:
            raise MigrationError(f"malformed {version} document: {exc!r}") from None
        notes.extend(step_notes)
        version = current["schema_version"]
    return Upgrade(current, str(original), notes)


def _from_0_1_0(old: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    notes = [
        "schema_version 0.1.0 -> 0.2.0",
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
        "schema_version": "0.2.0",
        "id": old["id"],
        "name": old["name"],
        "units": copy.deepcopy(old["units"]),
        "world_frame": copy.deepcopy(old["world_frame"]),
        "fixture": copy.deepcopy(old["fixture"]),
        "sources": copy.deepcopy(old["sources"]),
        "catalog": [],
        "scene": {**copy.deepcopy(dict(old["scene"])), "objects": objects},
    }
    return upgraded, notes


def _from_0_2_0(old: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    upgraded = {**copy.deepcopy(dict(old)), "schema_version": "0.3.0"}
    note = (
        "schema_version 0.2.0 -> 0.3.0 (additive: glTF visuals, walkway/keep_clear kinds, "
        "demonstration fixtures; no values changed)"
    )
    return upgraded, [note]


def _from_0_3_0(old: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    scene = copy.deepcopy(dict(old["scene"]))
    if "edit_log" in scene:
        raise MigrationError("malformed 0.3.0 document: scene.edit_log only exists from 0.4.0")
    upgraded = {
        **copy.deepcopy(dict(old)),
        "schema_version": "0.4.0",
        "scene": {**scene, "edit_log": []},
    }
    note = (
        "schema_version 0.3.0 -> 0.4.0 (adds an empty scene edit log; no values or evidence "
        "changed)"
    )
    return upgraded, [note]


def _from_0_4_0(old: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    catalog = []
    for asset in old["catalog"]:
        if "generation" in asset:
            raise MigrationError(
                "malformed 0.4.0 document: catalog generation records only exist from 0.5.0"
            )
        catalog.append({**copy.deepcopy(dict(asset)), "generation": None})
    upgraded = {**copy.deepcopy(dict(old)), "schema_version": "0.5.0", "catalog": catalog}
    note = (
        f"schema_version 0.4.0 -> 0.5.0 (adds 'generation: null' to {len(catalog)} catalog "
        f"asset{'' if len(catalog) == 1 else 's'}; no values or evidence changed)"
    )
    return upgraded, [note]


def _from_0_5_0(old: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    sources = []
    for source in old["sources"]:
        if "image" in source or "photo_import" in source:
            raise MigrationError("malformed 0.5.0 document: photo sources only exist from 0.6.0")
        sources.append({**copy.deepcopy(dict(source)), "image": None, "photo_import": None})
    upgraded = {**copy.deepcopy(dict(old)), "schema_version": "0.6.0", "sources": sources}
    note = (
        f"schema_version 0.5.0 -> 0.6.0 (adds 'image: null' and 'photo_import: null' to "
        f"{len(sources)} source{'' if len(sources) == 1 else 's'}; no values or evidence changed)"
    )
    return upgraded, [note]


_STEPS: Final[dict[str, Step]] = {
    "0.1.0": _from_0_1_0,
    "0.2.0": _from_0_2_0,
    "0.3.0": _from_0_3_0,
    "0.4.0": _from_0_4_0,
    "0.5.0": _from_0_5_0,
}
LEGACY_SCHEMA_VERSIONS: Final = tuple(_STEPS)
