#!/usr/bin/env python3
"""pdf-core 테스트 픽스처를 이 폴더에 다시 만든다.

PDF 픽스처는 표준 라이브러리만 쓰고, 같은 입력이면 항상 같은 바이트를 만든다(타임스탬프 없음).
TIFF 픽스처는 압축 인코더(LZW, Deflate, JPEG, CCITT)가 필요해 Pillow(libtiff 포함)와
libtiff의 `tiffcp`로 만든다. 같은 Pillow·libtiff 버전이면 같은 바이트가 나온다.

    python3 crates/pdf-core/tests/fixtures/generate_fixtures.py
"""

import hashlib
import struct
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent

LETTER = (612, 792)
A4 = (595, 842)

# 암호 픽스처의 비밀번호. Rust 테스트가 "비밀번호 필요" 에러만 확인하므로
# 값 자체는 테스트에서 쓰지 않는다.
USER_PASSWORD = b"secret"
OWNER_PASSWORD = b"owner"
FILE_ID = bytes.fromhex("00112233445566778899aabbccddeeff")
# 인쇄·복사 등 모든 권한을 허용하는 /P 값 (PDF 32000-1 표 22, 하위 비트 예약값 포함)
ALL_PERMISSIONS = -4
RC4_KEY_LENGTH = 5

PASSWORD_PADDING = bytes.fromhex(
    "28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A"
)


@dataclass
class PageSpec:
    """한 페이지의 기하 정보. rotate/crop_box가 None이면 키를 쓰지 않는다."""

    media_box: tuple = (0, 0) + LETTER
    rotate: int | None = None
    crop_box: tuple | None = None


def rc4(key: bytes, data: bytes) -> bytes:
    state = list(range(256))
    j = 0
    for i in range(256):
        j = (j + state[i] + key[i % len(key)]) % 256
        state[i], state[j] = state[j], state[i]
    output = bytearray()
    i = j = 0
    for byte in data:
        i = (i + 1) % 256
        j = (j + state[i]) % 256
        state[i], state[j] = state[j], state[i]
        output.append(byte ^ state[(state[i] + state[j]) % 256])
    return bytes(output)


def pad_password(password: bytes) -> bytes:
    return (password + PASSWORD_PADDING)[:32]


@dataclass
class Encryption:
    """RC4 40비트 표준 보안 핸들러(V1, R2)."""

    file_key: bytes
    owner_entry: bytes
    user_entry: bytes

    @staticmethod
    def create() -> "Encryption":
        owner_key = hashlib.md5(pad_password(OWNER_PASSWORD)).digest()[:RC4_KEY_LENGTH]
        owner_entry = rc4(owner_key, pad_password(USER_PASSWORD))
        file_key = hashlib.md5(
            pad_password(USER_PASSWORD)
            + owner_entry
            + struct.pack("<i", ALL_PERMISSIONS)
            + FILE_ID
        ).digest()[:RC4_KEY_LENGTH]
        user_entry = rc4(file_key, PASSWORD_PADDING)
        return Encryption(file_key, owner_entry, user_entry)

    def encrypt_stream(self, object_number: int, data: bytes) -> bytes:
        object_key = hashlib.md5(
            self.file_key + struct.pack("<I", object_number)[:3] + b"\x00\x00"
        ).digest()[: RC4_KEY_LENGTH + 5]
        return rc4(object_key, data)


def format_box(box: tuple) -> bytes:
    return b"[" + b" ".join(str(value).encode() for value in box) + b"]"


def outline_objects(
    first_number: int, titles: list[str], page_numbers: list[int]
) -> dict[int, bytes]:
    """Outlines 루트(first_number)와 항목들. 항목 i는 i번째 페이지로 이동한다."""
    item_numbers = [first_number + 1 + index for index in range(len(titles))]
    objects = {
        first_number: b"<< /Type /Outlines /First %d 0 R /Last %d 0 R /Count %d >>"
        % (item_numbers[0], item_numbers[-1], len(titles))
    }
    for index, (number, title) in enumerate(zip(item_numbers, titles)):
        parts = [
            b"<< /Title (" + title.encode("latin-1") + b")",
            b" /Parent %d 0 R" % first_number,
            b" /Dest [%d 0 R /Fit]" % page_numbers[index],
        ]
        if index > 0:
            parts.append(b" /Prev %d 0 R" % item_numbers[index - 1])
        if index < len(titles) - 1:
            parts.append(b" /Next %d 0 R" % item_numbers[index + 1])
        parts.append(b" >>")
        objects[number] = b"".join(parts)
    return objects


