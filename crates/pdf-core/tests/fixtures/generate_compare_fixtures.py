#!/usr/bin/env python3
"""비교 엔진 글자 추출(Step 17) 픽스처를 이 폴더에 다시 만든다. 표준 라이브러리만 쓰고,
같은 입력이면 항상 같은 바이트를 만든다(타임스탬프 없음).

- text-geometry.pdf: Helvetica(표준 14 글꼴, 임베드하지 않는다) 글자를 상자·회전이 다른 쪽에 둔다.
  글자 좌표는 `GEOMETRY_PAGES`에 적은 절대 사용자 공간 좌표다(CropBox 원점을 빼지 않는다).
- rotation-order.pdf: 같은 세 줄을 /Rotate 0·90·180·270 쪽과, 글자를 돌려 그리고 /Rotate로
  바로 세운 쪽에 둔다. 추출한 글자 순서가 회전과 상관없이 같아야 한다.
- korean-text.pdf: IBM Plex Sans KR(SIL OFL 1.1) 중 쓰는 글자만 남긴 TrueType을 Type0 +
  CIDFontType2 + Identity-H + ToUnicode로 임베드한다. 글꼴은 앱 의존성
  `@fontsource/ibm-plex-sans-kr`의 woff에서 읽으므로 `pnpm install` 뒤에 돌린다.

    python3 crates/pdf-core/tests/fixtures/generate_compare_fixtures.py

픽스처를 바꾸면 golden도 다시 만든다(`docs/rules/testing.md`).
"""

import struct
import zlib
from dataclasses import dataclass, field
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent
REPO_ROOT = OUTPUT_DIR.parents[3]
KOREAN_FONT_PATH = (
    REPO_ROOT
    / "node_modules/@fontsource/ibm-plex-sans-kr/files"
    / "ibm-plex-sans-kr-korean-400-normal.woff"
)
# 임베드 서브셋 글꼴 이름. 앞 6글자 + `+`는 PDF 서브셋 표기(PDF 32000-1 9.6.4)다.
KOREAN_FONT_NAME = b"KOREAN+IBMPlexSansKR-Regular"

LETTER_MEDIA_BOX = (0, 0, 612, 792)
A4_MEDIA_BOX = (0, 0, 595, 842)
DEFAULT_FONT_SIZE = 18


@dataclass
class TextRun:
    """한 줄. (x, y)는 기준선 시작점의 절대 사용자 공간 좌표다.

    `size_by`가 "font"면 `Tf`로, "text_matrix"면 `Tf 1` + `Tm` 배율로, "ctm"이면 `cm` 배율로
    글꼴 크기를 정한다. 어느 쪽이든 사용자 공간에서의 글꼴 크기는 `font_size`다.
    `upward`면 글자 방향을 사용자 공간 위쪽(반시계 90도)으로 돌려 그린다(`Tf`로만 크기를 정한다).
    """

    x: float
    y: float
    text: str
    font_size: float = DEFAULT_FONT_SIZE
    size_by: str = "font"
    upward: bool = False


@dataclass
class PageSpec:
    """`media_box`가 None이면 Pages 노드의 MediaBox를 물려받는다."""

    runs: list[TextRun]
    media_box: tuple | None = LETTER_MEDIA_BOX
    crop_box: tuple | None = None
    rotate: int | None = None
    user_unit: float | None = None


# CTM 배율로 크기를 정하는 줄의 배율
CTM_SCALE = 2

