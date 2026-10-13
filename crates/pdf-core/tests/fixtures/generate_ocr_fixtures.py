#!/usr/bin/env python3
"""OCR 스파이크(계획서 §6.4) 픽스처를 tests/fixtures/ocr/ 에 다시 만든다.

직접 쓴 가상 물품 공급 계약서(당사자·주소·금액·날짜 모두 가상)로
1) 한글 OFL 폰트(나눔명조·나눔고딕, 서브셋)를 임베드한 텍스트 PDF(원본 a, 변경본 b)를 만들고
2) pdfium으로 렌더해 스캔본처럼 만든다(기울기, 흐림, 노이즈, 붉은 원 도장, JPEG 압축).
   스캔 PDF 는 쪽마다 이미지 한 장만 있고 텍스트 레이어가 없다.
정답은 텍스트 PDF 자체와, 그 PDF 를 그린 배치 그대로의 줄·글자 칸 TSV, 스캔 조건 TSV 다.
3) 좌표 되돌리기 검증용(P2-4a) ocr-geometry.pdf(텍스트)와 ocr-geometry-scan.pdf(스캔)를 만든다.
   쪽마다 CropBox 오프셋·MediaBox 원점·/Rotate 90·180·270 이 다르고, 스캔 쪽은 텍스트 쪽을 같은
   상자·회전으로 렌더한 이미지를 사용자 공간 방향으로 되돌려 CropBox 에 붙인 것이라 화면에서 똑같이
   보인다. 기울기·노이즈 없이 흐림만 둔다(정답 상자는 텍스트 PDF 의 글자 상자다).

필요한 것
- Python 3.11+, Pillow(기존 픽스처 생성과 같음)
- fontTools: 폰트 서브셋에만 쓴다. 전역 설치 없이 `pip install --target <폴더> fonttools` 후
  PYTHONPATH 로 넘겨도 된다.
- pdfium 라이브러리: `pnpm fetch:pdfium` 후 PDFIUM_LIB_PATH(파일 경로)

    PDFIUM_LIB_PATH=$PWD/src-tauri/pdfium/aarch64-apple-darwin/libpdfium.dylib \\
      python3 crates/pdf-core/tests/fixtures/generate_ocr_fixtures.py

폰트는 고정 커밋 주소에서 받아 SHA-256 을 확인한 뒤 임시 폴더에 둔다.
같은 Pillow·libjpeg·fontTools·pdfium 버전이면 같은 바이트가 나온다(난수는 고정 시드).
"""

import ctypes
import hashlib
import io
import os
import tempfile
import urllib.request
import zlib
from dataclasses import dataclass, field
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

OUTPUT_DIR = Path(__file__).resolve().parent / "ocr"
FONT_CACHE_DIR = Path(tempfile.gettempdir()) / "pdf-studio-ocr-fixture-fonts"
PDFIUM_LIB_ENV = "PDFIUM_LIB_PATH"

# google/fonts 저장소의 고정 커밋(SIL OFL 1.1)
FONTS = {
    "body": {
        "file": "NanumMyeongjo-Regular.ttf",
        "url": "https://raw.githubusercontent.com/google/fonts/"
        "88c1e20fc00d7119afe4d4be3227cf3853ede956/ofl/nanummyeongjo/NanumMyeongjo-Regular.ttf",
        "sha256": "7ed9e8653a8ed04285d51dc343ffea6eb3d9c73afc27383ea8929ee4ffd03205",
        "pdf_name": "NanumMyeongjo",
    },
    "bold": {
        "file": "NanumGothic-Bold.ttf",
        "url": "https://raw.githubusercontent.com/google/fonts/"
        "16680f8688ffcd467d2eb2146a9ce0343404581d/ofl/nanumgothic/NanumGothic-Bold.ttf",
        "sha256": "21f9d3a7f1ca82ca1dc9a288e30138b4f1feb6e71fc89b5a9181fed174b6bbe2",
        "pdf_name": "NanumGothic-Bold",
    },
}
# PDF 폰트 리소스 이름
FONT_RESOURCE = {"body": "F1", "bold": "F2"}
SUBSET_TAG = {"body": "OCRAAA", "bold": "OCRAAB"}

# 쪽 배치(pt). 좌표는 위·왼쪽 원점으로 계산하고 PDF 에 쓸 때만 뒤집는다.
A4 = (595, 842)
MARGIN_LEFT = 70
MARGIN_RIGHT = 70
MARGIN_TOP = 72
MARGIN_BOTTOM = 80
TEXT_WIDTH = A4[0] - MARGIN_LEFT - MARGIN_RIGHT
TITLE_SIZE = 18
HEADING_SIZE = 11
BODY_SIZE = 10.5
LINE_GAP_RATIO = 1.75
PARAGRAPH_GAP = 6
PAGE_NUMBER_BASELINE = A4[1] - 40
# 줄 상자: 기준선 위 ASCENT_RATIO·크기, 아래 DESCENT_RATIO·크기
ASCENT_RATIO = 0.82
DESCENT_RATIO = 0.22
PDF_UNITS_PER_EM = 1000
TABLE_COLUMNS = [0, 70, 190, 330]  # 표 칸 왼쪽 위치(본문 왼쪽 기준)

# 스캔 조건
JPEG_QUALITY = 60
BLUR_RADIUS_PX = 0.6
NOISE_AMPLITUDE = 26  # 균일 노이즈 두 장 평균의 진폭(±13 정도)
NOISE_SEED = b"pdf-studio-ocr-fixture"
WHITE = 255
STAMP_COLOR = (205, 32, 38)
STAMP_RADIUS_PT = 30
STAMP_RING_PT = 2.4
STAMP_TEXT = "가나다"
STAMP_TEXT_SIZE_PT = 13
POINTS_PER_INCH = 72


