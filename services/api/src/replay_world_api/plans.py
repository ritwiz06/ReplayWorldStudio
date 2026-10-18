"""Floor plans as pictures (IMP-03): a PNG, a JPEG or one page of a PDF.

The original file is stored content-addressed as ``drawings/<sha256>.<pdf|png|jpg>``. A PDF page
is rendered here (PDFium, through pypdfium2) to ``drawings/<sha256>-p<page>.png``, so the page
shown, proposed on and traced over is the same picture every time; an image is its own
picture. The reading that comes back is a drawing in pixels with no objects and no unit: the
person marks one known length to give it a scale, and objects are proposed by the vision model
or traced by the person, both later. Nothing here measures anything: a PDF page's size is the
paper's, never the room's. Text in the file is content, never an instruction.
"""

from __future__ import annotations

import base64
import hashlib
import re
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final, Literal

import pypdfium2 as pdfium
from replay_world_contracts import (
    DrawingAnalysis,
    DrawingFile,
    DrawingImport,
    DrawingUnits,
    PlanPage,
    PlanPoint,
    PlanRaster,
    PlanUpload,
)
from replay_world_contracts.models import (
    DRAWING_PATH_PATTERN,
    MAX_DRAWING_BYTES,
    RASTER_PATH_PATTERN,
)

from .photos import PhotoError, inspect_photo, sanitise_filename, write_library_file

READER: Final = "rws-plan-image/1"
FOLDER: Final = "drawings"
MAX_PDF_PAGES: Final = 50
THUMBNAIL_PAGES: Final = 12
THUMBNAIL_SIDE_PX: Final = 220
RENDER_SIDE_PX: Final = 3000
MAX_RENDER_DPI: Final = 300.0
MAX_PAGE_PT: Final = 14400.0  # PDF's own limit: 200 inches
UNIT_QUESTION: Final = (
    "A plan image has no unit: mark two points whose real distance you know, and enter it."
)

PlanKind = Literal["pdf", "png", "jpeg"]
_EXTENSION: Final[dict[str, str]] = {"pdf": "pdf", "png": "png", "jpeg": "jpg"}


@dataclass(frozen=True)
class PlanError(Exception):
    """A plan was refused. ``message`` is safe to show (never file content)."""

    kind: Literal["unsupported", "corrupt", "encrypted", "too_large", "too_many_pages", "missing"]
    message: str


def identify(data: bytes) -> PlanKind:
    """What the file is, from its own bytes (never its name)."""
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8"):
        return "jpeg"
    raise PlanError(
        "unsupported",
        "This is not a PDF, PNG or JPEG file. Upload one floor-plan PDF or image, or a DXF.",
    )


def _open_pdf(data: bytes) -> pdfium.PdfDocument:
    try:
        return pdfium.PdfDocument(data)
    except pdfium.PdfiumError as exc:
        if "password" in str(exc).lower():
            raise PlanError(
                "encrypted", "This PDF is password-protected. Save an unprotected copy."
            ) from None
        raise PlanError(
            "corrupt", "This PDF cannot be read (it may be damaged or incomplete)."
        ) from None


def _png(width: int, height: int, channels: int, rows: bytes) -> bytes:
    """A plain 8-bit PNG (greyscale or RGB) from unfiltered rows; deterministic."""
    colour = {1: 0, 3: 2}[channels]

    def chunk(kind: bytes, body: bytes) -> bytes:
        crc = zlib.crc32(kind + body) & 0xFFFFFFFF
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", crc)

    header = struct.pack(">IIBBBBB", width, height, 8, colour, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(rows, 6))
        + chunk(b"IEND", b"")
    )


def _render(page: pdfium.PdfPage, scale: float) -> tuple[bytes, int, int]:
    bitmap = page.render(scale=scale, rev_byteorder=True)
    width, height, stride, channels = bitmap.width, bitmap.height, bitmap.stride, bitmap.n_channels
    buffer = bytes(bitmap.buffer)
    rows = bytearray()
    for r in range(height):
        line = buffer[r * stride : r * stride + width * channels]
        if channels == 4:  # drop alpha
            rgb = bytearray(width * 3)
            rgb[0::3], rgb[1::3], rgb[2::3] = line[0::4], line[1::4], line[2::4]
            line = bytes(rgb)
        rows += b"\x00" + line
    return _png(width, height, 3 if channels == 4 else channels, bytes(rows)), width, height


def _page_size(page: pdfium.PdfPage) -> tuple[float, float]:
    width, height = page.get_size()
    if not (0 < width <= MAX_PAGE_PT and 0 < height <= MAX_PAGE_PT):
        raise PlanError("corrupt", "A page of this PDF has an impossible size.")
    return float(width), float(height)


def _bare(filename: str, kind: PlanKind) -> str:
    bare = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    return f"plan.{_EXTENSION[kind]}" if bare in ("", ".", "..") else sanitise_filename(bare, "")


def _analysis(
    filename: str, digest: str, kind: PlanKind, size: int, raster: PlanRaster, warnings: list[str]
) -> DrawingAnalysis:
    layer = f"page {raster.page}" if raster.page is not None else "image"
    drawing = DrawingImport(
        reader=READER,
        file=DrawingFile(uri=f"{FOLDER}/{digest}.{_EXTENSION[kind]}", bytes=size),
        raster=raster,
        dxf_version=None,
        units=DrawingUnits(
            insunits=None, declared=None, measurement=None, question=UNIT_QUESTION, basis=None
        ),
        layers=[layer],
        extent_min=PlanPoint(x=0, y=0),
        extent_max=PlanPoint(x=raster.width_px, y=raster.height_px),
        lines=[],
        labels=[],
        objects=[],
        skipped=[],
        omitted=[],
        review=None,
    )
    return DrawingAnalysis(filename=filename, sha256=digest, drawing=drawing, warnings=warnings)


