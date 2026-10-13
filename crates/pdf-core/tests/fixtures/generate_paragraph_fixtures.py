#!/usr/bin/env python3
"""번역 문단 추출(Step 37, ADR 0002 §2) 픽스처를 이 폴더에 다시 만든다. 표준 라이브러리만 쓰고,
같은 입력이면 항상 같은 바이트를 만든다(타임스탬프 없음). 문장·이름·주소·숫자는 모두 지어낸 것이다.

- paragraphs-zh-hans.pdf(간체 중국어)
  - 0쪽: 한 단. 제목, 첫 줄 들여쓰기 문단(한 줄짜리 포함), 한자 줄과 라틴 줄 잇기, 큰 글자 절 제목,
    목록 머리 여러 가지(`1.`·`（3）`·`②`·`第五条`·`一、`·`•`)와 매단 들여쓰기, 간격만으로 나눈 문단.
  - 1쪽: 스캔 쪽 흉내. 본문은 글꼴 윤곽선을 경로로만 그려 글자층이 없고(화면에는 글이 보인다), 쪽 번호
    도장(`第 2 页`, 공백 아닌 글자 3자)만 글자층이다. 비교 추출의 `needs_ocr` 쪽이다.
  - 2쪽: /Rotate 90 + 위로 돌려 그린 글자. 화면에서는 바로 선 가로 쪽이다.
- paragraphs-zh-hant.pdf(번체 중국어 2단): 0쪽은 두 단을 줄마다 번갈아 쓴 내용 스트림, 1쪽은 같은
  배치를 단 순서로 쓴 내용 스트림이다. 두 쪽의 문단과 순서가 같아야 한다.
- paragraphs-en.pdf(영어)
  - 0쪽: 줄 끝 하이픈(글자 뒤 `co-`는 pdfium이 잇고, 숫자 뒤 `123-`와 홀로 선 `-`는 줄바꿈으로 남는다),
    간격으로 나눈 문단, 목록(`•`·`(a)`·`1)`)과 매단 들여쓰기, 첫 줄 들여쓰기 문단, 작은 글자 각주.
  - 1쪽: /Rotate 90 + 사용자 공간 가로 글자. 화면에서는 옆으로 누운 쪽이다.

글꼴은 Noto Sans SC·TC(SIL OFL 1.1, `fonts/OFL.txt`)의 wght 400 인스턴스에서 이 픽스처의 글자만 남긴
서브셋(`fonts/*-subset.ttf`)을 커밋한 것이다. 원본은 google/fonts 고정 커밋의 가변 글꼴이다.

| 서브셋 | 원본(`https://raw.githubusercontent.com/google/fonts/<커밋>/ofl/…`) | 원본 SHA-256 |
|---|---|---|
| NotoSansSC-Regular-subset.ttf | a85815a42757630ce188fdad368c2dfc444d4773 `notosanssc/NotoSansSC[wght].ttf` | a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da |
| NotoSansTC-Regular-subset.ttf | 3be1884c48c3e45b52ecc725676a08f87776373e `notosanstc/NotoSansTC[wght].ttf` | 864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f |

픽스처 문장을 바꿔 서브셋에 없는 글자가 생기면 서브셋을 다시 만든다(fontTools는 이때만 쓴다).

    python3 generate_paragraph_fixtures.py chars sc > sc.txt
    uvx --from fonttools==4.55.3 fonttools varLib.instancer 'NotoSansSC[wght].ttf' wght=400 -o sc-400.ttf
    uvx --from fonttools==4.55.3 pyftsubset sc-400.ttf --text-file=sc.txt --layout-features= \\
        --no-hinting --output-file=fonts/NotoSansSC-Regular-subset.ttf
    (TC도 같다: `chars tc`, notosanstc)

픽스처 만들기:

    python3 crates/pdf-core/tests/fixtures/generate_paragraph_fixtures.py

픽스처를 바꾸면 golden(`tests/golden/paragraphs-*.paragraphs.json`)도 다시 만든다(`docs/rules/testing.md`).
"""

import struct
import sys
import zlib
from dataclasses import dataclass, field
from pathlib import Path