@dataclass
class Run:
    """한 줄 안에서 같은 폰트로 이어 쓴 글자열."""

    font: str
    size: float
    x: float
    text: str


@dataclass
class Line:
    page: int
    baseline: float
    runs: list[Run]


@dataclass
class Stamp:
    """쪽 위 붉은 원 도장(pt, 위·왼쪽 원점). anchor 줄의 첫 글자 위치에서 dx, dy 만큼 옮긴다."""

    page: int
    anchor: str
    dx: float
    dy: float


@dataclass
class ScanSpec:
    name: str
    source: str
    dpi: int
    skew_degrees: list[float]
    stamps: list[Stamp] = field(default_factory=list)


# ---------------------------------------------------------------------------
# 가상 계약서 문구. 블록 종류: title, heading, para, table, sign, gap
# ---------------------------------------------------------------------------

CONTRACT_A = [
    ("title", "물품 공급 계약서"),
    (
        "para",
        '주식회사 가나다(이하 "갑"이라 한다)와 라마바상사 주식회사(이하 "을"이라 한다)는 '
        "사무용 소모품의 공급에 관하여 다음과 같이 계약을 체결한다.",
    ),
    ("heading", "제1조 (목적)"),
    (
        "para",
        "이 계약은 을이 갑에게 사무용 소모품을 공급하고 갑이 그 대금을 지급하는 데 "
        "필요한 사항을 정함을 목적으로 한다.",
    ),
    ("heading", "제2조 (계약 기간)"),
    (
        "para",
        "계약 기간은 2026년 4월 1일부터 2027년 3월 31일까지로 한다. 기간 만료 30일 전까지 "
        "어느 한쪽이 서면으로 종료 의사를 알리지 않으면 같은 조건으로 1년씩 연장한다.",
    ),
    ("heading", "제3조 (공급 물품과 수량)"),
    (
        "para",
        "공급 물품은 레이저 프린터 토너와 복사 용지로 하며, 월 공급 수량은 토너 120개, "
        "복사 용지 85상자(A4, 2,500매 단위)로 한다.",
    ),
    ("heading", "제4조 (계약 금액)"),
    (
        "para",
        "총 계약 금액은 금 48,750,000원(부가가치세 별도)으로 한다. 단가는 토너 1개당 "
        "27,500원, 복사 용지 1상자당 8,900원이다.",
    ),
    ("heading", "제5조 (대금 지급)"),
    ("para", "갑은 아래 일정에 따라 을이 지정한 계좌로 대금을 지급한다."),
    (
        "table",
        [
            ["회차", "지급일", "금액", "비고"],
            ["1차", "2026. 4. 30.", "16,250,000원", "계약금"],
            ["2차", "2026. 9. 30.", "16,250,000원", "중도금"],
            ["3차", "2027. 3. 31.", "16,250,000원", "잔금"],
        ],
    ),
    ("heading", "제6조 (납품과 검수)"),
    (
        "para",
        "을은 매월 10일까지 갑의 본사 창고로 물품을 납품하고, 갑은 납품일로부터 7일 이내에 "
        "검수를 마친다. 검수에서 불합격한 물품은 을이 14일 이내에 모든 비용을 부담하여 교체한다.",
    ),
    ("heading", "제7조 (지체상금)"),
    (
        "para",
        "을의 사유로 납품이 늦어지면 을은 지체 1일마다 해당 회차 금액의 0.15%를 "
        "지체상금으로 갑에게 지급한다. 다만 지체상금의 합계는 계약 금액의 10%를 넘지 않는다.",
    ),
    ("heading", "제8조 (하자 보증)"),
    (
        "para",
        "하자 보증 기간은 검수 완료일로부터 12개월로 하며, 을은 계약 금액의 3%인 "
        "1,462,500원을 하자보증금으로 갑에게 낸다.",
    ),
    ("heading", "제9조 (비밀 유지)"),
    (
        "para",
        "갑과 을은 이 계약으로 알게 된 상대방의 영업상 정보를 계약 종료 후 3년 동안 "
        "제3자에게 알리지 않는다.",
    ),
    ("heading", "제10조 (계약 해지)"),
    (
        "para",
        "어느 한쪽이 이 계약을 위반하고 상대방의 시정 요구를 받은 날로부터 15일 안에 "
        "고치지 않으면 상대방은 서면 통지로 계약을 해지할 수 있다.",
    ),
    ("heading", "제11조 (분쟁 해결)"),
    (
        "para",
        "이 계약에 관한 분쟁은 서로 협의하여 해결하고, 협의가 되지 않으면 갑의 본점 소재지를 "
        "관할하는 법원을 제1심 법원으로 한다.",
    ),
    (
        "para",
        "이 계약을 증명하기 위하여 계약서 2부를 작성하고 갑과 을이 기명날인한 후 각 1부씩 보관한다.",
    ),
    ("date", "2026년 3월 20일"),
    (
        "sign",
        [
            ["갑", "주식회사 가나다", "대표이사 홍길동 (인)"],
            ["", "서울특별시 가상구 예시로 123", "사업자등록번호 123-45-67890"],
            ["을", "라마바상사 주식회사", "대표이사 김철수 (인)"],
            ["", "부산광역시 샘플구 모의로 45", "사업자등록번호 987-65-43210"],
        ],
    ),
]

