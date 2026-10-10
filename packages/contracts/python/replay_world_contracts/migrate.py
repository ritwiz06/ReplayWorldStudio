"""Upgrade an older project file to the current contract.

Usage: ``uv run python -m replay_world_contracts.migrate OLD.json [-o NEW.json]``

The upgraded document is validated before it is written. Notes describing every change go
to stderr; the JSON goes to stdout unless ``-o`` is given. The input file is never modified.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pydantic import ValidationError

from .migrations import MigrationError, upgrade_document
from .models import Project


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m replay_world_contracts.migrate")
    parser.add_argument("input", type=Path, help="project JSON file to upgrade")
    parser.add_argument("-o", "--output", type=Path, help="write here instead of stdout")
    args = parser.parse_args(argv)

    try:
        document = json.loads(args.input.read_text(encoding="utf-8"))
        if not isinstance(document, dict):
            raise MigrationError("a project document must be a JSON object")
        upgrade = upgrade_document(document)
        project = Project.model_validate(upgrade.document)
    except (OSError, json.JSONDecodeError, MigrationError, ValidationError) as exc:
        print(f"error: {args.input}: {exc}", file=sys.stderr)
        return 1

    for note in upgrade.notes or ["already at the current schema version; no changes"]:
        print(f"note: {note}", file=sys.stderr)
    text = project.model_dump_json(indent=2) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