# 같은 폴더의 생성 스크립트를 불러와도 __pycache__ 를 남기지 않는다.
sys.dont_write_bytecode = True

from generate_compare_fixtures import (  # noqa: E402
    A4_MEDIA_BOX,
    FONT_FLAG_SYMBOLIC,
    FONT_STEM_V,
    GLYPH_SPACE_UNITS,
    LETTER_MEDIA_BOX,
    TextRun,
    TrueTypeFont,
    format_box,
    format_number,
    run_commands,
    serialize_pdf,
    stream_object,
    subset_font,
    to_unicode_cmap,
    unicode_to_glyph,
)

OUTPUT_DIR = Path(__file__).resolve().parent
FONT_DIR = OUTPUT_DIR / "fonts"
SC_FONT_PATH = FONT_DIR / "NotoSansSC-Regular-subset.ttf"
TC_FONT_PATH = FONT_DIR / "NotoSansTC-Regular-subset.ttf"
# 임베드 서브셋 글꼴 이름. 앞 6글자 + `+`는 PDF 서브셋 표기(PDF 32000-1 9.6.4)다.
SC_FONT_NAME = b"PARASC+NotoSansSC-Regular"
TC_FONT_NAME = b"PARATC+NotoSansTC-Regular"

SFNT_HEADER_SIZE = 12
SFNT_TABLE_ENTRY_SIZE = 16

# 글꼴 객체 번호: Type0(3)·CIDFont(4)·FontDescriptor(5)·FontFile2(6)·ToUnicode(7)
FONT_OBJECT = 3
CID_FONT_OBJECT = 4
FONT_DESCRIPTOR_OBJECT = 5
FONT_FILE_OBJECT = 6
TO_UNICODE_OBJECT = 7

# 줄 간격(글자 크기 배수). 한 줄의 기준선에서 다음 줄 기준선까지다.
CHINESE_LINE_PITCH = 1.6
ENGLISH_LINE_PITCH = 1.4

# 'glyf' 단순 글리프 점 플래그와 합성 글리프 플래그(OpenType glyf 표)
ON_CURVE_POINT = 0x01
X_SHORT_VECTOR = 0x02
Y_SHORT_VECTOR = 0x04
REPEAT_FLAG = 0x08
X_IS_SAME_OR_POSITIVE = 0x10
Y_IS_SAME_OR_POSITIVE = 0x20
ARG_1_AND_2_ARE_WORDS = 0x0001
ARGS_ARE_XY_VALUES = 0x0002
SCALE_FLAGS = 0x0008 | 0x0040 | 0x0080
MORE_COMPONENTS = 0x0020
GLYPH_HEADER_SIZE = 10


@dataclass
class Gap:
    """다음 줄 앞에 더 띄우는 거리(pt). 문단 간격이다."""

    points: float


@dataclass
class Line:
    """줄 하나. `x`는 기준선 시작점(들여쓰기 포함)이다."""

    x: float
    text: str
    size: float


@dataclass
class Page:
    runs: list[TextRun]
    media_box: tuple = A4_MEDIA_BOX
    rotate: int | None = None
    # 글자층 없이 윤곽선 경로로만 그리는 줄(스캔 쪽 흉내)
    outlines: list[TextRun] = field(default_factory=list)


def flow(top: float, pitch: float, items: list) -> list[TextRun]:
    """`Line`을 위에서 아래로 놓는다. 다음 줄 기준선은 이 줄 크기 × `pitch`만큼 아래다."""
    runs, y = [], top
    for item in items:
        if isinstance(item, Gap):
            y -= item.points
            continue
        runs.append(TextRun(item.x, y, item.text, item.size))
        y -= item.size * pitch
    return runs


def upward(left: float, pitch: float, items: list) -> list[TextRun]:
    """`flow`와 같은 배치를 위로 돌려 그린다. 글자는 사용자 공간 위쪽으로 가고, 다음 줄은 오른쪽이다.
    `Line.x`는 줄 시작점의 y가 된다(/Rotate 90 화면에서 왼쪽 여백)."""
    runs, x = [], left
    for item in items:
        if isinstance(item, Gap):
            x += item.points
            continue
        runs.append(TextRun(x, item.x, item.text, item.size, upward=True))
        x += item.size * pitch
    return runs