GEOMETRY_PAGES = [
    # 0: 상자 상속, 글꼴 크기를 Tf·Tm·cm으로 정하는 세 줄
    PageSpec(
        media_box=None,
        runs=[
            TextRun(72, 700, "Plain page, inherited MediaBox"),
            TextRun(72, 670, "Text matrix sets the size", size_by="text_matrix"),
            TextRun(72, 640, "CTM scales this line: jumpy", size_by="ctm"),
        ],
    ),
    # 1: CropBox 오프셋. 걸친 줄은 겹친 글자만 남고, 밖의 줄은 빠진다.
    PageSpec(
        crop_box=(100, 150, 500, 650),
        runs=[
            TextRun(130, 600, "Inside the offset CropBox"),
            TextRun(130, 570, "Origin is not zero: typography"),
            TextRun(420, 300, "Straddles the edge"),
            TextRun(20, 60, "Hidden outside the crop"),
        ],
    ),
    # 2: MediaBox 원점이 0이 아니고 CropBox가 MediaBox 밖으로 나간다(보이는 영역은 교집합).
    PageSpec(
        media_box=(100, 100, 500, 600),
        crop_box=(50, 200, 450, 700),
        runs=[
            TextRun(150, 500, "MediaBox origin is 100 100"),
            TextRun(150, 470, "CropBox clipped by MediaBox"),
        ],
    ),
    # 3: /Rotate 90 + CropBox 오프셋
    PageSpec(
        crop_box=(60, 80, 560, 720),
        rotate=90,
        runs=[
            TextRun(100, 650, "Rotated 90 with a CropBox"),
            TextRun(100, 620, "Second line, quickly typed"),
        ],
    ),
    # 4: /Rotate 180, 상자 상속
    PageSpec(
        media_box=None,
        rotate=180,
        runs=[
            TextRun(72, 700, "Rotated 180 degrees: upside"),
            TextRun(72, 670, "down on the display, jolly"),
        ],
    ),
    # 5: /Rotate 270 + MediaBox 원점 오프셋
    PageSpec(
        media_box=(30, 40, 625, 882),
        rotate=270,
        runs=[
            TextRun(80, 800, "Rotated 270 on offset A4"),
            TextRun(80, 770, "MediaBox starts at 30 40"),
        ],
    ),
    # 6: UserUnit 2(사용자 공간 1단위 = 2pt) + CropBox 오프셋
    PageSpec(
        media_box=(0, 0, 306, 396),
        crop_box=(20, 30, 286, 376),
        user_unit=2,
        runs=[
            TextRun(40, 330, "UserUnit is two: each unit", font_size=9),
            TextRun(40, 315, "spans two points; quirky", font_size=9),
        ],
    ),
    # 7: 스캔본 흉내. 쪽 번호만 있다(OCR 대상).
    PageSpec(media_box=None, runs=[TextRun(290, 40, "- 8 -", font_size=10)]),
    # 8: CropBox가 MediaBox와 겹치지 않는다(잘못 만든 PDF). 보이는 영역은 MediaBox다.
    PageSpec(
        crop_box=(700, 800, 900, 1000),
        runs=[
            TextRun(72, 700, "CropBox misses the MediaBox"),
            TextRun(72, 670, "so the view falls back, hmm"),
        ],
    ),
]

ORDER_LINES = ["First line of the clause", "Second line follows it", "Third line ends here"]
ORDER_LINE_GAP = 30


def order_runs() -> list[TextRun]:
    return [TextRun(100, 650 - index * ORDER_LINE_GAP, line) for index, line in enumerate(ORDER_LINES)]


ROTATION_ORDER_PAGES = [PageSpec(runs=order_runs(), rotate=rotate) for rotate in (None, 90, 180, 270)] + [
    # /Rotate 90은 화면에서 시계 방향으로 돌린다. 글자를 반시계 방향으로 그려 두면 화면에서 바로 선다.
    # 화면 아래쪽이 사용자 공간 x가 커지는 쪽이므로 다음 줄은 x를 늘린다.
    PageSpec(
        rotate=90,
        runs=[
            TextRun(500 + index * ORDER_LINE_GAP, 100, line, upward=True)
            for index, line in enumerate(ORDER_LINES)
        ],
    ),
]