def build_pdf(
    pages: list[PageSpec],
    title: str | None = None,
    encryption: Encryption | None = None,
    outline_titles: list[str] | None = None,
) -> bytes:
    """Catalog(1), Pages(2), Info(3, 선택), 이어서 페이지·콘텐츠 객체를 쓴다.
    북마크(선택)는 페이지 뒤에 이어 붙인다."""
    objects: dict[int, bytes] = {}
    next_number = 3
    info_number = None
    if title is not None:
        info_number = next_number
        next_number += 1
        objects[info_number] = b"<< /Title (" + title.encode("latin-1") + b") >>"

    font_number = next_number
    next_number += 1
    objects[font_number] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    page_numbers = []
    for index, spec in enumerate(pages):
        page_number, content_number = next_number, next_number + 1
        next_number += 2
        page_numbers.append(page_number)
        parts = [
            b"<< /Type /Page /Parent 2 0 R /MediaBox " + format_box(spec.media_box),
            b" /Resources << /Font << /F1 %d 0 R >> >>" % font_number,
            b" /Contents %d 0 R" % content_number,
        ]
        if spec.crop_box is not None:
            parts.append(b" /CropBox " + format_box(spec.crop_box))
        if spec.rotate is not None:
            parts.append(b" /Rotate %d" % spec.rotate)
        parts.append(b" >>")
        objects[page_number] = b"".join(parts)

        origin_x, origin_y = spec.media_box[0], spec.media_box[1]
        text = b"BT /F1 24 Tf %d %d Td (Page %d) Tj ET" % (
            origin_x + 50,
            origin_y + 100,
            index + 1,
        )
        if encryption is not None:
            text = encryption.encrypt_stream(content_number, text)
        objects[content_number] = (
            b"<< /Length %d >>\nstream\n" % len(text) + text + b"\nendstream"
        )

    kids = b" ".join(b"%d 0 R" % number for number in page_numbers)
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    if outline_titles is not None:
        outlines_number = next_number
        next_number += 1 + len(outline_titles)
        objects.update(outline_objects(outlines_number, outline_titles, page_numbers))
        objects[1] = b"<< /Type /Catalog /Pages 2 0 R /Outlines %d 0 R >>" % (
            outlines_number
        )
    objects[2] = b"<< /Type /Pages /Kids [" + kids + b"] /Count %d >>" % len(pages)

    encrypt_number = None
    if encryption is not None:
        encrypt_number = next_number
        next_number += 1
        objects[encrypt_number] = (
            b"<< /Filter /Standard /V 1 /R 2 /P %d /O <%s> /U <%s> >>"
            % (
                ALL_PERMISSIONS,
                encryption.owner_entry.hex().encode(),
                encryption.user_entry.hex().encode(),
            )
        )

    output = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for number in sorted(objects):
        offsets[number] = len(output)
        output += b"%d 0 obj\n" % number + objects[number] + b"\nendobj\n"

    xref_offset = len(output)
    output += b"xref\n0 %d\n" % next_number
    output += b"0000000000 65535 f \n"
    for number in range(1, next_number):
        output += b"%010d 00000 n \n" % offsets[number]

    trailer = b"<< /Size %d /Root 1 0 R" % next_number
    if info_number is not None:
        trailer += b" /Info %d 0 R" % info_number
    if encrypt_number is not None:
        trailer += b" /Encrypt %d 0 R /ID [<%s> <%s>]" % (
            encrypt_number,
            FILE_ID.hex().encode(),
            FILE_ID.hex().encode(),
        )
    trailer += b" >>"
    output += b"trailer\n" + trailer + b"\nstartxref\n%d\n%%%%EOF\n" % xref_offset
    return bytes(output)


def plain_pages(count: int, size: tuple = LETTER) -> list[PageSpec]:
    return [PageSpec(media_box=(0, 0) + size) for _ in range(count)]


