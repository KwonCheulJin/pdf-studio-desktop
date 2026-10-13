//! 스캔 쪽 OCR을 비교에 연결한 결과 검증(ADR 0001 §5·§11). 픽스처는 `tests/fixtures/ocr/`
//! (`generate_ocr_fixtures.py`)다.
//!
//! OCR이 필요한 테스트는 ONNX Runtime·모델이 없는 환경(`ONNXRUNTIME_LIB_PATH`·`OCR_MODEL_DIR` 미설정,
//! 예: CI)에서 건너뛴다. 준비: `pnpm fetch:pdfium && pnpm fetch:ocr` 후 세 환경변수를 넘긴다.
//! golden은 `UPDATE_GOLDEN=1`로 다시 쓰고 바뀐 변경을 눈으로 확인한다.

mod common;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;

use common::{assert_matches_golden, engine, fixture_path};
use pdf_core::{
    ChangeKind, DIFF_TIME_LIMIT, DocumentText, ExtractedPage, NoTextReason, NormalizeOptions,
    Notice, OcrCache, OcrEngine, OcrFailure, PageRotation, Side, TextBox, TextComparison,
    TextSource, compare_texts, read_document_text,
};
use serde::Serialize;
use similar::{Algorithm, DiffTag, capture_diff_slices};

const OCR_ENVS: [&str; 2] = ["ONNXRUNTIME_LIB_PATH", "OCR_MODEL_DIR"];
const CONTRACT_A: &str = "contract-a.pdf";
/// 텍스트본 A와 같은 계약서의 스캔본(해상도·도장이 다르다)
const SCANS_OF_A: [&str; 3] = [
    "contract-a-scan-300dpi.pdf",
    "contract-a-scan-200dpi.pdf",
    "contract-a-scan-stamp.pdf",
];
/// 금액·날짜·비율·조항 문구를 바꾼 변경본 B의 스캔본
const SCAN_OF_B: &str = "contract-b-scan-300dpi.pdf";
/// 쪽마다 CropBox 오프셋·MediaBox 원점·/Rotate 90·180·270이 다른 텍스트본과 그 스캔본
const GEOMETRY_TEXT: &str = "ocr-geometry.pdf";
const GEOMETRY_SCAN: &str = "ocr-geometry-scan.pdf";
/// OCR 글자 상자를 사방으로 이만큼(pt) 넓히면 같은 글자의 텍스트 레이어 tight 상자 중심을 품어야
/// 한다. OCR 상자는 글자 사이 가운데에서 나눈 줄 높이 상자라 tight 상자보다 크고, 이 값은 글자
/// 나누기의 흔들림(측정 최대 0.85pt 바깥)만 흡수한다. 회전·원점·배율을 잘못 되돌리면 수십 pt가
/// 어긋난다.
const OCR_BOX_TOLERANCE_PT: f32 = 1.0;
/// 화면 방향 줄 묶기: 글자 중심의 세로 위치가 줄 첫 글자와 이만큼(pt) 안이면 같은 줄이다(본문 줄
/// 간격 약 18pt, 끝 마침표처럼 낮은 글자도 같은 줄에 든다).
const SAME_SCREEN_LINE_PT: f32 = 8.0;
/// golden 깊이: 변경 배열 → 변경. 변경 하나가 한 줄이다.
const OCR_CHANGES_GOLDEN_DEPTH: usize = 1;

/// OCR 엔진을 만든다. 런타임·모델 환경변수가 없으면 `None`(건너뛴다).
fn ocr_engine() -> Option<OcrEngine> {
    if OCR_ENVS.iter().any(|name| std::env::var_os(name).is_none()) {
        eprintln!("skipped: set {OCR_ENVS:?} (run `pnpm fetch:ocr`)");
        return None;
    }
    // ONNX Runtime 환경은 프로세스에 하나다. 병렬 테스트가 동시에 붙이지 않게 한다.
    static LOAD: Mutex<()> = Mutex::new(());
    let _guard = LOAD.lock().expect("OCR load lock");
    let missing = Path::new("/nonexistent");
    Some(OcrEngine::load(missing, missing).expect("load OCR runtime and models"))
}

fn ocr_fixture(name: &str) -> PathBuf {
    fixture_path(&format!("ocr/{name}"))
}

fn read(name: &str, ocr: Option<&mut OcrEngine>, cache: Option<&OcrCache>) -> DocumentText {
    read_document_text(
        engine(),
        &ocr_fixture(name),
        ocr,
        cache,
        &AtomicBool::new(false),
    )
    .expect("read document text")
}

fn compare(before: &DocumentText, after: &DocumentText) -> TextComparison {
    compare_texts(before, after, NormalizeOptions::default(), DIFF_TIME_LIMIT)
}

