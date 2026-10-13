"""hundred-pages.pdf 생성기 (표준 라이브러리만 쓴다).

비교 결과 화면의 행 가상화 확인용 100쪽 A4 문서. 쪽마다 쪽 번호 한 줄만 표준 글꼴(Helvetica)로
쓴다. 결과 화면이 화면 근처 행만 pdf.js로 그리는지 렌더 캐시 항목 수로 확인한다(`compare-result.spec.ts`).

재생성: python3 e2e/fixtures/generate_hundred_pages.py
"""

from pathlib import Path

OUTPUT_PATH = Path(__file__).with_name("hundred-pages.pdf")

PAGE_COUNT = 100
PAGE_WIDTH = 595
PAGE_HEIGHT = 842
FONT_SIZE = 36
LINE_LEFT = 72
LINE_TOP = 720
# 객체 번호: 1 Catalog, 2 Pages, 3 글꼴, 그 뒤로 쪽마다 (쪽, 내용) 두 개
FIRST_PAGE_OBJECT = 4


def page_object_number(index: int) -> int:
    return FIRST_PAGE_OBJECT + index * 2


def build_objects() -> list[bytes]:
    kids = " ".join(f"{page_object_number(index)} 0 R" for index in range(PAGE_COUNT))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {PAGE_COUNT} >>".encode("ascii"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for index in range(PAGE_COUNT):
        content_number = page_object_number(index) + 1
        stream = (
            f"BT /F1 {FONT_SIZE} Tf {LINE_LEFT} {LINE_TOP} Td (Page {index + 1}) Tj ET"
        ).encode("ascii")
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
                f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_number} 0 R >>"
            ).encode("ascii")
        )
        objects.append(
            b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream)
        )
    return objects


def build_pdf() -> bytes:
    output = bytearray(b"%PDF-1.7\n")
    offsets = []
    for number, body in enumerate(build_objects(), start=1):
        offsets.append(len(output))
        output += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref_offset = len(output)
    output += b"xref\n0 %d\n0000000000 65535 f \n" % (len(offsets) + 1)
    for offset in offsets:
        output += b"%010d 00000 n \n" % offset
    output += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(offsets) + 1,
        xref_offset,
    )
    return bytes(output)


if __name__ == "__main__":
    OUTPUT_PATH.write_bytes(build_pdf())