def _render_page(
    data: bytes, digest: str, page_number: int, filename: str, sources_dir: Path
) -> DrawingAnalysis:
    pdf = _open_pdf(data)
    count = len(pdf)
    if not 1 <= page_number <= count:
        raise PlanError("missing", f"This PDF has {count} page{'' if count == 1 else 's'}.")
    page = pdf[page_number - 1]
    width_pt, height_pt = _page_size(page)
    scale = min(RENDER_SIDE_PX / max(width_pt, height_pt), MAX_RENDER_DPI / 72)
    png, width, height = _render(page, scale)
    uri = f"{FOLDER}/{digest}-p{page_number}.png"
    write_library_file(sources_dir, uri, png, "plan")
    raster = PlanRaster(
        uri=uri,
        media_type="image/png",
        sha256=hashlib.sha256(png).hexdigest(),
        width_px=width,
        height_px=height,
        page=page_number,
        page_count=count,
        dpi=round(scale * 72, 3),
    )
    warnings = [
        f"Page {page_number} is {width_pt / 72 * 25.4:.0f} by {height_pt / 72 * 25.4:.0f} mm of "
        "paper. That is the sheet's size, not the room's: the scale comes from a length you know."
    ]
    return _analysis(filename, digest, "pdf", len(data), raster, warnings)


def store_plan(data: bytes, filename: str, sources_dir: Path) -> PlanUpload:
    """Check and store a plan. An image, or a one-page PDF, comes back read; a PDF with more
    pages comes back with its pages listed so the person chooses one."""
    if len(data) > MAX_DRAWING_BYTES:
        raise PlanError("too_large", f"The plan is larger than {MAX_DRAWING_BYTES // 1048576} MB.")
    if not data:
        raise PlanError("corrupt", "The file is empty.")
    kind = identify(data)
    digest = hashlib.sha256(data).hexdigest()
    name = _bare(filename, kind)
    if kind != "pdf":
        try:
            info = inspect_photo(data)
        except PhotoError as exc:
            raise PlanError("corrupt", exc.message.replace("photo", "image")) from None
        if info.orientation != 1:
            raise PlanError(
                "unsupported",
                "This image is stored turned (EXIF orientation); save it upright and try again.",
            )
        uri = f"{FOLDER}/{digest}.{_EXTENSION[kind]}"
        write_library_file(sources_dir, uri, data, "plan")
        raster = PlanRaster(
            uri=uri,
            media_type=info.media_type,  # type: ignore[arg-type]
            sha256=digest,
            width_px=info.width_px,
            height_px=info.height_px,
            page=None,
            page_count=None,
            dpi=None,
        )
        warnings = [
            f"The image is {info.width_px} by {info.height_px} pixels. Pixels have no size until "
            "you mark a length you know."
        ]
        analysis = _analysis(name, digest, kind, len(data), raster, warnings)
        return PlanUpload(filename=name, sha256=digest, kind=kind, pages=[], analysis=analysis)

    pdf = _open_pdf(data)
    count = len(pdf)
    if count > MAX_PDF_PAGES:
        raise PlanError(
            "too_many_pages",
            f"This PDF has {count} pages; the limit is {MAX_PDF_PAGES}. Save the floor-plan page "
            "as its own PDF.",
        )
    write_library_file(sources_dir, f"{FOLDER}/{digest}.pdf", data, "plan")
    if count == 1:
        analysis = _render_page(data, digest, 1, name, sources_dir)
        return PlanUpload(filename=name, sha256=digest, kind="pdf", pages=[], analysis=analysis)
    pages: list[PlanPage] = []
    for index in range(count):
        page = pdf[index]
        width_pt, height_pt = _page_size(page)
        thumbnail = None
        if index < THUMBNAIL_PAGES:
            png, _, _ = _render(page, THUMBNAIL_SIDE_PX / max(width_pt, height_pt))
            thumbnail = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
        pages.append(
            PlanPage(page=index + 1, width_pt=width_pt, height_pt=height_pt, thumbnail=thumbnail)
        )
    return PlanUpload(filename=name, sha256=digest, kind="pdf", pages=pages, analysis=None)


def read_pdf_page(sha256: str, page: int, filename: str, sources_dir: Path) -> DrawingAnalysis:
    """Render one page of a stored PDF (the person's choice) and read it."""
    path = library_file(sources_dir, f"{FOLDER}/{sha256}.pdf")
    if path is None:
        raise PlanError("missing", "That PDF is not in the source library; upload it again.")
    return _render_page(path.read_bytes(), sha256, page, _bare(filename, "pdf"), sources_dir)


def library_file(sources_dir: Path, uri: str) -> Path | None:
    """A stored plan file or picture, or None when it is not there or the path is unsafe."""
    if not (re.fullmatch(DRAWING_PATH_PATTERN, uri) or re.fullmatch(RASTER_PATH_PATTERN, uri)):
        return None
    library = sources_dir.resolve()
    candidate = (library / PurePosixPath(uri)).resolve()
    if not candidate.is_relative_to(library) or not candidate.is_file():
        return None
    return candidate
