//! 스캔 쪽 OCR 공개 API 검증. ONNX Runtime·모델이 없는 환경(`ONNXRUNTIME_LIB_PATH`·`OCR_MODEL_DIR`
//! 미설정, 예: CI)에서는 건너뛴다. 준비: `pnpm fetch:pdfium && pnpm fetch:ocr` 후 세 환경변수를 넘긴다.

use std::path::{Path, PathBuf};

use pdf_core::{OcrEngine, PdfEngine, render_page_for_ocr};

const PDFIUM_LIB_ENV: &str = "PDFIUM_LIB_PATH";
const OCR_ENVS: [&str; 2] = ["ONNXRUNTIME_LIB_PATH", "OCR_MODEL_DIR"];

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("ocr")
        .join(name)
}

/// 쪽 전체 인식 결과를 공백 없이 이어 붙인다.
fn page_text(pdf: &PdfEngine, ocr: &mut OcrEngine, name: &str, page_index: u16) -> String {
    let image = render_page_for_ocr(pdf, &fixture(name), page_index).expect("render scan page");
    ocr.recognize(&image)
        .expect("recognize page")
        .iter()
        .flat_map(|line| line.text.chars())
        .filter(|character| !character.is_whitespace())
        .collect()
}

#[test]
fn reads_amounts_and_dates_through_red_stamp() {
    if OCR_ENVS.iter().any(|name| std::env::var_os(name).is_none()) {
        eprintln!("skipped: set {OCR_ENVS:?} (run `pnpm fetch:ocr`)");
        return;
    }
    assert!(
        std::env::var_os(PDFIUM_LIB_ENV).is_some(),
        "{PDFIUM_LIB_ENV} is required: run `node scripts/fetch-pdfium.mjs` and export it"
    );
    let missing = Path::new("/nonexistent");
    let pdf = PdfEngine::bind(missing).expect("bind pdfium");
    let mut ocr = OcrEngine::load(missing, missing).expect("load OCR runtime and models");

    // 붉은 도장이 금액 줄에 겹친 1쪽(1도 기울어짐): 도장 아래 금액과 표의 날짜가 그대로 읽힌다
    let text = page_text(&pdf, &mut ocr, "contract-a-scan-stamp.pdf", 0);

    assert!(text.contains("금48,750,000원(부가가치세별도)"), "{text}");
    assert!(text.contains("2026.4.30."), "{text}");
}
