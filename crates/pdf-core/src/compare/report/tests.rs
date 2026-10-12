//! 리포트 내보내기 검증(ADR 0001 §14). 만든 PDF를 pdfium으로 다시 열어 장·상자·주석을 확인하므로
//! pdfium 핸들(`PdfEngine::pdfium`, crate 안 공개)이 필요해 통합 테스트가 아닌 이 모듈에 둔다.
//! 입력은 실제 파이프라인(추출 → 토큰화 → diff → 쪽 짝짓기)으로 만든 결과이고, 기대값은 결과
//! 모델과 출력 쪽에서 pdfium이 다시 뽑은 글자 위치로 세운다(배치 계산을 다시 구현하지 않는다).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::AtomicBool;

use pdfium_render::prelude::{
    PdfColor, PdfDocument, PdfPage, PdfPageAnnotationCommon, PdfPageAnnotationType,
    PdfPageObjectCommon, PdfPageObjectsCommon, PdfPathFillMode,
};

use super::super::extract::ExtractedPage;
use super::super::model::{
    Change, ChangeKind, ChangeSide, CompareResult, PagePair, PageSizes, PageSources, TextBox,
    TextSource,
};
use super::super::{
    DIFF_TIME_LIMIT, NormalizeOptions, diff_tokens, extract_text_layer, pair_pages, tokenize,
};
use super::{
    CHANGE_STROKE, CompareReportOptions, ReportError, ReportLayout, ReportSources,
    export_annotated_pdf, export_compare_pdf, preview_compare_report,
};
use crate::engine::PdfEngine;
use crate::info::PageBox;
use crate::ocr::{OCR_RENDER_DPI, render_page_for_ocr};

const LIBRARY_PATH_ENV: &str = "PDFIUM_LIB_PATH";
/// 장 좌표 허용 오차(pt): 상자 여백 1pt + 선 굵기(경로 경계에 선 반쪽과 모서리 마이터가 들어가며
/// 확인 필요 선은 1.5pt) + 부동소수점
const SHEET_TOLERANCE_PT: f32 = 3.0;
/// 주석 사각형 허용 오차(pt). 결과 상자를 그대로 쓰므로 부동소수점 차이만 흡수한다.
const ANNOTATION_TOLERANCE_PT: f32 = 0.01;
/// `text-geometry.pdf`의 8쪽: CropBox가 MediaBox와 겹치지 않아 pdfium XObject에 보이는 영역이 없다.
const GEOMETRY_BROKEN_PAGE: u32 = 8;
/// 확인 필요로 표시할 쪽(`/Rotate 90` + CropBox 오프셋)
const GEOMETRY_REVIEW_PAGE: u32 = 3;
/// 강조 주석 사각형에서 색이 칠해진 화소 비율의 하한. 글자 화소(검정)를 빼고도 넘는 값이다.
const MIN_HIGHLIGHT_TINT_RATIO: f32 = 0.2;
/// 색이 칠해졌다고 보는 화소의 채널 차이(회색·흰색·검정은 0에 가깝다)
const TINT_CHANNEL_SPREAD: u8 = 25;
/// 상자를 걸 낱말의 최소 글자 수. 짧은 낱말(`-`, `8`)은 장 위에서 같은 글자가 흔해 찾기 어렵다.
const MIN_MARKED_WORD_CHARS: usize = 4;

fn engine() -> &'static PdfEngine {
    static ENGINE: OnceLock<PdfEngine> = OnceLock::new();
    ENGINE.get_or_init(|| {
        assert!(
            std::env::var_os(LIBRARY_PATH_ENV).is_some(),
            "{LIBRARY_PATH_ENV} is required: run `node scripts/fetch-pdfium.mjs` and export it"
        );
        // 번들 폴더는 없는 경로를 준다: 환경변수 경로로 바인딩돼야 통과한다.
        PdfEngine::bind(Path::new("/nonexistent/pdfium")).expect("bind pdfium")
    })
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

/// 테스트마다 비어 있는 새 폴더. 입력 픽스처도 여기로 복사해 쓴다(거부 검사가 깨져도 커밋한 픽스처를
/// 덮지 않게).
fn scratch_dir(test_name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "pdf-core-report-{test_name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).expect("create scratch dir");
    directory
}

