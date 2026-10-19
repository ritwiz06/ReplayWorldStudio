"""Send damaged copies of an evidence bundle to a running app and print what it answers (REL-01).

Each copy is made in memory from BUNDLE: one file changed by a byte, one listed file removed, a
file the manifest does not list, an unsafe entry name, a truncated ZIP, and a summary-only
manifest. The untouched bundle is opened last, with its problems (for example a drawing that is
neither in the bundle nor on that computer). Nothing is written to disk.

Usage: uv run python scripts/demo/check_bundle_errors.py BUNDLE.zip [http://127.0.0.1:8000]
"""

from __future__ import annotations

import io
import json
import sys
import urllib.error
import urllib.request
import zipfile


def entries(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def rezip(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def post(base: str, data: bytes) -> tuple[int, dict[str, object]]:
    request = urllib.request.Request(
        f"{base}/api/v1/exports/open",
        data=data,
        method="POST",
        headers={"Content-Type": "application/zip"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        return exc.code, json.load(exc)


def main() -> None:
    path = sys.argv[1]
    base = (sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8000").rstrip("/")
    original = open(path, "rb").read()  # noqa: SIM115 - read once
    files = entries(original)
    events = next(name for name in files if name.endswith("events.json"))

    changed = dict(files)
    changed[events] = changed[events].replace(b'"t": 0', b'"t": 1', 1)
    missing = {k: v for k, v in files.items() if k != "project.json"}
    extra = {**files, "notes.txt": b"added after export"}
    unsafe = {**files, "../outside.txt": b"x"}
    summary = dict(files)
    manifest = json.loads(summary["manifest.json"])
    manifest["project"]["file"] = None
    manifest["replay"] = "summary_only"
    manifest["files"] = [f for f in manifest["files"] if f["role"] != "project"]
    summary.pop("project.json")
    summary["manifest.json"] = json.dumps(manifest).encode()

    cases = [
        ("one byte changed in " + events, rezip(changed)),
        ("project.json removed", rezip(missing)),
        ("a file the manifest does not list", rezip(extra)),
        ("an entry named ../outside.txt", rezip(unsafe)),
        ("the ZIP cut in half", original[: len(original) // 2]),
        ("summary only", rezip(summary)),
    ]
    for name, data in cases:
        status, body = post(base, data)
        print(f"{name}: HTTP {status}: {body.get('detail')}")
    status, body = post(base, original)
    print(
        f"untouched bundle: HTTP {status}; stored {body.get('stored')}; "
        f"problems {body.get('problems')}"
    )


if __name__ == "__main__":
    main()
