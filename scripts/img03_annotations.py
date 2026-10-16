"""IMG-03 ground-truth annotations: a versioned format and its validator.

    uv run --project services/api python scripts/img03_annotations.py validate PATH [PATH …]

PATH is an annotation file or a folder of them (``*.annotation.json``). Every annotation
describes one photo and what was independently measured about it, in the frame of the photo's
floor rectangle (see docs/assist-evaluation/img-03/protocol.md):

* origin at the rectangle's centre, on the floor;
* +x along corner 0 → corner 1 (the rectangle's width), +z along corner 1 → corner 2 (its
  depth), y up; positions in metres;
* an object's ``yaw_deg`` turns its width axis from +x towards +z.

Two strata, never mixed in one table:

* ``real``: a photograph of a real site. Positions and sizes are measured on site with a stated
  tolerance; a value that was not measured is null, never estimated. The photo may stay on the
  computer that holds it (``local_only``) when its rights do not allow publication: then only its
  sha256 and the anonymised measurements are recorded here, and the file is looked up in
  ``$RWS_IMG03_LOCAL_DIR`` (never inside the repository).
* ``synthetic``: a render of a known-geometry scene made by this project. Every value is exact
  (tolerance 0) and the camera is known. It verifies the metrics and the pipeline; it is never
  reported as real-world accuracy.

A size inferred from the same photo, or a "typical" size, is not ground truth and is refused.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Annotated, Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

ROOT: Final = Path(__file__).resolve().parents[1]
FORMAT: Final = "rws-img03-annotation/1"
CLASSES: Final = (
    "table",
    "chair",
    "cabinet",
    "shelf",
    "sofa",
    "machine",
    "conveyor",
    "pallet",
    "box",
    "screen",
    "plant",
    "tank",
)
SCENE_TYPES: Final = ("industrial", "storage", "office", "lounge")
# How a value was known. Independent measurements only: nothing "typical", and nothing read off the
# same photo, is ground truth (the Literal refuses anything else).
Method = Literal["tape", "laser_distance", "site_drawing", "render_exact"]
MIN_COUNTED_SIDE_PX: Final = 16
"""An object whose visible outline is smaller than this on either side is not counted."""

Unit = Annotated[float, Field(ge=0.0, le=1.0)]
Metres = Annotated[float, Field(gt=0.0, le=100.0)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Box(Model):
    left: Unit
    top: Unit
    right: Unit
    bottom: Unit

    @model_validator(mode="after")
    def _ordered(self) -> Box:
        if not (self.left < self.right and self.top < self.bottom):
            raise ValueError("a box needs left < right and top < bottom")
        return self


class Point(Model):
    u: Unit
    v: Unit


class Rights(Model):
    source: str = Field(min_length=3, description="Who made or owns the photo, and where from.")
    license: str = Field(min_length=2)
    analysis_permitted: bool = Field(
        description="The owner allows it to be analysed, including by the vision model."
    )
    publishable: bool = Field(description="The photo itself may be committed and shown.")


class Image(Model):
    file: str = Field(min_length=3, description="File name; under img-03/photos/ unless local.")
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    width_px: int = Field(ge=16, le=20000)
    height_px: int = Field(ge=16, le=20000)
    stratum: Literal["real", "synthetic"]
    scene_type: Literal["industrial", "storage", "office", "lounge"]
    split: Literal["development", "held_out"]
    rights: Rights
    local_only: bool = Field(description="Kept only on the computer that holds it (not committed).")


class Camera(Model):
    """Known only for renders (or a real camera measured on site)."""

    position_m: tuple[float, float, float]
    target_m: tuple[float, float, float]
    vertical_fov_deg: float = Field(gt=1, lt=170)
    source: str = Field(min_length=3)


class Rectangle(Model):
    feature: str = Field(min_length=2)
    corners: list[Point] = Field(min_length=4, max_length=4)
    width_m: Metres
    depth_m: Metres
    tolerance_m: float = Field(ge=0.0, le=0.05)
    method: Method
    measured_by: str = Field(min_length=3, description="Who measured, with what, when (no names).")
    check_length_m: float | None = Field(
        default=None,
        gt=0,
        description="Real sites: a second measured floor distance, not used to calibrate.",
    )
    check_points: list[Point] | None = Field(default=None, min_length=2, max_length=2)


class Size(Model):
    width_m: Metres | None
    depth_m: Metres | None
    height_m: Metres | None


class GroundTruthObject(Model):
    id: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9._-]{0,63}$")]
    cls: Literal[
        "table",
        "chair",
        "cabinet",
        "shelf",
        "sofa",
        "machine",
        "conveyor",
        "pallet",
        "box",
        "screen",
        "plant",
        "tank",
    ] = Field(alias="class")
    centre_m: tuple[float, float] | None = Field(
        description="Footprint centre (x, z); null if unmeasured."
    )
    yaw_deg: float | None
    size: Size
    tolerance_m: float = Field(ge=0.0, le=0.25)
    method: Method | None = Field(description="How its position and size were measured.")
    visibility: Literal["visible", "partly_visible", "mostly_hidden", "out_of_frame"]
    visible_fraction: float | None = Field(
        ge=0.0, le=1.0, description="Share of its unoccluded outline that shows (renders only)."
    )
    visible_box: Box | None = Field(
        description="The outline of what shows, as a person would draw it."
    )
    amodal_box: Box | None = Field(description="Where the whole object projects (renders only).")
    cut_off: list[Literal["left", "right", "top", "bottom"]]
    on_floor: bool
    counted: bool
    reason: str | None = Field(description="Why it is not counted, when it is not.")
    notes: list[str]

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class Annotation(Model):
    format: Literal["rws-img03-annotation/1"]
    image: Image
    camera: Camera | None
    rectangle: Rectangle
    objects: list[GroundTruthObject] = Field(min_length=1, max_length=200)
    notes: list[str]

    @model_validator(mode="after")
    def _consistent(self) -> Annotation:
        ids = [o.id for o in self.objects]
        if len(ids) != len(set(ids)):
            raise ValueError("object ids must be unique")
        real = self.image.stratum == "real"
        if real and self.rectangle.tolerance_m <= 0:
            raise ValueError("a real rectangle states its measurement tolerance (> 0)")
        if real == (self.rectangle.method == "render_exact"):
            raise ValueError("a real rectangle is measured on site; only a render is exact")
        if (self.rectangle.check_length_m is None) != (self.rectangle.check_points is None):
            raise ValueError("a check length needs its two points, and the other way round")
        if not real and self.camera is None:
            raise ValueError("a render records its exact camera")
        if not self.image.rights.analysis_permitted:
            raise ValueError("the photo's rights must permit the planned analysis")
        if not self.image.rights.publishable and not self.image.local_only:
            raise ValueError("a photo that may not be published must be local only")
        w, h = self.image.width_px, self.image.height_px
        for o in self.objects:
            measured = o.centre_m is not None or o.size != Size(
                width_m=None, depth_m=None, height_m=None
            )
            if real and measured and (o.tolerance_m <= 0 or o.method in (None, "render_exact")):
                raise ValueError(f"{o.id}: a real measurement states its method and tolerance")
            if not real and o.method != "render_exact":
                raise ValueError(f"{o.id}: a render's values are exact (method render_exact)")
            if not real and (
                o.centre_m is None
                or o.yaw_deg is None
                or None in (o.size.width_m, o.size.depth_m, o.size.height_m)
            ):
                raise ValueError(f"{o.id}: a render knows every value")
            should = (
                o.on_floor
                and o.visibility in ("visible", "partly_visible")
                and o.visible_box is not None
                and (o.visible_box.right - o.visible_box.left) * w >= MIN_COUNTED_SIDE_PX
                and (o.visible_box.bottom - o.visible_box.top) * h >= MIN_COUNTED_SIDE_PX
            )
            if o.counted != should:
                raise ValueError(
                    f"{o.id}: counted must follow the protocol (on the floor, visible or partly "
                    f"visible, an outline at least {MIN_COUNTED_SIDE_PX} px on each side)"
                )
            if not o.counted and not o.reason:
                raise ValueError(f"{o.id}: say why it is not counted")
        return self


def image_path(annotation: Annotation, folder: Path) -> Path:
    """Where the photo is: next to the annotations, or in the local-only library."""
    if annotation.image.local_only:
        local = os.environ.get("RWS_IMG03_LOCAL_DIR")
        if not local:
            raise FileNotFoundError("local-only photo: set RWS_IMG03_LOCAL_DIR to its folder")
        path = Path(local) / annotation.image.file
        if ROOT in path.resolve().parents:
            raise ValueError("a local-only photo must not be inside the repository")
        return path
    return folder.parent / "photos" / annotation.image.file


def validate_file(path: Path, *, need_photo: bool = True) -> Annotation:
    annotation = Annotation.model_validate(json.loads(path.read_text()))
    if need_photo:
        photo = image_path(annotation, path.parent)
        digest = hashlib.sha256(photo.read_bytes()).hexdigest()
        if digest != annotation.image.sha256:
            raise ValueError(f"{photo.name}: sha256 differs from the annotation")
    return annotation


def annotation_files(paths: list[str]) -> list[Path]:
    out: list[Path] = []
    for p in map(Path, paths):
        out.extend(sorted(p.glob("*.annotation.json")) if p.is_dir() else [p])
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] != "validate":
        print(__doc__, file=sys.stderr)
        return 2
    failed = 0
    for path in annotation_files(argv[1:]):
        try:
            a = validate_file(path)
        except (ValidationError, ValueError, FileNotFoundError) as exc:
            failed += 1
            print(f"{path.name}: INVALID: {exc}", file=sys.stderr)
            continue
        counted = sum(o.counted for o in a.objects)
        print(
            f"{path.name}: ok ({a.image.stratum}, {a.image.scene_type}, {a.image.split}; "
            f"{len(a.objects)} objects, {counted} counted)"
        )
    return 1 if failed else 0


def as_json(annotation: Annotation) -> dict[str, Any]:
    data: dict[str, Any] = annotation.model_dump(mode="json", by_alias=True)
    return data


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