def fixtures() -> dict[str, bytes]:
    mixed_geometry = [
        PageSpec(),
        PageSpec(rotate=90),
        PageSpec(media_box=(0, 0) + A4, rotate=270),
        PageSpec(crop_box=(50, 50, 350, 450)),
        PageSpec(media_box=(100, 100, 400, 500)),
    ]
    return {
        "one-page.pdf": build_pdf(plain_pages(1)),
        "three-pages.pdf": build_pdf(plain_pages(3, A4)),
        "thirty-pages.pdf": build_pdf(plain_pages(30)),
        "titled.pdf": build_pdf(plain_pages(5), title="My Document Title"),
        "empty-title.pdf": build_pdf(plain_pages(1), title=""),
        "mixed-geometry.pdf": build_pdf(mixed_geometry),
        "password-protected.pdf": build_pdf(
            plain_pages(1), encryption=Encryption.create()
        ),
        "not-a-pdf.pdf": b"This file has a .pdf extension but is not a PDF.\n",
        "bookmarked.pdf": build_pdf(
            plain_pages(3), outline_titles=["Chapter 1", "Chapter 2", "Chapter 3"]
        ),
    }


# TIFF 태그 번호와 값 (TIFF 6.0)
TAG_IMAGE_WIDTH = 256
TAG_IMAGE_LENGTH = 257
TAG_BITS_PER_SAMPLE = 258
TAG_COMPRESSION = 259
TAG_PHOTOMETRIC = 262
TAG_FILL_ORDER = 266
TAG_STRIP_OFFSETS = 273
TAG_ROWS_PER_STRIP = 278
TAG_STRIP_BYTE_COUNTS = 279
TAG_T4_OPTIONS = 292
TYPE_SHORT = 3
TYPE_LONG = 4
COMPRESSION_NONE = 1
# JPEG 2000. `tiff` 크레이트가 풀지 못하는 압축의 예
COMPRESSION_JPEG_2000 = 34712
PHOTOMETRIC_WHITE_IS_ZERO = 0
PHOTOMETRIC_BLACK_IS_ZERO = 1
FILL_ORDER_LSB_TO_MSB = 2
T4_OPTION_2D = 1

RED = (255, 0, 0)
MID_GRAY = 128
# 1비트 스캔: 64x48 흰 바탕에 왼쪽 위 사분면만 검정. 상하·좌우 뒤집힘과 색 반전이 모두 드러난다.
SCAN_SIZE = (64, 48)
SCAN_BLACK_BOX = (0, 0, 31, 23)
# 한 행이 8바이트이므로 스트립 하나가 8행이 되어 스트립 6개로 나뉜다.
SCAN_STRIP_BYTES = 64
# 픽셀 수 상한을 넘는 크기. 실제 픽셀 데이터는 넣지 않는다.
OVERSIZED_SIDE = 20000


def build_minimal_tiff(
    width: int, height: int, bits: int, compression: int, strip: bytes
) -> bytes:
    """리틀엔디언 baseline TIFF 한 페이지(BlackIsZero 그레이, 스트립 하나)."""
    entry_count = 8
    ifd_offset = 8
    strip_offset = ifd_offset + 2 + entry_count * 12 + 4
    entries = [
        (TAG_IMAGE_WIDTH, TYPE_LONG, width),
        (TAG_IMAGE_LENGTH, TYPE_LONG, height),
        (TAG_BITS_PER_SAMPLE, TYPE_SHORT, bits),
        (TAG_COMPRESSION, TYPE_SHORT, compression),
        (TAG_PHOTOMETRIC, TYPE_SHORT, PHOTOMETRIC_BLACK_IS_ZERO),
        (TAG_STRIP_OFFSETS, TYPE_LONG, strip_offset),
        (TAG_ROWS_PER_STRIP, TYPE_LONG, height),
        (TAG_STRIP_BYTE_COUNTS, TYPE_LONG, len(strip)),
    ]
    output = bytearray(b"II" + struct.pack("<HI", 42, ifd_offset))
    output += struct.pack("<H", entry_count)
    for tag, value_type, value in entries:
        # 값 칸은 4바이트다. SHORT는 앞 2바이트에 쓰고 나머지를 0으로 채운다.
        if value_type == TYPE_SHORT:
            packed = struct.pack("<HH", value, 0)
        else:
            packed = struct.pack("<I", value)
        output += struct.pack("<HHI", tag, value_type, 1) + packed
    output += struct.pack("<I", 0)
    return bytes(output) + strip