fn copy_fixture(name: &str, directory: &Path) -> PathBuf {
    let path = directory.join(name);
    fs::copy(fixture(name), &path).expect("copy fixture");
    path
}

fn page_numbers(pages: &[ExtractedPage]) -> Vec<u32> {
    (0..u32::try_from(pages.len()).expect("page count fits u32")).collect()
}

fn result_from(
    before_pages: &[ExtractedPage],
    after_pages: &[ExtractedPage],
    changes: Vec<Change>,
    page_pairs: Vec<PagePair>,
) -> CompareResult {
    CompareResult {
        changes,
        page_pairs,
        page_sizes: PageSizes {
            before: before_pages.iter().map(|page| page.size).collect(),
            after: after_pages.iter().map(|page| page.size).collect(),
        },
        page_sources: PageSources {
            before: vec![Some(TextSource::TextLayer); before_pages.len()],
            after: vec![Some(TextSource::TextLayer); after_pages.len()],
        },
        notices: Vec::new(),
    }
}

/// 두 픽스처를 실제 파이프라인으로 비교한 결과(비교 범위 = 전체)
fn compare_files(before: &Path, after: &Path) -> CompareResult {
    let before_pages = extract_text_layer(engine(), before).expect("extract before");
    let after_pages = extract_text_layer(engine(), after).expect("extract after");
    let before_tokens = tokenize(&before_pages, NormalizeOptions::default());
    let after_tokens = tokenize(&after_pages, NormalizeOptions::default());
    let diff = diff_tokens(&before_tokens, &after_tokens, DIFF_TIME_LIMIT);
    let page_pairs = pair_pages(
        &page_numbers(&before_pages),
        &page_numbers(&after_pages),
        &before_tokens,
        &after_tokens,
        &diff.matches,
    );
    result_from(&before_pages, &after_pages, diff.changes, page_pairs)
}

fn open_output(path: &Path) -> PdfDocument<'static> {
    engine()
        .pdfium()
        .load_pdf_from_file(path, None)
        .expect("open output")
}

fn rgb(color: PdfColor) -> (u8, u8, u8) {
    (color.red(), color.green(), color.blue())
}

/// 장에 그린 사각형 경로 하나
#[derive(Debug)]
struct DrawnRect {
    bounds: PageBox,
    stroke: (u8, u8, u8),
    filled: bool,
    dashed: bool,
}

fn drawn_rects(page: &PdfPage) -> Vec<DrawnRect> {
    page.objects()
        .iter()
        .filter_map(|object| {
            let path = object.as_path_object()?;
            let bounds = object.bounds().expect("path bounds").to_rect();
            Some(DrawnRect {
                bounds: PageBox {
                    left: bounds.left().value,
                    bottom: bounds.bottom().value,
                    right: bounds.right().value,
                    top: bounds.top().value,
                },
                stroke: rgb(object.stroke_color().expect("stroke color")),
                filled: path.fill_mode().expect("fill mode") != PdfPathFillMode::None,
                dashed: !object.dash_array().expect("dash array").is_empty(),
            })
        })
        .collect()
}

fn contains(outer: PageBox, inner: PageBox, tolerance: f32) -> bool {
    inner.left >= outer.left - tolerance
        && inner.bottom >= outer.bottom - tolerance
        && inner.right <= outer.right + tolerance
        && inner.top <= outer.top + tolerance
}

fn page_box(bounds: &TextBox) -> PageBox {
    PageBox {
        left: bounds.x,
        bottom: bounds.y,
        right: bounds.x + bounds.w,
        top: bounds.y + bounds.h,
    }
}

fn union(first: PageBox, second: PageBox) -> PageBox {
    PageBox {
        left: first.left.min(second.left),
        bottom: first.bottom.min(second.bottom),
        right: first.right.max(second.right),
        top: first.top.max(second.top),
    }
}

