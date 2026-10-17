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

0.6.0 -> 0.7.0
    * every generated asset's ``generation`` gains ``revision: null``: revisions did not exist
      before 0.7.0, so every existing generated asset is an original.
    * every photo scale reference gains ``size_basis: "not_stated"``: 0.6.0 did not ask whether
      the size was measured or assumed, so neither is claimed.

0.7.0 -> 0.8.0
    * every photo observation gains ``visibility: "not_recorded"``, ``derived_from: null``,
      ``replaced_by: null`` and ``corrections: []``: 0.7.0 did not record how much of an object
      the photo showed, and could not split or merge observations, so none is claimed.

0.8.0 -> 0.9.0
    * every source document gains ``drawing: null``. DXF drawings were not read before 0.9.0, so
      no source has a drawing reading. 0.9.0 also refuses a ``default`` length marked
      ``confirmed``; no earlier editor could produce one, and such a document is reported, not
      silently changed.

0.9.0 -> 0.10.0
    * every drawing reading gains a ``review`` in which nothing has been checked yet: the floor
      is the reader's proposal (or none), the scale is the unit as settled at import (unchecked
      from the header, confirmed when the person chose it), every object is proposed, and the
      omissions are not yet accepted;
    * every drawn object gains ``footprint_fit``: 'enclosing' for a block's extent or an outline
      that is not a rectangle (the conservative reading), 'exact' otherwise;
    * a drawn object's footprint width and depth recorded as ``measured`` with a "Drawn in ..."
      source become ``drawn``: they were read from a design drawing, not measured on site. This
      only weakens evidence; nothing else changes.

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


