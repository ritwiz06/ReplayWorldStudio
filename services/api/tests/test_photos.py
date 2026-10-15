"""Source photos: identified by their bytes, stored content-addressed, verified when opened."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import struct
import zlib
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError
from replay_world_api.photos import (
    MAX_PHOTO_BYTES,
    MAX_PHOTO_PIXELS,
    MAX_PHOTO_SIDE_PX,
    MIN_PHOTO_SIDE_PX,
    PhotoError,
    PhotoInfo,
    check_source_files,
    inspect_photo,
    photo_uri,
    resolve_source_file,
    store_photo,
)
from replay_world_contracts import Project, StoredPhoto

REPO = Path(__file__).resolve().parents[3]
PHOTOS = REPO / "fixtures" / "photos"
FOUNDATION = REPO / "fixtures" / "scenes" / "foundation-scene.json"

# Stand-ins for private metadata. None of them may ever reach an error message.
SECRET = "GPS 51.5007N 0.1246W serial SN-90210 comment: meet at the back door"
SECRETS = ("51.5007", "SN-90210", "back door")


# --- Synthetic image headers -----------------------------------------------------------------


def png_chunk(ctype: bytes, body: bytes) -> bytes:
    crc = zlib.crc32(body, zlib.crc32(ctype)) & 0xFFFFFFFF
    return struct.pack(">I", len(body)) + ctype + body + struct.pack(">I", crc)


def png(width: int, height: int, before_idat: bytes = b"", after_idat: bytes = b"") -> bytes:
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = png_chunk(b"IDAT", zlib.compress(b"\x00" * 16))
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + before_idat
        + idat
        + after_idat
        + png_chunk(b"IEND", b"")
    )


def tiff(order: str, orientation: int | None, text: str = SECRET) -> bytes:
    """A TIFF/Exif block whose IFD0 holds an ImageDescription and, optionally, Orientation."""
    fmt = "<" if order == "II" else ">"
    head = (b"II*\x00" if order == "II" else b"MM\x00*") + struct.pack(fmt + "I", 8)
    # ImageDescription, stored after the IFD.
    entries: list[tuple[int, int, int, int | None]] = [(0x010E, 2, len(text) + 1, None)]
    if orientation is not None:
        entries.append((0x0112, 3, 1, orientation))
    ifd_size = 2 + 12 * len(entries) + 4
    text_offset = 8 + ifd_size
    ifd = struct.pack(fmt + "H", len(entries))
    for tag, kind, count, value in entries:
        if value is None:
            ifd += struct.pack(fmt + "HHII", tag, kind, count, text_offset)
        else:
            ifd += struct.pack(fmt + "HHIHH", tag, kind, count, value, 0)
    ifd += struct.pack(fmt + "I", 0)
    return head + ifd + text.encode() + b"\x00"


def segment(marker: int, body: bytes) -> bytes:
    return bytes((0xFF, marker)) + struct.pack(">H", len(body) + 2) + body


def sof(marker: int, width: int, height: int) -> bytes:
    return segment(marker, struct.pack(">BHHB", 8, height, width, 3) + b"\x01\x22\x00" * 3)


def jpeg(
    width: int,
    height: int,
    exif: bytes | None = None,
    *,
    frame: int = 0xC0,
    before_frame: bytes = b"",
    after_frame: bytes = b"",
) -> bytes:
    app1 = b"" if exif is None else segment(0xE1, b"Exif\x00\x00" + exif)
    comment = segment(0xFE, SECRET.encode())
    return (
        b"\xff\xd8"
        + app1
        + comment
        + before_frame
        + sof(frame, width, height)
        + after_frame
        + b"\xff\xd9"
    )


def riff_chunk(ctype: bytes, body: bytes) -> bytes:
    return ctype + struct.pack("<I", len(body)) + body + (b"\x00" if len(body) % 2 else b"")


def webp(*chunks: bytes) -> bytes:
    body = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body


def vp8(
    width: int, height: int, *, key_frame: bool = True, start: bytes = b"\x9d\x01\x2a"
) -> bytes:
    tag = b"\x00\x00\x00" if key_frame else b"\x01\x00\x00"
    # The top two bits of each size are a scaling hint and must be ignored.
    sizes = struct.pack("<HH", width | 0x4000, height | 0x8000)
    return riff_chunk(b"VP8 ", tag + start + sizes + b"\x00" * 8)


def vp8l(width: int, height: int, signature: int = 0x2F) -> bytes:
    bits = (width - 1) | ((height - 1) << 14) | (1 << 28)  # alpha hint bit set
    return riff_chunk(b"VP8L", bytes((signature,)) + struct.pack("<I", bits) + b"\x00" * 3)


def vp8x(width: int, height: int, flags: int = 0) -> bytes:
    body = bytes((flags, 0, 0, 0))
    body += (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(3, "little")
    return riff_chunk(b"VP8X", body)


def refused(data: bytes) -> PhotoError:
    with pytest.raises(PhotoError) as info:
        inspect_photo(data)
    for secret in SECRETS:
        assert secret not in info.value.message
    return info.value


# --- Inspection: committed photos ------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "media_type", "size"),
    [
        ("office.jpg", "image/jpeg", (1024, 678)),
        ("classroom.jpg", "image/jpeg", (1024, 684)),
        ("living-room.webp", "image/webp", (1024, 727)),
        ("factory-walk.png", "image/png", (1328, 1000)),
    ],
)
def test_reads_the_committed_photos(name: str, media_type: str, size: tuple[int, int]) -> None:
    info = inspect_photo((PHOTOS / name).read_bytes())
    assert (info.media_type, (info.width_px, info.height_px)) == (media_type, size)
    assert info.orientation == 1


# --- Inspection: PNG -------------------------------------------------------------------------


def test_reads_a_png_header() -> None:
    text = png_chunk(b"tEXt", b"Comment\x00" + SECRET.encode())
    assert inspect_photo(png(300, 200, before_idat=text)) == PhotoInfo(
        "image/png", 300, 200, 1, 300, 200
    )


def test_png_exif_orientation_swaps_the_displayed_sides() -> None:
    info = inspect_photo(png(300, 200, before_idat=png_chunk(b"eXIf", tiff("MM", 6))))
    assert (info.width_px, info.height_px, info.orientation) == (200, 300, 6)
    assert (info.raw_width_px, info.raw_height_px) == (300, 200)


def test_refuses_an_animated_png() -> None:
    actl = png_chunk(b"acTL", struct.pack(">II", 2, 0))
    assert refused(png(300, 200, before_idat=actl)).kind == "animated"


def test_an_animation_chunk_after_the_image_data_is_not_read() -> None:
    actl = png_chunk(b"acTL", struct.pack(">II", 2, 0))
    assert inspect_photo(png(300, 200, after_idat=actl)).media_type == "image/png"


def _bad_crc(data: bytes) -> bytes:
    at = 8 + 8 + 13  # the IHDR checksum
    return data[:at] + bytes((data[at] ^ 0xFF,)) + data[at + 1 :]


@pytest.mark.parametrize(
    "data",
    [
        png(300, 200)[:20],  # cut inside the header chunk
        png(300, 200)[:33],  # ends after the header, before any image data
        _bad_crc(png(300, 200)),
        png(0, 200),
        b"\x89PNG\r\n\x1a\n" + png_chunk(b"tEXt", b"x") + png(300, 200)[8:],  # IHDR not first
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 300, 200, 8, 2, 0, 0, 0))
        + png_chunk(b"IEND", b""),  # no image data
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 300, 200, 3, 2, 0, 0, 0))  # 3-bit RGB
        + png_chunk(b"IDAT", b""),
    ],
)
def test_refuses_a_damaged_png(data: bytes) -> None:
    assert refused(data).kind == "corrupt"


# --- Inspection: JPEG ------------------------------------------------------------------------


@pytest.mark.parametrize("order", ["II", "MM"])
def test_jpeg_exif_orientation_6_swaps_the_displayed_sides(order: str) -> None:
    info = inspect_photo(jpeg(400, 300, tiff(order, 6)))
    assert info == PhotoInfo("image/jpeg", 300, 400, 6, 400, 300)


@pytest.mark.parametrize(("orientation", "size"), [(3, (400, 300)), (8, (300, 400))])
def test_jpeg_orientations_rotate_only_by_quarter_turns(
    orientation: int, size: tuple[int, int]
) -> None:
    info = inspect_photo(jpeg(400, 300, tiff("II", orientation)))
    assert ((info.width_px, info.height_px), info.orientation) == (size, orientation)


@pytest.mark.parametrize(
    "exif",
    [
        None,
        tiff("II", None),  # no orientation tag
        tiff("II", 0),
        tiff("MM", 9),
        b"XX\x00*" + tiff("II", 6)[4:],  # unknown byte order
        tiff("II", 6)[:12],  # IFD cut off
        b"II*\x00" + struct.pack("<I", 4000),  # IFD offset past the block
    ],
)
def test_missing_or_odd_exif_means_shown_as_stored(exif: bytes | None) -> None:
    info = inspect_photo(jpeg(400, 300, exif))
    assert (info.width_px, info.height_px, info.orientation) == (400, 300, 1)


def test_jpeg_size_comes_from_the_frame_not_from_lookalike_segments() -> None:
    # DHT (0xC4), JPG (0xC8) and DAC (0xCC) sit in the SOF range but are not frames.
    fakes = b"".join(
        segment(m, struct.pack(">BHHB", 8, 9, 9, 3) + b"\x00" * 9) for m in (0xC4, 0xC8, 0xCC)
    )
    info = inspect_photo(jpeg(640, 480, before_frame=fakes))
    assert (info.width_px, info.height_px) == (640, 480)


@pytest.mark.parametrize("frame", [0xC1, 0xC2, 0xC3, 0xC5, 0xC7, 0xC9, 0xCB, 0xCD, 0xCF])
def test_reads_every_kind_of_jpeg_frame(frame: int) -> None:
    assert inspect_photo(jpeg(640, 480, frame=frame)).width_px == 640


def test_jpeg_uses_the_first_frame_and_an_exif_block_written_after_it() -> None:
    later = segment(0xE1, b"Exif\x00\x00" + tiff("MM", 6)) + sof(0xC0, 99, 99)
    info = inspect_photo(jpeg(640, 480, after_frame=later))
    assert (info.width_px, info.height_px, info.orientation) == (480, 640, 6)


def test_jpeg_tolerates_fill_bytes_and_standalone_markers() -> None:
    data = b"\xff\xd8\xff\xff\xff\xd0" + sof(0xC2, 640, 480) + b"\xff\xda"
    assert inspect_photo(data).height_px == 480


@pytest.mark.parametrize(
    "data",
    [
        b"\xff\xd8",
        b"\xff\xd8\xff",
        b"\xff\xd8\xff\xe0\x00",
        b"\xff\xd8" + segment(0xE0, b"JFIF\x00")[:6],  # segment cut off
        b"\xff\xd8\xff\xe0\x00\x01",  # impossible segment length
        b"\xff\xd8" + segment(0xFE, b"note") + b"\x12\x34",  # no marker where one is due
        b"\xff\xd8\xff\x00",
        b"\xff\xd8\xff\xd9",  # ends before the frame
        b"\xff\xd8\xff\xda\x00\x02",  # scan before the frame
        b"\xff\xd8" + sof(0xC0, 640, 480),  # ends before the image data
        b"\xff\xd8" + segment(0xC0, b"\x08\x01\xe0") + b"\xff\xd9",  # frame header cut off
        jpeg(640, 0),
        jpeg(0, 480),
        jpeg(640, 480, tiff("II", 6))[:60],
    ],
)
def test_refuses_a_damaged_jpeg(data: bytes) -> None:
    assert refused(data).kind == "corrupt"


# --- Inspection: WebP ------------------------------------------------------------------------


def test_reads_lossy_lossless_and_extended_webp() -> None:
    assert inspect_photo(webp(vp8(640, 480))) == PhotoInfo("image/webp", 640, 480, 1, 640, 480)
    assert inspect_photo(webp(vp8l(641, 481))) == PhotoInfo("image/webp", 641, 481, 1, 641, 481)
    extended = webp(vp8x(640, 480, 0x10), riff_chunk(b"ALPH", b"\x00" * 3), vp8(640, 480))
    assert inspect_photo(extended).width_px == 640


@pytest.mark.parametrize("prefix", [b"", b"Exif\x00\x00"])
def test_webp_exif_orientation(prefix: bytes) -> None:
    exif = riff_chunk(b"EXIF", prefix + tiff("II", 6))
    info = inspect_photo(webp(vp8x(640, 480, 0x08), vp8l(640, 480), exif))
    assert (info.width_px, info.height_px, info.orientation) == (480, 640, 6)


@pytest.mark.parametrize(
    "data",
    [
        webp(vp8x(640, 480, 0x02), vp8(640, 480)),
        webp(vp8x(640, 480), riff_chunk(b"ANIM", b"\x00" * 6), riff_chunk(b"ANMF", b"\x00" * 16)),
    ],
)
def test_refuses_an_animated_webp(data: bytes) -> None:
    assert refused(data).kind == "animated"


@pytest.mark.parametrize(
    "data",
    [
        b"RIFF\x04\x00\x00\x00WEBP",  # holds no chunk
        webp(vp8(640, 480))[:-4],  # shorter than the RIFF size says
        webp(vp8(640, 480, key_frame=False)),
        webp(vp8(640, 480, start=b"\x00\x00\x00")),
        webp(vp8(0, 480)),
        webp(riff_chunk(b"VP8 ", b"\x00" * 4)),
        webp(vp8l(640, 480, signature=0x2E)),
        webp(riff_chunk(b"VP8L", b"\x2f" + struct.pack("<I", 1 << 29))),  # unknown version
        webp(riff_chunk(b"ICCP", b"\x00" * 4)),  # first chunk is not an image
        webp(riff_chunk(b"VP8X", b"\x00" * 4)),
        webp(vp8x(640, 480)),  # no image
        webp(vp8x(640, 480), vp8(320, 240)),  # canvas and image disagree
        webp(vp8x(640, 480), vp8(640, 480), vp8(640, 480)),
        b"RIFF" + struct.pack("<I", 12) + b"WEBPVP8 " + struct.pack("<I", 100),  # chunk too long
        b"RIFF" + struct.pack("<I", 8) + b"WEBPVP8 ",  # chunk header cut off
    ],
)
def test_refuses_a_damaged_webp(data: bytes) -> None:
    assert refused(data).kind == "corrupt"


# --- Inspection: other formats and limits ----------------------------------------------------


@pytest.mark.parametrize(
    ("data", "named"),
    [
        (b"GIF89a" + b"\x00" * 20, "GIF"),
        (b"\x00\x00\x00\x18ftypheic" + b"\x00" * 20, "HEIC"),
        (b"BM" + b"\x00" * 30, "BMP"),
        (b"MM\x00*" + b"\x00" * 30, "TIFF"),
        (b"<svg xmlns='http://www.w3.org/2000/svg'/>", "SVG"),
        (b"%PDF-1.7\n", "PDF"),
        (b"hello, this is text", "not a supported image"),
    ],
)
def test_refuses_other_formats_naming_the_supported_ones(data: bytes, named: str) -> None:
    error = refused(data)
    assert error.kind == "unsupported"
    assert named in error.message
    assert "JPEG, PNG and WebP" in error.message


def test_a_filename_or_declared_type_cannot_make_a_photo() -> None:
    # Only the bytes count: a GIF stays a GIF whatever it is called.
    assert refused(b"GIF89a" + b"\x00" * 20).kind == "unsupported"


def test_refuses_an_empty_file() -> None:
    assert refused(b"").kind == "corrupt"


def test_refuses_too_many_bytes_before_reading_the_header() -> None:
    data = png(300, 200)
    error = refused(data + b"\x00" * (MAX_PHOTO_BYTES + 1 - len(data)))
    assert error.kind == "too_large"
    assert "15.0 MB" in error.message


def test_accepts_the_largest_allowed_file() -> None:
    data = png(300, 200)
    assert inspect_photo(data + b"\x00" * (MAX_PHOTO_BYTES - len(data))).width_px == 300


@pytest.mark.parametrize(
    ("width", "height", "kind"),
    [
        (MIN_PHOTO_SIDE_PX - 1, 200, "too_small"),
        (200, MIN_PHOTO_SIDE_PX - 1, "too_small"),
        (10_000, 5_001, "too_many_pixels"),
        (MAX_PHOTO_SIDE_PX + 1, MIN_PHOTO_SIDE_PX, "too_large"),
        (MIN_PHOTO_SIDE_PX, MAX_PHOTO_SIDE_PX + 1, "too_large"),
    ],
)
def test_enforces_the_size_limits(width: int, height: int, kind: str) -> None:
    assert refused(png(width, height)).kind == kind


@pytest.mark.parametrize(
    ("width", "height"),
    [(MIN_PHOTO_SIDE_PX, MIN_PHOTO_SIDE_PX), (MAX_PHOTO_SIDE_PX, MAX_PHOTO_PIXELS // 20_000)],
)
def test_accepts_sizes_at_the_limits(width: int, height: int) -> None:
    assert inspect_photo(png(width, height)).width_px == width


def test_messages_never_contain_metadata() -> None:
    exif = tiff("II", 6)
    text = png_chunk(b"tEXt", b"Comment\x00" + SECRET.encode())
    actl = png_chunk(b"acTL", b"\x00" * 8)
    for data in (
        jpeg(40, 300, exif),
        jpeg(640, 480, exif)[:-2],
        png(30, 30, before_idat=text),
        png(300, 200, before_idat=text + actl),
        png(300, 200, before_idat=png_chunk(b"eXIf", exif))[:-30],
        webp(vp8x(640, 480, 0x0A), vp8(640, 480), riff_chunk(b"EXIF", exif)),
        webp(vp8x(30, 30, 0x08), vp8(30, 30), riff_chunk(b"EXIF", exif)),
        SECRET.encode(),
    ):
        refused(data)  # asserts on the message


# --- Storage ---------------------------------------------------------------------------------


@pytest.fixture
def sources(tmp_path: Path) -> Path:
    return tmp_path / "sources"


def _files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if not p.is_dir()) if root.exists() else []


def test_stores_a_photo_content_addressed(sources: Path) -> None:
    data = (PHOTOS / "office.jpg").read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    stored = store_photo(data, "office.jpg", sources)
    assert stored == StoredPhoto.model_validate(
        {
            "filename": "office.jpg",
            "sha256": digest,
            "image": {
                "uri": f"photos/{digest}.jpg",
                "media_type": "image/jpeg",
                "width_px": 1024,
                "height_px": 678,
                "bytes": len(data),
            },
        }
    )
    target = sources / "photos" / f"{digest}.jpg"
    assert _files(sources) == [target]  # no temporary file left behind
    assert target.read_bytes() == data
    assert stat.S_IMODE(target.stat().st_mode) == 0o644


def test_stores_displayed_dimensions(sources: Path) -> None:
    stored = store_photo(jpeg(400, 300, tiff("MM", 6)), "turned.jpg", sources)
    assert (stored.image.width_px, stored.image.height_px) == (300, 400)


def test_storing_the_same_bytes_again_changes_nothing(sources: Path) -> None:
    data = (PHOTOS / "living-room.webp").read_bytes()
    first = store_photo(data, "living-room.webp", sources)
    target = sources / first.image.uri
    before = target.stat().st_mtime_ns
    second = store_photo(data, "renamed.webp", sources, expected_sha256=first.sha256)
    assert second.image == first.image
    assert second.filename == "renamed.webp"
    assert target.stat().st_mtime_ns == before
    assert _files(sources) == [target]


def test_an_unexpected_hash_writes_nothing(sources: Path) -> None:
    data = png(300, 200)
    with pytest.raises(PhotoError) as info:
        store_photo(data, "a.png", sources, expected_sha256="0" * 64)
    assert info.value.kind == "hash_mismatch"
    assert "0" * 12 not in info.value.message
    assert _files(sources) == []


def test_a_refused_photo_writes_nothing(sources: Path) -> None:
    with pytest.raises(PhotoError):
        store_photo(b"GIF89a" + b"\x00" * 20, "a.png", sources)
    assert _files(sources) == []


def test_never_replaces_a_different_file(sources: Path) -> None:
    data = png(300, 200)
    uri = photo_uri(hashlib.sha256(data).hexdigest(), "image/png")
    (sources / "photos").mkdir(parents=True)
    (sources / uri).write_bytes(b"altered")
    with pytest.raises(PhotoError) as info:
        store_photo(data, "a.png", sources)
    assert info.value.kind == "hash_mismatch"
    assert (sources / uri).read_bytes() == b"altered"


def test_refuses_a_photo_folder_that_escapes_the_library(sources: Path, tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    sources.mkdir()
    (sources / "photos").symlink_to(outside)
    with pytest.raises(PhotoError) as info:
        store_photo(png(300, 200), "a.png", sources)
    assert info.value.kind == "unsafe"
    assert _files(outside) == []


def test_refuses_a_dangling_photo_folder_link(sources: Path, tmp_path: Path) -> None:
    sources.mkdir()
    (sources / "photos").symlink_to(tmp_path / "not-yet")
    with pytest.raises(PhotoError) as info:
        store_photo(png(300, 200), "a.png", sources)
    assert info.value.kind == "unsafe"
    assert not (tmp_path / "not-yet").exists()


def test_refuses_a_stored_file_that_links_outside(sources: Path, tmp_path: Path) -> None:
    data = png(300, 200)
    uri = photo_uri(hashlib.sha256(data).hexdigest(), "image/png")
    (tmp_path / "elsewhere.png").write_bytes(data)
    (sources / "photos").mkdir(parents=True)
    (sources / uri).symlink_to(tmp_path / "elsewhere.png")
    with pytest.raises(PhotoError) as info:
        store_photo(data, "a.png", sources)
    assert info.value.kind == "unsafe"


@pytest.mark.parametrize(
    ("given", "recorded"),
    [
        ("office.jpg", "office.jpg"),
        ("C:\\Users\\me\\Pictures\\office.jpg", "office.jpg"),
        ("../../etc/office.jpg", "office.jpg"),
        ("off\x00ice\n\t.jpg", "office.jpg"),
        ("\u202egpj.exe", "gpj.exe"),  # a right-to-left override cannot disguise the name
        ("  bureau été.jpg  ", "bureau été.jpg"),
        ("", "photo.png"),
        ("   ", "photo.png"),
        ("photos/", "photo.png"),
        ("..", "photo.png"),
        ("\x01\x02", "photo.png"),
        ("a" * 300 + ".jpeg", "a" * 195 + ".jpeg"),
        ("b" * 300, "b" * 200),
        ("c" * 300 + ".averylongextension", "c" * 200),
    ],
)
def test_records_a_sanitised_filename(sources: Path, given: str, recorded: str) -> None:
    assert store_photo(png(300, 200), given, sources).filename == recorded


def test_photo_uri() -> None:
    assert photo_uri("a" * 64, "image/webp") == f"photos/{'a' * 64}.webp"
    for sha, media_type in (
        ("a" * 64, "image/gif"),
        ("A" * 64, "image/png"),
        ("a" * 63, "image/png"),
    ):
        with pytest.raises(ValueError):
            photo_uri(sha, media_type)


# --- Resolution ------------------------------------------------------------------------------

SHA = "3f2a1c" + "0" * 58


@pytest.fixture
def library(sources: Path, tmp_path: Path) -> Path:
    (sources / "photos").mkdir(parents=True)
    (sources / "photos" / f"{SHA}.jpg").write_bytes(b"jpeg")
    (tmp_path / "outside.jpg").write_bytes(b"secret")
    return sources


def test_resolves_a_photo_inside_the_library(library: Path) -> None:
    path = resolve_source_file(library, f"photos/{SHA}.jpg")
    assert path == (library / "photos" / f"{SHA}.jpg").resolve()


@pytest.mark.parametrize(
    "uri",
    [
        "../outside.jpg",
        f"photos/../../{SHA}.jpg",
        f"/photos/{SHA}.jpg",
        f"{SHA}.jpg",
        f"photos/{SHA.upper()}.jpg",
        f"photos/{SHA}.JPG",
        f"photos/{SHA}.gif",
        f"photos\\{SHA}.jpg",
        f"file:///photos/{SHA}.jpg",
        f"photos/{SHA}.jpg?x=1",
        f"photos/{SHA[:-1]}.jpg",
    ],
)
def test_refuses_unsafe_references(library: Path, uri: str) -> None:
    with pytest.raises(PhotoError) as info:
        resolve_source_file(library, uri)
    assert info.value.kind == "unsafe"
    assert uri not in info.value.message  # a rejected reference is not echoed


def test_refuses_a_photo_that_links_outside_the_library(library: Path, tmp_path: Path) -> None:
    other = "b" * 64
    (library / "photos" / f"{other}.jpg").symlink_to(tmp_path / "outside.jpg")
    with pytest.raises(PhotoError) as info:
        resolve_source_file(library, f"photos/{other}.jpg")
    assert info.value.kind == "unsafe"


def test_a_link_inside_the_library_is_followed(library: Path) -> None:
    other = "c" * 64
    (library / "photos" / f"{other}.jpg").symlink_to(library / "photos" / f"{SHA}.jpg")
    assert resolve_source_file(library, f"photos/{other}.jpg").read_bytes() == b"jpeg"


@pytest.mark.parametrize("make_folder", [False, True])
def test_reports_a_missing_photo(library: Path, make_folder: bool) -> None:
    uri = f"photos/{'d' * 64}.png"
    if make_folder:
        (library / uri).mkdir()  # a folder is not a photo
    with pytest.raises(PhotoError) as info:
        resolve_source_file(library, uri)
    assert info.value.kind == "missing"


# --- Checking a project's photo sources ------------------------------------------------------


def photo_source(stored: StoredPhoto, source_id: str = "src-photo-office") -> dict[str, Any]:
    def length(value: float, origin: str) -> dict[str, Any]:
        return {
            "value_m": value,
            "origin": origin,
            "source_ref": "assumed rug size for the test",
            "review_status": "unreviewed",
            "uncertainty_m": None,
        }

    corners = [{"u": u, "v": v} for u, v in ((0.3, 0.8), (0.7, 0.8), (0.65, 0.6), (0.35, 0.6))]
    return {
        "id": source_id,
        "kind": "photo",
        "filename": stored.filename,
        "sha256": stored.sha256,
        "source_to_world": None,
        "import_warnings": [],
        "image": stored.image.model_dump(),
        "photo_import": {
            "vision_model": None,
            "calibration": {
                "reference": {
                    "feature": "rug",
                    "corners": corners,
                    "width": length(2.0, "user_supplied"),
                    "depth": length(1.4, "inferred"),
                    "size_basis": "assumed",
                },
                "image_to_floor": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
                "camera": {
                    "vertical_fov_deg": 55.0,
                    "fov_basis": "assumed",
                    "position_m": {"x": 0.0, "y": 1.6, "z": 4.0},
                },
                "notes": [],
            },
            "observations": [
                {
                    "id": "obs-1",
                    "label": "chair",
                    "box": {"left": 0.1, "top": 0.2, "right": 0.3, "bottom": 0.5},
                    "floor_contact": None,
                    "contact_basis": None,
                    "found_by": "user",
                    "decision": "rejected",
                    "object_id": None,
                    "notes": [],
                }
            ],
            "visible_text": [],
        },
    }


def project_with(*sources: dict[str, Any]) -> Project:
    document = json.loads(FOUNDATION.read_text())
    document["sources"].extend(sources)
    return Project.model_validate_json(json.dumps(document))


@pytest.fixture
def office(sources: Path) -> StoredPhoto:
    return store_photo((PHOTOS / "office.jpg").read_bytes(), "office.jpg", sources)


def test_a_project_without_photos_needs_no_library(sources: Path) -> None:
    assert check_source_files(project_with(), sources, allow_missing=False) == (0, [], [])


@pytest.mark.parametrize("allow_missing", [False, True])
def test_verifies_a_stored_photo(sources: Path, office: StoredPhoto, allow_missing: bool) -> None:
    project = project_with(photo_source(office))
    assert check_source_files(project, sources, allow_missing) == (1, [], [])


def test_a_missing_photo_is_an_issue_unless_allowed(tmp_path: Path, office: StoredPhoto) -> None:
    project = project_with(photo_source(office))
    empty = tmp_path / "empty-library"
    verified, issues, missing = check_source_files(project, empty, allow_missing=False)
    assert (verified, missing) == (0, [])
    assert issues == [
        {
            "loc": ("body", "sources", 1, "image", "uri"),
            "msg": (
                f"Source photo 'office.jpg' (sha256 {office.sha256[:12]}…) is not in this "
                "computer's source library. Attach the original photo to restore it, or open "
                "the project without the photo."
            ),
            "type": "source_missing",
        }
    ]
    assert check_source_files(project, empty, allow_missing=True) == (0, [], [office.image.uri])


@pytest.mark.parametrize("allow_missing", [False, True])
def test_an_altered_photo_is_always_an_issue(
    sources: Path, office: StoredPhoto, allow_missing: bool
) -> None:
    (sources / office.image.uri).write_bytes(b"something else")
    project = project_with(photo_source(office))
    verified, issues, missing = check_source_files(project, sources, allow_missing)
    assert (verified, missing) == (0, [])
    assert [(i["loc"], i["type"]) for i in issues] == [
        (("body", "sources", 1, "sha256"), "source_hash_mismatch")
    ]
    assert "never used in its place" in issues[0]["msg"]


def test_a_photo_linking_outside_the_library_is_an_issue(
    sources: Path, office: StoredPhoto, tmp_path: Path
) -> None:
    target = sources / office.image.uri
    (tmp_path / "copy.jpg").write_bytes(target.read_bytes())
    target.unlink()
    target.symlink_to(tmp_path / "copy.jpg")
    project = project_with(photo_source(office))
    _, issues, missing = check_source_files(project, sources, allow_missing=True)
    assert missing == []
    assert [(i["loc"], i["type"]) for i in issues] == [
        (("body", "sources", 1, "image", "uri"), "source_unsafe")
    ]


def test_the_contract_refuses_a_path_naming_another_file(office: StoredPhoto) -> None:
    source = photo_source(office)
    source["sha256"] = "e" * 64
    with pytest.raises(ValidationError, match="stored file name must be its sha256"):
        project_with(source)


def test_counts_each_photo_source(sources: Path, office: StoredPhoto) -> None:
    room = store_photo((PHOTOS / "living-room.webp").read_bytes(), "room.webp", sources)
    project = project_with(photo_source(office), photo_source(room, "src-photo-room"))
    os.remove(sources / room.image.uri)
    assert check_source_files(project, sources, allow_missing=True) == (1, [], [room.image.uri])