/// 회전·CropBox 오프셋·MediaBox 원점·`UserUnit` 쪽마다 낱말 하나에 상자를 건 결과를 나란히 내보내면,
/// 장에 그린 상자 두 개(A·B)가 각각 출력 장에서 pdfium이 다시 뽑은 그 낱말 글자들을 덮는다.
#[test]
fn boxes_cover_the_same_glyphs_on_rotated_and_offset_pages() {
    let directory = scratch_dir("geometry");
    let source = copy_fixture("text-geometry.pdf", &directory);
    let pages = extract_text_layer(engine(), &source).expect("extract");
    let tokens = tokenize(&pages, NormalizeOptions::default());

    let mut changes = Vec::new();
    for page in page_numbers(&pages) {
        let word = tokens.iter().find(|token| {
            token.key_boxes.len() >= MIN_MARKED_WORD_CHARS
                && token.key_boxes.iter().all(|bounds| bounds.page == page)
        });
        let Some(word) = word.filter(|_| page != GEOMETRY_BROKEN_PAGE) else {
            continue;
        };
        let bounds = word
            .key_boxes
            .iter()
            .copied()
            .reduce(|first, second| {
                let joined = union(page_box(&first), page_box(&second));
                TextBox {
                    page,
                    x: joined.left,
                    y: joined.bottom,
                    w: joined.right - joined.left,
                    h: joined.top - joined.bottom,
                }
            })
            .expect("word has boxes");
        let side = ChangeSide {
            text: word.text.clone(),
            boxes: vec![bounds],
            min_confidence: None,
        };
        changes.push(Change {
            id: page.to_string(),
            kind: ChangeKind::Replace,
            before: Some(side.clone()),
            after: Some(side),
            page_pair: (Some(page), Some(page)),
            needs_review: page == GEOMETRY_REVIEW_PAGE,
        });
    }
    let rows: Vec<PagePair> = page_numbers(&pages)
        .into_iter()
        .map(|page| (Some(page), Some(page)))
        .collect();
    let result = result_from(&pages, &pages, changes, rows.clone());
    let sources = ReportSources {
        before: source.clone(),
        after: source,
    };
    let output = directory.join("geometry-report.pdf");

    let report = export_compare_pdf(
        engine(),
        &result,
        &sources,
        &CompareReportOptions::default(),
        &output,
        &AtomicBool::new(false),
    )
    .expect("export");

    assert_eq!(report.sheet_count as usize, rows.len());
    let document = open_output(&output);
    let sheet_chars = extract_text_layer(engine(), &output).expect("extract output");
    for change in &result.changes {
        let page = change.page_pair.0.expect("before page");
        let sheet = document.pages().get(page as i32).expect("sheet");
        let boxes: Vec<DrawnRect> = drawn_rects(&sheet)
            .into_iter()
            .filter(|rect| rect.stroke == rgb(CHANGE_STROKE))
            .collect();
        assert_eq!(boxes.len(), 2, "page {page}: one box on A and one on B");
        let word: String = change.before.as_ref().expect("before").text.clone();
        for drawn in &boxes {
            // 변경은 점선, 확인 필요는 채우지 않는다.
            assert!(drawn.dashed, "page {page}: replace boxes are dashed");
            assert_eq!(drawn.filled, !change.needs_review, "page {page}");
            let covered: Vec<_> = sheet_chars[page as usize]
                .chars
                .iter()
                .filter(|extracted| !extracted.ch.is_whitespace())
                .filter_map(|extracted| Some((extracted.ch, page_box(&extracted.glyph?.bounds))))
                .filter(|(_, glyph)| {
                    let center = (
                        (glyph.left + glyph.right) / 2.0,
                        (glyph.bottom + glyph.top) / 2.0,
                    );
                    center.0 > drawn.bounds.left
                        && center.0 < drawn.bounds.right
                        && center.1 > drawn.bounds.bottom
                        && center.1 < drawn.bounds.top
                })
                .collect();
            let text: String = covered.iter().map(|(ch, _)| *ch).collect();
            assert_eq!(text, word, "page {page}: box {:?}", drawn.bounds);
            let glyphs = covered
                .iter()
                .map(|(_, glyph)| *glyph)
                .reduce(union)
                .expect("covered glyphs");
            assert!(
                contains(drawn.bounds, glyphs, 0.0)
                    && contains(glyphs, drawn.bounds, SHEET_TOLERANCE_PT),
                "page {page}: box {:?} does not fit glyphs {glyphs:?}",
                drawn.bounds
            );
        }
    }
}