# --- 간체 중국어 -----------------------------------------------------------------------

HANS_BODY = 12
HANS_LEFT = 72
HANS_INDENT = HANS_LEFT + 2 * HANS_BODY

HANS_PAGE_0 = [
    Line(228, "云记事本服务说明", 18),
    Gap(8),
    Line(HANS_INDENT, "云记事本是一款虚构的笔记软件，本文用它说明文档段落的提取规则。", HANS_BODY),
    Line(HANS_LEFT, "用户可以在电脑和手机上创建笔记，并通过网络在多台设备之间同步内容。", HANS_BODY),
    Line(HANS_LEFT, "本文出现的名称、数字和地址都是虚构的，仅供测试使用。", HANS_BODY),
    Line(HANS_INDENT, "软件目前支持的操作系统包括 Windows", HANS_BODY),
    Line(HANS_LEFT, "和 macOS，后续版本计划加入更多平台。", HANS_BODY),
    Line(HANS_INDENT, "安装前请先阅读本说明。", HANS_BODY),
    Line(HANS_INDENT, "如果在使用过程中遇到问题，可以通过设置页面中的反馈入口提交日志，", HANS_BODY),
    Line(HANS_LEFT, "我们会在三个工作日内回复。", HANS_BODY),
    Line(HANS_LEFT, "第一章 安装步骤", 14),
    Line(HANS_LEFT, "1. 从示例网站下载安装包，并保存到本地文件夹。", HANS_BODY),
    Line(HANS_LEFT, "2. 双击安装包，按照屏幕提示完成安装。安装过程中请不要关闭电脑，", HANS_BODY),
    Line(HANS_INDENT, "否则可能需要重新安装。", HANS_BODY),
    Line(HANS_LEFT, "（3）首次启动时登录账号，选择需要同步的文件夹。", HANS_BODY),
    Line(HANS_LEFT, "② 如需离线使用，请在设置中开启本地缓存。", HANS_BODY),
    Line(HANS_LEFT, "第五条 本软件的全部权利归虚构的示例公司所有。", HANS_BODY),
    Line(HANS_LEFT, "一、本说明自发布之日起生效。", HANS_BODY),
    Line(HANS_LEFT, "• 本说明中的示例仅用于测试。", HANS_BODY),
    Gap(10),
    Line(HANS_LEFT, "注意：请定期备份重要笔记。云端同步不能代替本地备份，删除的笔记会在", HANS_BODY),
    Line(HANS_LEFT, "回收站中保留三十天。", HANS_BODY),
    Gap(10),
    Line(HANS_LEFT, "如有其他问题，请发送邮件至 support@example.com。", HANS_BODY),
]

# 스캔 쪽: 윤곽선으로만 그리는 본문과 글자층 쪽 번호 도장
HANS_SCAN_OUTLINES = [
    Line(HANS_LEFT, "第二章 同步设置", 14),
    Line(HANS_INDENT, "开启同步后，笔记会在登录同一账号的所有设备上保持一致。", HANS_BODY),
    Line(HANS_LEFT, "同步频率可以在设置中调整，默认每五分钟同步一次。", HANS_BODY),
    Line(HANS_INDENT, "如果网络不稳定，软件会在恢复连接后自动重试。", HANS_BODY),
]
HANS_SCAN_STAMP = Line(280, "第 2 页", 9)

HANS_ROTATED = [
    Line(HANS_LEFT, "附录 常见问题", 14),
    Line(HANS_INDENT, "问：同步失败时应该怎么办？", HANS_BODY),
    Line(HANS_INDENT, "答：请先检查网络连接，然后在设置页面中点击“立即同步”。如果仍然", HANS_BODY),
    Line(HANS_LEFT, "失败，请重新登录账号。", HANS_BODY),
    Line(HANS_INDENT, "问：一个账号可以在几台设备上使用？", HANS_BODY),
    Line(HANS_INDENT, "答：每个账号最多可以在五台设备上同时使用。", HANS_BODY),
]

HANS_TOP = 770