def set_short_tag(data: bytes, tag: int, value: int) -> bytes:
    """리틀엔디언 TIFF 첫 IFD에 있는 SHORT 태그 하나의 값을 바꾼다. 픽셀 데이터는 그대로다."""
    output = bytearray(data)
    (ifd_offset,) = struct.unpack_from("<I", output, 4)
    (entry_count,) = struct.unpack_from("<H", output, ifd_offset)
    for index in range(entry_count):
        entry = ifd_offset + 2 + index * 12
        entry_tag, value_type, value_count = struct.unpack_from("<HHI", output, entry)
        if entry_tag == tag and value_type == TYPE_SHORT and value_count == 1:
            struct.pack_into("<HH", output, entry + 8, value, 0)
            return bytes(output)
    raise ValueError(f"SHORT tag {tag} not found")


def tiff_fixtures() -> dict[str, bytes]:
    from PIL import Image, ImageDraw

    with tempfile.TemporaryDirectory() as work_dir:
        work = Path(work_dir)
        Image.new("RGB", (60, 30), RED).save(
            work / "rgb.tif", compression="tiff_lzw", dpi=(72, 72)
        )
        Image.new("L", (60, 30), MID_GRAY).save(
            work / "gray.tif", compression="tiff_deflate", dpi=(144, 144)
        )
        # Pillow는 YCbCr JPEG를 쓰지 못한다. tiffcp는 RGB를 JPEG로 바꿀 때 YCbCr로 저장한다.
        # 해상도 단위는 cm(3)다.
        Image.new("RGB", (40, 80), RED).save(
            work / "rgb-for-jpeg.tif",
            resolution_unit=3,
            x_resolution=20,
            y_resolution=20,
        )
        # JPEG 스트립은 16행의 배수여야 한다(YCbCr 2x2 서브샘플링의 MCU 높이).
        subprocess.run(
            [
                "tiffcp",
                "-c",
                "jpeg",
                "-r",
                "16",
                work / "rgb-for-jpeg.tif",
                work / "ycbcr.tif",
            ],
            check=True,
        )
        # 페이지마다 압축을 유지한 채 이어 붙인다.
        subprocess.run(
            [
                "tiffcp",
                work / "rgb.tif",
                work / "gray.tif",
                work / "ycbcr.tif",
                work / "multipage.tif",
            ],
            check=True,
        )

        scan = Image.new("1", SCAN_SIZE, 1)
        ImageDraw.Draw(scan).rectangle(SCAN_BLACK_BOX, fill=0)
        scan.save(
            work / "g4.tif", compression="group4", strip_size=SCAN_STRIP_BYTES
        )
        # 팩스에 흔한 WhiteIsZero. Pillow는 1비트 WhiteIsZero를 잘못 저장하므로(전부 검정),
        # 반전한 그림을 BlackIsZero로 저장한 뒤 Photometric 태그만 바꿔 같은 그림을 만든다.
        negative = Image.new("1", SCAN_SIZE, 0)
        ImageDraw.Draw(negative).rectangle(SCAN_BLACK_BOX, fill=1)
        negative.save(
            work / "g4-lsb-negative.tif",
            compression="group4",
            strip_size=SCAN_STRIP_BYTES,
            tiffinfo={TAG_FILL_ORDER: FILL_ORDER_LSB_TO_MSB},
        )
        white_is_zero = set_short_tag(
            (work / "g4-lsb-negative.tif").read_bytes(),
            TAG_PHOTOMETRIC,
            PHOTOMETRIC_WHITE_IS_ZERO,
        )
        scan.save(
            work / "g3.tif",
            compression="group3",
            strip_size=SCAN_STRIP_BYTES,
            tiffinfo={TAG_T4_OPTIONS: T4_OPTION_2D},
        )

        return {
            "multipage.tif": (work / "multipage.tif").read_bytes(),
            "ccitt-g4.tif": (work / "g4.tif").read_bytes(),
            "ccitt-g4-lsb-first.tif": white_is_zero,
            "ccitt-g3-2d.tif": (work / "g3.tif").read_bytes(),
            "unsupported-compression.tif": build_minimal_tiff(
                8, 8, 8, COMPRESSION_JPEG_2000, bytes(64)
            ),
            "oversized-image.tif": build_minimal_tiff(
                OVERSIZED_SIDE, OVERSIZED_SIDE, 1, COMPRESSION_NONE, bytes(16)
            ),
        }


def main() -> None:
    for name, data in (fixtures() | tiff_fixtures()).items():
        (OUTPUT_DIR / name).write_bytes(data)
        print(f"{name}: {len(data)} bytes")


if __name__ == "__main__":
    main()