/// 출력 장 하나에 놓인 원본 글자(공백 제외, 정렬). 장마다 어느 쪽이 놓였는지 알아보는 데 쓴다.
fn sheet_signatures(path: &Path) -> Vec<String> {
    extract_text_layer(engine(), path)
        .expect("extract output")
        .iter()
        .map(|page| signature(page, None))
        .collect()
}

fn signature(page: &ExtractedPage, other: Option<&ExtractedPage>) -> String {
    let mut chars: Vec<char> = [Some(page), other]
        .into_iter()
        .flatten()
        .flat_map(|page| &page.chars)
        .filter(|extracted| extracted.glyph.is_some() && !extracted.ch.is_whitespace())
        .map(|extracted| extracted.ch)
        .collect();
    chars.sort_unstable();
    chars.into_iter().collect()
}

/// 행이 장에 보이는 쪽에 숨기지 않은 변경 상자를 갖는가(결과 모델로 바로 센다)
fn row_has_visible_box(result: &CompareResult, row: PagePair, hidden: &[ChangeKind]) -> bool {
    result
        .changes
        .iter()
        .filter(|change| !hidden.contains(&change.kind))
        .any(|change| {
            let on = |side: &Option<ChangeSide>, page: Option<u32>| {
                side.as_ref()
                    .is_some_and(|side| side.boxes.iter().any(|bounds| Some(bounds.page) == page))
            };
            on(&change.before, row.0) || on(&change.after, row.1)
        })
}

/// 쪽 삽입 픽스처로 배치 3종과 차이 쪽만·숨긴 종류 필터가 고르는 행을 확인한다. 장마다 놓인 쪽은
/// 출력 장의 글자로 알아본다.
#[test]
fn sheets_follow_layout_and_changed_page_filters() {
    let directory = scratch_dir("sheets");
    let before = copy_fixture("pages-base.pdf", &directory);
    let after = copy_fixture("pages-insert.pdf", &directory);
    let result = compare_files(&before, &after);
    let before_pages = extract_text_layer(engine(), &before).expect("extract before");
    let after_pages = extract_text_layer(engine(), &after).expect("extract after");
    let sources = ReportSources {
        before: before.clone(),
        after: after.clone(),
    };
    let row_signature = |row: PagePair, layout: ReportLayout| {
        let shown_before = (layout != ReportLayout::BOnly)
            .then_some(row.0)
            .flatten()
            .map(|page| &before_pages[page as usize]);
        let shown_after = (layout != ReportLayout::AOnly)
            .then_some(row.1)
            .flatten()
            .map(|page| &after_pages[page as usize]);
        match (shown_before, shown_after) {
            (Some(first), second) => signature(first, second),
            (None, Some(only)) => signature(only, None),
            (None, None) => String::new(),
        }
    };
    let export = |name: &str, options: &CompareReportOptions| {
        let output = directory.join(name);
        export_compare_pdf(
            engine(),
            &result,
            &sources,
            options,
            &output,
            &AtomicBool::new(false),
        )
        .map(|report| (report.sheet_count, sheet_signatures(&output)))
    };
    let expect_rows = |rows: Vec<PagePair>, layout: ReportLayout| -> Vec<String> {
        rows.into_iter()
            .map(|row| row_signature(row, layout))
            .collect()
    };

    let inserted_row = (None, Some(2));
    assert!(
        result.page_pairs.contains(&inserted_row),
        "{:?}",
        result.page_pairs
    );

    for layout in [
        ReportLayout::SideBySide,
        ReportLayout::AOnly,
        ReportLayout::BOnly,
    ] {
        let options = CompareReportOptions {
            layout,
            ..CompareReportOptions::default()
        };
        let rows: Vec<PagePair> = result
            .page_pairs
            .iter()
            .copied()
            .filter(|row| match layout {
                ReportLayout::SideBySide => true,
                ReportLayout::AOnly => row.0.is_some(),
                ReportLayout::BOnly => row.1.is_some(),
            })
            .collect();
        let (count, signatures) = export("all.pdf", &options).expect("export all rows");
        assert_eq!(count as usize, rows.len(), "{layout:?}");
        assert_eq!(signatures, expect_rows(rows, layout), "{layout:?}");
    }

    let changed_rows = |hidden: &[ChangeKind]| -> Vec<PagePair> {
        result
            .page_pairs
            .iter()
            .copied()
            .filter(|&row| row_has_visible_box(&result, row, hidden))
            .collect()
    };
    let all_changed = changed_rows(&[]);
    assert!(all_changed.contains(&inserted_row));
    assert!(all_changed.len() < result.page_pairs.len());
    let changed_only = CompareReportOptions {
        changed_pages_only: true,
        ..CompareReportOptions::default()
    };
    let (_, signatures) = export("changed.pdf", &changed_only).expect("export changed rows");
    assert_eq!(
        signatures,
        expect_rows(all_changed, ReportLayout::SideBySide)
    );

    // 새 쪽은 추가뿐이라 추가를 숨기면 그 행이 빠진다.
    let without_inserts = changed_rows(&[ChangeKind::Insert]);
    assert!(!without_inserts.contains(&inserted_row));
    let hide_inserts = CompareReportOptions {
        hidden_kinds: vec![ChangeKind::Insert],
        ..changed_only.clone()
    };
    let (_, signatures) = export("no-inserts.pdf", &hide_inserts).expect("export filtered");
    assert_eq!(
        signatures,
        expect_rows(without_inserts, ReportLayout::SideBySide)
    );

    let hide_all = CompareReportOptions {
        hidden_kinds: vec![ChangeKind::Insert, ChangeKind::Delete, ChangeKind::Replace],
        ..changed_only
    };
    assert!(matches!(
        export("empty.pdf", &hide_all),
        Err(ReportError::EmptyReport)
    ));
    assert!(!directory.join("empty.pdf").exists());
}