def hans_pages() -> list[Page]:
    return [
        Page(runs=flow(HANS_TOP, CHINESE_LINE_PITCH, HANS_PAGE_0)),
        Page(
            runs=flow(40, CHINESE_LINE_PITCH, [HANS_SCAN_STAMP]),
            outlines=flow(HANS_TOP, CHINESE_LINE_PITCH, HANS_SCAN_OUTLINES),
        ),
        Page(runs=upward(80, CHINESE_LINE_PITCH, HANS_ROTATED), rotate=90),
    ]


# --- 번체 중국어 2단 ----------------------------------------------------------------------

HANT_BODY = 11
HANT_LEFT_COLUMN = 60
HANT_RIGHT_COLUMN = 315
HANT_INDENT = 2 * HANT_BODY
HANT_TITLE = Line(225, "雲端記事本使用條款", 16)
HANT_TITLE_TOP = 790
HANT_COLUMN_TOP = 750

HANT_LEFT_LINES = [
    (True, "本服務是一項虛構的雲端筆記服務，"),
    (False, "使用者可以在多台裝置之間同步筆記"),
    (False, "內容。"),
    (True, "使用本服務前，請先閱讀並同意本條"),
    (False, "款的全部內容。"),
    (True, "我們會依照法律規定保護使用者的個"),
    (False, "人資料，不會出售給第三方。"),
]
HANT_RIGHT_LINES = [
    (True, "使用者應妥善保管帳號與密碼，因保"),
    (False, "管不當造成的損失由使用者自行負擔。"),
    (True, "本條款如有修改，將在網站上公告，"),
    (False, "公告後繼續使用即視為同意。"),
    (False, "第三條 本條款依虛構地區的法律解釋。"),
]


def column_runs(left: float, lines: list[tuple[bool, str]]) -> list[TextRun]:
    """`(첫 줄 들여쓰기, 글)` 줄들을 단 하나로 놓는다."""
    items = [Line(left + (HANT_INDENT if indented else 0), text, HANT_BODY) for indented, text in lines]
    return flow(HANT_COLUMN_TOP, CHINESE_LINE_PITCH, items)


def hant_pages() -> list[Page]:
    title = flow(HANT_TITLE_TOP, CHINESE_LINE_PITCH, [HANT_TITLE])
    left = column_runs(HANT_LEFT_COLUMN, HANT_LEFT_LINES)
    right = column_runs(HANT_RIGHT_COLUMN, HANT_RIGHT_LINES)
    # 줄마다 왼쪽 단 → 오른쪽 단 순서로 번갈아 쓴다.
    interleaved = [
        run
        for row in range(max(len(left), len(right)))
        for run in (left[row : row + 1] + right[row : row + 1])
    ]
    return [Page(runs=title + interleaved), Page(runs=title + left + right)]


# --- 영어 -----------------------------------------------------------------------------

EN_BODY = 11
EN_LEFT = 72
EN_INDENT = EN_LEFT + 2 * EN_BODY
# `• `의 너비만큼 매단 들여쓰기
EN_HANG = EN_LEFT + EN_BODY
EN_TOP = 720

EN_PAGE_0 = [
    Line(EN_LEFT, "Field Notes Service Guide", 18),
    Gap(6),
    Line(EN_LEFT, "Field Notes is a fictional note-taking service used to test how paragraphs", EN_BODY),
    Line(EN_LEFT, "are extracted from PDF files. Notes can be shared with co-", EN_BODY),
    Line(EN_LEFT, "operating teams, and every account has a support code such as 123-", EN_BODY),
    Line(EN_LEFT, "456 printed on the invoice.", EN_BODY),
    Gap(8),
    Line(EN_LEFT, "Before installing, check that your device has at least 2 GB of free space -", EN_BODY),
    Line(EN_LEFT, "(see the table in the appendix) and a stable network connection.", EN_BODY),
    Gap(6),
    Line(EN_LEFT, "Installation", 14),
    Line(EN_LEFT, "• Download the installer from the example site.", EN_BODY),
    Line(EN_LEFT, "• Run the installer and follow the steps on the screen. The setup may", EN_BODY),
    Line(EN_HANG, "take a few minutes on older devices.", EN_BODY),
    Line(EN_LEFT, "(a) Sign in with your account.", EN_BODY),
    Line(EN_LEFT, "1) Choose the folders to sync.", EN_BODY),
    Gap(8),
    Line(EN_INDENT, "The service keeps deleted notes for thirty days. After that, they are", EN_BODY),
    Line(EN_LEFT, "removed permanently and cannot be restored by the support team.", EN_BODY),
    Line(EN_INDENT, "Backups are created every night.", EN_BODY),
    Line(EN_INDENT, "Contact the support team at support@example.com if you need help with", EN_BODY),
    Line(EN_LEFT, "your account.", EN_BODY),
    Line(EN_LEFT, "All names in this guide are fictional.", 8),
]

