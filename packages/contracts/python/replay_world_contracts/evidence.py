"""Evidence bundles (REL-01): one ZIP that lets someone else open a project and reproduce its
shift and before/after comparison, with what each number rests on.

A bundle holds a README, a plain summary, the project file (its process included), the event log
and metrics of each compared run as the engine produced them, chosen asset files, and this
manifest. The manifest lists every file with its sha256, the contract and engine versions, the
seed, fingerprints of each layout, process and event log, and the basis of every operating input
(an ``example`` assumption or ``entered``). Layout evidence (what the drawing and its review
established) is stated separately from operating values. Nothing in a bundle is a measurement of
real output.
"""

from __future__ import annotations

from typing import Annotated, Any, Final, Literal

from pydantic import Field, StringConstraints, model_validator

from .models import (
    ContractModel,
    NonEmptyText,
    ProcessBasis,
    Project,
    SchemaVersion,
    Sha256Hex,
    _require_unique,
)

EVIDENCE_FORMAT: Final = "rws-evidence/1"
MAX_BUNDLE_FILES: Final = 200
BundlePath = Annotated[
    str,
    StringConstraints(
        pattern=r"^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,99}/){0,5}[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"
    ),
    Field(description="A relative path inside the bundle: no '..', no leading '/', no backslash."),
]
Fingerprint = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{14}$")]
# The contract a bundle was written with: bundles began at 0.14.0, and an older bundle stays
# readable (its project file is upgraded when opened). A new bundle is always the current one.
BundleSchemaVersion = Literal["0.14.0", SchemaVersion]
RunOutcome = Literal["ready", "blocked", "cannot_determine", "needs_input"]


class EvidenceFile(ContractModel):
    path: BundlePath
    sha256: Sha256Hex
    bytes: int = Field(ge=0)
    role: Literal["readme", "summary", "project", "events", "metrics", "source", "model"]
    uri: NonEmptyText | None = Field(
        description="For an asset: the URI the project uses for it (source library or catalog)."
    )


class EvidenceInput(ContractModel):
    """One operating value of the process and where it came from."""

    path: NonEmptyText = Field(description="Where it is in the process, e.g. stations[1].worker_s.")
    label: NonEmptyText
    value: float | None = Field(description="The number in ``unit``; null for a place (detail).")
    unit: NonEmptyText
    detail: NonEmptyText | None
    basis: ProcessBasis


class EvidenceRun(ContractModel):
    """One run of the process on one layout, as the engine produced it."""

    layout: Literal["original", "edited"]
    engine: NonEmptyText
    seed: int = Field(ge=0)
    scene_revision: int = Field(ge=0)
    layout_fingerprint: Fingerprint
    process_fingerprint: Fingerprint
    outcome: RunOutcome
    reasons: list[NonEmptyText]
    event_fingerprint: Fingerprint | None
    event_count: int = Field(ge=0)
    completed: int | None = Field(ge=0)
    created: int | None = Field(ge=0)
    unfinished: int | None = Field(ge=0)
    events_file: BundlePath | None
    metrics_file: BundlePath | None


class EvidenceExcluded(ContractModel):
    what: NonEmptyText
    reason: NonEmptyText


class EvidenceProject(ContractModel):
    file: BundlePath | None = Field(description="Null in a summary-only bundle.")
    id: NonEmptyText
    name: NonEmptyText
    synthetic: bool = Field(description="A labelled synthetic or demonstration project.")
    note: NonEmptyText | None


class EvidenceProcess(ContractModel):
    name: NonEmptyText
    fingerprint: Fingerprint
    seed: int = Field(ge=0)
    example_note: NonEmptyText | None


class EvidenceComparison(ContractModel):
    identical: bool
    explanation: list[NonEmptyText]


class EvidenceManifest(ContractModel):
    format: Literal["rws-evidence/1"]
    created_utc: NonEmptyText
    schema_version: BundleSchemaVersion
    engine: NonEmptyText
    project: EvidenceProject
    process: EvidenceProcess
    runs: list[EvidenceRun] = Field(min_length=1, max_length=2)
    comparison: EvidenceComparison | None
    inputs: list[EvidenceInput]
    layout_evidence: list[NonEmptyText] = Field(
        description="What the drawing and its review established (design geometry), in words."
    )
    claims: list[NonEmptyText] = Field(description="What the results do and do not show.")
    conventions: list[NonEmptyText] = Field(description="Units, timestamps and event ordering.")
    replay: Literal["full", "runs_only", "summary_only"] = Field(
        description="'full': the project and every source and model file it names are included; "
        "'runs_only': the runs replay from the project file, but some of its files are not "
        "included (see 'excluded'); 'summary_only': no project file, so nothing can be rerun."
    )
    files: list[EvidenceFile] = Field(max_length=MAX_BUNDLE_FILES)
    excluded: list[EvidenceExcluded]

    @model_validator(mode="after")
    def _consistent(self) -> EvidenceManifest:
        _require_unique((f.path for f in self.files), "bundle file")
        _require_unique((r.layout for r in self.runs), "run layout")
        if (self.project.file is None) != (self.replay == "summary_only"):
            raise ValueError("a summary-only bundle, and only one, has no project file")
        if self.files:
            paths = {f.path for f in self.files}
            named = [
                self.project.file,
                *(r.events_file for r in self.runs),
                *(r.metrics_file for r in self.runs),
            ]
            missing = [p for p in named if p is not None and p not in paths]
            if missing:
                raise ValueError(f"the manifest names files it does not list: {missing}")
        return self


class EvidenceText(ContractModel):
    path: BundlePath
    role: Literal["readme", "summary", "project", "events", "metrics"]
    text: str = Field(max_length=20_000_000)


class EvidenceBundleRequest(ContractModel):
    """What the browser sends to package a bundle: the texts it made, the asset URIs to copy in
    (each checked against the project's own hash), and the manifest without its file list."""

    manifest: EvidenceManifest
    texts: list[EvidenceText] = Field(min_length=1, max_length=20)
    include: list[NonEmptyText] = Field(max_length=MAX_BUNDLE_FILES)


class EvidenceAsset(ContractModel):
    """A file the project names, and whether it can go in a bundle."""

    uri: NonEmptyText
    kind: Literal["drawing", "plan", "photo", "model"]
    label: NonEmptyText
    sha256: Sha256Hex | None
    bytes: int | None = Field(ge=0)
    status: Literal["repo_owned", "library", "missing", "changed"] = Field(
        description="'repo_owned': a synthetic fixture or catalog model in this repository, "
        "verified by hash; 'library': the person's own file in their local library; 'missing' or "
        "'changed': not available as the project recorded it."
    )


class EvidenceInventory(ContractModel):
    assets: list[EvidenceAsset]


class EvidenceBundleOpened(ContractModel):
    """A bundle checked and opened: its manifest, its project, the recorded event logs, and
    what was verified, stored or missing."""

    manifest: EvidenceManifest
    project: Project
    events: dict[str, list[dict[str, Any]]]
    verified: list[NonEmptyText]
    stored: list[NonEmptyText]
    problems: list[NonEmptyText]
