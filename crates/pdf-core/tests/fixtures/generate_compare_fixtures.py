#!/usr/bin/env python3
"""비교 엔진 글자 추출(Step 17) 픽스처를 이 폴더에 다시 만든다. 표준 라이브러리만 쓰고,
같은 입력이면 항상 같은 바이트를 만든다(타임스탬프 없음).

- text-geometry.pdf: 라틴 글자를 상자·회전이 다른 쪽에 둔다. 글자 좌표는 `GEOMETRY_PAGES`에 적은
  절대 사용자 공간 좌표다(CropBox 원점을 빼지 않는다). 글자 상자를 golden으로 고정하므로 글꼴은
  korean-text.pdf와 같은 방식으로 임베드한다(표준 14 글꼴은 OS마다 대체 글꼴이 달라 상자가 달라진다).
- rotation-order.pdf: 같은 세 줄을 /Rotate 0·90·180·270 쪽과, 글자를 돌려 그리고 /Rotate로
  바로 세운 쪽에 둔다. 추출한 글자 순서가 회전과 상관없이 같아야 한다.
- korean-text.pdf: IBM Plex Sans KR(SIL OFL 1.1) 중 쓰는 글자만 남긴 TrueType을 Type0 +
  CIDFontType2 + Identity-H + ToUnicode로 임베드한다. 글꼴은 앱 의존성
  `@fontsource/ibm-plex-sans-kr`의 woff에서 읽으므로 `pnpm install` 뒤에 돌린다.
- tokenize-korean.pdf(Step 18): 같은 방식의 한글 글꼴로 쓴 가상 계약서 문구. 숫자·금액·날짜,
  호환 문자(NFKC로 바뀌는 ㈜·™·²), 대소문자, 연속 공백, 하이픈 줄바꿈(pdfium이 잇는 것과
  줄바꿈으로 남기는 것, 쪽 경계)을 담는다. 3쪽은 ToUnicode가 PUA를 가리킨다(깨진 텍스트 레이어
  흉내, LowTextConfidence 대상).
- diff-base.pdf·diff-edit.pdf·diff-move.pdf·diff-rewrap.pdf(Step 19): 같은 한글 글꼴로 쓴 가상
  계약서 원본과 변형 셋(단어 삽입·삭제·치환과 숫자 치환, 쪽 경계를 넘는 문단 이동, 줄바꿈 위치만
  다른 판).
- pages-base.pdf·pages-insert.pdf·pages-delete.pdf·pages-edit.pdf·pages-push.pdf(Step 20): 빈 쪽이
  낀 5쪽 가상 계약서 원본과 변형 넷(쪽 삽입과 다른 쪽 숫자 하나 수정, 쪽 삭제, 쪽 순서를 둔 채
  내용 일부 수정, 앞에 넣은 문단 때문에 쪽 내용이 반 넘게 다음 쪽으로 밀린 판).
- connectors-a.pdf·connectors-b.pdf(Step 28): 연결선 묶기 사례(여러 줄 변경, 인접 변경 3개, 20pt
  경계 안·밖, A만 경계 안, 순서가 뒤바뀐 변경, 추가·삭제)를 둔 세로 쪽과 가로 쪽(A는 /Rotate 90에
  돌려 그린 글자, B는 가로 MediaBox) 2쪽.
- placement-a.pdf·placement-b.pdf·placement-blank.pdf(Step 28-b): 앵커 사례(문서 맨 앞·줄 가운데·
  줄 경계·쪽 경계·문서 맨 끝 삽입, 줄 가운데 삭제)와 같은 줄 상자 병합 사례(한 줄 두 낱말, 줄을 넘는
  삽입, 같은 높이 두 단에 걸친 삽입)를 둔 3쪽 짝과, 반대쪽이 빈 쪽인 사례에 쓰는 글자 없는 한 쪽.
- connector-geometry-a.pdf·connector-geometry-b.pdf(Step 28-c): 연결선 끝점·모양 사례(한 줄·상자 여럿인
  한 줄·두 줄 치환, 세 줄 치환·삽입 띠, 앵커 삽입·삭제, 쪽을 넘는 치환)를 회전 0·90·180·270과 CropBox
  오프셋·MediaBox 원점 쪽에 둔 4쪽 짝.

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
    """`media_box`가 None이면 Pages 노드의 MediaBox를 물려받는다.
    `font_object`는 쪽 자원 `/F1`이 가리키는 글꼴 객체 번호다."""

    runs: list[TextRun]
    media_box: tuple | None = LETTER_MEDIA_BOX
    crop_box: tuple | None = None
    rotate: int | None = None
    user_unit: float | None = None
    font_object: int = 3


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
        parts = [
            b"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 %d 0 R >> >>"
            % spec.font_object
        ]
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
    # 한글 글꼴 서브셋이 라틴 글자도 담는다.
    font = korean_font(GEOMETRY_PAGES)
    return build_document(GEOMETRY_PAGES, font.objects, font.encode)


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
        # 마지막 longHorMetric의 advanceWidth(앞 2바이트)를 그대로 쓴다.
        (advance,) = struct.unpack(">H", hmtx[(metric_count - 1) * 4 : (metric_count - 1) * 4 + 2])
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


@dataclass
class KoreanFont:
    """글꼴 객체 3(Type0, ToUnicode 7)·4(CIDFont)·5(FontDescriptor)·6(FontFile2)·7(ToUnicode)."""

    subset: FontSubset
    objects: dict[int, bytes]

    def encode(self, line: str) -> bytes:
        return b"<" + b"".join(b"%04X" % self.subset.cid_by_char[char] for char in line) + b">"


def korean_font(pages: list[PageSpec]) -> KoreanFont:
    text = "".join(run.text for page in pages for run in page.runs)
    subset = subset_font(TrueTypeFont(read_woff_tables(KOREAN_FONT_PATH)), text)

    def to_glyph_space(value: int) -> int:
        return round(value * GLYPH_SPACE_UNITS / subset.units_per_em)

    widths = b" ".join(b"%d" % to_glyph_space(advance) for advance in subset.advances)
    font_file = zlib.compress(subset.sfnt, 9)
    objects = {
        3: type0_font(KOREAN_TO_UNICODE_OBJECT),
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
        KOREAN_TO_UNICODE_OBJECT: stream_object(to_unicode_cmap(subset.cid_by_char)),
    }
    return KoreanFont(subset, objects)


KOREAN_TO_UNICODE_OBJECT = 7


def type0_font(to_unicode_object: int) -> bytes:
    """CIDFont 4를 쓰는 Type0 글꼴"""
    return (
        b"<< /Type /Font /Subtype /Type0 /BaseFont /%s /Encoding /Identity-H "
        b"/DescendantFonts [4 0 R] /ToUnicode %d 0 R >>" % (KOREAN_FONT_NAME, to_unicode_object)
    )


def korean_text_pdf() -> bytes:
    font = korean_font(KOREAN_PAGES)
    return build_document(KOREAN_PAGES, font.objects, font.encode)


# --- 토큰화(Step 18) ---------------------------------------------------------------

# 깨진 ToUnicode 흉내: 공백이 아닌 글자를 PUA(U+E000부터)로 잇는다.
PUA_FONT_OBJECT = 8
PUA_TO_UNICODE_OBJECT = 9
PRIVATE_USE_START = 0xE000

TOKENIZE_FONT_SIZE = 12
TOKENIZE_LINE_GAP = 22
TOKENIZE_LEFT = 60
TOKENIZE_TOP = 780


def tokenize_runs(lines: list[str]) -> list[TextRun]:
    return [
        TextRun(TOKENIZE_LEFT, TOKENIZE_TOP - index * TOKENIZE_LINE_GAP, line, TOKENIZE_FONT_SIZE)
        for index, line in enumerate(lines)
    ]


TOKENIZE_PAGES = [
    # 줄 끝 하이픈: 글자 뒤 `-`는 pdfium이 다음 줄과 잇고(co-, Self-), 숫자 뒤 `-`(45-)와 홀로 선
    # `-`(별첨 -)는 줄바꿈으로 남긴다. 마지막 줄의 `갑-`은 다음 쪽 첫 줄과 이어진다.
    PageSpec(
        media_box=A4_MEDIA_BOX,
        runs=tokenize_runs(
            [
                "제3조(대금 지급) ㈜한빛상사는 계약 금액 금 1,000,000원을",
                "2026. 10. 13.까지 을에게   지급한다.",
                "입금 계좌는 사업자등록번호 123-45-",
                "67890 명의로 하고, 실무는 co-",
                "operation 담당이 맡는다. 연락처는 별첨 -",
                "(부록 A)에 적는다. 독립 계약자(Self-",
                "Employed) 조항, Service Level과 NDA™를 따르며",
                "면적은 100m²로 본다. 이 계약서는 갑-",
            ]
        ),
    ),
    PageSpec(media_box=A4_MEDIA_BOX, runs=tokenize_runs(["을 쌍방이 서명한 날부터 효력이 생긴다."])),
    PageSpec(
        media_box=A4_MEDIA_BOX,
        font_object=PUA_FONT_OBJECT,
        runs=tokenize_runs(["제4조(해지) 위반 시 해지할 수 있다."]),
    ),
]


def tokenize_korean_pdf() -> bytes:
    font = korean_font(TOKENIZE_PAGES)
    pua_by_char = {
        char: char if char.isspace() else chr(PRIVATE_USE_START + cid)
        for char, cid in font.subset.cid_by_char.items()
    }
    pua_cmap = to_unicode_cmap(
        {pua_by_char[char]: cid for char, cid in font.subset.cid_by_char.items()}
    )
    objects = {
        **font.objects,
        PUA_FONT_OBJECT: type0_font(PUA_TO_UNICODE_OBJECT),
        PUA_TO_UNICODE_OBJECT: stream_object(pua_cmap),
    }
    return build_document(TOKENIZE_PAGES, objects, font.encode)


# --- diff(Step 19) -----------------------------------------------------------------

# 원본 계약서(2쪽). 변형은 이 문구에서 바꾼 곳만 다르다.
DIFF_BASE_PAGES = [
    [
        "제1조(목적) 이 계약은 갑과 을 사이의 용역 제공에 관한",
        "권리와 의무를 정함을 목적으로 한다.",
        "제2조(계약 기간) 계약 기간은 2026년 1월 1일부터",
        "2026년 12월 31일까지로 한다.",
        "제3조(대금) 갑은 을에게 용역 대금으로 금 1,000,000원을",
        "지급하고, 지연 이자는 연 5%로 한다.",
    ],
    [
        "제4조(비밀 유지) 을은 업무 중 알게 된 갑의 정보를",
        "제3자에게 누설하지 아니한다.",
        "제5조(해지) 어느 한쪽이 계약을 위반하면 상대방은 서면으로",
        "통지한 후 이 계약을 해지할 수 있다.",
        "제6조(관할) 이 계약에 관한 분쟁은 서울중앙지방법원을",
        "관할 법원으로 한다.",
    ],
]

# 단어 삽입(14일 전에, 두 줄에 걸친 문장)·삭제(용역)·치환(서울중앙→수원), 날짜(2026년 12월 31일 →
# 2027년 6월 30일)·금액(1,000,000 → 1,500,000)·비율(5% → 15%) 숫자 치환. 줄은 공백에서만 바꾼다.
DIFF_EDIT_PAGES = [
    [
        "제1조(목적) 이 계약은 갑과 을 사이의 용역 제공에 관한",
        "권리와 의무를 정함을 목적으로 한다.",
        "제2조(계약 기간) 계약 기간은 2026년 1월 1일부터",
        "2027년 6월 30일까지로 한다.",
        "제3조(대금) 갑은 을에게 대금으로 금 1,500,000원을",
        "지급하고, 지연 이자는 연 15%로 한다.",
    ],
    [
        "제4조(비밀 유지) 을은 업무 중 알게 된 갑의 정보를",
        "제3자에게 누설하지 아니한다. 이 의무는 계약이 끝난",
        "후에도 3년간 유지된다.",
        "제5조(해지) 어느 한쪽이 계약을 위반하면 상대방은 14일 전에",
        "서면으로 통지한 후 이 계약을 해지할 수 있다.",
        "제6조(관할) 이 계약에 관한 분쟁은 수원지방법원을",
        "관할 법원으로 한다.",
    ],
]

# 문단 이동: 1쪽의 제2조를 2쪽 제4조 뒤로 옮긴다(쪽 경계를 넘는 이동).
DIFF_MOVE_PAGES = [
    DIFF_BASE_PAGES[0][:2] + DIFF_BASE_PAGES[0][4:],
    DIFF_BASE_PAGES[1][:2] + DIFF_BASE_PAGES[0][2:4] + DIFF_BASE_PAGES[1][2:],
]

# 같은 문구를 다른 위치에서 줄바꿈하고 쪽 경계도 옮긴다. 한글 단어 중간에서 하이픈 없이 바꾼 줄
# (제공|에, 31일까|지로, 통지|한, 서울중앙지방|법원을)이 있어 토큰 경계는 다르지만 차이는 0이어야 한다.
DIFF_REWRAP_PAGES = [
    [
        "제1조(목적) 이 계약은 갑과 을 사이의 용역 제공",
        "에 관한 권리와 의무를 정함을 목적으로 한다. 제2조(계약",
        "기간) 계약 기간은 2026년 1월 1일부터 2026년 12월 31일까",
        "지로 한다.",
        "제3조(대금) 갑은 을에게 용역 대금으로 금",
    ],
    [
        "1,000,000원을 지급하고, 지연 이자는 연 5%로 한다.",
        "제4조(비밀 유지) 을은 업무 중 알게 된 갑의 정보를 제3자에게",
        "누설하지 아니한다.",
        "제5조(해지) 어느 한쪽이 계약을 위반하면 상대방은 서면으로 통지",
        "한 후 이 계약을 해지할 수 있다.",
        "제6조(관할) 이 계약에 관한 분쟁은 서울중앙지방",
        "법원을 관할 법원으로 한다.",
    ],
]


def diff_pdf(pages: list[list[str]]) -> bytes:
    specs = [PageSpec(media_box=A4_MEDIA_BOX, runs=tokenize_runs(lines)) for lines in pages]
    font = korean_font(specs)
    return build_document(specs, font.objects, font.encode)


# --- 페이지 짝짓기(Step 20) ----------------------------------------------------------

# 원본 계약서(5쪽). 2쪽(0부터)은 빈 쪽이다. 변형은 쪽 단위로 이 문구를 다시 쓴다.
PAGES_ARTICLES_1_2 = [
    "제1조(목적) 이 계약은 가람물류 주식회사(이하 갑)가",
    "누리소프트 주식회사(이하 을)에게 맡기는 물류 관리",
    "시스템 구축 용역의 범위와 대가를 정함을 목적으로 한다.",
    "제2조(정의) 산출물이란 을이 용역을 수행하며 만든",
    "설계서, 소스 코드, 사용 설명서를 말하고, 검수란 갑이",
    "산출물이 요구 사항에 맞는지 확인하는 일을 말한다.",
]
PAGES_ARTICLES_3_4 = [
    "제3조(기간) 용역 기간은 2026년 11월 2일부터 2027년",
    "4월 30일까지로 하며, 갑과 을이 서면으로 합의하면 늘린다.",
    "제4조(대금) 갑은 을에게 용역 대금으로 금 48,000,000원을",
    "세 번에 나누어 지급한다. 착수금은 계약 금액의 30%,",
    "중도금은 40%, 잔금은 30%로 하고, 잔금은 검수를 마친",
    "날부터 14일 안에 지급한다.",
]
PAGES_BLANK: list[str] = []
PAGES_ARTICLES_5_6 = [
    "제5조(비밀 유지) 을은 용역을 수행하며 알게 된 갑의 영업",
    "정보와 고객 정보를 제3자에게 누설하지 아니한다.",
    "이 의무는 계약이 끝난 뒤에도 3년간 유지된다.",
    "제6조(해지) 어느 한쪽이 이 계약을 위반하고 상대방의",
    "시정 요구를 받은 날부터 10일 안에 바로잡지 아니하면",
    "상대방은 서면으로 통지하여 이 계약을 해지할 수 있다.",
]
PAGES_SIGNATURE = [
    "제7조(관할) 이 계약에 관한 분쟁은 갑의 본점 소재지를",
    "관할하는 지방법원을 제1심 법원으로 한다.",
    "이 계약을 증명하기 위하여 계약서 2통을 만들어 1통씩 가진다.",
    "2026년 10월 13일",
    "갑 가람물류 주식회사 대표이사 김가람 (인)",
    "을 누리소프트 주식회사 대표이사 이누리 (인)",
]
# 3쪽의 기간 숫자만 바꾼 판(3년간 → 5년간). 쪽 삽입·내용 수정 변형이 함께 쓴다.
PAGES_ARTICLES_5_6_EDITED = [
    *PAGES_ARTICLES_5_6[:2],
    "이 의무는 계약이 끝난 뒤에도 5년간 유지된다.",
    *PAGES_ARTICLES_5_6[3:],
]
PAGES_BASE = [
    PAGES_ARTICLES_1_2,
    PAGES_ARTICLES_3_4,
    PAGES_BLANK,
    PAGES_ARTICLES_5_6,
    PAGES_SIGNATURE,
]

# 쪽 삽입: 1쪽 뒤(빈 쪽 앞)에 새 조항 한 쪽을 넣는다. 흔한 낱말(을은, 날부터, 안에)은 다른 쪽과 겹친다.
# 3쪽의 숫자도 하나 바꿔 시간 제한 확인(통째로 낸 `Replace`)에 쓴다.
PAGES_INSERTED = [
    "제4조의2(검수) 을은 산출물을 넘긴 뒤 갑에게 검수를",
    "요청하고, 갑은 요청을 받은 날부터 7일 안에 결과를",
    "알려야 한다. 그 기간 안에 알리지 아니하면 검수에",
    "합격한 것으로 보고, 하자가 나오면 을은 지체 없이 고쳐",
    "다시 넘긴다.",
]
PAGES_INSERT = [
    *PAGES_BASE[:2],
    PAGES_INSERTED,
    PAGES_BLANK,
    PAGES_ARTICLES_5_6_EDITED,
    PAGES_SIGNATURE,
]

# 쪽 삭제: 1쪽(제3조·제4조)을 뺀다. 빈 쪽은 남는다.
PAGES_DELETE = PAGES_BASE[:1] + PAGES_BASE[2:]

# 쪽 순서를 둔 채 내용 일부 수정: 낱말 삽입, 날짜·금액·기간 숫자 치환.
PAGES_EDIT = [
    [
        *PAGES_ARTICLES_1_2[:2],
        "시스템 구축과 유지 보수 용역의 범위와 대가를 정함을 목적으로 한다.",
        *PAGES_ARTICLES_1_2[3:],
    ],
    [
        "제3조(기간) 용역 기간은 2026년 11월 16일부터 2027년",
        PAGES_ARTICLES_3_4[1],
        "제4조(대금) 갑은 을에게 용역 대금으로 금 52,000,000원을",
        *PAGES_ARTICLES_3_4[3:],
    ],
    PAGES_BLANK,
    PAGES_ARTICLES_5_6_EDITED,
    [*PAGES_SIGNATURE[:3], "2026년 10월 20일", *PAGES_SIGNATURE[4:]],
]

# 쪽 내용 밀림: 0쪽 앞에 전문 네 줄을 넣어 한 쪽에 여섯 줄씩 다시 앉힌다. 0쪽은 두 줄만 남고 네 줄이
# 1쪽으로, 1쪽도 두 줄만 남고 네 줄이 새 2쪽으로 밀린다. 빈 쪽과 그 뒤 쪽은 그대로다.
PAGES_PREAMBLE = [
    "전문 두 당사자는 서로 믿고 협력하여 아래와 같이",
    "약정하며, 이 문서에 적지 않은 사항은 따로 협의해",
    "정하기로 하고 그 협의 결과는 부속 합의서에 담는다.",
    "부속 합의서는 이 계약과 같은 효력을 가진다.",
]
PAGES_PUSH = [
    PAGES_PREAMBLE + PAGES_ARTICLES_1_2[:2],
    PAGES_ARTICLES_1_2[2:] + PAGES_ARTICLES_3_4[:2],
    PAGES_ARTICLES_3_4[2:],
    *PAGES_BASE[2:],
]


# --- 연결선 묶기(Step 28) ------------------------------------------------------------

# 0쪽(A4 세로)은 A·B가 같은 자리에 같은 문구를 두고 바꾼 곳만 다르다. 사례 사이는 40pt 넘게 띄워
# 서로 묶이지 않게 한다. 글자 크기 12pt에서 숫자 tight 상자는 기준선 위 약 8.6pt·아래 약 0.2pt라,
# 위아래 두 줄 숫자 상자의 세로 간격은 기준선 간격 − 약 8.8pt다.
CONNECTOR_FONT_SIZE = 12
CONNECTOR_LEFT = 60
# 붙는 줄(간격 약 13pt), 20pt 경계 바로 안(약 17pt)과 바로 밖(약 23pt)의 기준선 간격
CONNECTOR_LINE_GAP = 22
CONNECTOR_NEAR_GAP = 26
CONNECTOR_FAR_GAP = 32


@dataclass
class ConnectorLine:
    """연결선 픽스처 한 줄. `before_y`·`after_y`는 A·B 기준선(같으면 `after_y`는 None)."""

    before: str
    after: str
    before_y: float
    after_y: float | None = None


CONNECTOR_PORTRAIT_LINES = [
    # 여러 줄 변경: 줄 끝 `서면으로`와 다음 줄 첫 `통지한`이 한 변경이고 상자가 줄마다 하나다.
    ConnectorLine(
        "제1조(통지) 계약을 끝내려는 쪽은 상대방에게 서면으로",
        "제1조(통지) 계약을 끝내려는 쪽은 상대방에게 전자우편으로",
        780,
    ),
    ConnectorLine("통지한 후 30일이 지나면 해지할 수 있다.", "알린 후 30일이 지나면 해지할 수 있다.", 758),
    # 인접 변경 3개: 줄마다 숫자 하나씩, 붙는 줄 간격이라 한 묶음이다.
    ConnectorLine(
        "제2조(대금) 계약 금액은 금 1,000,000원으로 한다.",
        "제2조(대금) 계약 금액은 금 1,200,000원으로 한다.",
        700,
    ),
    ConnectorLine(
        "착수금은 계약 금액의 30%로 하고 계약일에 지급한다.",
        "착수금은 계약 금액의 40%로 하고 계약일에 지급한다.",
        700 - CONNECTOR_LINE_GAP,
    ),
    ConnectorLine(
        "잔금은 검수를 마친 날부터 14일 안에 지급한다.",
        "잔금은 검수를 마친 날부터 7일 안에 지급한다.",
        700 - 2 * CONNECTOR_LINE_GAP,
    ),
    # 20pt 경계 안: 간격 약 17pt라 묶인다.
    ConnectorLine(
        "제3조(기간) 용역 기간은 2026년 11월 2일부터 시작한다.",
        "제3조(기간) 용역 기간은 2026년 11월 9일부터 시작한다.",
        600,
    ),
    ConnectorLine(
        "검수 기간은 산출물을 받은 날부터 10일로 한다.",
        "검수 기간은 산출물을 받은 날부터 15일로 한다.",
        600 - CONNECTOR_NEAR_GAP,
    ),
    # 20pt 경계 밖: 간격 약 23pt라 따로다.
    ConnectorLine("제4조(보증) 하자 보증 기간은 1년으로 한다.", "제4조(보증) 하자 보증 기간은 2년으로 한다.", 520),
    ConnectorLine(
        "보증금은 계약 금액의 5%로 한다.", "보증금은 계약 금액의 3%로 한다.", 520 - CONNECTOR_FAR_GAP
    ),
    # A는 경계 안(약 17pt), B는 경계 밖(약 23pt): 양쪽 모두 안이어야 묶이므로 따로다.
    ConnectorLine(
        "제5조(지체) 지체상금은 하루에 계약 금액의 0.1%로 한다.",
        "제5조(지체) 지체상금은 하루에 계약 금액의 0.2%로 한다.",
        430,
    ),
    ConnectorLine(
        "지체상금 합계는 계약 금액의 10%를 넘지 못한다.",
        "지체상금 합계는 계약 금액의 20%를 넘지 못한다.",
        430 - CONNECTOR_NEAR_GAP,
        430 - CONNECTOR_FAR_GAP,
    ),
    # 순서가 뒤바뀐 변경: B는 내용 순서를 둔 채 두 줄의 자리만 바꿨다. 붙는 줄이지만 B 읽는 순서의
    # 순위가 거꾸로라 따로다.
    ConnectorLine(
        "제6조(관할) 분쟁은 갑의 본점 소재지 법원에서 다룬다.",
        "제6조(관할) 분쟁은 을의 본점 소재지 법원에서 다룬다.",
        350,
        350 - CONNECTOR_LINE_GAP,
    ),
    ConnectorLine(
        "이 계약서는 2통을 만들어 1통씩 가진다.",
        "이 계약서는 3통을 만들어 1통씩 가진다.",
        350 - CONNECTOR_LINE_GAP,
        350,
    ),
    # 추가·삭제는 잇지 않는다.
    ConnectorLine(
        "제7조(기타) 이 계약에 없는 사항은 관례에 따른다.",
        "제7조(기타) 이 계약에 없는 사항은 서로 협의해 관례에 따른다.",
        260,
    ),
    ConnectorLine("부속 합의서는 이 계약과 같은 효력을 가진다.", "부속 합의서는 계약과 같은 효력을 가진다.", 200),
]

# 1쪽은 가로 쪽 행이다. A는 세로 A4를 /Rotate 90으로 눕히고 글자를 돌려 그려 화면에서 바로 선다
# (화면 위 → 아래가 사용자 공간 x가 커지는 쪽). B는 가로 MediaBox에 그냥 쓴다. A 첫 줄의 변경은 줄
# 앞쪽, 둘째 줄의 변경은 줄 뒤쪽이라 사용자 공간 위쪽 모서리 순서로는 둘째 줄이 먼저다. 화면 방향
# 읽는 순서로는 첫 줄이 먼저라 두 변경이 한 묶음이다. 셋째 줄은 멀리 떨어져 따로다.
CONNECTOR_LANDSCAPE_TEXT = [
    ("제8조(검수) 7일 안에 갑은 산출물을 모두 검수한다.", "제8조(검수) 10일 안에 갑은 산출물을 모두 검수한다."),
    (
        "검수에 떨어진 산출물은 을이 고쳐 다시 넘기되 5일을 넘기지 않는다.",
        "검수에 떨어진 산출물은 을이 고쳐 다시 넘기되 3일을 넘기지 않는다.",
    ),
    ("이 조항은 2026년 10월 13일부터 적용한다.", "이 조항은 2027년 10월 13일부터 적용한다."),
]
# A(돌려 그린 줄): 줄마다 사용자 공간 x, 줄 시작 y
CONNECTOR_ROTATED_LINE_X = (120, 120 + CONNECTOR_LINE_GAP, 240)
CONNECTOR_ROTATED_START_Y = 80
# B(가로 MediaBox): 줄마다 기준선 y
A4_LANDSCAPE_MEDIA_BOX = (0, 0, 842, 595)
CONNECTOR_LANDSCAPE_LINE_Y = (515, 515 - CONNECTOR_LINE_GAP, 395)


def connector_pages(side: str) -> list[PageSpec]:
    is_before = side == "before"
    portrait = PageSpec(
        media_box=A4_MEDIA_BOX,
        runs=[
            TextRun(
                CONNECTOR_LEFT,
                line.before_y if is_before or line.after_y is None else line.after_y,
                line.before if is_before else line.after,
                CONNECTOR_FONT_SIZE,
            )
            for line in CONNECTOR_PORTRAIT_LINES
        ],
    )
    if is_before:
        landscape = PageSpec(
            media_box=A4_MEDIA_BOX,
            rotate=90,
            runs=[
                TextRun(x, CONNECTOR_ROTATED_START_Y, before, CONNECTOR_FONT_SIZE, upward=True)
                for x, (before, _) in zip(CONNECTOR_ROTATED_LINE_X, CONNECTOR_LANDSCAPE_TEXT)
            ],
        )
    else:
        landscape = PageSpec(
            media_box=A4_LANDSCAPE_MEDIA_BOX,
            runs=[
                TextRun(CONNECTOR_LEFT, y, after, CONNECTOR_FONT_SIZE)
                for y, (_, after) in zip(CONNECTOR_LANDSCAPE_LINE_Y, CONNECTOR_LANDSCAPE_TEXT)
            ],
        )
    return [portrait, landscape]


def connectors_pdf(side: str) -> bytes:
    specs = connector_pages(side)
    font = korean_font(specs)
    return build_document(specs, font.objects, font.encode)


# --- 앵커·상자 병합(Step 28-b) -------------------------------------------------------

# 0·1쪽은 한 단 본문이다. B는 앵커 사례(문서 맨 앞 `전문`, 줄 가운데 `서로의 모든`, 줄 경계 `총`, 쪽
# 경계 `부칙`, 문서 맨 끝 `끝.` 삽입과 줄 가운데 `금` 삭제)와 병합 사례(한 줄 두 낱말 `서로의 모든`,
# 줄을 넘는 삽입 `상대방은 서면으로 통지하고 그 뒤에`)를 둔다. 줄을 넘는 삽입의 둘째 줄은 들여 써서
# (`PLACEMENT_INDENT`) 첫째 줄 상자 왼쪽 끝보다 오른쪽에서 시작한다. 그래야 같은 줄 판정 중 세로
# 겹침만이 두 줄을 가른다. 줄은 문자열(왼쪽 여백에서 시작) 또는 (x, 문자열)이다.
PLACEMENT_INDENT = 72
PLACEMENT_BEFORE_PAGES = [
    [
        "제1조(목적) 이 계약은 갑과 을의 권리와 의무를 정한다.",
        "계약 금액은 금 1,000,000원으로 하고",
        "잔금은 검수를 마친 뒤에 지급한다.",
    ],
    ["제2조(해지) 어느 한쪽이 위반하면 해지할 수 있다.", "이 계약서는 2통을 만든다."],
]
PLACEMENT_AFTER_PAGES = [
    [
        "전문 제1조(목적) 이 계약은 갑과 을의 서로의 모든 권리와 의무를 정한다.",
        "총 계약 금액은 1,000,000원으로 하고",
        "잔금은 검수를 마친 뒤에 지급한다.",
    ],
    [
        "부칙 제2조(해지) 어느 한쪽이 위반하면",
        "상대방은 서면으로 통지하고",
        (PLACEMENT_INDENT, "그 뒤에 해지할 수 있다."),
        "이 계약서는 2통을 만든다. 끝.",
    ],
]
# 2쪽은 두 단이다. 같은 높이의 왼쪽 단 줄과 오른쪽 단 줄을 번갈아 그려(내용 스트림 순서가 글자
# 순서다) 한 변경이 같은 높이의 두 단에 걸치게 한다. B는 왼쪽 단 첫 줄 끝에 `모두`, 오른쪽 단 첫 줄
# 앞에 `또한`을 넣는다. 두 낱말 사이는 단 사이 간격(약 18pt, 흔한 단 간격 0.25인치)이라 글자
# 높이(약 11pt) 기준 병합 한도를 넘어 상자 둘로 남아야 한다.
PLACEMENT_COLUMN_X = (TOKENIZE_LEFT, 208)
PLACEMENT_BEFORE_COLUMNS = [
    ("제3조(갑) 갑은 대금을", "제4조(을) 을은 물품을"),
    ("기한 안에 낸다.", "기한 안에 넘긴다."),
]
PLACEMENT_AFTER_COLUMNS = [
    ("제3조(갑) 갑은 대금을 모두", "또한 제4조(을) 을은 물품을"),
    ("기한 안에 낸다.", "기한 안에 넘긴다."),
]


def column_page(rows: list[tuple[str, str]]) -> PageSpec:
    return PageSpec(
        media_box=A4_MEDIA_BOX,
        runs=[
            TextRun(x, TOKENIZE_TOP - index * TOKENIZE_LINE_GAP, text, TOKENIZE_FONT_SIZE)
            for index, row in enumerate(rows)
            for x, text in zip(PLACEMENT_COLUMN_X, row)
        ],
    )


def placement_runs(lines: list[str | tuple[float, str]]) -> list[TextRun]:
    runs = []
    for index, line in enumerate(lines):
        x, text = line if isinstance(line, tuple) else (TOKENIZE_LEFT, line)
        runs.append(TextRun(x, TOKENIZE_TOP - index * TOKENIZE_LINE_GAP, text, TOKENIZE_FONT_SIZE))
    return runs


def placement_pdf(pages: list[list[str | tuple[float, str]]], columns: list[tuple[str, str]]) -> bytes:
    specs = [PageSpec(media_box=A4_MEDIA_BOX, runs=placement_runs(lines)) for lines in pages]
    specs.append(column_page(columns))
    font = korean_font(specs)
    return build_document(specs, font.objects, font.encode)


def blank_pdf() -> bytes:
    """글자가 없는 A4 한 쪽(반대쪽이 빈 쪽인 앵커 사례)"""
    return build_document([PageSpec(media_box=A4_MEDIA_BOX, runs=[])], HELVETICA, pdf_literal)


# --- 연결선 끝점·띠(Step 28-c) -------------------------------------------------------

# A·B가 같은 쪽 상자·회전을 쓰고 글자만 다르다. 쪽마다 회전·상자가 달라 화면 끝점 변환(회전 0·90·180·270,
# CropBox 오프셋, MediaBox 원점)을 모두 거친다. 글자는 사용자 공간에서 가로로 그린다(병합 회전처럼
# /Rotate로만 돌린 쪽). 사례: 한 줄 치환, 한 줄에 상자가 여럿인 치환(글자 diff), 두 줄 치환(선의 끝),
# 세 줄 치환·세 줄 삽입(띠, 삽입은 앵커 쪽), 줄 가운데·줄 경계 삽입과 삭제(앵커), 쪽 경계를 넘는
# 치환(첫 쪽 상자만 끝이 된다).
@dataclass
class GeometryPage:
    """연결선 끝점 픽스처 한 쪽의 상자·회전과 첫 줄 기준선 시작점(절대 사용자 공간)"""

    media_box: tuple
    crop_box: tuple | None
    rotate: int | None
    left: float
    top: float


CONNECTOR_GEOMETRY_PAGES = [
    # 0: 회전 0 + CropBox 오프셋
    GeometryPage(A4_MEDIA_BOX, (30, 40, 565, 812), None, 60, 760),
    # 1: /Rotate 90 + CropBox 오프셋
    GeometryPage(A4_MEDIA_BOX, (20, 30, 575, 820), 90, 60, 760),
    # 2: /Rotate 180
    GeometryPage(A4_MEDIA_BOX, None, 180, 60, 760),
    # 3: /Rotate 270 + MediaBox 원점 오프셋
    GeometryPage((30, 40, 625, 882), None, 270, 90, 800),
]
CONNECTOR_GEOMETRY_BEFORE = [
    [
        "제1조(대금) 계약 금액은 금 1,000,000원으로 한다.",
        "기간은 2026년 1월 2일부터 3월 4일까지다.",
        "을은 산출물을 갑에게",
        "넘긴다. 그 뒤에 갑이 검수한다.",
        "하자 보증 기간은 일 년이다.",
        "보증금은 대금의 오 퍼센트다.",
        "지체상금은 하루 천분의 일이다.",
        "제2조(해지) 서면으로 통지한다.",
        "이 계약서는 두 통을 만든다.",
    ],
    [
        "제3조(검수) 발주자는 산출물을 받은 날부터",
        "열흘 안에 결과를 알린다.",
        "검수에 떨어지면 을이 고친다.",
        "고친 산출물은 다시 검수한다.",
    ],
    [
        "제4조(비밀) 을은 알게 된 정보를",
        "남에게 알리지 아니한다.",
        "이 의무는 삼 년간 이어진다.",
        "제5조(손해) 위반한 쪽이 손해를 물어 준다.",
    ],
    [
        "다만 고의가 없으면 줄인다.",
        "제6조(관할) 분쟁은 갑의 주소지 법원이 맡는다.",
        "이 계약은 서명한 날부터 효력이 생긴다.",
    ],
]
CONNECTOR_GEOMETRY_AFTER = [
    [
        "제1조(대금) 계약 금액은 금 1,500,000원으로 한다.",
        "기간은 2027년 5월 6일부터 7월 8일까지다.",
        "을은 산출물을 병에게",
        "보낸다. 그 뒤에 갑이 검수한다.",
        "유지 보수 범위는 별첨에 따른다.",
        "보수 요청은 문서로 낸다.",
        "응답 시한은 사흘로 정한다.",
        "제2조(해지) 상대방에게 서면으로 통지한다.",
        "이 계약서는 통을 만든다.",
    ],
    [
        "제3조(검수) 발주자는 산출물을 받은 날부터",
        "이레 안에 결과를 알린다.",
        "검수에 떨어지면 을이 바로 고친다.",
        "수정 내역은 별도 대장에",
        "날짜와 담당자를 적어",
        "발주자에게 함께 보인다.",
        "고친 산출물은 검수한다.",
    ],
    [
        "제4조(비밀) 을은 알게 된 정보를",
        "알리지 아니한다.",
        "이 의무는 오 년간 이어진다.",
        "제5조(손해) 위반한 쪽이 손해를 물어 낸다.",
    ],
    [
        "단 고의가 없으면 줄인다.",
        "제6조(관할) 분쟁은 을의 주소지 법원이 맡는다.",
        "이 계약은 양측이 서명한 날부터 효력이 생긴다.",
    ],
]


def connector_geometry_pdf(pages: list[list[str]]) -> bytes:
    specs = [
        PageSpec(
            media_box=page.media_box,
            crop_box=page.crop_box,
            rotate=page.rotate,
            runs=[
                TextRun(page.left, page.top - index * TOKENIZE_LINE_GAP, line, TOKENIZE_FONT_SIZE)
                for index, line in enumerate(lines)
            ],
        )
        for page, lines in zip(CONNECTOR_GEOMETRY_PAGES, pages)
    ]
    font = korean_font(specs)
    return build_document(specs, font.objects, font.encode)


def main() -> None:
    fixtures = {
        "text-geometry.pdf": text_geometry_pdf(),
        "rotation-order.pdf": rotation_order_pdf(),
        "korean-text.pdf": korean_text_pdf(),
        "tokenize-korean.pdf": tokenize_korean_pdf(),
        "diff-base.pdf": diff_pdf(DIFF_BASE_PAGES),
        "diff-edit.pdf": diff_pdf(DIFF_EDIT_PAGES),
        "diff-move.pdf": diff_pdf(DIFF_MOVE_PAGES),
        "diff-rewrap.pdf": diff_pdf(DIFF_REWRAP_PAGES),
        "pages-base.pdf": diff_pdf(PAGES_BASE),
        "pages-insert.pdf": diff_pdf(PAGES_INSERT),
        "pages-delete.pdf": diff_pdf(PAGES_DELETE),
        "pages-edit.pdf": diff_pdf(PAGES_EDIT),
        "pages-push.pdf": diff_pdf(PAGES_PUSH),
        "connectors-a.pdf": connectors_pdf("before"),
        "connectors-b.pdf": connectors_pdf("after"),
        "placement-a.pdf": placement_pdf(PLACEMENT_BEFORE_PAGES, PLACEMENT_BEFORE_COLUMNS),
        "placement-b.pdf": placement_pdf(PLACEMENT_AFTER_PAGES, PLACEMENT_AFTER_COLUMNS),
        "placement-blank.pdf": blank_pdf(),
        "connector-geometry-a.pdf": connector_geometry_pdf(CONNECTOR_GEOMETRY_BEFORE),
        "connector-geometry-b.pdf": connector_geometry_pdf(CONNECTOR_GEOMETRY_AFTER),
    }
    for name, data in fixtures.items():
        (OUTPUT_DIR / name).write_bytes(data)
        print(f"{name}: {len(data)} bytes")


if __name__ == "__main__":
    main()