EN_PAGE_1 = [
    Line(EN_LEFT, "Appendix: Sync Limits", 14),
    Line(EN_LEFT, "Each account can sync up to five devices at the same time. Older devices", EN_BODY),
    Line(EN_LEFT, "may need an update before they can sign in.", EN_BODY),
    Gap(8),
    Line(EN_LEFT, "Large attachments are uploaded only on Wi-Fi to save mobile data.", EN_BODY),
]


def en_pages() -> list[Page]:
    return [
        Page(runs=flow(EN_TOP, ENGLISH_LINE_PITCH, EN_PAGE_0), media_box=LETTER_MEDIA_BOX),
        Page(
            runs=flow(EN_TOP, ENGLISH_LINE_PITCH, EN_PAGE_1),
            media_box=LETTER_MEDIA_BOX,
            rotate=90,
        ),
    ]


# --- 글꼴 -----------------------------------------------------------------------------


def read_sfnt_tables(path: Path) -> dict[str, bytes]:
    data = path.read_bytes()
    _, table_count = struct.unpack(">IH", data[:6])
    tables = {}
    for index in range(table_count):
        start = SFNT_HEADER_SIZE + index * SFNT_TABLE_ENTRY_SIZE
        tag, _, offset, length = struct.unpack(">4sIII", data[start : start + SFNT_TABLE_ENTRY_SIZE])
        tables[tag.decode("latin-1")] = data[offset : offset + length]
    return tables


@dataclass
class EmbeddedFont:
    """글꼴 객체 3~7(Type0·CIDFont·FontDescriptor·FontFile2·ToUnicode)과 `Tj` 인코딩"""

    cid_by_char: dict[str, int]
    objects: dict[int, bytes]

    def encode(self, line: str) -> bytes:
        return b"<" + b"".join(b"%04X" % self.cid_by_char[char] for char in line) + b">"


def embedded_font(font: TrueTypeFont, name: bytes, pages: list[Page]) -> EmbeddedFont:
    text = "".join(run.text for page in pages for run in page.runs)
    subset = subset_font(font, text)

    def to_glyph_space(value: int) -> int:
        return round(value * GLYPH_SPACE_UNITS / subset.units_per_em)

    widths = b" ".join(b"%d" % to_glyph_space(advance) for advance in subset.advances)
    objects = {
        FONT_OBJECT: b"<< /Type /Font /Subtype /Type0 /BaseFont /%s /Encoding /Identity-H "
        b"/DescendantFonts [%d 0 R] /ToUnicode %d 0 R >>" % (name, CID_FONT_OBJECT, TO_UNICODE_OBJECT),
        CID_FONT_OBJECT: b"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /%s "
        b"/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
        b"/FontDescriptor %d 0 R /CIDToGIDMap /Identity /W [0 [%s]] >>"
        % (name, FONT_DESCRIPTOR_OBJECT, widths),
        FONT_DESCRIPTOR_OBJECT: b"<< /Type /FontDescriptor /FontName /%s /Flags %d /FontBBox %s "
        b"/ItalicAngle 0 /Ascent %d /Descent %d /CapHeight %d /StemV %d /FontFile2 %d 0 R >>"
        % (
            name,
            FONT_FLAG_SYMBOLIC,
            format_box(tuple(to_glyph_space(value) for value in subset.bbox)),
            to_glyph_space(subset.ascent),
            to_glyph_space(subset.descent),
            to_glyph_space(subset.cap_height),
            FONT_STEM_V,
            FONT_FILE_OBJECT,
        ),
        FONT_FILE_OBJECT: stream_object(
            zlib.compress(subset.sfnt, 9), b" /Length1 %d /Filter /FlateDecode" % len(subset.sfnt)
        ),
        TO_UNICODE_OBJECT: stream_object(to_unicode_cmap(subset.cid_by_char)),
    }
    return EmbeddedFont(subset.cid_by_char, objects)