def _from_0_6_0(old: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    catalog = []
    revised = 0
    for asset in old["catalog"]:
        generation = asset.get("generation")
        if generation is None:
            catalog.append(copy.deepcopy(dict(asset)))
            continue
        if "revision" in generation:
            raise MigrationError(
                "malformed 0.6.0 document: asset revision records only exist from 0.7.0"
            )
        catalog.append(
            {
                **copy.deepcopy(dict(asset)),
                "generation": {**copy.deepcopy(generation), "revision": None},
            }
        )
        revised += 1
    sources = []
    scales = 0
    for source in old["sources"]:
        photo = source.get("photo_import")
        if photo is None:
            sources.append(copy.deepcopy(dict(source)))
            continue
        reference = photo["calibration"]["reference"]
        if "size_basis" in reference:
            raise MigrationError("malformed 0.6.0 document: scale size bases only exist from 0.7.0")
        upgraded_source = copy.deepcopy(dict(source))
        # 0.6.0 did not ask whether the scale was measured or assumed: say so, claim neither.
        upgraded_source["photo_import"]["calibration"]["reference"]["size_basis"] = "not_stated"
        sources.append(upgraded_source)
        scales += 1
    upgraded = {
        **copy.deepcopy(dict(old)),
        "schema_version": "0.7.0",
        "catalog": catalog,
        "sources": sources,
    }
    note = (
        f"schema_version 0.6.0 -> 0.7.0 (adds 'revision: null' to {revised} generated "
        f"asset{'' if revised == 1 else 's'} and 'size_basis: not_stated' to {scales} photo scale "
        f"reference{'' if scales == 1 else 's'}; no values or evidence changed)"
    )
    return upgraded, [note]


def _from_0_7_0(old: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    sources = []
    count = 0
    for source in old["sources"]:
        photo = source.get("photo_import")
        upgraded_source = copy.deepcopy(dict(source))
        if photo is not None:
            observations = []
            for observation in photo["observations"]:
                added = {"visibility", "derived_from", "replaced_by", "corrections"}
                if added & set(observation):
                    raise MigrationError(
                        "malformed 0.7.0 document: observation visibility and corrections only "
                        "exist from 0.8.0"
                    )
                # 0.7.0 did not ask how much of the object showed: say so, claim nothing.
                observations.append(
                    {
                        **copy.deepcopy(dict(observation)),
                        "visibility": "not_recorded",
                        "derived_from": None,
                        "replaced_by": None,
                        "corrections": [],
                    }
                )
                count += 1
            upgraded_source["photo_import"]["observations"] = observations
        sources.append(upgraded_source)
    upgraded = {**copy.deepcopy(dict(old)), "schema_version": "0.8.0", "sources": sources}
    note = (
        f"schema_version 0.7.0 -> 0.8.0 (adds 'visibility: not_recorded' and empty corrections "
        f"to {count} photo observation{'' if count == 1 else 's'}; no values or evidence changed)"
    )
    return upgraded, [note]


def _from_0_8_0(old: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    sources = []
    for source in old["sources"]:
        if "drawing" in source:
            raise MigrationError("malformed 0.8.0 document: drawing readings only exist from 0.9.0")
        sources.append({**copy.deepcopy(dict(source)), "drawing": None})
    upgraded = {**copy.deepcopy(dict(old)), "schema_version": "0.9.0", "sources": sources}
    count = len(sources)
    note = (
        f"schema_version 0.8.0 -> 0.9.0 (adds 'drawing: null' to {count} "
        f"source{'' if count == 1 else 's'}; no values or evidence changed)"
    )
    return upgraded, [note]


def _from_0_9_0(old: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    upgraded = copy.deepcopy(dict(old))
    objects = {o["id"]: o for o in upgraded["scene"]["objects"]}
    reviews = fits = weakened = 0
    for source in upgraded["sources"]:
        drawing = source.get("drawing")
        if drawing is None:
            continue
        if "review" in drawing or any("footprint_fit" in d for d in drawing["objects"]):
            raise MigrationError("malformed 0.9.0 document: drawing reviews only exist from 0.10.0")
        floor = next((d for d in drawing["objects"] if d["role"] == "floor"), None)
        for drawn in drawing["objects"]:
            approximate = drawn["refs"][0]["entity"] == "INSERT" or any(
                "not a rectangle" in note for note in drawn["notes"]
            )
            drawn["footprint_fit"] = "enclosing" if approximate else "exact"
            fits += 1
            scene_object = objects.get(drawn["object_id"])
            if scene_object is None:
                continue
            for axis in ("width", "depth"):
                length = scene_object["dimensions"][axis]
                if length["origin"] == "measured" and str(length["source_ref"] or "").startswith(
                    "Drawn in "
                ):
                    length["origin"] = "drawn"
                    weakened += 1
        transform = source["source_to_world"]
        header = drawing["units"]["basis"] == "drawing_header"
        drawing["review"] = {
            "floor": {
                "choice": "outline" if floor else "none",
                "drawn_id": floor["id"] if floor else None,
                "object_id": floor["object_id"] if floor else None,
                "status": "proposed",
            },
            "scale": {
                "basis": "drawing_unit" if header else "chosen_unit",
                "unit": transform["source_unit"],
                "metres_per_unit": transform["metres_per_source_unit"],
                "status": "unchecked" if header else "confirmed",
                "reference": None,
            },
            "objects": [
                {
                    "drawn_id": d["id"],
                    "status": "used_as_floor" if d is floor else "proposed",
                }
                for d in drawing["objects"]
            ],
            "omissions": "proposed",
        }
        reviews += 1
    upgraded["schema_version"] = "0.10.0"
    note = (
        f"schema_version 0.9.0 -> 0.10.0 (adds an unchecked review to {reviews} drawing "
        f"source{'' if reviews == 1 else 's'} and footprint_fit to {fits} drawn "
        f"object{'' if fits == 1 else 's'}; {weakened} drawn footprint "
        f"value{'' if weakened == 1 else 's'} recorded as measured become drawn (a design "
        "drawing, not a site measurement); nothing is strengthened)"
    )
    return upgraded, [note]


_STEPS: Final[dict[str, Step]] = {
    "0.1.0": _from_0_1_0,
    "0.2.0": _from_0_2_0,
    "0.3.0": _from_0_3_0,
    "0.4.0": _from_0_4_0,
    "0.5.0": _from_0_5_0,
    "0.6.0": _from_0_6_0,
    "0.7.0": _from_0_7_0,
    "0.8.0": _from_0_8_0,
    "0.9.0": _from_0_9_0,
}
LEGACY_SCHEMA_VERSIONS: Final = tuple(_STEPS)