# 변경본 b: 금액 한 자리, 날짜, 조항 문구 치환, 단어 삽입·삭제
CONTRACT_B_REPLACEMENTS = [
    ("금 48,750,000원", "금 48,950,000원"),
    ("2026년 4월 1일부터", "2026년 5월 1일부터"),
    ("0.15%를", "0.20%를"),
    ("서면으로 종료 의사를 알리지 않으면", "종료 의사를 서면으로 알리지 않으면"),
    ("검수에서 불합격한", "검수에서 규격 미달로 불합격한"),
    ("모든 비용을", "비용을"),
]

# 좌표 되돌리기 픽스처: 쪽마다 (MediaBox, CropBox, /Rotate). 상자는 [왼쪽, 아래, 오른쪽, 위] pt
GEOMETRY_PAGES = [
    ((0, 0, 595, 842), (36, 48, 559, 794), 0),
    ((0, 0, 595, 842), (40, 60, 560, 800), 90),
    ((0, 0, 595, 842), (0, 0, 595, 842), 180),
    ((50, 60, 645, 902), (80, 100, 620, 880), 270),
]
GEOMETRY_TEXT = [
    "제4조 (계약 금액) 총 계약 금액은 금 48,750,000원(부가가치세 별도)으로 한다.",
    "단가는 토너 1개당 27,500원, 복사 용지 1상자당 8,900원이다.",
    "계약 기간은 2026년 4월 1일부터 2027년 3월 31일까지로 한다.",
    "을은 매월 10일까지 갑의 본사 창고로 물품을 납품한다.",
]
GEOMETRY_MARGIN = 40
GEOMETRY_DPI = 300
GEOMETRY_JPEG_QUALITY = 75
# 쪽 회전(/Rotate, 시계 방향)마다 글자를 화면에서 바로 서게 그리는 텍스트 행렬의 (a, b, c, d)
TEXT_ROTATION_MATRIX = {0: (1, 0, 0, 1), 90: (0, 1, -1, 0), 180: (-1, 0, 0, -1), 270: (0, -1, 1, 0)}
# 화면 방향 렌더 이미지를 사용자 공간 방향으로 되돌리는 PIL 회전(ROTATE_90 은 반시계 90도)
UNROTATE_IMAGE = {
    0: None,
    90: Image.Transpose.ROTATE_90,
    180: Image.Transpose.ROTATE_180,
    270: Image.Transpose.ROTATE_270,
}

SCANS = [
    ScanSpec("contract-a-scan-300dpi", "contract-a", 300, [0.7, -1.2]),
    ScanSpec("contract-a-scan-200dpi", "contract-a", 200, [-0.5, 1.6]),
    ScanSpec(
        "contract-a-scan-stamp",
        "contract-a",
        300,
        [1.0, -0.8],
        [
            # 제4조 금액 줄 위, 서명란 (인) 두 곳
            Stamp(1, "총 계약 금액은", 150, -6),
            Stamp(2, "대표이사 홍길동 (인)", 98, -4),
            Stamp(2, "대표이사 김철수 (인)", 98, -4),
        ],
    ),
    ScanSpec("contract-b-scan-300dpi", "contract-b", 300, [2.0, -0.6]),
]


# ---------------------------------------------------------------------------
# 폰트
# ---------------------------------------------------------------------------


def fetch_font(spec: dict) -> Path:
    FONT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = FONT_CACHE_DIR / spec["file"]
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != spec["sha256"]:
        with urllib.request.urlopen(spec["url"]) as response:
            data = response.read()
        actual = hashlib.sha256(data).hexdigest()
        if actual != spec["sha256"]:
            raise SystemExit(f"{spec['file']} SHA-256 불일치: {actual}")
        path.write_bytes(data)
    return path


class Font:
    def __init__(self, key: str):
        self.key = key
        self.path = fetch_font(FONTS[key])
        self.tt = TTFont(self.path, recalcTimestamp=False)
        self.units_per_em = self.tt["head"].unitsPerEm
        self.cmap = self.tt.getBestCmap()
        self.glyph_order = self.tt.getGlyphOrder()
        self.gid_of_name = {name: index for index, name in enumerate(self.glyph_order)}
        self.hmtx = self.tt["hmtx"]
        self.used: dict[int, str] = {}

    def gid(self, character: str) -> int:
        name = self.cmap.get(ord(character))
        if name is None:
            raise SystemExit(f"{self.key} 폰트에 없는 글자: {character!r}")
        gid = self.gid_of_name[name]
        self.used[gid] = character
        return gid

    def advance(self, character: str) -> float:
        name = self.cmap[ord(character)]
        return self.hmtx[name][0] * PDF_UNITS_PER_EM / self.units_per_em

    def width(self, text: str, size: float) -> float:
        return sum(self.advance(character) for character in text) * size / PDF_UNITS_PER_EM

    def subset_bytes(self) -> bytes:
        options = subset.Options()
        options.retain_gids = True
        options.hinting = False
        options.layout_features = []
        options.notdef_outline = True
        options.name_IDs = []
        options.drop_tables += ["DSIG", "GSUB", "GPOS", "GDEF"]
        font = TTFont(self.path, recalcTimestamp=False)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=[ord(character) for character in self.used.values()])
        subsetter.subset(font)
        output = io.BytesIO()
        font.save(output)
        return output.getvalue()


# ---------------------------------------------------------------------------
# 배치
# ---------------------------------------------------------------------------