KOREAN_PAGES = [
    PageSpec(
        media_box=A4_MEDIA_BOX,
        runs=[
            TextRun(60, 760, "제1조(목적) 이 계약은 갑과 을의 권리와 의무를 정한다.", 14),
            TextRun(60, 735, "계약 금액은 금 1,000,000원(부가세 별도)으로 한다.", 14),
        ],
    ),
    # /Rotate 270 + CropBox 오프셋
    PageSpec(
        media_box=A4_MEDIA_BOX,
        crop_box=(40, 60, 555, 800),
        rotate=270,
        runs=[
            TextRun(70, 700, "제2조(기간) 계약 기간은 2026년 1월 1일부터", 14),
            TextRun(70, 675, "1년으로 하며, 갑과 을이 합의하면 연장한다.", 14),
        ],
    ),
]


def format_number(value: float) -> bytes:
    return (f"{value:g}").encode("ascii")


def format_box(box: tuple) -> bytes:
    return b"[" + b" ".join(format_number(value) for value in box) + b"]"


def stream_object(data: bytes, extra: bytes = b"") -> bytes:
    return b"<< /Length %d%s >>\nstream\n" % (len(data), extra) + data + b"\nendstream"


def serialize_pdf(objects: dict[int, bytes], version: bytes = b"1.6") -> bytes:
    """객체 번호 1이 Catalog다. 번호는 1부터 빈틈없이 이어져야 한다."""
    output = bytearray(b"%PDF-" + version + b"\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for number in sorted(objects):
        offsets[number] = len(output)
        output += b"%d 0 obj\n" % number + objects[number] + b"\nendobj\n"
    size = len(objects) + 1
    xref_offset = len(output)
    output += b"xref\n0 %d\n0000000000 65535 f \n" % size
    for number in range(1, size):
        output += b"%010d 00000 n \n" % offsets[number]
    output += b"trailer\n<< /Size %d /Root 1 0 R >>\n" % size
    output += b"startxref\n%d\n%%%%EOF\n" % xref_offset
    return bytes(output)


def run_commands(run: TextRun, encoded_text: bytes) -> bytes:
    x, y, size = (format_number(value) for value in (run.x, run.y, run.font_size))
    if run.upward:
        return b"BT /F1 %s Tf 0 1 -1 0 %s %s Tm %s Tj ET" % (size, x, y, encoded_text)
    if run.size_by == "font":
        return b"BT /F1 %s Tf %s %s Td %s Tj ET" % (size, x, y, encoded_text)
    if run.size_by == "text_matrix":
        return b"BT /F1 1 Tf %s 0 0 %s %s %s Tm %s Tj ET" % (
            size,
            size,
            x,
            y,
            encoded_text,
        )
    if run.size_by == "ctm":
        scaled = (
            format_number(value / CTM_SCALE) for value in (run.font_size, run.x, run.y)
        )
        size, x, y = scaled
        return b"q %d 0 0 %d 0 0 cm BT /F1 %s Tf %s %s Td %s Tj ET Q" % (
            CTM_SCALE,
            CTM_SCALE,
            size,
            x,
            y,
            encoded_text,
        )
    raise ValueError(f"unknown size_by: {run.size_by}")


def build_document(
    pages: list[PageSpec], font_objects: dict[int, bytes], encode
) -> bytes:
    """Catalog(1), Pages(2), 글꼴(3부터, `font_objects`), 이어서 쪽·콘텐츠 객체.
    `encode`는 줄 글자를 `Tj` 피연산자(문자열 객체)로 바꾼다."""
    objects = dict(font_objects)
    next_number = max(objects) + 1
    page_numbers = []
    for spec in pages:
        page_number, content_number = next_number, next_number + 1
        next_number += 2
        page_numbers.append(page_number)
        parts = [b"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >>"]
        if spec.media_box is not None:
            parts.append(b" /MediaBox " + format_box(spec.media_box))
        if spec.crop_box is not None:
            parts.append(b" /CropBox " + format_box(spec.crop_box))
        if spec.rotate is not None:
            parts.append(b" /Rotate %d" % spec.rotate)
        if spec.user_unit is not None:
            parts.append(b" /UserUnit " + format_number(spec.user_unit))
        parts.append(b" /Contents %d 0 R >>" % content_number)
        objects[page_number] = b"".join(parts)
        content = b"\n".join(run_commands(run, encode(run.text)) for run in spec.runs)
        objects[content_number] = stream_object(content)

    kids = b" ".join(b"%d 0 R" % number for number in page_numbers)
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    # 상속 확인용: MediaBox가 없는 쪽은 이 값을 물려받는다.
    objects[2] = b"<< /Type /Pages /Kids [%s] /Count %d /MediaBox %s >>" % (
        kids,
        len(pages),
        format_box(LETTER_MEDIA_BOX),
    )
    return serialize_pdf(objects)


def pdf_literal(text: str) -> bytes:
    escaped = (
        text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    )
    return b"(" + escaped.encode("latin-1") + b")"


HELVETICA = {3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"}


def text_geometry_pdf() -> bytes:
    return build_document(GEOMETRY_PAGES, HELVETICA, pdf_literal)


def rotation_order_pdf() -> bytes:
    return build_document(ROTATION_ORDER_PAGES, HELVETICA, pdf_literal)


# --- TrueType 서브셋 (WOFF 1.0 → 쓰는 글리프만 남긴 sfnt) ---------------------------

WOFF_HEADER_SIZE = 44
WOFF_TABLE_ENTRY_SIZE = 20
SFNT_VERSION_TRUETYPE = 0x00010000
POST_VERSION_3 = 0x00030000
# 글리프 이름 없는 post 3.0은 머리 32바이트뿐이다.
POST_HEADER_SIZE = 32
# 그대로 옮기는 표. 힌팅 명령(fpgm·prep·cvt)은 글리프 명령이 참조하므로 남긴다.
COPIED_TABLES = ("OS/2", "cvt ", "fpgm", "gasp", "prep")

# 'glyf' 합성 글리프 플래그 (OpenType glyf 표)
ARG_1_AND_2_ARE_WORDS = 0x0001
WE_HAVE_A_SCALE = 0x0008
MORE_COMPONENTS = 0x0020
WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
WE_HAVE_A_TWO_BY_TWO = 0x0080
GLYPH_HEADER_SIZE = 10


def read_woff_tables(path: Path) -> dict[str, bytes]:
    data = path.read_bytes()
    signature, flavor, _, table_count = struct.unpack(">4sIIH", data[:14])
    if signature != b"wOFF" or flavor != SFNT_VERSION_TRUETYPE:
        raise ValueError(f"not a TrueType WOFF 1.0 file: {path}")
    tables = {}
    for index in range(table_count):
        start = WOFF_HEADER_SIZE + index * WOFF_TABLE_ENTRY_SIZE
        tag, offset, compressed_length, original_length, _ = struct.unpack(
            ">4sIIII", data[start : start + WOFF_TABLE_ENTRY_SIZE]
        )
        raw = data[offset : offset + compressed_length]
        is_compressed = compressed_length < original_length
        tables[tag.decode("latin-1")] = zlib.decompress(raw) if is_compressed else raw
    return tables


def unicode_to_glyph(cmap: bytes) -> dict[int, int]:
    """(3, 1) 형식 4 부분 표를 읽는다(BMP 글자만 쓴다)."""
    _, subtable_count = struct.unpack(">HH", cmap[:4])
    for index in range(subtable_count):
        platform_id, encoding_id, offset = struct.unpack(
            ">HHI", cmap[4 + index * 8 : 12 + index * 8]
        )
        (subtable_format,) = struct.unpack(">H", cmap[offset : offset + 2])
        if (platform_id, encoding_id, subtable_format) == (3, 1, 4):
            return read_cmap_format_4(cmap, offset)
    raise ValueError("no (3, 1) format 4 cmap subtable")


def read_cmap_format_4(cmap: bytes, offset: int) -> dict[int, int]:
    (segment_count_x2,) = struct.unpack(">H", cmap[offset + 6 : offset + 8])
    segment_count = segment_count_x2 // 2

    def array(start: int, signed: bool = False) -> tuple:
        code = "h" if signed else "H"
        return struct.unpack(
            ">%d%s" % (segment_count, code), cmap[start : start + segment_count_x2]
        )

    ends_at = offset + 14
    starts_at = ends_at + segment_count_x2 + 2
    deltas_at = starts_at + segment_count_x2
    range_offsets_at = deltas_at + segment_count_x2
    ends, starts = array(ends_at), array(starts_at)
    deltas, range_offsets = array(deltas_at, signed=True), array(range_offsets_at)
    mapping = {}
    for segment in range(segment_count):
        for code_point in range(starts[segment], ends[segment] + 1):
            if range_offsets[segment] == 0:
                glyph = (code_point + deltas[segment]) & 0xFFFF
            else:
                at = (
                    range_offsets_at
                    + segment * 2
                    + range_offsets[segment]
                    + (code_point - starts[segment]) * 2
                )
                (glyph,) = struct.unpack(">H", cmap[at : at + 2])
                if glyph:
                    glyph = (glyph + deltas[segment]) & 0xFFFF
            if glyph:
                mapping[code_point] = glyph
    return mapping


@dataclass
class TrueTypeFont:
    tables: dict[str, bytes]
    glyph_count: int = field(init=False)

    def __post_init__(self) -> None:
        (self.glyph_count,) = struct.unpack(">H", self.tables["maxp"][4:6])

    def glyph_data(self, glyph: int) -> bytes:
        loca, glyf = self.tables["loca"], self.tables["glyf"]
        (is_long,) = struct.unpack(">h", self.tables["head"][50:52])
        if is_long:
            start, end = struct.unpack(">II", loca[glyph * 4 : glyph * 4 + 8])
        else:
            start, end = (2 * value for value in struct.unpack(">HH", loca[glyph * 2 : glyph * 2 + 4]))
        return glyf[start:end]

    def horizontal_metric(self, glyph: int) -> tuple[int, int]:
        (metric_count,) = struct.unpack(">H", self.tables["hhea"][34:36])
        hmtx = self.tables["hmtx"]
        if glyph < metric_count:
            return struct.unpack(">Hh", hmtx[glyph * 4 : glyph * 4 + 4])
        (advance,) = struct.unpack(">H", hmtx[(metric_count - 1) * 4 : metric_count * 4])
        at = metric_count * 4 + (glyph - metric_count) * 2
        (left_side_bearing,) = struct.unpack(">h", hmtx[at : at + 2])
        return advance, left_side_bearing


def component_offsets(glyph: bytes) -> list[int]:
    """합성 글리프의 각 성분 glyphIndex 위치. 단순 글리프면 빈 목록이다."""
    if len(glyph) < GLYPH_HEADER_SIZE:
        return []
    (contour_count,) = struct.unpack(">h", glyph[:2])
    if contour_count >= 0:
        return []
    offsets = []
    at = GLYPH_HEADER_SIZE
    while True:
        (flags,) = struct.unpack(">H", glyph[at : at + 2])
        offsets.append(at + 2)
        at += 4 + (4 if flags & ARG_1_AND_2_ARE_WORDS else 2)
        if flags & WE_HAVE_A_SCALE:
            at += 2
        elif flags & WE_HAVE_AN_X_AND_Y_SCALE:
            at += 4
        elif flags & WE_HAVE_A_TWO_BY_TWO:
            at += 8
        if not flags & MORE_COMPONENTS:
            return offsets


def table_checksum(data: bytes) -> int:
    padded = data + b"\0" * (-len(data) % 4)
    return sum(struct.unpack(">%dI" % (len(padded) // 4), padded)) & 0xFFFFFFFF


def build_sfnt(tables: dict[str, bytes]) -> bytes:
    tags = sorted(tables)
    entry_selector = max(power for power in range(16) if 2**power <= len(tags))
    search_range = 16 * 2**entry_selector
    header = struct.pack(
        ">IHHHH",
        SFNT_VERSION_TRUETYPE,
        len(tags),
        search_range,
        entry_selector,
        len(tags) * 16 - search_range,
    )
    offset = len(header) + 16 * len(tags)
    records, body = b"", b""
    for tag in tags:
        data = tables[tag]
        records += struct.pack(
            ">4sIII", tag.encode("latin-1"), table_checksum(data), offset + len(body), len(data)
        )
        body += data + b"\0" * (-len(data) % 4)
    return header + records + body


@dataclass
class FontSubset:
    """새 글리프 번호(= CID, CIDToGIDMap Identity)로 다시 번호를 매긴 서브셋."""

    sfnt: bytes
    cid_by_char: dict[str, int]
    advances: list[int]
    units_per_em: int
    bbox: tuple
    ascent: int
    descent: int
    cap_height: int


def subset_font(font: TrueTypeFont, text: str) -> FontSubset:
    unicode_map = unicode_to_glyph(font.tables["cmap"])
    chars = sorted(set(text))
    missing = [char for char in chars if ord(char) not in unicode_map]
    if missing:
        raise ValueError(f"font has no glyph for {missing}")

    needed = {0} | {unicode_map[ord(char)] for char in chars}
    pending = list(needed)
    while pending:
        data = font.glyph_data(pending.pop())
        for at in component_offsets(data):
            (component,) = struct.unpack(">H", data[at : at + 2])
            if component not in needed:
                needed.add(component)
                pending.append(component)
    old_glyphs = sorted(needed)
    new_number = {old: new for new, old in enumerate(old_glyphs)}

    glyf, loca, hmtx, advances = b"", [0], b"", []
    for old in old_glyphs:
        data = bytearray(font.glyph_data(old))
        for at in component_offsets(bytes(data)):
            (component,) = struct.unpack(">H", data[at : at + 2])
            struct.pack_into(">H", data, at, new_number[component])
        glyf += bytes(data) + b"\0" * (-len(data) % 4)
        loca.append(len(glyf))
        advance, left_side_bearing = font.horizontal_metric(old)
        hmtx += struct.pack(">Hh", advance, left_side_bearing)
        advances.append(advance)

    count = len(old_glyphs)
    head = bytearray(font.tables["head"])
    struct.pack_into(">I", head, 8, 0)  # checkSumAdjustment: 검증하는 곳이 없다
    struct.pack_into(">h", head, 50, 1)  # indexToLocFormat: long
    hhea = bytearray(font.tables["hhea"])
    struct.pack_into(">H", hhea, 34, count)
    maxp = bytearray(font.tables["maxp"])
    struct.pack_into(">H", maxp, 4, count)
    post = bytearray(font.tables["post"][:POST_HEADER_SIZE])
    struct.pack_into(">I", post, 0, POST_VERSION_3)

    tables = {tag: font.tables[tag] for tag in COPIED_TABLES if tag in font.tables}
    tables.update(
        {
            "head": bytes(head),
            "hhea": bytes(hhea),
            "maxp": bytes(maxp),
            "post": bytes(post),
            "hmtx": hmtx,
            "glyf": glyf,
            "loca": struct.pack(">%dI" % len(loca), *loca),
        }
    )
    (units_per_em,) = struct.unpack(">H", head[18:20])
    bbox = struct.unpack(">4h", head[36:44])
    ascent, descent = struct.unpack(">hh", hhea[4:8])
    (cap_height,) = struct.unpack(">h", font.tables["OS/2"][88:90])
    return FontSubset(
        sfnt=build_sfnt(tables),
        cid_by_char={char: new_number[unicode_map[ord(char)]] for char in chars},
        advances=advances,
        units_per_em=units_per_em,
        bbox=bbox,
        ascent=ascent,
        descent=descent,
        cap_height=cap_height,
    )


# ToUnicode CMap 한 블록에 넣을 수 있는 bfchar 최대 개수(PDF 32000-1 9.10.3)
MAX_BFCHAR_PER_BLOCK = 100
# PDF 글리프 공간 단위(1000 = 글꼴 크기 1)
GLYPH_SPACE_UNITS = 1000
# FontDescriptor Flags: Symbolic(비트 3). CIDFont는 글자 집합이 표준 라틴 밖이다.
FONT_FLAG_SYMBOLIC = 4
# FontDescriptor StemV: 필수지만 렌더·추출이 쓰지 않는 값
FONT_STEM_V = 80


def to_unicode_cmap(cid_by_char: dict[str, int]) -> bytes:
    pairs = sorted((cid, char) for char, cid in cid_by_char.items())
    lines = [
        b"/CIDInit /ProcSet findresource begin",
        b"12 dict begin",
        b"begincmap",
        b"/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
        b"/CMapName /Adobe-Identity-UCS def",
        b"/CMapType 2 def",
        b"1 begincodespacerange",
        b"<0000> <FFFF>",
        b"endcodespacerange",
    ]
    for start in range(0, len(pairs), MAX_BFCHAR_PER_BLOCK):
        block = pairs[start : start + MAX_BFCHAR_PER_BLOCK]
        lines.append(b"%d beginbfchar" % len(block))
        lines.extend(b"<%04X> <%04X>" % (cid, ord(char)) for cid, char in block)
        lines.append(b"endbfchar")
    lines += [b"endcmap", b"CMapName currentdict /CMap defineresource pop", b"end", b"end"]
    return b"\n".join(lines)


def korean_text_pdf() -> bytes:
    text = "".join(run.text for page in KOREAN_PAGES for run in page.runs)
    subset = subset_font(TrueTypeFont(read_woff_tables(KOREAN_FONT_PATH)), text)

    def to_glyph_space(value: int) -> int:
        return round(value * GLYPH_SPACE_UNITS / subset.units_per_em)

    widths = b" ".join(b"%d" % to_glyph_space(advance) for advance in subset.advances)
    font_file = zlib.compress(subset.sfnt, 9)
    font_objects = {
        3: b"<< /Type /Font /Subtype /Type0 /BaseFont /%s /Encoding /Identity-H "
        b"/DescendantFonts [4 0 R] /ToUnicode 7 0 R >>" % KOREAN_FONT_NAME,
        4: b"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /%s "
        b"/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
        b"/FontDescriptor 5 0 R /CIDToGIDMap /Identity /W [0 [%s]] >>"
        % (KOREAN_FONT_NAME, widths),
        5: b"<< /Type /FontDescriptor /FontName /%s /Flags %d /FontBBox %s "
        b"/ItalicAngle 0 /Ascent %d /Descent %d /CapHeight %d /StemV %d /FontFile2 6 0 R >>"
        % (
            KOREAN_FONT_NAME,
            FONT_FLAG_SYMBOLIC,
            format_box(tuple(to_glyph_space(value) for value in subset.bbox)),
            to_glyph_space(subset.ascent),
            to_glyph_space(subset.descent),
            to_glyph_space(subset.cap_height),
            FONT_STEM_V,
        ),
        6: stream_object(
            font_file, b" /Length1 %d /Filter /FlateDecode" % len(subset.sfnt)
        ),
        7: stream_object(to_unicode_cmap(subset.cid_by_char)),
    }

    def encode(line: str) -> bytes:
        return b"<" + b"".join(b"%04X" % subset.cid_by_char[char] for char in line) + b">"

    return build_document(KOREAN_PAGES, font_objects, encode)


def main() -> None:
    fixtures = {
        "text-geometry.pdf": text_geometry_pdf(),
        "rotation-order.pdf": rotation_order_pdf(),
        "korean-text.pdf": korean_text_pdf(),
    }
    for name, data in fixtures.items():
        (OUTPUT_DIR / name).write_bytes(data)
        print(f"{name}: {len(data)} bytes")


if __name__ == "__main__":
    main()
