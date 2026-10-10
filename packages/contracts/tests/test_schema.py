"""The exported JSON Schema bundle is the contract TypeScript is generated from."""

from __future__ import annotations

from typing import Any

from replay_world_contracts.schema import ROOT_MODELS, build_schema_bundle


def test_validation_and_serialization_schemas_are_identical() -> None:
    # Every field is required (no defaults), so what the API accepts is what it emits.
    assert build_schema_bundle("validation") == build_schema_bundle("serialization")


def test_bundle_exposes_every_root_model() -> None:
    bundle = build_schema_bundle()
    for model in ROOT_MODELS:
        assert bundle["properties"][model.__name__] == {"$ref": f"#/$defs/{model.__name__}"}
        assert model.__name__ in bundle["$defs"]


def test_parameter_is_a_closed_known_or_unknown_union() -> None:
    defs = build_schema_bundle()["$defs"]
    items = defs["SceneObject"]["properties"]["parameters"]["items"]
    assert {ref["$ref"] for ref in items["oneOf"]} == {
        "#/$defs/KnownParameter",
        "#/$defs/UnknownParameter",
    }
    assert defs["UnknownParameter"]["additionalProperties"] is False
    assert "value" not in defs["UnknownParameter"]["properties"]


def test_refs_have_no_sibling_keywords() -> None:
    # A description beside a $ref makes the TypeScript generator duplicate the interface.
    def walk(node: Any) -> list[dict[str, Any]]:
        if isinstance(node, dict):
            found = [node] if "$ref" in node and len(node) > 1 else []
            return found + [bad for value in node.values() for bad in walk(value)]
        if isinstance(node, list):
            return [bad for item in node for bad in walk(item)]
        return []

    assert walk(build_schema_bundle()) == []