/// 주석 PDF는 B 사본에 추가·변경(차이)은 B 상자 위치의 강조, 확인 필요는 사각형, 삭제는 메모로 단다.
/// 내용은 변경 전후 글자이고 원본 B는 바뀌지 않는다. 숨긴 종류는 달지 않는다.
#[test]
fn annotated_pdf_marks_after_copy_and_keeps_source() {
    let directory = scratch_dir("annotated");
    let before = copy_fixture("diff-base.pdf", &directory);
    let after = copy_fixture("diff-edit.pdf", &directory);
    let mut result = compare_files(&before, &after);
    let review_index = result
        .changes
        .iter()
        .rposition(|change| change.kind == ChangeKind::Replace)
        .expect("a replace");
    result.changes[review_index].needs_review = true;
    let kinds: Vec<ChangeKind> = result.changes.iter().map(|change| change.kind).collect();
    for kind in [ChangeKind::Insert, ChangeKind::Delete, ChangeKind::Replace] {
        assert!(kinds.contains(&kind), "fixture lacks {kind:?}: {kinds:?}");
    }
    let source_bytes = fs::read(&after).expect("read source");
    let output = directory.join("annotated.pdf");

    let report = export_annotated_pdf(
        engine(),
        &result,
        &after,
        &[],
        &output,
        &AtomicBool::new(false),
    )
    .expect("export");

    assert_eq!(fs::read(&after).expect("read source"), source_bytes);
    let document = open_output(&output);
    let source_document = open_output(&after);
    assert_eq!(document.pages().len(), source_document.pages().len());

    let mut found: Vec<(u32, PdfPageAnnotationType, PageBox, String)> = Vec::new();
    for (page_index, page) in document.pages().iter().enumerate() {
        for annotation in page.annotations().iter() {
            let rect = annotation.bounds().expect("annotation rect");
            found.push((
                page_index as u32,
                annotation.annotation_type(),
                PageBox {
                    left: rect.left().value,
                    bottom: rect.bottom().value,
                    right: rect.right().value,
                    top: rect.top().value,
                },
                annotation.contents().unwrap_or_default(),
            ));
        }
    }
    assert_eq!(report.annotation_count as usize, found.len());

    let mut expected_count = 0;
    for change in &result.changes {
        let before_text = change.before.as_ref().map(|side| side.text.as_str());
        let after_text = change.after.as_ref().map(|side| side.text.as_str());
        let mentions_change = |contents: &str| {
            before_text.is_none_or(|text| contents.contains(text))
                && after_text.is_none_or(|text| contents.contains(text))
        };
        match &change.after {
            Some(after_side) => {
                let expected_type = if change.needs_review {
                    PdfPageAnnotationType::Square
                } else {
                    PdfPageAnnotationType::Highlight
                };
                let page = after_side.boxes[0].page;
                let expected_rect = after_side
                    .boxes
                    .iter()
                    .filter(|bounds| bounds.page == page)
                    .map(page_box)
                    .reduce(union)
                    .expect("boxes");
                assert!(
                    found.iter().any(|(found_page, kind, rect, contents)| {
                        *found_page == page
                            && *kind == expected_type
                            && contains(*rect, expected_rect, ANNOTATION_TOLERANCE_PT)
                            && contains(expected_rect, *rect, ANNOTATION_TOLERANCE_PT)
                            && mentions_change(contents)
                    }),
                    "{change:?} not annotated in {found:?}"
                );
                expected_count += 1;
            }
            None => {
                assert!(
                    found.iter().any(|(_, kind, _, contents)| {
                        *kind == PdfPageAnnotationType::Text && mentions_change(contents)
                    }),
                    "{change:?} has no note in {found:?}"
                );
                expected_count += 1;
            }
        }
    }
    assert_eq!(found.len(), expected_count, "one annotation per change");

    // 강조는 사각형 안을 실제로 칠한다(QuadPoints 순서가 틀리면 pdfium·뷰어가 꼬인 사각형을 그려
    // 거의 칠하지 않는다). 픽스처 쪽은 회전 0, `view_box` 원점 0이다.
    let pixels_per_point = OCR_RENDER_DPI as f32 / 72.0;
    for (page, kind, rect, _) in &found {
        if *kind != PdfPageAnnotationType::Highlight {
            continue;
        }
        let image = render_page_for_ocr(engine(), &output, *page as u16).expect("render");
        let view_top = result.page_sizes.after[*page as usize].view_box.top;
        let to_pixel = |value: f32| (value * pixels_per_point) as u32;
        let (left, right) = (to_pixel(rect.left), to_pixel(rect.right));
        let (top, bottom) = (
            to_pixel(view_top - rect.top),
            to_pixel(view_top - rect.bottom),
        );
        let total = (right - left) * (bottom - top);
        let tinted = (top..bottom)
            .flat_map(|y| (left..right).map(move |x| (x, y)))
            .filter(|&(x, y)| {
                let [red, green, blue] = image.get_pixel(x, y).0;
                red.max(green).max(blue) - red.min(green).min(blue) > TINT_CHANNEL_SPREAD
            })
            .count();
        assert!(
            tinted as f32 >= total as f32 * MIN_HIGHLIGHT_TINT_RATIO,
            "highlight {rect:?} on page {page} is barely painted: {tinted}/{total}"
        );
    }

    let hidden_output = directory.join("no-deletes.pdf");
    let hidden = export_annotated_pdf(
        engine(),
        &result,
        &after,
        &[ChangeKind::Delete],
        &hidden_output,
        &AtomicBool::new(false),
    )
    .expect("export without deletes");
    let deletes = kinds
        .iter()
        .filter(|kind| **kind == ChangeKind::Delete)
        .count();
    assert_eq!(hidden.annotation_count as usize, found.len() - deletes);
}