/// 이 테스트만 쓰는 빈 캐시 폴더
fn fresh_cache_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("pdf-core-ocr-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// 런타임·모델이 없으면 스캔 쪽은 텍스트 레이어(글자 없음)로 비교하고, (종류, 쪽, 이유) 조합마다
/// 안내 하나로 알린다. 텍스트본 쪽은 그대로 비교되어 A의 글자가 모두 삭제로 나온다.
#[test]
fn scan_pages_without_ocr_runtime_are_reported_unavailable() {
    let text = read(CONTRACT_A, None, None);
    let scan = read(SCAN_OF_B, None, None);

    let comparison = compare(&text, &scan);

    assert_eq!(
        scan.ocr_failures,
        [0, 1].map(|page| OcrFailure {
            page,
            reason: NoTextReason::OcrUnavailable,
        })
    );
    assert_eq!(
        comparison.page_sources.after,
        vec![Some(TextSource::TextLayer); 2]
    );
    assert_eq!(
        comparison.notices,
        vec![Notice::NoTextLayer {
            side: Side::After,
            reason: NoTextReason::OcrUnavailable,
            pages: vec![0, 1],
        }]
    );
    assert!(
        comparison
            .changes
            .iter()
            .all(|change| change.kind == ChangeKind::Delete),
        "{:#?}",
        comparison.changes
    );
}

/// 같은 계약서의 텍스트본 ↔ 스캔본(300·200dpi, 붉은 도장)은 차이(`needs_review == false`)가 없다.
/// OCR이 빠뜨린 끝 마침표·띄어쓰기, 도장 글자는 확인 필요로만 나온다.
#[test]
fn text_and_scan_of_same_contract_have_no_differences() {
    let Some(mut ocr) = ocr_engine() else {
        return;
    };
    let text = read(CONTRACT_A, None, None);
    for scan_name in SCANS_OF_A {
        let scan = read(scan_name, Some(&mut ocr), None);

        let comparison = compare(&text, &scan);

        assert_eq!(
            comparison.page_sources.after,
            vec![Some(TextSource::Ocr); 2],
            "{scan_name}"
        );
        assert_eq!(comparison.notices, [], "{scan_name}");
        let differences: Vec<_> = comparison
            .changes
            .iter()
            .filter(|change| !change.needs_review)
            .collect();
        assert!(differences.is_empty(), "{scan_name}: {differences:#?}");
    }
}

/// 변경 하나를 글자로 줄인 golden 모양(상자·신뢰도는 OCR 실행마다 조금 흔들릴 수 있어 뺀다)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangeText<'a> {
    kind: ChangeKind,
    before: Option<&'a str>,
    after: Option<&'a str>,
    needs_review: bool,
}

/// 텍스트본 A ↔ 금액·날짜·비율·조항을 바꾼 B의 스캔본: 차이는 바꾼 곳뿐이고, 바꾼 곳은 모두
/// 변경으로 나온다(금액은 OCR 숫자 토큰 신뢰도가 기준 미만이라 확인 필요). 나머지는 OCR의 끝
/// 마침표·띄어쓰기 차이로 확인 필요다.
#[test]
fn edited_scan_reports_edited_places_as_differences() {
    let Some(mut ocr) = ocr_engine() else {
        return;
    };
    let text = read(CONTRACT_A, None, None);
    let scan = read(SCAN_OF_B, Some(&mut ocr), None);

    let comparison = compare(&text, &scan);

    let summary: Vec<ChangeText> = comparison
        .changes
        .iter()
        .map(|change| ChangeText {
            kind: change.kind,
            before: change.before.text(),
            after: change.after.text(),
            needs_review: change.needs_review,
        })
        .collect();
    assert_matches_golden(&summary, "ocr-edit.changes.json", OCR_CHANGES_GOLDEN_DEPTH);
}

/// 같은 파일을 다시 읽으면 캐시의 OCR 결과를 쓴다: OCR 엔진 없이 읽어도 처음과 같은 글자·출처다.
#[test]
fn rereading_same_file_uses_cached_ocr() {
    let Some(mut ocr) = ocr_engine() else {
        return;
    };
    let dir = fresh_cache_dir("reread");
    let cache = OcrCache::new(dir.clone());
    let first = read(SCANS_OF_A[1], Some(&mut ocr), Some(&cache));

    let second = read(SCANS_OF_A[1], None, Some(&cache));

    std::fs::remove_dir_all(&dir).expect("remove cache dir");
    assert_eq!(first.sources, vec![TextSource::Ocr; 2]);
    assert_eq!(second, first);
}