# --- 윤곽선 경로(스캔 쪽 흉내) -----------------------------------------------------------


def contours(font: TrueTypeFont, glyph: int) -> list[list[tuple[int, int, bool]]]:
    """글리프의 윤곽선 점들(글꼴 단위, 곡선 위 점이면 True). 합성 글리프는 성분을 옮겨 합친다."""
    data = font.glyph_data(glyph)
    if len(data) < GLYPH_HEADER_SIZE:
        return []
    (contour_count,) = struct.unpack(">h", data[:2])
    if contour_count < 0:
        return composite_contours(font, data)
    at = GLYPH_HEADER_SIZE
    ends = struct.unpack(">%dH" % contour_count, data[at : at + 2 * contour_count])
    at += 2 * contour_count
    (instruction_length,) = struct.unpack(">H", data[at : at + 2])
    at += 2 + instruction_length
    point_count = ends[-1] + 1
    flags = []
    while len(flags) < point_count:
        flag = data[at]
        at += 1
        flags.append(flag)
        if flag & REPEAT_FLAG:
            flags.extend([flag] * data[at])
            at += 1
    xs, at = read_coordinates(data, at, flags, X_SHORT_VECTOR, X_IS_SAME_OR_POSITIVE)
    ys, _ = read_coordinates(data, at, flags, Y_SHORT_VECTOR, Y_IS_SAME_OR_POSITIVE)
    points = [(x, y, bool(flag & ON_CURVE_POINT)) for x, y, flag in zip(xs, ys, flags)]
    starts = [0] + [end + 1 for end in ends[:-1]]
    return [points[start : end + 1] for start, end in zip(starts, ends)]


def read_coordinates(data: bytes, at: int, flags: list[int], short: int, same_or_positive: int):
    values, value = [], 0
    for flag in flags:
        if flag & short:
            delta = data[at]
            at += 1
            value += delta if flag & same_or_positive else -delta
        elif not flag & same_or_positive:
            (delta,) = struct.unpack(">h", data[at : at + 2])
            at += 2
            value += delta
        values.append(value)
    return values, at


def composite_contours(font: TrueTypeFont, data: bytes) -> list[list[tuple[int, int, bool]]]:
    result, at = [], GLYPH_HEADER_SIZE
    while True:
        flags, component = struct.unpack(">HH", data[at : at + 4])
        at += 4
        if not flags & ARGS_ARE_XY_VALUES or flags & SCALE_FLAGS:
            raise ValueError("only offset composite glyph components are supported")
        if flags & ARG_1_AND_2_ARE_WORDS:
            dx, dy = struct.unpack(">hh", data[at : at + 4])
            at += 4
        else:
            dx, dy = struct.unpack(">bb", data[at : at + 2])
            at += 2
        for contour in contours(font, component):
            result.append([(x + dx, y + dy, on) for x, y, on in contour])
        if not flags & MORE_COMPONENTS:
            return result


def contour_path(contour: list[tuple[int, int, bool]]) -> list[bytes]:
    """TrueType 2차 곡선 윤곽선을 PDF 경로(3차 곡선)로 바꾼다. 곡선 밖 점 둘 사이에는 가운데 곡선 위 점이 있다."""
    if not any(on for _, _, on in contour):
        first, second = contour[0], contour[1]
        contour = [((first[0] + second[0]) / 2, (first[1] + second[1]) / 2, True)] + contour
    start = next(index for index, point in enumerate(contour) if point[2])
    ordered = contour[start:] + contour[:start] + [contour[start]]
    ops = [b"%s %s m" % (format_number(ordered[0][0]), format_number(ordered[0][1]))]
    current, control = ordered[0], None
    for x, y, on in ordered[1:]:
        if on:
            if control is None:
                ops.append(b"%s %s l" % (format_number(x), format_number(y)))
            else:
                ops.append(quadratic_to_cubic(current, control, (x, y)))
            current, control = (x, y), None
        elif control is None:
            control = (x, y)
        else:
            middle = ((control[0] + x) / 2, (control[1] + y) / 2)
            ops.append(quadratic_to_cubic(current, control, middle))
            current, control = middle, (x, y)
    ops.append(b"h")
    return ops


