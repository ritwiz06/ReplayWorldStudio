"""Evidence bundles (REL-01): package a run for someone else, and open one.

The browser makes the texts (README, summary, project, event logs and metrics: the engine runs
there) and names the files it chose to include; this module checks each named file against the
hash the project records for it, adds it, lists every file with its sha256 in ``manifest.json``
and writes one ZIP. Nothing is included that was not chosen: the reviewer sees every source and
model the project names, and a person's own files are not selected for them. The Voyager key,
other files in the library and anything outside the project are never read.

Opening a bundle checks it before anything is used: every entry's name is a plain relative path,
the sizes are bounded, the manifest lists every file and each file has the listed hash. A source
or model is stored only when it has the hash the project records for it; a different file is
never used in place of a source.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Final, Literal

from pydantic import ValidationError
from replay_world_contracts import (
    SCHEMA_VERSION,
    EvidenceAsset,
    EvidenceBundleOpened,
    EvidenceBundleRequest,
    EvidenceInventory,
    EvidenceManifest,
    GltfVisual,
    Project,
)
from replay_world_contracts.evidence import EvidenceExcluded, EvidenceFile
from replay_world_contracts.migrations import (
    LEGACY_SCHEMA_VERSIONS,
    MigrationError,
    upgrade_document,
)

from .catalog_files import CatalogFileError, resolve_catalog_file
from .drawings import drawing_file
from .photos import PhotoError, resolve_source_file, write_library_file

MAX_BUNDLE_BYTES: Final = 200 * 1024 * 1024
MAX_UNPACKED_BYTES: Final = 400 * 1024 * 1024
MAX_ENTRIES: Final = 201
MANIFEST: Final = "manifest.json"
_ENTRY = re.compile(r"^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,99}/){0,5}[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
# Zip entries carry a fixed date so the same files give the same archive bytes.
_ZIP_DATE: Final = (1980, 1, 1, 0, 0, 0)


@dataclass(frozen=True)
class EvidenceError(Exception):
    kind: Literal["invalid", "damaged", "summary_only", "too_large"]
    message: str


@dataclass(frozen=True)
class _Asset:
    uri: str
    kind: Literal["drawing", "plan", "photo", "model"]
    label: str
    sha256: str
    bytes: int | None


def project_assets(project: Project) -> list[_Asset]:
    """Every file the project names: source drawings, plan pictures, photos and model files."""
    assets: list[_Asset] = []
    for source in project.sources:
        name = source.filename or source.id
        if source.drawing is not None and source.sha256 is not None:
            drawing = source.drawing
            kind: Literal["drawing", "plan"] = "drawing" if source.kind == "dxf" else "plan"
            assets.append(_Asset(drawing.file.uri, kind, name, source.sha256, drawing.file.bytes))
            raster = drawing.raster
            if raster is not None and raster.uri != drawing.file.uri:
                assets.append(
                    _Asset(raster.uri, "plan", f"{name} (page picture)", raster.sha256, None)
                )
        elif source.kind == "photo" and source.image is not None and source.sha256 is not None:
            assets.append(
                _Asset(source.image.uri, "photo", name, source.sha256, source.image.bytes)
            )
    for asset in project.catalog:
        if isinstance(asset.visual, GltfVisual):
            assets.append(
                _Asset(
                    asset.visual.uri, "model", f"{asset.name} (model)", asset.visual.sha256, None
                )
            )
    return assets


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class Libraries:
    """Where a project's files are looked up: the local source library, the synthetic sample
    files shipped with the repository, and the model catalog."""

    sources: Path
    shared: Mapping[str, Path]
    catalog: Path
    generated: Path | None = None


def _locate(asset: _Asset, libs: Libraries) -> tuple[Path | None, bool]:
    """The file for ``asset`` and whether it is part of this repository (synthetic sample files
    and the shipped catalog), or (None, False) when it is not on this computer."""
    if asset.kind == "model":
        try:
            path = resolve_catalog_file(libs.catalog, asset.uri, libs.generated)
        except CatalogFileError:
            return None, False
        # Generated and uploaded models are the person's own files, not the repository's.
        return path, not asset.uri.startswith(("generated/", "uploaded/"))
    if asset.kind == "photo":
        try:
            return resolve_source_file(libs.sources, asset.uri), False
        except PhotoError:
            return None, False
    # Drawing files are stored by their sha256, so a path the repository's samples also have is
    # the same synthetic file (its bytes are still checked against the recorded hash).
    own = drawing_file(libs.sources, asset.uri)
    if own is not None:
        return own, asset.uri in libs.shared
    shared = libs.shared.get(asset.uri)
    return (shared, True) if shared is not None else (None, False)


def inventory(project: Project, libs: Libraries) -> EvidenceInventory:
    """What could go in a bundle of ``project``, and where each file stands."""
    out: list[EvidenceAsset] = []
    seen: set[str] = set()
    for asset in project_assets(project):
        if asset.uri in seen:
            continue
        seen.add(asset.uri)
        path, repo = _locate(asset, libs)
        if path is None:
            status: Literal["repo_owned", "library", "missing", "changed"] = "missing"
            size = asset.bytes
        else:
            data = path.read_bytes()
            size = len(data)
            status = (
                "changed" if _sha256(data) != asset.sha256 else "repo_owned" if repo else "library"
            )
        out.append(
            EvidenceAsset(
                uri=asset.uri,
                kind=asset.kind,
                label=asset.label,
                sha256=asset.sha256,
                bytes=size,
                status=status,
            )
        )
    return EvidenceInventory(assets=out)


def _bundle_path(asset: _Asset) -> str:
    return f"{'models' if asset.kind == 'model' else 'files'}/{asset.uri}"


def _parse_project(text: str, where: str) -> Project:
    try:
        document: Any = json.loads(text)
    except json.JSONDecodeError as exc:
        raise EvidenceError(
            "damaged", f"{where} is not JSON ({exc.msg}, line {exc.lineno})."
        ) from None
    if isinstance(document, dict) and document.get("schema_version") in LEGACY_SCHEMA_VERSIONS:
        try:
            document = upgrade_document(document).document
        except MigrationError as exc:
            raise EvidenceError("invalid", f"{where} could not be upgraded: {exc}") from None
    try:
        return Project.model_validate(document)
    except ValidationError as exc:
        first = exc.errors()[0]
        place = "/".join(str(p) for p in first["loc"])
        raise EvidenceError(
            "invalid", f"{where} does not match the project contract ({place}: {first['msg']})."
        ) from None


def build_bundle(request: EvidenceBundleRequest, libs: Libraries) -> tuple[bytes, EvidenceManifest]:
    """The ZIP for ``request`` and the manifest written into it."""
    manifest = request.manifest
    if manifest.schema_version != SCHEMA_VERSION:
        raise EvidenceError(
            "invalid", f"A new bundle is written with the current contract ({SCHEMA_VERSION})."
        )
    texts = {t.path: t for t in request.texts}
    if len(texts) != len(request.texts) or MANIFEST in texts:
        raise EvidenceError(
            "invalid", "Each text needs its own path, and manifest.json is written here."
        )
    project: Project | None = None
    if manifest.project.file is not None:
        text = texts.get(manifest.project.file)
        if text is None or text.role != "project":
            raise EvidenceError(
                "invalid", f"The project file {manifest.project.file} was not sent."
            )
        project = _parse_project(text.text, manifest.project.file)
        if project.id != manifest.project.id:
            raise EvidenceError(
                "invalid", "The manifest names a different project than the file sent."
            )
    elif request.include:
        raise EvidenceError("invalid", "A summary-only bundle includes no source or model files.")

    assets = {a.uri: a for a in project_assets(project)} if project else {}
    entries: list[tuple[str, bytes, EvidenceFile]] = []
    for text in request.texts:
        data = text.text.encode("utf-8")
        entries.append(
            (
                text.path,
                data,
                EvidenceFile(
                    path=text.path, sha256=_sha256(data), bytes=len(data), role=text.role, uri=None
                ),
            )
        )
    for uri in dict.fromkeys(request.include):
        asset = assets.get(uri)
        if asset is None:
            raise EvidenceError(
                "invalid", f"'{uri}' is not a file this project uses; nothing else is bundled."
            )
        path, _repo = _locate(asset, libs)
        if path is None:
            raise EvidenceError(
                "invalid", f"{asset.label} is not on this computer, so it cannot be included."
            )
        data = path.read_bytes()
        if _sha256(data) != asset.sha256:
            raise EvidenceError(
                "invalid",
                f"{asset.label} on this computer differs from the file the project records "
                f"(sha256 {asset.sha256[:12]}…); a different file is never bundled in its place.",
            )
        where = _bundle_path(asset)
        role: Literal["source", "model"] = "model" if asset.kind == "model" else "source"
        entries.append(
            (
                where,
                data,
                EvidenceFile(path=where, sha256=asset.sha256, bytes=len(data), role=role, uri=uri),
            )
        )

    left_out = [a for uri, a in assets.items() if uri not in request.include]
    replay = "summary_only" if project is None else "runs_only" if left_out else "full"
    if replay != manifest.replay:
        raise EvidenceError(
            "invalid",
            f"The manifest says the bundle replays '{manifest.replay}', but with these files "
            f"it is '{replay}'.",
        )
    excluded_named = {e.what for e in manifest.excluded}
    unexplained = [a.label for a in left_out if a.label not in excluded_named]
    if unexplained:
        raise EvidenceError(
            "invalid", f"The manifest does not say why these are left out: {unexplained}."
        )

    final = manifest.model_copy(update={"files": [e[2] for e in entries]})
    final = EvidenceManifest.model_validate(final.model_dump(mode="json"))
    manifest_bytes = (
        json.dumps(final.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n"
    ).encode("utf-8")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in [(MANIFEST, manifest_bytes), *((e[0], e[1]) for e in entries)]:
            info = zipfile.ZipInfo(name, date_time=_ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)
    return buffer.getvalue(), final


def _read_entries(data: bytes) -> dict[str, bytes]:
    if len(data) > MAX_BUNDLE_BYTES:
        raise EvidenceError(
            "too_large", f"The bundle is larger than {MAX_BUNDLE_BYTES // 2**20} MB."
        )
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise EvidenceError("damaged", "This is not a ZIP file, or the ZIP is damaged.") from None
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ENTRIES:
            raise EvidenceError("invalid", f"The bundle has more than {MAX_ENTRIES} entries.")
        names = [i.filename for i in infos if not i.is_dir()]
        bad = [n for n in names if not _ENTRY.fullmatch(n) or ".." in PurePosixPath(n).parts]
        if bad:
            raise EvidenceError(
                "invalid",
                "The bundle holds entries with unsafe names (absolute paths, '..' or other "
                "characters); nothing was opened.",
            )
        if len(set(names)) != len(names):
            raise EvidenceError(
                "invalid", "The bundle names the same file twice; nothing was opened."
            )
        if sum(i.file_size for i in infos) > MAX_UNPACKED_BYTES:
            raise EvidenceError(
                "too_large", f"The bundle unpacks to more than {MAX_UNPACKED_BYTES // 2**20} MB."
            )
        out: dict[str, bytes] = {}
        for info in infos:
            if info.is_dir():
                continue
            try:
                with archive.open(info) as handle:
                    content = handle.read(info.file_size + 1)
            except (zipfile.BadZipFile, OSError, EOFError) as exc:
                raise EvidenceError(
                    "damaged", f"{info.filename} cannot be read from the ZIP ({exc})."
                ) from None
            if len(content) != info.file_size:
                raise EvidenceError("damaged", f"{info.filename} is not the size the ZIP records.")
            out[info.filename] = content
        return out


def open_bundle(data: bytes, libs: Libraries) -> EvidenceBundleOpened:
    """Check a bundle and store its verified files; raise :class:`EvidenceError` when it cannot
    be used, before anything is stored."""
    entries = _read_entries(data)
    raw = entries.get(MANIFEST)
    if raw is None:
        raise EvidenceError(
            "invalid",
            "The ZIP has no manifest.json, so it is not a Replay World Studio evidence bundle.",
        )
    try:
        manifest = EvidenceManifest.model_validate_json(raw)
    except ValidationError as exc:
        first = exc.errors()[0]
        place = "/".join(str(p) for p in first["loc"]) or "(top)"
        raise EvidenceError(
            "invalid", f"manifest.json is not an rws-evidence/1 manifest ({place}: {first['msg']})."
        ) from None

    listed = {f.path: f for f in manifest.files}
    for file in manifest.files:
        content = entries.get(file.path)
        if content is None:
            raise EvidenceError(
                "damaged",
                f"{file.path} is listed in the manifest but missing from the bundle; nothing "
                "was opened.",
            )
        digest = _sha256(content)
        if digest != file.sha256 or len(content) != file.bytes:
            raise EvidenceError(
                "damaged",
                f"{file.path} differs from the manifest (sha256 {digest[:12]}…, recorded "
                f"{file.sha256[:12]}…): the bundle was changed or damaged; nothing was opened.",
            )
    extra = sorted(set(entries) - set(listed) - {MANIFEST})
    if extra:
        raise EvidenceError(
            "damaged",
            "The bundle holds files its manifest does not list "
            f"({', '.join(extra[:3])}); nothing was opened.",
        )
    if manifest.project.file is None:
        raise EvidenceError(
            "summary_only",
            "This bundle is summary-only: it holds no project file, so nothing can be opened or "
            "rerun. Read its summary.md, and the event logs and metrics inside it.",
        )
    project = _parse_project(entries[manifest.project.file].decode("utf-8"), manifest.project.file)
    if project.id != manifest.project.id:
        raise EvidenceError("damaged", "The project file is not the project the manifest names.")

    assets = {a.uri: a for a in project_assets(project)}
    checks: list[tuple[_Asset, bytes]] = []
    for file in manifest.files:
        if file.role not in ("source", "model"):
            continue
        asset = assets.get(file.uri or "")
        if asset is None or file.path != _bundle_path(asset):
            raise EvidenceError(
                "damaged", f"{file.path} is not a file the project uses; nothing was opened."
            )
        if file.sha256 != asset.sha256:
            raise EvidenceError(
                "damaged",
                f"{file.path} is not the file the project records for {asset.label}; a different "
                "file is never used in place of a source. Nothing was opened.",
            )
        checks.append((asset, entries[file.path]))

    verified = [f"{f.path} (sha256 {f.sha256[:12]}…)" for f in manifest.files]
    stored: list[str] = []
    problems: list[str] = []
    for asset, content in checks:
        path, _repo = _locate(asset, libs)
        if path is not None:
            if _sha256(path.read_bytes()) != asset.sha256:
                problems.append(
                    f"{asset.label}: this computer holds a different file under the same name; it "
                    "was left as it is, and the bundle's copy was not stored."
                )
            continue
        if asset.kind == "model":
            if not asset.uri.startswith(("generated/", "uploaded/")):
                # A shipped catalog model is part of the repository, not of anyone's bundle.
                problems.append(
                    f"{asset.label} is missing from this checkout's catalog; rebuild it with "
                    "`pnpm assets:build`."
                )
                continue
            library = (
                libs.catalog
                if asset.uri.startswith("uploaded/")
                else libs.generated or libs.catalog
            )
            write_library_file(library, asset.uri, content, "model")
        else:
            write_library_file(libs.sources, asset.uri, content, asset.kind)
        stored.append(f"{asset.label} → {asset.uri}")
    included = {f.uri for f in manifest.files if f.uri}
    for asset in assets.values():
        if asset.uri in included:
            continue
        path, _repo = _locate(asset, libs)
        if path is None:
            problems.append(
                f"{asset.label} is not in the bundle or on this computer. The runs replay from "
                "the project file (the reviewed layout is in it), but this file cannot be shown "
                "or checked."
            )
        elif _sha256(path.read_bytes()) != asset.sha256:
            problems.append(
                f"{asset.label} on this computer differs from the recorded file; it is not used."
            )

    events: dict[str, list[dict[str, Any]]] = {}
    for run in manifest.runs:
        if run.events_file is None:
            continue
        try:
            log = json.loads(entries[run.events_file])
        except json.JSONDecodeError:
            raise EvidenceError("damaged", f"{run.events_file} is not JSON.") from None
        if not isinstance(log, dict) or not isinstance(log.get("events"), list):
            raise EvidenceError("damaged", f"{run.events_file} holds no event list.")
        events[run.layout] = log["events"]
    return EvidenceBundleOpened(
        manifest=manifest,
        project=project,
        events=events,
        verified=verified,
        stored=stored,
        problems=problems,
    )


def excluded_for(assets: list[EvidenceAsset], include: list[str]) -> list[EvidenceExcluded]:
    """Why each file left out of a bundle is not in it (used by tests and the CLI check)."""
    reasons = {
        "library": "your own file; not selected for this bundle",
        "missing": "not on this computer",
        "changed": "the file on this computer differs from the one recorded",
        "repo_owned": "part of this repository; not selected",
    }
    return [
        EvidenceExcluded(what=a.label, reason=reasons[a.status])
        for a in assets
        if a.uri not in include
    ]
