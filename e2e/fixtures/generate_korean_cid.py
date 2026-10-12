"""korean-cid.pdf 생성기 (표준 라이브러리만 쓴다).

pdf.js가 cMap 자산(cMapUrl)을 읽어야만 글자를 그릴 수 있는 한글 PDF를 만든다.
- Type0 폰트 + 미리 정의된 CMap `UniKS-UCS2-H`: 문자 코드 → CID 변환에 그 CMap 파일이 필요하다.
- 하위 CIDFont는 `Adobe-Korea1`이고 **임베드하지 않는다**: 글리프는 시스템 글꼴로 대신 그리므로
  CID → 유니코드 변환(`Adobe-Korea1-UCS2` CMap)도 필요하다.
cMap을 못 읽으면 pdf.js는 폰트 로드에 실패하고 글자를 건너뛰어 흰 페이지만 남는다.

재생성: python3 e2e/fixtures/generate_korean_cid.py
"""

from pathlib import Path

OUTPUT_PATH = Path(__file__).with_name("korean-cid.pdf")

PAGE_WIDTH = 595
PAGE_HEIGHT = 842
FONT_SIZE = 120
LINE_LEFT = 60
# 한 줄씩 (y 좌표, 글자). 두 줄이 썸네일의 위쪽 절반을 채운다.
LINES = [(620, "한글"), (440, "가나다")]


def ucs2_hex(text: str) -> str:
    """UniKS-UCS2-H의 문자 코드는 2바이트 UCS-2 값이다."""
    return "".join(f"{ord(character):04X}" for character in text)


def content_stream() -> bytes:
    commands = ["BT", f"/F1 {FONT_SIZE} Tf"]
    for y, text in LINES:
        commands.append(f"1 0 0 1 {LINE_LEFT} {y} Tm <{ucs2_hex(text)}> Tj")
    commands.append("ET")
    return "\n".join(commands).encode("ascii")


def build_objects() -> list[bytes]:
    stream = content_stream()
    return [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
            "/Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>"
        ).encode("ascii"),
        (
            b"<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium-UniKS-UCS2-H "
            b"/Encoding /UniKS-UCS2-H /DescendantFonts [5 0 R] >>"
        ),
        (
            b"<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium "
            b"/CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 1 >> "
            b"/FontDescriptor 6 0 R /DW 1000 >>"
        ),
        (
            b"<< /Type /FontDescriptor /FontName /HYGoThic-Medium /Flags 6 "
            b"/FontBBox [-6 -145 1003 880] /ItalicAngle 0 /Ascent 880 "
            b"/Descent -120 /CapHeight 880 /StemV 93 >>"
        ),
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
    ]


def build_pdf() -> bytes:
    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(build_objects(), start=1):
        offsets.append(len(output))
        output += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref_offset = len(output)
    output += b"xref\n0 %d\n0000000000 65535 f \n" % (len(offsets) + 1)
    for offset in offsets:
        output += b"%010d 00000 n \n" % offset
    output += b"trailer\n<< /Size %d /Root 1 0 R >>\n" % (len(offsets) + 1)
    output += b"startxref\n%d\n%%%%EOF\n" % xref_offset
    return bytes(output)


if __name__ == "__main__":
    OUTPUT_PATH.write_bytes(build_pdf())
    print(f"wrote {OUTPUT_PATH}")
