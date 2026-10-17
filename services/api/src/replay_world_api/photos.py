"""Inspect, store and verify source photos in the local source library.

A photo is accepted only when its own bytes say it is a still JPEG, PNG or WebP image whose
header is complete and consistent; the filename and the declared content type are never
trusted. Its displayed size (after EXIF orientation) is read from the header alone, without
decoding pixels, so a hostile file costs no more than a header walk.

Accepted photos are stored content-addressed as ``<sources_dir>/photos/<sha256>.<ext>``: the
write is atomic, storing the same bytes again changes nothing, a different file already at
that path is never replaced, and nothing is written outside the library. When a project is
opened, every photo source is checked against its recorded sha256; nothing else is ever
served in place of a missing or altered file.

Error messages are safe to show: they never contain image bytes or metadata values (GPS
positions, camera serials, comments), only the format, sizes and limits.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import re
import struct
import tempfile
import unicodedata
import zlib
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Final, Literal

from replay_world_contracts import Project, SourceImage, StoredPhoto
from replay_world_contracts.models import PHOTO_EXTENSION, PHOTO_PATH_PATTERN, PhotoMediaType

MAX_PHOTO_BYTES: Final = 15 * 1024 * 1024
MAX_PHOTO_PIXELS: Final = 50_000_000
MIN_PHOTO_SIDE_PX: Final = 64
MAX_PHOTO_SIDE_PX: Final = 20000
MAX_FILENAME_CHARS: Final = 200

PHOTO_FOLDER: Final = "photos"
SUPPORTED_FORMATS: Final = "Supported formats: JPEG, PNG and WebP."

_PATH: Final = re.compile(PHOTO_PATH_PATTERN)

PhotoErrorKind = Literal[
    "unsupported",
    "corrupt",
    "too_large",
    "too_many_pixels",
    "too_small",
    "animated",
    "hash_mismatch",
    "unsafe",
    "missing",
]


@dataclass(frozen=True)
class PhotoError(Exception):
    """A photo was refused. ``message`` is safe to show to the user."""

    kind: PhotoErrorKind
    message: str


@dataclass(frozen=True)
class PhotoInfo:
    """What a photo's header says. ``width_px``/``height_px`` are as displayed (EXIF
    orientation applied); ``raw_*`` are as stored in the image data."""

    media_type: PhotoMediaType
    width_px: int
    height_px: int
    orientation: int
    raw_width_px: int
    raw_height_px: int


# --- Inspection ------------------------------------------------------------------------------


def inspect_photo(data: bytes) -> PhotoInfo:
    """Identify ``data`` by its magic bytes and read its size, or raise :class:`PhotoError`."""
    if len(data) > MAX_PHOTO_BYTES:
        raise PhotoError(
            "too_large",
            f"The photo is {_megabytes(len(data))}; the limit is "
            f"{_megabytes(MAX_PHOTO_BYTES)}. Export a smaller copy and try again.",
        )
    if not data:
        raise PhotoError("corrupt", "The photo file is empty.")
    media_type: PhotoMediaType
    if data.startswith(_PNG_SIGNATURE):
        media_type = "image/png"
        width, height, orientation = _inspect_png(data)
    elif data.startswith(b"\xff\xd8"):
        media_type = "image/jpeg"
        width, height, orientation = _inspect_jpeg(data)
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        media_type = "image/webp"
        width, height, orientation = _inspect_webp(data)
    else:
        raise PhotoError("unsupported", f"{_describe_unsupported(data)} {SUPPORTED_FORMATS}")

    # Orientations 5-8 rotate the stored image by a quarter turn, swapping its sides.
    shown_w, shown_h = (height, width) if orientation >= 5 else (width, height)
    if min(shown_w, shown_h) < MIN_PHOTO_SIDE_PX:
        raise PhotoError(
            "too_small",
            f"The photo is {shown_w} x {shown_h} pixels; each side needs at least "
            f"{MIN_PHOTO_SIDE_PX} pixels.",
        )
    if shown_w * shown_h > MAX_PHOTO_PIXELS:
        raise PhotoError(
            "too_many_pixels",
            f"The photo is {shown_w} x {shown_h} pixels ({shown_w * shown_h:,} in all); the "
            f"limit is {MAX_PHOTO_PIXELS:,}. Export a smaller copy and try again.",
        )
    if max(shown_w, shown_h) > MAX_PHOTO_SIDE_PX:
        raise PhotoError(
            "too_large",
            f"The photo is {shown_w} x {shown_h} pixels; each side may be at most "
            f"{MAX_PHOTO_SIDE_PX} pixels. Export a smaller copy and try again.",
        )
    return PhotoInfo(
        media_type=media_type,
        width_px=shown_w,
        height_px=shown_h,
        orientation=orientation,
        raw_width_px=width,
        raw_height_px=height,
    )


def _megabytes(size: int) -> str:
    return f"{size / (1024 * 1024):.1f} MB"


def _corrupt(fmt: str, detail: str) -> PhotoError:
    return PhotoError("corrupt", f"The {fmt} file is damaged or incomplete: {detail}.")


def _describe_unsupported(data: bytes) -> str:
    """Name a few common formats people try, so the refusal says what was recognised."""
    head = data[:64].lstrip()
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "GIF images are not supported."
    if head.startswith(b"BM"):
        return "BMP images are not supported."
    if head.startswith((b"II*\x00", b"MM\x00*")):
        return "TIFF images are not supported."
    if data[4:8] == b"ftyp":
        return "HEIC, HEIF and AVIF images are not supported."
    if head.startswith(b"%PDF"):
        return "PDF documents are not supported as photos."
    if head.startswith((b"<?xml", b"<svg")):
        return "SVG and other vector or XML files are not supported."
    return "This file is not a supported image."


# PNG -----------------------------------------------------------------------------------------

_PNG_SIGNATURE: Final = b"\x89PNG\r\n\x1a\n"
_PNG_COLOUR_DEPTHS: Final[dict[int, tuple[int, ...]]] = {
    0: (1, 2, 4, 8, 16),
    2: (8, 16),
    3: (1, 2, 4, 8),
    4: (8, 16),
    6: (8, 16),
}


def _inspect_png(data: bytes) -> tuple[int, int, int]:
    pos = len(_PNG_SIGNATURE)
    width = height = 0
    orientation = 1
    first = True
    while True:
        if pos + 8 > len(data):
            raise _corrupt("PNG", "it ends before the image data")
        length, ctype = struct.unpack_from(">I4s", data, pos)
        body_end = pos + 8 + length
        if body_end + 4 > len(data):
            raise _corrupt("PNG", "a chunk runs past the end of the file")
        body = data[pos + 8 : body_end]
        (crc,) = struct.unpack_from(">I", data, body_end)
        if _crc32(ctype, body) != crc:
            raise _corrupt("PNG", "a chunk checksum does not match")
        if first:
            if ctype != b"IHDR" or length != 13:
                raise _corrupt("PNG", "the header chunk is missing")
            width, height, depth, colour = struct.unpack_from(">IIBB", body)
            if width == 0 or height == 0 or depth not in _PNG_COLOUR_DEPTHS.get(colour, ()):
                raise _corrupt("PNG", "the header describes an impossible image")
            first = False
        elif ctype == b"acTL":
            # An animation control chunk before the first image data marks an APNG.
            raise PhotoError("animated", "Animated PNG images are not supported; use a still.")
        elif ctype == b"eXIf":
            orientation = _exif_orientation(body)
        elif ctype in (b"IDAT", b"IEND"):
            if ctype == b"IEND":
                raise _corrupt("PNG", "it has no image data")
            return width, height, orientation
        pos = body_end + 4


def _crc32(ctype: bytes, body: bytes) -> int:
    return zlib.crc32(body, zlib.crc32(ctype)) & 0xFFFFFFFF


# JPEG ----------------------------------------------------------------------------------------

# Start-of-frame markers carry the frame size. 0xC4 (DHT), 0xC8 (JPG) and 0xCC (DAC) share
# the 0xCn range but are not frames.
_JPEG_SOF: Final = frozenset({*range(0xC0, 0xD0)} - {0xC4, 0xC8, 0xCC})
_JPEG_STANDALONE: Final = frozenset({0x01, *range(0xD0, 0xD8)})
_JPEG_SOS: Final = 0xDA
_JPEG_EOI: Final = 0xD9
_JPEG_APP1: Final = 0xE1
_EXIF_HEADER: Final = b"Exif\x00\x00"


def _inspect_jpeg(data: bytes) -> tuple[int, int, int]:
    pos = 2
    size: tuple[int, int] | None = None
    orientation: int | None = None
    # Walk the header segments up to the scan data. The frame size comes from the first SOFn;
    # the walk continues to the scan so an Exif block written after the frame still counts.
    while True:
        if pos >= len(data):
            if size is None:
                raise _corrupt("JPEG", "it ends before the frame header")
            raise _corrupt("JPEG", "it ends before the image data")
        if data[pos] != 0xFF:
            raise _corrupt("JPEG", "a segment marker is missing")
        while pos < len(data) and data[pos] == 0xFF:  # fill bytes may pad a marker
            pos += 1
        if pos >= len(data):
            raise _corrupt("JPEG", "it ends inside a marker")
        marker = data[pos]
        pos += 1
        if marker in _JPEG_STANDALONE:
            continue
        if marker in (_JPEG_SOS, _JPEG_EOI):
            if size is None:
                raise _corrupt("JPEG", "the image data starts before the frame header")
            return size[0], size[1], orientation or 1
        if marker == 0x00 or marker == 0xD8:
            raise _corrupt("JPEG", "a segment marker is invalid")
        if pos + 2 > len(data):
            raise _corrupt("JPEG", "a segment header is cut off")
        (length,) = struct.unpack_from(">H", data, pos)
        if length < 2 or pos + length > len(data):
            raise _corrupt("JPEG", "a segment runs past the end of the file")
        segment = data[pos + 2 : pos + length]
        if marker in _JPEG_SOF and size is None:
            if len(segment) < 6:
                raise _corrupt("JPEG", "the frame header is cut off")
            height, width = struct.unpack_from(">HH", segment, 1)
            if width == 0 or height == 0:
                raise _corrupt("JPEG", "the frame header gives no image size")
            size = (width, height)
        elif marker == _JPEG_APP1 and orientation is None and segment.startswith(_EXIF_HEADER):
            orientation = _exif_orientation(segment[len(_EXIF_HEADER) :])
        pos += length


# WebP ----------------------------------------------------------------------------------------

_VP8X_ANIMATION: Final = 0x02
_VP8_START_CODE: Final = b"\x9d\x01\x2a"
_VP8L_SIGNATURE: Final = 0x2F


def _inspect_webp(data: bytes) -> tuple[int, int, int]:
    if len(data) < 12:
        raise _corrupt("WebP", "the file header is cut off")
    (riff_size,) = struct.unpack_from("<I", data, 4)
    end = 8 + riff_size
    if riff_size < 4 or end > len(data):
        raise _corrupt("WebP", "the file is shorter than its header says")
    chunks = _riff_chunks(data, 12, end)
    if not chunks:
        raise _corrupt("WebP", "it holds no image")
    first_type, first_body = chunks[0]
    if first_type in (b"VP8 ", b"VP8L"):
        width, height = _webp_bitstream_size(first_type, first_body)
        return width, height, 1  # only the extended format can carry Exif
    if first_type != b"VP8X":
        raise _corrupt("WebP", "the first chunk is not an image")
    if len(first_body) < 10:
        raise _corrupt("WebP", "the extended header is cut off")
    flags = first_body[0]
    width = int.from_bytes(first_body[4:7], "little") + 1
    height = int.from_bytes(first_body[7:10], "little") + 1
    kinds = {ctype for ctype, _ in chunks}
    if flags & _VP8X_ANIMATION or kinds & {b"ANIM", b"ANMF"}:
        raise PhotoError("animated", "Animated WebP images are not supported; use a still.")
    images = [(t, b) for t, b in chunks if t in (b"VP8 ", b"VP8L")]
    if len(images) != 1:
        raise _corrupt("WebP", "it does not hold exactly one image")
    if _webp_bitstream_size(*images[0]) != (width, height):
        raise _corrupt("WebP", "the canvas and image sizes disagree")
    exif = next((body for ctype, body in chunks if ctype == b"EXIF"), None)
    orientation = 1 if exif is None else _exif_orientation(exif.removeprefix(_EXIF_HEADER))
    return width, height, orientation


def _riff_chunks(data: bytes, pos: int, end: int) -> list[tuple[bytes, bytes]]:
    chunks: list[tuple[bytes, bytes]] = []
    while pos < end:
        if pos + 8 > end:
            raise _corrupt("WebP", "a chunk header is cut off")
        ctype = data[pos : pos + 4]
        (size,) = struct.unpack_from("<I", data, pos + 4)
        body_end = pos + 8 + size
        if body_end > end:
            raise _corrupt("WebP", "a chunk runs past the end of the file")
        chunks.append((ctype, data[pos + 8 : body_end]))
        pos = body_end + (size & 1)  # chunks are padded to an even length
    return chunks


def _webp_bitstream_size(ctype: bytes, body: bytes) -> tuple[int, int]:
    if ctype == b"VP8 ":
        if len(body) < 10:
            raise _corrupt("WebP", "the lossy image header is cut off")
        # Bit 0 of the frame tag is 0 for a key frame, which is where the size is stored.
        if body[0] & 1 or body[3:6] != _VP8_START_CODE:
            raise _corrupt("WebP", "the lossy image header is invalid")
        width, height = struct.unpack_from("<HH", body, 6)
        width &= 0x3FFF  # the top two bits are a scaling hint, not size
        height &= 0x3FFF
        if width == 0 or height == 0:
            raise _corrupt("WebP", "the lossy image header gives no image size")
        return width, height
    if len(body) < 5 or body[0] != _VP8L_SIGNATURE:
        raise _corrupt("WebP", "the lossless image header is invalid")
    (bits,) = struct.unpack_from("<I", body, 1)
    if bits >> 29:  # the 3-bit version must be 0
        raise _corrupt("WebP", "the lossless image header has an unknown version")
    return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1


# Exif ----------------------------------------------------------------------------------------

_ORIENTATION_TAG: Final = 0x0112


def _exif_orientation(tiff: bytes) -> int:
    """Read the IFD0 orientation from a TIFF-structured Exif block.

    Exif is optional and often malformed in the wild; anything missing or odd means the image
    is shown as stored (orientation 1) rather than refused.
    """
    if tiff[:4] == b"II*\x00":
        order = "<"
    elif tiff[:4] == b"MM\x00*":
        order = ">"
    else:
        return 1
    try:
        (ifd,) = struct.unpack_from(order + "I", tiff, 4)
        (count,) = struct.unpack_from(order + "H", tiff, ifd)
        for entry in range(count):
            at = ifd + 2 + 12 * entry
            tag, kind, n = struct.unpack_from(order + "HHI", tiff, at)
            if tag != _ORIENTATION_TAG:
                continue
            if n != 1 or kind not in (3, 4):  # SHORT, or a LONG from a lax writer
                return 1
            (value,) = struct.unpack_from(order + ("H" if kind == 3 else "I"), tiff, at + 8)
            return value if 1 <= value <= 8 else 1
    except struct.error:
        return 1
    return 1


# --- Storage ---------------------------------------------------------------------------------


def photo_uri(sha256: str, media_type: str) -> str:
    """Return the source-library path ``photos/<sha256>.<ext>`` for a photo."""
    extension = PHOTO_EXTENSION.get(media_type)
    uri = f"{PHOTO_FOLDER}/{sha256}.{extension}"
    if extension is None or not _PATH.fullmatch(uri):
        raise ValueError("a photo path needs a lowercase sha256 and a JPEG, PNG or WebP type")
    return uri


def sanitise_filename(filename: str, media_type: str) -> str:
    """The name recorded for a photo: final path component only, no control or format
    characters, at most 200 characters, never empty."""
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if not unicodedata.category(ch).startswith("C")).strip()
    if name in ("", ".", ".."):
        return f"photo.{PHOTO_EXTENSION.get(media_type, 'jpg')}"
    if len(name) > MAX_FILENAME_CHARS:
        suffix = PurePosixPath(name).suffix
        if not 1 < len(suffix) <= 10:
            suffix = ""
        name = name[: MAX_FILENAME_CHARS - len(suffix)].rstrip() + suffix
    return name


def store_photo(
    data: bytes, filename: str, sources_dir: Path, expected_sha256: str | None = None
) -> StoredPhoto:
    """Check ``data`` and store it as ``<sources_dir>/photos/<sha256>.<ext>``.

    Nothing is written when the photo is refused, when ``expected_sha256`` is given and the
    bytes do not match it, or when the photo folder resolves outside the library. Storing the
    same bytes again is a no-op; a different file already at the path is never replaced.
    """
    info = inspect_photo(data)
    digest = hashlib.sha256(data).hexdigest()
    if expected_sha256 is not None and expected_sha256 != digest:
        raise PhotoError(
            "hash_mismatch",
            "The photo does not match the sha256 it was sent with; it may have changed in "
            "transfer. Nothing was stored.",
        )
    uri = photo_uri(digest, info.media_type)
    write_library_file(sources_dir, uri, data, "photo")
    return StoredPhoto(
        filename=sanitise_filename(filename, info.media_type),
        sha256=digest,
        image=SourceImage(
            uri=uri,
            media_type=info.media_type,
            width_px=info.width_px,
            height_px=info.height_px,
            bytes=len(data),
        ),
    )


def write_library_file(sources_dir: Path, uri: str, data: bytes, noun: str) -> None:
    """Store ``data`` at ``<sources_dir>/<uri>`` (``<folder>/<name>``), content-addressed.

    The write is atomic; the same bytes again change nothing; a different file already there is
    never replaced; nothing is written outside the library, even through a symbolic link.
    """
    folder_name, name = uri.split("/")
    sources_dir.mkdir(parents=True, exist_ok=True)
    root = sources_dir.resolve()
    folder = sources_dir / folder_name
    # Check before creating anything: a symbolic link here must not lead writes elsewhere.
    if not folder.resolve().is_relative_to(root):
        raise PhotoError("unsafe", f"The {noun} folder resolves outside the source library.")
    folder.mkdir(exist_ok=True)
    real_folder = folder.resolve()
    if not real_folder.is_relative_to(root) or not real_folder.is_dir():
        raise PhotoError("unsafe", f"The {noun} folder resolves outside the source library.")
    target = real_folder / name

    if target.exists() or target.is_symlink():
        existing = target.resolve()
        if not existing.is_relative_to(root) or not existing.is_file():
            raise PhotoError("unsafe", f"'{uri}' resolves outside the source library.")
        if existing.read_bytes() != data:
            raise PhotoError(
                "hash_mismatch",
                f"A different file is already stored as '{uri}'; it was not replaced. "
                "Restore or remove the altered file in the source library.",
            )
    else:
        _write_atomically(real_folder, target, data)


def _write_atomically(folder: Path, target: Path, data: bytes) -> None:
    fd, temporary = tempfile.mkstemp(dir=folder, prefix=".", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o644)  # mkstemp creates 0600; library files are plain readable
        os.replace(temporary, target)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)
        raise


# --- Resolution and verification -------------------------------------------------------------


def resolve_source_file(sources_dir: Path, uri: str) -> Path:
    """Return the library file for ``uri`` or raise :class:`PhotoError` (unsafe or missing)."""
    if not _PATH.fullmatch(uri):
        # The rejected reference is not echoed back.
        raise PhotoError(
            "unsafe",
            "That is not a source-library photo path: use photos/<sha256>.<jpg|png|webp> with "
            "a lowercase sha256, and no '..', absolute paths, schemes or backslashes.",
        )
    library = sources_dir.resolve()
    candidate = (library / uri).resolve()
    if not candidate.is_relative_to(library):
        raise PhotoError("unsafe", f"'{uri}' resolves outside the source library.")
    if not candidate.is_file():
        raise PhotoError("missing", f"Source photo '{uri}' is not in the source library.")
    return candidate


def _file_sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def check_source_files(
    project: Project, sources_dir: Path, allow_missing: bool
) -> tuple[int, list[dict[str, Any]], list[str]]:
    """Check every photo source's file; return (files verified, validation issues, missing).

    With ``allow_missing`` an absent file is listed in ``missing`` instead of being an issue,
    so the project can open without it. An altered file is always an issue: it is never shown.
    """
    verified = 0
    issues: list[dict[str, Any]] = []
    missing: list[str] = []
    for index, source in enumerate(project.sources):
        image = source.image
        if source.kind != "photo" or image is None or source.sha256 is None:
            continue
        loc = ("body", "sources", index)
        name = source.filename or PurePosixPath(image.uri).name
        short = source.sha256[:12]
        if PurePosixPath(image.uri).stem != source.sha256:
            issues.append(
                {
                    "loc": (*loc, "image", "uri"),
                    "msg": (
                        f"Source photo '{name}' records sha256 {short}… but its stored path "
                        f"'{image.uri}' names a different file."
                    ),
                    "type": "source_hash_mismatch",
                }
            )
            continue
        try:
            path = resolve_source_file(sources_dir, image.uri)
        except PhotoError as exc:
            if exc.kind == "missing":
                if allow_missing:
                    missing.append(image.uri)
                    continue
                message = (
                    f"Source photo '{name}' (sha256 {short}…) is not in this computer's source "
                    "library. Attach the original photo to restore it, or open the project "
                    "without the photo."
                )
            else:
                message = exc.message
            issues.append(
                {"loc": (*loc, "image", "uri"), "msg": message, "type": f"source_{exc.kind}"}
            )
            continue
        if _file_sha256(path) != source.sha256:
            issues.append(
                {
                    "loc": (*loc, "sha256"),
                    "msg": (
                        f"Source photo '{name}' in the source library differs from the recorded "
                        f"file (sha256 {short}…). Attach the original photo to restore it; a "
                        "different file is never used in its place."
                    ),
                    "type": "source_hash_mismatch",
                }
            )
            continue
        verified += 1
    return verified, issues, missing
