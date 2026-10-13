//! 번역 문단 추출(ADR 0002 §2)의 golden·스캔 쪽·쪽 범위·스캔 쪽 그림·추출 캐시 검증.
//!
//! 픽스처는 `generate_paragraph_fixtures.py`(가상 간체·번체 중국어·영어 문서, Noto Sans SC·TC 서브셋
//! 임베드)로 만든다. 픽스처나 문단 규칙을 바꾸면 `UPDATE_GOLDEN=1`로 golden을 다시 쓰고 눈으로 확인한다.

mod common;

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use common::{assert_matches_golden, engine, fixture_path};
use image::ImageFormat;
use pdf_core::{
    CompareOptions, CompareRequest, CompareStage, ExtractionCache, PageParagraphs, ParagraphPage,
    ProgressDetail, SCAN_IMAGE_MAX_EDGE_PX, compare_pdfs, extract_paragraphs, extract_text_layer,
    render_scan_page,
};
use sha2::{Digest, Sha256};

const HANS: &str = "paragraphs-zh-hans.pdf";
const HANT: &str = "paragraphs-zh-hant.pdf";
const ENGLISH: &str = "paragraphs-en.pdf";
/// paragraphs-zh-hans.pdf의 스캔 쪽(A4 세로)과 /Rotate 90 쪽(A4 세로 MediaBox, 화면은 가로)
const HANS_SCAN_PAGE: u32 = 1;
const HANS_ROTATED_PAGE: u32 = 2;
/// golden 깊이: 쪽 배열 → 쪽 → `content` → `paragraphs` → 문단. 문단 하나가 한 줄이다.
const PARAGRAPHS_GOLDEN_DEPTH: usize = 4;

/// ADR 0002 §3 문단 키(`crates/translate`가 셀 값을 여기서 같은 식으로 센다)
const PARAGRAPH_KEY_PREFIX: &[u8] = b"pdfstudio.paragraph.v1";
const PARAGRAPH_KEY_HASH_BYTES: usize = 8;

fn paragraphs(name: &str, range: &str) -> Vec<ParagraphPage> {
    extract_paragraphs(
        engine(),
        &fixture_path(name),
        range,
        &ExtractionCache::new(),
    )
    .expect("extract paragraphs")
}

fn texts(page: &ParagraphPage) -> Vec<&str> {
    match &page.content {
        PageParagraphs::Text(paragraphs) => paragraphs
            .iter()
            .map(|paragraph| paragraph.text.as_str())
            .collect(),
        PageParagraphs::Scan => Vec::new(),
    }
}

fn paragraph_key(page: u32, number: u32, text: &str) -> String {
    let length = u32::try_from(text.len()).expect("text length fits u32");
    let digest = Sha256::new()
        .chain_update(PARAGRAPH_KEY_PREFIX)
        .chain_update(length.to_le_bytes())
        .chain_update(text.as_bytes())
        .finalize();
    let hash: String = digest[..PARAGRAPH_KEY_HASH_BYTES]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("{page}-{number}-{hash}")
}

fn keys(pages: &[ParagraphPage]) -> Vec<String> {
    pages
        .iter()
        .flat_map(|page| match &page.content {
            PageParagraphs::Text(paragraphs) => paragraphs
                .iter()
                .map(|paragraph| paragraph_key(page.page, paragraph.number, &paragraph.text))
                .collect(),
            PageParagraphs::Scan => Vec::new(),
        })
        .collect()
}

/// 간체 한 단 쪽: 첫 줄 들여쓰기(한 줄짜리 들여쓴 문단 포함), 한자 줄끼리는 그냥·라틴이 끼면 공백으로
/// 잇기, 큰 글자 절 제목(제목), 목록 머리(`1.`·`（3）`·`②`·`第五条`·`一、`·`•`)와 매단 들여쓰기, 간격만으로
/// 나눈 문단. 스캔 쪽은 문단 없이 `scan`, /Rotate 90에 돌려 그린 쪽은 가로줄로 읽는다.
#[test]
fn simplified_chinese_paragraphs_match_golden() {
    assert_matches_golden(
        &paragraphs(HANS, ""),
        "paragraphs-zh-hans.paragraphs.json",
        PARAGRAPHS_GOLDEN_DEPTH,
    );
}