def wrap(font: Font, text: str, size: float, width: float) -> list[str]:
    """공백 단위로 줄을 나눈다(숫자·금액이 줄 사이에서 갈리지 않게)."""
    lines, current = [], ""
    for word in text.split(" "):
        candidate = word if not current else f"{current} {word}"
        if current and font.width(candidate, size) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def layout(blocks: list, fonts: dict[str, Font]) -> list[Line]:
    lines: list[Line] = []
    page = 1
    cursor = MARGIN_TOP

    def advance(size: float, rows: int = 1) -> float:
        nonlocal page, cursor
        height = size * LINE_GAP_RATIO * rows
        if cursor + height > A4[1] - MARGIN_BOTTOM:
            page += 1
            cursor = MARGIN_TOP
        baseline = cursor + size * ASCENT_RATIO
        cursor += size * LINE_GAP_RATIO
        return baseline

    for kind, content in blocks:
        if kind == "title":
            width = fonts["bold"].width(content, TITLE_SIZE)
            baseline = advance(TITLE_SIZE)
            x = (A4[0] - width) / 2
            lines.append(Line(page, baseline, [Run("bold", TITLE_SIZE, x, content)]))
            cursor += PARAGRAPH_GAP * 2
        elif kind == "heading":
            # 조 제목과 첫 줄이 다른 쪽으로 갈라지지 않게 두 줄 높이를 확인한다
            baseline = advance(HEADING_SIZE, rows=2)
            lines.append(Line(page, baseline, [Run("bold", HEADING_SIZE, MARGIN_LEFT, content)]))
        elif kind == "para":
            for text in wrap(fonts["body"], content, BODY_SIZE, TEXT_WIDTH):
                baseline = advance(BODY_SIZE)
                lines.append(Line(page, baseline, [Run("body", BODY_SIZE, MARGIN_LEFT, text)]))
            cursor += PARAGRAPH_GAP
        elif kind == "table":
            for row in content:
                baseline = advance(BODY_SIZE)
                runs = [
                    Run("body", BODY_SIZE, MARGIN_LEFT + 20 + TABLE_COLUMNS[index], cell)
                    for index, cell in enumerate(row)
                ]
                lines.append(Line(page, baseline, runs))
            cursor += PARAGRAPH_GAP
        elif kind == "date":
            cursor += PARAGRAPH_GAP * 2
            width = fonts["body"].width(content, BODY_SIZE)
            baseline = advance(BODY_SIZE)
            lines.append(
                Line(page, baseline, [Run("body", BODY_SIZE, (A4[0] - width) / 2, content)])
            )
            cursor += PARAGRAPH_GAP * 2
        elif kind == "sign":
            for row in content:
                baseline = advance(BODY_SIZE)
                columns = [MARGIN_LEFT, MARGIN_LEFT + 30, MARGIN_LEFT + 245]
                runs = [
                    Run("body", BODY_SIZE, columns[index], cell)
                    for index, cell in enumerate(row)
                    if cell
                ]
                lines.append(Line(page, baseline, runs))
                if not row[0]:
                    cursor += PARAGRAPH_GAP * 2
    return lines


def page_count(lines: list[Line]) -> int:
    return max(line.page for line in lines)


def with_page_numbers(lines: list[Line], fonts: dict[str, Font]) -> list[Line]:
    total = page_count(lines)
    numbered = list(lines)
    for page in range(1, total + 1):
        text = f"- {page} -"
        x = (A4[0] - fonts["body"].width(text, BODY_SIZE)) / 2
        numbered.append(Line(page, PAGE_NUMBER_BASELINE, [Run("body", BODY_SIZE, x, text)]))
    return numbered


# ---------------------------------------------------------------------------
# 텍스트 PDF
# ---------------------------------------------------------------------------


def stream_object(data: bytes, extra: bytes = b"") -> bytes:
    compressed = zlib.compress(data, 9)
    return (
        b"<< /Length %d /Filter /FlateDecode%s >>\nstream\n" % (len(compressed), extra)
        + compressed
        + b"\nendstream"
    )


def to_unicode_cmap(used: dict[int, str]) -> bytes:
    entries = sorted(used.items())
    body = []
    for start in range(0, len(entries), 100):
        chunk = entries[start : start + 100]
        body.append(f"{len(chunk)} beginbfchar")
        for gid, character in chunk:
            utf16 = character.encode("utf-16-be").hex().upper()
            body.append(f"<{gid:04X}> <{utf16}>")
        body.append("endbfchar")
    return (
        "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n"
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n"
        "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n"
        "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
        + "\n".join(body)
        + "\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n"
    ).encode("ascii")


def font_objects(font: Font, first_number: int) -> dict[int, bytes]:
    """Type0(first_number) → CIDFontType2 → FontDescriptor → FontFile2, ToUnicode."""
    type0, cid, descriptor, font_file, to_unicode = range(first_number, first_number + 5)
    head = font.tt["head"]
    scale = PDF_UNITS_PER_EM / font.units_per_em
    bbox = [round(value * scale) for value in (head.xMin, head.yMin, head.xMax, head.yMax)]
    hhea = font.tt["hhea"]
    base_name = f"{SUBSET_TAG[font.key]}+{FONTS[font.key]['pdf_name']}".encode("ascii")
    widths = " ".join(
        f"{gid} [{round(font.hmtx[font.glyph_order[gid]][0] * scale)}]"
        for gid in sorted(font.used)
    ).encode("ascii")
    subset_data = font.subset_bytes()
    return {
        type0: b"<< /Type /Font /Subtype /Type0 /BaseFont /%s /Encoding /Identity-H "
        b"/DescendantFonts [%d 0 R] /ToUnicode %d 0 R >>" % (base_name, cid, to_unicode),
        cid: b"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /%s "
        b"/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
        b"/FontDescriptor %d 0 R /CIDToGIDMap /Identity /DW 1000 /W [%s] >>"
        % (base_name, descriptor, widths),
        descriptor: b"<< /Type /FontDescriptor /FontName /%s /Flags 4 /FontBBox [%s] "
        b"/ItalicAngle 0 /Ascent %d /Descent %d /CapHeight %d /StemV 80 /FontFile2 %d 0 R >>"
        % (
            base_name,
            " ".join(str(value) for value in bbox).encode("ascii"),
            round(hhea.ascent * scale),
            round(hhea.descent * scale),
            round(hhea.ascent * scale),
            font_file,
        ),
        font_file: stream_object(subset_data, b" /Length1 %d" % len(subset_data)),
        to_unicode: stream_object(to_unicode_cmap(font.used)),
    }