/// 출력 경로가 비교한 파일이면(`..`로 돌아간 경로 포함) 쓰지 않고 거부한다.
#[test]
fn refuses_to_overwrite_compared_files() {
    let directory = scratch_dir("overwrite");
    let before = copy_fixture("diff-base.pdf", &directory);
    let after = copy_fixture("diff-edit.pdf", &directory);
    let result = compare_files(&before, &after);
    let sources = ReportSources {
        before: before.clone(),
        after: after.clone(),
    };
    let before_bytes = fs::read(&before).expect("read before");
    let after_bytes = fs::read(&after).expect("read after");
    let detour = |path: &Path| {
        directory
            .join("..")
            .join(directory.file_name().expect("dir name"))
            .join(path.file_name().expect("file name"))
    };
    let never = AtomicBool::new(false);

    let compare_over_before = export_compare_pdf(
        engine(),
        &result,
        &sources,
        &CompareReportOptions::default(),
        &detour(&before),
        &never,
    );
    let annotated_over_after =
        export_annotated_pdf(engine(), &result, &after, &[], &detour(&after), &never);

    assert!(matches!(
        compare_over_before,
        Err(ReportError::OutputIsSource { .. })
    ));
    assert!(matches!(
        annotated_over_after,
        Err(ReportError::OutputIsSource { .. })
    ));
    assert_eq!(fs::read(&before).expect("read before"), before_bytes);
    assert_eq!(fs::read(&after).expect("read after"), after_bytes);
}