/// 번체 2단 쪽: 같은 높이의 두 단 줄을 가로 간격 한도로 가르고, 왼쪽 단을 다 읽은 뒤 오른쪽 단을 읽는다.
/// 두 단을 줄마다 번갈아 쓴 내용 스트림(0쪽)과 단 순서로 쓴 스트림(1쪽)이 같은 문단·순서를 낸다.
#[test]
fn two_column_pages_read_column_by_column_regardless_of_stream_order() {
    let pages = paragraphs(HANT, "");
    assert_matches_golden(
        &pages,
        "paragraphs-zh-hant.paragraphs.json",
        PARAGRAPHS_GOLDEN_DEPTH,
    );

    let [interleaved, column_order] = pages.as_slice() else {
        panic!("expected two pages, got {}", pages.len());
    };
    assert_eq!(texts(interleaved), texts(column_order));
}

/// 영어: 줄 끝 하이픈 단어는 하이픈째 잇고(`co-operating`·`123-456`) 홀로 선 하이픈은 공백으로 잇는다.
/// 간격·목록 머리(`•`·`(a)`·`1)`)·들여쓰기·작은 글자 각주로 나누고, 가로 글자를 /Rotate 90으로 눕힌 쪽도
/// 가로줄로 읽는다.
#[test]
fn english_paragraphs_match_golden() {
    assert_matches_golden(
        &paragraphs(ENGLISH, ""),
        "paragraphs-en.paragraphs.json",
        PARAGRAPHS_GOLDEN_DEPTH,
    );
}

/// 스캔 쪽 판정은 비교 추출의 `needs_ocr`와 같다(글자층 글자가 조금 있는 쪽, 그림만 있는 스캔 쪽, 쪽
/// 번호만 있는 쪽 포함).
#[test]
fn scan_pages_are_the_compare_ocr_targets() {
    for name in [
        HANS,
        HANT,
        ENGLISH,
        "ocr/contract-a-scan-300dpi.pdf",
        "text-geometry.pdf",
    ] {
        let path = fixture_path(name);
        let extracted = extract_text_layer(engine(), &path).expect("extract text layer");
        let pages = paragraphs(name, "");

        assert_eq!(pages.len(), extracted.len(), "{name}");
        for (page, text_layer) in pages.iter().zip(&extracted) {
            assert_eq!(
                matches!(page.content, PageParagraphs::Scan),
                text_layer.needs_ocr,
                "{name} page {}",
                page.page
            );
        }
    }
}

/// 같은 파일을 다시 추출하면(새 캐시·캐시 적중 모두) 문단 키 재료(쪽·번호·원문)가 같아 ADR 0002 §3
/// 키가 같다. 기대 키는 Python `hashlib`로 셈한 값이다.
#[test]
fn paragraph_keys_are_stable_across_runs() {
    let path = fixture_path(HANS);
    let cache = ExtractionCache::new();
    let first = extract_paragraphs(engine(), &path, "", &cache).expect("first run");
    let cached = extract_paragraphs(engine(), &path, "", &cache).expect("cached run");
    let fresh = paragraphs(HANS, "");

    assert_eq!(keys(&first), keys(&cached));
    assert_eq!(keys(&first), keys(&fresh));
    // 한자 줄을 공백 없이 이은 세 줄 문단(0쪽 2번)과, 스캔 쪽 뒤 /Rotate 90 쪽(쪽 번호 2)의 두 줄 문단
    let first_keys = keys(&first);
    assert_eq!(first_keys[1], "0-2-f5e03e5720bb6c7a");
    assert_eq!(first_keys[17], "2-3-30948413a40b3757");
}