def write_pdf(objects: dict[int, bytes], object_count: int) -> bytes:
    output = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for number in sorted(objects):
        offsets[number] = len(output)
        output += b"%d 0 obj\n" % number + objects[number] + b"\nendobj\n"
    xref_offset = len(output)
    output += b"xref\n0 %d\n0000000000 65535 f \n" % object_count
    for number in range(1, object_count):
        output += b"%010d 00000 n \n" % offsets[number]
    output += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        object_count,
        xref_offset,
    )
    return bytes(output)


def content_stream(lines: list[Line], page: int, fonts: dict[str, Font]) -> bytes:
    commands = []
    for line in lines:
        if line.page != page:
            continue
        for run in line.runs:
            font = fonts[run.font]
            glyphs = "".join(f"{font.gid(character):04X}" for character in run.text)
            y = A4[1] - line.baseline
            commands.append(
                f"BT /{FONT_RESOURCE[run.font]} {run.size:g} Tf "
                f"1 0 0 1 {run.x:.2f} {y:.2f} Tm <{glyphs}> Tj ET"
            )
    return "\n".join(commands).encode("ascii")


def text_pdf(lines: list[Line], fonts: dict[str, Font]) -> bytes:
    total = page_count(lines)
    # 콘텐츠를 먼저 만들어야 폰트별로 쓴 글리프가 모인다
    contents = [content_stream(lines, page, fonts) for page in range(1, total + 1)]
    objects: dict[int, bytes] = {}
    font_numbers = {"body": 3, "bold": 8}
    for key, number in font_numbers.items():
        objects.update(font_objects(fonts[key], number))
    next_number = 13
    page_numbers = []
    for content in contents:
        page_number, content_number = next_number, next_number + 1
        next_number += 2
        page_numbers.append(page_number)
        objects[page_number] = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
            b"/Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> /Contents %d 0 R >>"
            % (A4[0], A4[1], font_numbers["body"], font_numbers["bold"], content_number)
        )
        objects[content_number] = stream_object(content)
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    kids = b" ".join(b"%d 0 R" % number for number in page_numbers)
    objects[2] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_numbers))
    return write_pdf(objects, next_number)


def glyph_cells(font: Font, run: Run) -> str:
    """공백이 아닌 글자마다 그려진 가로 칸 `x0:x1`(pt). 글자 상자 정답이다."""
    cells, x = [], run.x
    for character in run.text:
        advance = font.advance(character) * run.size / PDF_UNITS_PER_EM
        if not character.isspace():
            cells.append(f"{x:.2f}:{x + advance:.2f}")
        x += advance
    return ",".join(cells)


def answer_tsv(lines: list[Line], fonts: dict[str, Font]) -> str:
    """정답 줄 목록. 칸: page, x0, top, x1, bottom(pt, 위·왼쪽 원점), char_cells, text.
    한 줄에 칸(표 칸 등)이 여럿이면 칸마다 한 행."""
    rows = ["page\tx0\ttop\tx1\tbottom\tchar_cells\ttext"]
    for line in sorted(lines, key=lambda item: (item.page, item.baseline)):
        for run in line.runs:
            font = fonts[run.font]
            width = font.width(run.text, run.size)
            rows.append(
                f"{line.page}\t{run.x:.2f}\t{line.baseline - run.size * ASCENT_RATIO:.2f}\t"
                f"{run.x + width:.2f}\t{line.baseline + run.size * DESCENT_RATIO:.2f}\t"
                f"{glyph_cells(font, run)}\t{run.text}"
            )
    return "\n".join(rows) + "\n"


# ---------------------------------------------------------------------------
# pdfium 렌더(ctypes)
# ---------------------------------------------------------------------------

FPDF_ANNOT = 0x01
BITMAP_BGRX = 0
BITMAP_BACKGROUND = 0xFFFFFFFF