/// 취소가 켜져 있으면 저장하지 않고 `Cancelled`를 돌려주며 출력·임시 파일이 남지 않는다.
#[test]
fn cancelled_export_leaves_no_files() {
    let directory = scratch_dir("cancel");
    let before = copy_fixture("diff-base.pdf", &directory);
    let after = copy_fixture("diff-edit.pdf", &directory);
    let result = compare_files(&before, &after);
    let output_dir = directory.join("out");
    fs::create_dir(&output_dir).expect("create output dir");
    let cancelled = AtomicBool::new(true);

    let compare = export_compare_pdf(
        engine(),
        &result,
        &ReportSources {
            before,
            after: after.clone(),
        },
        &CompareReportOptions::default(),
        &output_dir.join("report.pdf"),
        &cancelled,
    );
    let annotated = export_annotated_pdf(
        engine(),
        &result,
        &after,
        &[],
        &output_dir.join("annotated.pdf"),
        &cancelled,
    );

    assert!(matches!(compare, Err(ReportError::Cancelled)));
    assert!(matches!(annotated, Err(ReportError::Cancelled)));
    assert_eq!(fs::read_dir(&output_dir).expect("list").count(), 0);
}

/// 미리보기는 첫 N장만 요청한 너비의 PNG로 그리고, 전체 장 수를 함께 준다. 색 상자를 넣으면
/// 그림에 색(회색이 아닌 화소)이 생긴다.
#[test]
fn preview_renders_first_sheets_as_png() {
    let directory = scratch_dir("preview");
    let before = copy_fixture("pages-base.pdf", &directory);
    let after = copy_fixture("pages-insert.pdf", &directory);
    let result = compare_files(&before, &after);
    let sources = ReportSources { before, after };
    let first_changed = CompareReportOptions {
        changed_pages_only: true,
        ..CompareReportOptions::default()
    };
    let width = 600;
    let preview = |options: &CompareReportOptions| {
        preview_compare_report(engine(), &result, &sources, options, 1, width).expect("preview")
    };

    let all_rows = preview_compare_report(
        engine(),
        &result,
        &sources,
        &CompareReportOptions::default(),
        2,
        width,
    )
    .expect("preview all rows");
    let with_boxes = preview(&first_changed);
    let without_boxes = preview(&CompareReportOptions {
        draw_boxes: false,
        ..first_changed.clone()
    });

    assert_eq!(all_rows.sheet_count as usize, result.page_pairs.len());
    assert_eq!(all_rows.images.len(), 2);
    let colored_pixels = |png: &[u8]| {
        let image = image::load_from_memory(png).expect("decode png").to_rgb8();
        assert_eq!(image.width(), width);
        image
            .pixels()
            .filter(|pixel| {
                let [red, green, blue] = pixel.0;
                red.max(green).max(blue) - red.min(green).min(blue) > 40
            })
            .count()
    };
    for png in &all_rows.images {
        colored_pixels(png);
    }
    assert_eq!(with_boxes.images.len(), 1);
    assert!(colored_pixels(&with_boxes.images[0]) > 0);
    assert_eq!(colored_pixels(&without_boxes.images[0]), 0);
}
