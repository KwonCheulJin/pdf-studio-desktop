//! 텍스트 레이어 글자 추출의 golden 검증(ADR 0001 §2 좌표 규칙).
//!
//! golden은 E2E(`e2e/text-box-geometry.spec.ts`)도 그대로 읽어 pdf.js 화면 위치와 맞춰 본다.
//! 픽스처(`generate_compare_fixtures.py`)나 추출 규칙을 바꾸면 `UPDATE_GOLDEN=1`로 다시 쓰고,
//! 바뀐 값을 눈으로 확인한 뒤 E2E까지 통과시킨다.

mod common;

use common::{assert_matches_golden, engine, fixture_path};
use pdf_core::extract_text_layer;

/// 상자 좌표는 CropBox 원점이 들어간 절대 사용자 공간 좌표이고(/Rotate·UserUnit 미적용),
/// view_box(CropBox ∩ MediaBox, 비면 MediaBox) 밖 글자는 빠지며, 글꼴 크기는 Tf·Tm·CTM을
/// 모두 반영하고, 쪽 번호만 있는 쪽은 OCR 대상이다.
#[test]
fn text_geometry_extraction_matches_golden() {
    assert_extraction_matches_golden("text-geometry");
}

/// Identity-H CID 글꼴(임베드 TrueType + ToUnicode)의 한글·숫자·괄호를 회전·CropBox 오프셋
/// 쪽까지 같은 규칙으로 읽는다.
#[test]
fn korean_cid_extraction_matches_golden() {
    assert_extraction_matches_golden("korean-text");
}

/// 같은 내용이면 /Rotate(0·90·180·270)와 상관없이, 글자를 돌려 그리고 /Rotate로 바로 세운
/// 쪽까지 같은 글자 순서를 낸다. 순서가 다르면 회전만 바꾼 문서끼리 비교해도 차이가 생긴다.
#[test]
fn page_rotation_does_not_change_text_order() {
    let pages = extract_text_layer(engine(), &fixture_path("rotation-order.pdf"))
        .expect("extract text layer");
    let texts: Vec<String> = pages
        .iter()
        .map(|page| page.chars.iter().map(|extracted| extracted.ch).collect())
        .collect();

    // 줄 끝 `\r\n`은 pdfium이 만든 줄바꿈이다.
    let content_order = [
        "First line of the clause",
        "Second line follows it",
        "Third line ends here",
    ]
    .join("\r\n");
    for (page_number, text) in texts.iter().enumerate() {
        assert_eq!(text, &content_order, "page {page_number}");
    }
}

/// golden 깊이: 쪽 배열 → 쪽 → `chars` → 글자. 글자 하나가 한 줄이다.
const EXTRACT_GOLDEN_DEPTH: usize = 3;

fn assert_extraction_matches_golden(fixture_stem: &str) {
    let pages = extract_text_layer(engine(), &fixture_path(&format!("{fixture_stem}.pdf")))
        .expect("extract text layer");
    assert_matches_golden(
        &pages,
        &format!("{fixture_stem}.extract.json"),
        EXTRACT_GOLDEN_DEPTH,
    );
}