class Pdfium:
    def __init__(self):
        path = os.environ.get(PDFIUM_LIB_ENV)
        if not path:
            raise SystemExit(f"{PDFIUM_LIB_ENV} 가 필요하다(pnpm fetch:pdfium 후 라이브러리 파일 경로)")
        lib = ctypes.CDLL(path)
        lib.FPDF_InitLibrary()
        lib.FPDF_LoadMemDocument.restype = ctypes.c_void_p
        lib.FPDF_LoadMemDocument.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p]
        lib.FPDF_GetPageCount.argtypes = [ctypes.c_void_p]
        lib.FPDF_LoadPage.restype = ctypes.c_void_p
        lib.FPDF_LoadPage.argtypes = [ctypes.c_void_p, ctypes.c_int]
        lib.FPDFBitmap_Create.restype = ctypes.c_void_p
        lib.FPDFBitmap_Create.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int]
        lib.FPDFBitmap_FillRect.argtypes = [ctypes.c_void_p] + [ctypes.c_int] * 4 + [ctypes.c_ulong]
        lib.FPDF_RenderPageBitmap.argtypes = [ctypes.c_void_p, ctypes.c_void_p] + [ctypes.c_int] * 6
        lib.FPDFBitmap_GetBuffer.restype = ctypes.c_void_p
        lib.FPDFBitmap_GetBuffer.argtypes = [ctypes.c_void_p]
        lib.FPDFBitmap_GetStride.argtypes = [ctypes.c_void_p]
        lib.FPDFBitmap_Destroy.argtypes = [ctypes.c_void_p]
        lib.FPDF_ClosePage.argtypes = [ctypes.c_void_p]
        lib.FPDF_CloseDocument.argtypes = [ctypes.c_void_p]
        self.lib = lib

    def render_pages(self, pdf: bytes, dpi: int) -> list[Image.Image]:
        """쪽마다 화면 크기(CropBox, /Rotate 적용)로 렌더한다."""
        lib = self.lib
        lib.FPDF_GetPageWidthF.restype = ctypes.c_float
        lib.FPDF_GetPageWidthF.argtypes = [ctypes.c_void_p]
        lib.FPDF_GetPageHeightF.restype = ctypes.c_float
        lib.FPDF_GetPageHeightF.argtypes = [ctypes.c_void_p]
        buffer = ctypes.create_string_buffer(pdf, len(pdf))
        document = lib.FPDF_LoadMemDocument(buffer, len(pdf), None)
        if not document:
            raise SystemExit("pdfium 이 텍스트 PDF 를 열지 못함")
        images = []
        for index in range(lib.FPDF_GetPageCount(document)):
            page = lib.FPDF_LoadPage(document, index)
            width = round(lib.FPDF_GetPageWidthF(page) * dpi / POINTS_PER_INCH)
            height = round(lib.FPDF_GetPageHeightF(page) * dpi / POINTS_PER_INCH)
            bitmap = lib.FPDFBitmap_Create(width, height, BITMAP_BGRX)
            lib.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, BITMAP_BACKGROUND)
            lib.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, FPDF_ANNOT)
            stride = lib.FPDFBitmap_GetStride(bitmap)
            raw = ctypes.string_at(lib.FPDFBitmap_GetBuffer(bitmap), stride * height)
            image = Image.frombuffer("RGB", (width, height), raw, "raw", "BGRX", stride, 1)
            images.append(image.copy())
            lib.FPDFBitmap_Destroy(bitmap)
            lib.FPDF_ClosePage(page)
        lib.FPDF_CloseDocument(document)
        return images

    def render(self, pdf: bytes, dpi: int) -> list[Image.Image]:
        lib = self.lib
        buffer = ctypes.create_string_buffer(pdf, len(pdf))
        document = lib.FPDF_LoadMemDocument(buffer, len(pdf), None)
        if not document:
            raise SystemExit("pdfium 이 텍스트 PDF 를 열지 못함")
        width, height = pixel_size(dpi)
        images = []
        for index in range(lib.FPDF_GetPageCount(document)):
            page = lib.FPDF_LoadPage(document, index)
            bitmap = lib.FPDFBitmap_Create(width, height, BITMAP_BGRX)
            lib.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, BITMAP_BACKGROUND)
            lib.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, FPDF_ANNOT)
            stride = lib.FPDFBitmap_GetStride(bitmap)
            raw = ctypes.string_at(lib.FPDFBitmap_GetBuffer(bitmap), stride * height)
            image = Image.frombuffer("RGB", (width, height), raw, "raw", "BGRX", stride, 1)
            images.append(image.copy())
            lib.FPDFBitmap_Destroy(bitmap)
            lib.FPDF_ClosePage(page)
        lib.FPDF_CloseDocument(document)
        return images


def pixel_size(dpi: int) -> tuple[int, int]:
    return (round(A4[0] * dpi / POINTS_PER_INCH), round(A4[1] * dpi / POINTS_PER_INCH))


# ---------------------------------------------------------------------------
# 스캔 흉내
# ---------------------------------------------------------------------------


def noise_layer(size: tuple[int, int], label: str) -> Image.Image:
    """시드로 고정한 균일 노이즈 두 장의 평균(가운데가 높은 분포). 128 이 0 이다."""
    count = size[0] * size[1]

    def uniform(index: int) -> Image.Image:
        stream = bytearray()
        counter = 0
        seed = NOISE_SEED + label.encode() + bytes([index])
        while len(stream) < count:
            stream += hashlib.sha256(seed + counter.to_bytes(8, "big")).digest()
            counter += 1
        return Image.frombytes("L", size, bytes(stream[:count]))

    averaged = ImageChops.add(uniform(0), uniform(1), scale=2)
    return averaged.point(lambda value: round((value - 128) * NOISE_AMPLITUDE / 128) + 128)


def stamp_layer(size: tuple[int, int], dpi: int, centers: list[tuple[float, float]]) -> Image.Image:
    """흰 바탕에 붉은 원 도장. 곱하기로 합성하므로 검은 글자는 검게 남고 흰 바탕만 붉어진다."""
    layer = Image.new("RGB", size, (WHITE, WHITE, WHITE))
    draw = ImageDraw.Draw(layer)
    scale = dpi / POINTS_PER_INCH
    radius = STAMP_RADIUS_PT * scale
    ring = round(STAMP_RING_PT * scale)
    font = ImageFont.truetype(str(fetch_font(FONTS["bold"])), round(STAMP_TEXT_SIZE_PT * scale))
    for cx_pt, cy_pt in centers:
        cx, cy = cx_pt * scale, cy_pt * scale
        draw.ellipse(
            (cx - radius, cy - radius, cx + radius, cy + radius), outline=STAMP_COLOR, width=ring
        )
        draw.text((cx, cy), STAMP_TEXT, fill=STAMP_COLOR, font=font, anchor="mm")
    return layer