/// OCR 상자를 PDF pt로 되돌린 결과가 원본 텍스트 PDF의 글자 상자와 맞는다: CropBox 오프셋, MediaBox
/// 원점, /Rotate 90·180·270 쪽 모두 같은 글자의 tight 상자 중심이 OCR 상자(± 허용 오차) 안에 있다.
#[test]
fn ocr_boxes_map_back_onto_text_layer_boxes() {
    let Some(mut ocr) = ocr_engine() else {
        return;
    };
    let text = read(GEOMETRY_TEXT, None, None);
    let scan = read(GEOMETRY_SCAN, Some(&mut ocr), None);
    assert_eq!(scan.sources, vec![TextSource::Ocr; text.pages.len()]);

    for (page_number, (text_page, scan_page)) in text.pages.iter().zip(&scan.pages).enumerate() {
        let truth = screen_order_glyphs(text_page);
        let read = screen_order_glyphs(scan_page);
        let truth_chars: Vec<char> = truth.iter().map(|glyph| glyph.0).collect();
        let read_chars: Vec<char> = read.iter().map(|glyph| glyph.0).collect();
        let mut matched = 0;
        let mut misplaced = Vec::new();
        for op in capture_diff_slices(Algorithm::Myers, &truth_chars, &read_chars) {
            let (tag, truth_range, read_range) = op.as_tag_tuple();
            if tag != DiffTag::Equal {
                continue;
            }
            for (truth_index, read_index) in truth_range.zip(read_range) {
                let ((ch, tight), (_, ocr_box)) = (truth[truth_index], read[read_index]);
                matched += 1;
                if !covers_center(&ocr_box, &tight) {
                    misplaced.push((ch, tight, ocr_box));
                }
            }
        }
        // OCR이 빠뜨린 끝 마침표 정도만 짝이 없다.
        assert!(
            matched + 2 >= truth.len(),
            "page {page_number}: matched {matched} of {}",
            truth.len()
        );
        assert!(misplaced.is_empty(), "page {page_number}: {misplaced:#?}");
    }
}

/// `outer`를 [`OCR_BOX_TOLERANCE_PT`]만큼 넓히면 `inner`의 중심을 품는다.
fn covers_center(outer: &TextBox, inner: &TextBox) -> bool {
    let (x, y) = (inner.x + inner.w / 2.0, inner.y + inner.h / 2.0);
    x >= outer.x - OCR_BOX_TOLERANCE_PT
        && x <= outer.x + outer.w + OCR_BOX_TOLERANCE_PT
        && y >= outer.y - OCR_BOX_TOLERANCE_PT
        && y <= outer.y + outer.h + OCR_BOX_TOLERANCE_PT
}

/// (화면 좌표의 글자 중심, 글자, 사용자 공간 상자)
type ScreenGlyph = ((f32, f32), char, TextBox);

/// 쪽의 글자(공백 제외)를 화면에서 읽는 순서(줄 위→아래, 줄 안 왼쪽→오른쪽)로 놓는다. 텍스트
/// 레이어 추출 순서와 OCR 줄 순서가 회전 쪽에서 다를 수 있어, 두 쪽을 같은 기준으로 짝짓는다.
fn screen_order_glyphs(page: &ExtractedPage) -> Vec<(char, TextBox)> {
    let view_box = page.size.view_box;
    let (width, height) = (
        view_box.right - view_box.left,
        view_box.top - view_box.bottom,
    );
    // 사용자 공간 중심 → 화면 좌표(위·왼쪽 원점). `/Rotate`는 시계 방향이다.
    let to_screen = |bounds: &TextBox| {
        let x = bounds.x + bounds.w / 2.0 - view_box.left;
        let y = bounds.y + bounds.h / 2.0 - view_box.bottom;
        match page.size.rotation {
            PageRotation::Degrees0 => (x, height - y),
            PageRotation::Degrees90 => (y, x),
            PageRotation::Degrees180 => (width - x, y),
            PageRotation::Degrees270 => (height - y, width - x),
        }
    };
    let mut glyphs: Vec<ScreenGlyph> = page
        .chars
        .iter()
        .filter(|extracted| !extracted.ch.is_whitespace())
        .filter_map(|extracted| {
            let glyph = extracted.glyph?;
            Some((to_screen(&glyph.bounds), extracted.ch, glyph.bounds))
        })
        .collect();
    glyphs.sort_by(|left, right| left.0.1.total_cmp(&right.0.1));
    let mut lines: Vec<Vec<ScreenGlyph>> = Vec::new();
    for glyph in glyphs {
        match lines.last_mut() {
            Some(line) if (glyph.0.1 - line[0].0.1).abs() <= SAME_SCREEN_LINE_PT => {
                line.push(glyph)
            }
            _ => lines.push(vec![glyph]),
        }
    }
    lines
        .into_iter()
        .flat_map(|mut line| {
            line.sort_by(|left, right| left.0.0.total_cmp(&right.0.0));
            line.into_iter().map(|(_, ch, bounds)| (ch, bounds))
        })
        .collect()
}