def quadratic_to_cubic(start, control, end) -> bytes:
    first = [start[axis] + 2 / 3 * (control[axis] - start[axis]) for axis in range(2)]
    second = [end[axis] + 2 / 3 * (control[axis] - end[axis]) for axis in range(2)]
    values = (*first, *second, end[0], end[1])
    return b" ".join(format_number(round(value, 2)) for value in values) + b" c"


def outline_commands(font: TrueTypeFont, run: TextRun) -> bytes:
    """줄을 글리프 윤곽선 채우기로 그린다(글자층 없음)."""
    glyph_of = unicode_to_glyph(font.tables["cmap"])
    (units_per_em,) = struct.unpack(">H", font.tables["head"][18:20])
    scale = run.font_size / units_per_em
    commands, x = [], run.x
    for char in run.text:
        glyph = glyph_of[ord(char)]
        path = [op for contour in contours(font, glyph) for op in contour_path(contour)]
        if path:
            commands.append(
                b"q %s 0 0 %s %s %s cm %s f Q"
                % (
                    format_number(round(scale, 6)),
                    format_number(round(scale, 6)),
                    format_number(round(x, 3)),
                    format_number(run.y),
                    b" ".join(path),
                )
            )
        x += font.horizontal_metric(glyph)[0] * scale
    return b"\n".join(commands)


# --- 문서 -----------------------------------------------------------------------------


def paragraph_pdf(font_path: Path, font_name: bytes, pages: list[Page]) -> bytes:
    font = TrueTypeFont(read_sfnt_tables(font_path))
    embedded = embedded_font(font, font_name, pages)
    objects = dict(embedded.objects)
    next_number = max(objects) + 1
    page_numbers = []
    for page in pages:
        page_number, content_number = next_number, next_number + 1
        next_number += 2
        page_numbers.append(page_number)
        parts = [
            b"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 %d 0 R >> >>" % FONT_OBJECT,
            b" /MediaBox " + format_box(page.media_box),
        ]
        if page.rotate is not None:
            parts.append(b" /Rotate %d" % page.rotate)
        parts.append(b" /Contents %d 0 R >>" % content_number)
        objects[page_number] = b"".join(parts)
        content = [outline_commands(font, run) for run in page.outlines]
        content += [run_commands(run, embedded.encode(run.text)) for run in page.runs]
        objects[content_number] = stream_object(zlib.compress(b"\n".join(content), 9), b" /Filter /FlateDecode")

    kids = b" ".join(b"%d 0 R" % number for number in page_numbers)
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[2] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(pages))
    return serialize_pdf(objects)


def fixture_chars(pages: list[Page]) -> str:
    """서브셋에 남길 글자(줄 글자와 윤곽선 글자)"""
    text = "".join(run.text for page in pages for run in page.runs + page.outlines)
    return "".join(sorted(set(text)))


FONT_PAGES = {
    "sc": lambda: hans_pages() + en_pages(),
    "tc": hant_pages,
}


def main() -> None:
    if sys.argv[1:2] == ["chars"]:
        print(fixture_chars(FONT_PAGES[sys.argv[2]]()))
        return
    fixtures = {
        "paragraphs-zh-hans.pdf": paragraph_pdf(SC_FONT_PATH, SC_FONT_NAME, hans_pages()),
        "paragraphs-zh-hant.pdf": paragraph_pdf(TC_FONT_PATH, TC_FONT_NAME, hant_pages()),
        "paragraphs-en.pdf": paragraph_pdf(SC_FONT_PATH, SC_FONT_NAME, en_pages()),
    }
    for name, data in fixtures.items():
        (OUTPUT_DIR / name).write_bytes(data)
        print(f"{name}: {len(data)} bytes")


if __name__ == "__main__":
    main()