def stamp_center(stamp: Stamp, lines: list[Line]) -> tuple[float, float]:
    for line in lines:
        for run in line.runs:
            if line.page == stamp.page and run.text.startswith(stamp.anchor):
                return (run.x + stamp.dx, line.baseline - run.size / 2 + stamp.dy)
    raise SystemExit(f"도장 기준 줄을 찾지 못함: {stamp.anchor}")


def degrade(
    image: Image.Image, dpi: int, skew: float, stamps: list[tuple[float, float]], label: str
) -> Image.Image:
    colored = bool(stamps)
    page = image if colored else image.convert("L")
    if stamps:
        page = ImageChops.multiply(page, stamp_layer(page.size, dpi, stamps))
    fill = (WHITE, WHITE, WHITE) if colored else WHITE
    # 양수 각도는 반시계 방향, 쪽 가운데를 중심으로 돌린다
    page = page.rotate(skew, resample=Image.Resampling.BICUBIC, fillcolor=fill)
    page = page.filter(ImageFilter.GaussianBlur(BLUR_RADIUS_PX))
    noise = noise_layer(page.size, label)
    if colored:
        noise = Image.merge("RGB", [noise, noise, noise])
    return ImageChops.add(page, noise, scale=1, offset=-128)


def jpeg_bytes(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return output.getvalue()


def image_pdf(pages: list[Image.Image]) -> bytes:
    """쪽마다 JPEG 한 장(DCTDecode)만 있는 PDF. 텍스트 레이어가 없다."""
    objects: dict[int, bytes] = {1: b"<< /Type /Catalog /Pages 2 0 R >>"}
    next_number = 3
    page_numbers = []
    for page in pages:
        page_number, content_number, image_number = next_number, next_number + 1, next_number + 2
        next_number += 3
        page_numbers.append(page_number)
        data = jpeg_bytes(page)
        color_space = b"/DeviceRGB" if page.mode == "RGB" else b"/DeviceGray"
        objects[page_number] = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
            b"/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>"
            % (A4[0], A4[1], image_number, content_number)
        )
        content = b"q %d 0 0 %d 0 0 cm /Im0 Do Q" % A4
        objects[content_number] = b"<< /Length %d >>\nstream\n%s\nendstream" % (
            len(content),
            content,
        )
        objects[image_number] = (
            b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s "
            b"/BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n"
            % (page.width, page.height, color_space, len(data))
            + data
            + b"\nendstream"
        )
    kids = b" ".join(b"%d 0 R" % number for number in page_numbers)
    objects[2] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_numbers))
    return write_pdf(objects, next_number)


def scans_tsv(entries: list[tuple[ScanSpec, list[tuple[float, float]]]]) -> str:
    """스캔 조건. 칸: file, page, dpi, skew_degrees(양수=반시계), stamps(cx,cy,r pt; 위·왼쪽 원점, 없으면 -)"""
    rows = ["file\tpage\tdpi\tskew_degrees\tstamps"]
    for spec, centers in entries:
        for page_index, skew in enumerate(spec.skew_degrees):
            page = page_index + 1
            page_stamps = [
                f"{cx:.2f},{cy:.2f},{STAMP_RADIUS_PT}"
                for stamp, (cx, cy) in zip(spec.stamps, centers)
                if stamp.page == page
            ]
            rows.append(
                f"{spec.name}.pdf\t{page}\t{spec.dpi}\t{skew}\t{';'.join(page_stamps) or '-'}"
            )
    return "\n".join(rows) + "\n"


# ---------------------------------------------------------------------------
# 좌표 되돌리기 픽스처
# ---------------------------------------------------------------------------


def screen_to_user(crop: tuple, rotation: int, x: float, y: float) -> tuple[float, float]:
    """화면 좌표(위·왼쪽 원점, /Rotate 적용 후) → 사용자 공간 좌표. 텍스트 쪽을 그릴 때만 쓴다
    (정답 상자는 이 함수가 아니라 pdfium 이 텍스트 PDF 에서 읽은 글자 상자다)."""
    left, bottom, right, top = crop
    width, height = right - left, top - bottom
    user = {
        0: (x, height - y),
        90: (y, x),
        180: (width - x, y),
        270: (width - y, height - x),
    }[rotation]
    return (left + user[0], bottom + user[1])


def screen_size(crop: tuple, rotation: int) -> tuple[float, float]:
    width, height = crop[2] - crop[0], crop[3] - crop[1]
    return (height, width) if rotation in (90, 270) else (width, height)


def geometry_content(font: Font, crop: tuple, rotation: int) -> bytes:
    screen_width, _ = screen_size(crop, rotation)
    a, b, c, d = TEXT_ROTATION_MATRIX[rotation]
    commands = []
    baseline = GEOMETRY_MARGIN
    for paragraph in GEOMETRY_TEXT:
        for text in wrap(font, paragraph, BODY_SIZE, screen_width - 2 * GEOMETRY_MARGIN):
            baseline += BODY_SIZE * LINE_GAP_RATIO
            x, y = screen_to_user(crop, rotation, GEOMETRY_MARGIN, baseline)
            glyphs = "".join(f"{font.gid(character):04X}" for character in text)
            commands.append(
                f"BT /{FONT_RESOURCE['body']} {BODY_SIZE:g} Tf "
                f"{a} {b} {c} {d} {x:.2f} {y:.2f} Tm <{glyphs}> Tj ET"
            )
    return "\n".join(commands).encode("ascii")


