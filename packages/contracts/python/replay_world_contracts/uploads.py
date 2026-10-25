"""Attaching a model file to an existing object (0.15.0, ENR-01's GLB part).

The API inspects an uploaded binary glTF before anything renders it, stores it unchanged under
``uploaded/<sha256>.glb``, and reports what it holds. The person then chooses which way is up,
the quarter turns that make it face forward, the unit only if the file is not in metres, and how
it fits the object's recorded envelope; the API turns those choices into a catalog asset whose
visual is the same file with a recorded correction. Nothing here changes an object.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .models import (
    ContractModel,
    ModelBounds,
    NonEmptyText,
    PositiveLength,
    Sha256Hex,
    UpAxis,
)

#: Units the person may say a file was authored in (glTF's own unit is the metre).
MODEL_UNITS: dict[str, float] = {"m": 1.0, "cm": 0.01, "mm": 0.001, "in": 0.0254, "ft": 0.3048}


class UploadedModelReport(ContractModel):
    """What an uploaded .glb holds, read from its content (never its name)."""

    uri: NonEmptyText = Field(description="Where it is stored: uploaded/<sha256>.glb.")
    sha256: Sha256Hex
    bytes: int = Field(ge=1)
    filename: NonEmptyText
    # Exact bounds of the default scene's vertices through every node transform, in the file's
    # own units (glTF's unit is the metre). (No Field description beside a $ref.)
    file_bounds: ModelBounds
    triangles: int = Field(ge=1)
    vertices: int = Field(ge=1)
    nodes: int = Field(ge=1)
    meshes: int = Field(ge=1)
    materials: int = Field(ge=0)
    textures: int = Field(ge=0)
    texture_pixels: int = Field(ge=0, description="Decoded pixels of every embedded image.")
    extensions_used: list[NonEmptyText]
    notes: list[NonEmptyText] = Field(
        description="What is in the file but not shown: cameras, lights, animations, ignored "
        "extensions. Names and extras in the file are data and are not interpreted."
    )
    scale_hint: NonEmptyText | None = Field(
        description="Said when the size in metres looks implausible for equipment; the unit is "
        "never changed for the person."
    )


class UploadedAssetRequest(ContractModel):
    """The person's reviewed choices for an uploaded file."""

    sha256: Sha256Hex
    filename: NonEmptyText
    name: NonEmptyText
    up_axis: UpAxis
    turns: int = Field(ge=0, le=3)
    unit: Literal["m", "cm", "mm", "in", "ft"]
    fit: Literal["contain", "scale_to_dimensions"]
    note: NonEmptyText | None


__all__ = [
    "MODEL_UNITS",
    "PositiveLength",
    "UploadedAssetRequest",
    "UploadedModelReport",
]
