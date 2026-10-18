"""Resolve glTF references against the catalog library without trusting the request.

A reference is accepted only if it matches the contract's path pattern, resolves (after
following symbolic links) to a regular file inside the library root, and - when a project is
validated - has exactly the bytes its catalog entry records. Nothing else is ever served in
its place.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from replay_world_contracts import GltfVisual, Project
from replay_world_contracts.models import CATALOG_PATH_PATTERN

_PATH = re.compile(CATALOG_PATH_PATTERN)
REBUILD_HINT = "Rebuild the models with `pnpm assets:build` or restore the file."


@dataclass(frozen=True)
class CatalogFileError(Exception):
    kind: Literal["unsafe", "missing"]
    message: str


def resolve_catalog_file(root: Path, uri: str, generated_root: Path | None = None) -> Path:
    """Return the library file for ``uri`` or raise :class:`CatalogFileError`.

    With ``generated_root`` (a public-preview visitor's own catalog), generated models are read
    only from there; the shared catalog models are read from ``root``.
    """
    if generated_root is not None and uri.startswith("generated/"):
        root = generated_root
    if not _PATH.fullmatch(uri):
        raise CatalogFileError(
            "unsafe",
            f"'{uri}' is not a catalog path: use lowercase segments ending in .glb, "
            "with no '..', absolute paths, schemes or backslashes",
        )
    library = root.resolve()
    candidate = (library / uri).resolve()
    if not candidate.is_relative_to(library):
        raise CatalogFileError("unsafe", f"'{uri}' resolves outside the catalog library")
    if not candidate.is_file():
        raise CatalogFileError(
            "missing", f"Model file '{uri}' is not in the catalog library. {REBUILD_HINT}"
        )
    return candidate


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_model_files(
    project: Project, root: Path, generated_root: Path | None = None
) -> tuple[int, list[dict[str, Any]]]:
    """Check every glTF visual; return (files verified, validation issues)."""
    verified = 0
    issues: list[dict[str, Any]] = []
    for index, asset in enumerate(project.catalog):
        visual = asset.visual
        if not isinstance(visual, GltfVisual):
            continue
        loc = ("body", "catalog", index, "visual")
        try:
            path = resolve_catalog_file(root, visual.uri, generated_root)
        except CatalogFileError as exc:
            issues.append({"loc": (*loc, "uri"), "msg": exc.message, "type": f"model_{exc.kind}"})
            continue
        digest = sha256_of(path)
        if digest != visual.sha256:
            issues.append(
                {
                    "loc": (*loc, "sha256"),
                    "msg": (
                        f"Model file '{visual.uri}' does not match the recorded sha256 "
                        f"(file is {digest[:12]}…). Restore the recorded file or update the "
                        "catalog entry; a different file is never loaded in its place."
                    ),
                    "type": "model_hash_mismatch",
                }
            )
            continue
        verified += 1
    return verified, issues