def page_boxes(media: tuple, crop: tuple, rotation: int) -> bytes:
    return b"/MediaBox [%s] /CropBox [%s] /Rotate %d" % (
        " ".join(str(value) for value in media).encode("ascii"),
        " ".join(str(value) for value in crop).encode("ascii"),
        rotation,
    )


def geometry_text_pdf(font: Font) -> bytes:
    contents = [geometry_content(font, crop, rotation) for _, crop, rotation in GEOMETRY_PAGES]
    objects: dict[int, bytes] = font_objects(font, 3)
    next_number = 8
    page_numbers = []
    for (media, crop, rotation), content in zip(GEOMETRY_PAGES, contents):
        page_number, content_number = next_number, next_number + 1
        next_number += 2
        page_numbers.append(page_number)
        objects[page_number] = (
            b"<< /Type /Page /Parent 2 0 R %s /Resources << /Font << /F1 3 0 R >> >> "
            b"/Contents %d 0 R >>" % (page_boxes(media, crop, rotation), content_number)
        )
        objects[content_number] = stream_object(content)
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    kids = b" ".join(b"%d 0 R" % number for number in page_numbers)
    objects[2] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_numbers))
    return write_pdf(objects, next_number)


def geometry_scan_pdf(pdfium: "Pdfium", text_pdf_bytes: bytes) -> bytes:
    """텍스트 쪽을 화면 방향으로 렌더하고, 사용자 공간 방향으로 되돌린 이미지를 같은 상자·회전의
    쪽 CropBox 에 붙인다."""
    rendered = pdfium.render_pages(text_pdf_bytes, GEOMETRY_DPI)
    objects: dict[int, bytes] = {1: b"<< /Type /Catalog /Pages 2 0 R >>"}
    next_number = 3
    page_numbers = []
    for (media, crop, rotation), image in zip(GEOMETRY_PAGES, rendered):
        page_number, content_number, image_number = next_number, next_number + 1, next_number + 2
        next_number += 3
        page_numbers.append(page_number)
        page = image.convert("L").filter(ImageFilter.GaussianBlur(BLUR_RADIUS_PX))
        if UNROTATE_IMAGE[rotation] is not None:
            page = page.transpose(UNROTATE_IMAGE[rotation])
        output = io.BytesIO()
        page.save(output, "JPEG", quality=GEOMETRY_JPEG_QUALITY, optimize=True)
        data = output.getvalue()
        objects[page_number] = (
            b"<< /Type /Page /Parent 2 0 R %s /Resources << /XObject << /Im0 %d 0 R >> >> "
            b"/Contents %d 0 R >>" % (page_boxes(media, crop, rotation), image_number, content_number)
        )
        left, bottom, right, top = crop
        content = b"q %d 0 0 %d %d %d cm /Im0 Do Q" % (right - left, top - bottom, left, bottom)
        objects[content_number] = b"<< /Length %d >>\nstream\n%s\nendstream" % (
            len(content),
            content,
        )
        objects[image_number] = (
            b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray "
            b"/BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n"
            % (page.width, page.height, len(data))
            + data
            + b"\nendstream"
        )
    kids = b" ".join(b"%d 0 R" % number for number in page_numbers)
    objects[2] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_numbers))
    return write_pdf(objects, next_number)


def contract_b() -> list:
    blocks = []
    for kind, content in CONTRACT_A:
        if kind == "para":
            for before, after in CONTRACT_B_REPLACEMENTS:
                content = content.replace(before, after)
        blocks.append((kind, content))
    return blocks


def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    pdfium = Pdfium()
    documents = {}
    for name, blocks in (("contract-a", CONTRACT_A), ("contract-b", contract_b())):
        fonts = {key: Font(key) for key in FONTS}
        lines = with_page_numbers(layout(blocks, fonts), fonts)
        pdf = text_pdf(lines, fonts)
        documents[name] = (pdf, lines)
        (OUTPUT_DIR / f"{name}.pdf").write_bytes(pdf)
        (OUTPUT_DIR / f"{name}.tsv").write_text(answer_tsv(lines, fonts), encoding="utf-8")
        print(f"{name}.pdf: {len(pdf)} bytes, {page_count(lines)} pages")

    entries = []
    for spec in SCANS:
        pdf, lines = documents[spec.source]
        rendered = pdfium.render(pdf, spec.dpi)
        if len(rendered) != len(spec.skew_degrees):
            raise SystemExit(f"{spec.name}: 쪽 수({len(rendered)})와 기울기 수가 다름")
        centers = [stamp_center(stamp, lines) for stamp in spec.stamps]
        pages = [
            degrade(
                image,
                spec.dpi,
                skew,
                [center for stamp, center in zip(spec.stamps, centers) if stamp.page == index + 1],
                f"{spec.name}-{index}",
            )
            for index, (image, skew) in enumerate(zip(rendered, spec.skew_degrees))
        ]
        data = image_pdf(pages)
        (OUTPUT_DIR / f"{spec.name}.pdf").write_bytes(data)
        entries.append((spec, centers))
        print(f"{spec.name}.pdf: {len(data)} bytes")
    (OUTPUT_DIR / "scans.tsv").write_text(scans_tsv(entries), encoding="utf-8")

    geometry_text = geometry_text_pdf(Font("body"))
    (OUTPUT_DIR / "ocr-geometry.pdf").write_bytes(geometry_text)
    geometry_scan = geometry_scan_pdf(pdfium, geometry_text)
    (OUTPUT_DIR / "ocr-geometry-scan.pdf").write_bytes(geometry_scan)
    print(f"ocr-geometry.pdf: {len(geometry_text)} bytes, ocr-geometry-scan.pdf: {len(geometry_scan)} bytes")


if __name__ == "__main__":
    main()
