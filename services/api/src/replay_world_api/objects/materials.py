"""The physically based surface for every approved material of a generated model.

Keys are exactly the contract's ``GeometryMaterial`` values. Materials that also exist in the
curated catalog (``apps/web/scripts/catalog/kit.ts``, ``PALETTE``) use the same values, so a
generated model sits beside a curated one without looking out of place. Colours are sRGB hex
as a person would pick them; the GLB writer converts them to glTF's linear space.

A material is an appearance only. It says nothing about what the real object is made of.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True)
class MaterialSpec:
    """A metallic-roughness surface.

    ``opacity`` set means the surface is drawn see-through (alpha blended) at that opacity.
    ``emissive_srgb`` set means the surface glows in that colour, scaled by
    ``emissive_intensity`` (at most 1, so no glTF extension is needed).
    """

    color_srgb: str
    metalness: float
    roughness: float
    emissive_srgb: str | None = None
    emissive_intensity: float = 1.0
    opacity: float | None = None


MATERIALS: Final[dict[str, MaterialSpec]] = {
    # Shared with the curated catalog palette (kit.ts): keep these values in step.
    "paint_light_grey": MaterialSpec("#c9cdcf", 0.1, 0.55),  # RAL 7035-like
    "paint_anthracite": MaterialSpec("#3a4045", 0.25, 0.5),  # RAL 7016-like
    "safety_yellow": MaterialSpec("#e5ad0c", 0.1, 0.45),
    "aluminium": MaterialSpec("#b9bfc5", 0.85, 0.32),
    "steel_dark": MaterialSpec("#555b62", 0.7, 0.42),
    "rubber_black": MaterialSpec("#1d1e20", 0.0, 0.88),
    "polycarbonate": MaterialSpec("#d8ebf5", 0.0, 0.06, opacity=0.2),
    "hmi_screen": MaterialSpec(
        "#0b1620", 0.0, 0.2, emissive_srgb="#3c8fe0", emissive_intensity=0.55
    ),
    "signal_green": MaterialSpec(
        "#1c8a3c", 0.0, 0.3, emissive_srgb="#28e060", emissive_intensity=0.9
    ),
    "signal_amber": MaterialSpec("#a86d0c", 0.0, 0.3),
    "signal_red": MaterialSpec("#8a1c1c", 0.0, 0.3),
    "signal_white": MaterialSpec(
        "#e8eef2", 0.0, 0.3, emissive_srgb="#ffffff", emissive_intensity=0.5
    ),
    "estop_red": MaterialSpec("#c3122a", 0.0, 0.38),
    "motor_blue": MaterialSpec("#2d5c8a", 0.35, 0.42),
    "cardboard": MaterialSpec("#b98c5e", 0.0, 0.92),
    "pallet_wood": MaterialSpec("#c49a62", 0.0, 0.9),
    "label_black": MaterialSpec("#141414", 0.0, 0.6),
    # Generated-model additions, in the same industrial register.
    "paint_white": MaterialSpec("#ecece7", 0.1, 0.5),  # RAL 9016-like
    "paint_blue": MaterialSpec("#1f5fa8", 0.15, 0.48),  # RAL 5015-like
    "paint_red": MaterialSpec("#af2b1e", 0.1, 0.48),  # RAL 3000-like
    "paint_green": MaterialSpec("#308446", 0.1, 0.5),  # RAL 6024-like
    "paint_orange": MaterialSpec("#e75b12", 0.1, 0.48),  # RAL 2004-like
    "stainless_steel": MaterialSpec("#c4c8cc", 0.9, 0.25),  # brushed
    "copper": MaterialSpec("#b87333", 0.95, 0.3),
    "plastic_black": MaterialSpec("#222426", 0.0, 0.55),
    "plastic_grey": MaterialSpec("#8a8f94", 0.0, 0.5),
    "glass_clear": MaterialSpec("#e6f2f5", 0.0, 0.03, opacity=0.25),
    "wood": MaterialSpec("#a87a4f", 0.0, 0.75),
    "concrete": MaterialSpec("#9c9a95", 0.0, 0.95),
    "fabric_grey": MaterialSpec("#6d7175", 0.0, 0.95),
}