/// 쪽 범위는 비교와 같은 문법이다: 범위 안 쪽만 쪽 번호 오름차순으로 내고, 잘못된 범위는 `INVALID_RANGE`다.
#[test]
fn page_range_selects_pages_and_rejects_invalid_ranges() {
    let selected: Vec<u32> = paragraphs(HANS, "3, 1")
        .iter()
        .map(|page| page.page)
        .collect();
    assert_eq!(selected, [0, 2]);

    for range in ["0", "4", "3-1", "1,,2", "a", "-1"] {
        let error = extract_paragraphs(
            engine(),
            &fixture_path(HANS),
            range,
            &ExtractionCache::new(),
        )
        .expect_err(range);
        assert_eq!(error.code(), "INVALID_RANGE", "{range}");
    }
}

/// 스캔 쪽 그림은 PNG이고 긴 변이 `SCAN_IMAGE_MAX_EDGE_PX`다. 방향은 `/Rotate`를 적용한 화면 방향이고,
/// 렌더는 파일을 쓰지 않는다. 없는 쪽은 `INVALID_PAGE`다.
#[test]
fn scan_page_image_is_an_in_memory_png_within_the_max_edge() {
    let folder = TestDir::new("scan-page-image");
    let path = folder.path.join(HANS);
    fs::copy(fixture_path(HANS), &path).expect("copy fixture");

    let portrait =
        decode_png(&render_scan_page(engine(), &path, HANS_SCAN_PAGE).expect("render scan page"));
    let rotated = decode_png(
        &render_scan_page(engine(), &path, HANS_ROTATED_PAGE).expect("render rotated page"),
    );

    assert_eq!(portrait.1, SCAN_IMAGE_MAX_EDGE_PX);
    assert!(portrait.0 < portrait.1, "A4 portrait: {portrait:?}");
    assert_eq!(rotated.0, SCAN_IMAGE_MAX_EDGE_PX);
    assert!(
        rotated.1 < rotated.0,
        "/Rotate 90 shows landscape: {rotated:?}"
    );
    assert_eq!(folder.entries(), [PathBuf::from(HANS)]);

    let error = render_scan_page(engine(), &path, 3).expect_err("page 3 does not exist");
    assert_eq!(error.code(), "INVALID_PAGE");
}

/// 문단 추출이 읽은 문서는 비교 실행기와 함께 쓰는 추출 캐시에 들어간다(같은 파일을 비교하면 추출하지 않는다).
#[test]
fn paragraph_extraction_fills_the_shared_extraction_cache() {
    let path = fixture_path(ENGLISH);
    let cache = ExtractionCache::new();
    extract_paragraphs(engine(), &path, "", &cache).expect("extract paragraphs");

    let request = CompareRequest {
        job_id: "paragraph-cache".to_owned(),
        before: path.clone(),
        after: path,
        options: CompareOptions::default(),
    };
    let mut extract_details = Vec::new();
    compare_pdfs(
        engine(),
        &request,
        None,
        None,
        &cache,
        &AtomicBool::new(false),
        |progress| {
            if progress.stage == CompareStage::ExtractA {
                extract_details.push(progress.detail);
            }
        },
    )
    .expect("compare");

    assert_eq!(extract_details, [Some(ProgressDetail::Cached)]);
}

/// PNG 바이트를 읽어 `(너비, 높이)`를 낸다. PNG가 아니면 실패한다.
fn decode_png(bytes: &[u8]) -> (u32, u32) {
    let image = image::load_from_memory_with_format(bytes, ImageFormat::Png).expect("PNG image");
    (image.width(), image.height())
}

/// 테스트마다 비어 있는 새 폴더. 끝나면(실패해도) 지운다.
struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("pdf-core-paragraphs-{name}-{}", std::process::id()));
        if path.exists() {
            fs::remove_dir_all(&path).expect("clear test dir");
        }
        fs::create_dir_all(&path).expect("create test dir");
        Self { path }
    }

    /// 폴더 안 이름들(정렬)
    fn entries(&self) -> Vec<PathBuf> {
        let mut names: Vec<PathBuf> = fs::read_dir(&self.path)
            .expect("read test dir")
            .map(|entry| PathBuf::from(entry.expect("dir entry").file_name()))
            .collect();
        names.sort();
        names
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        // 정리 실패는 테스트 결과와 무관하다(임시 폴더).
        let _ = fs::remove_dir_all(&self.path);
    }
}
