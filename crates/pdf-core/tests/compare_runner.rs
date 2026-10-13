//! 비교 작업 실행기(`compare_pdfs`) 검증(ADR 0001 §15): 6단계 진행률 규칙, 결과 조립, 쪽 범위,
//! 취소, 옵션만 바꾼 재실행의 추출·OCR 생략.
//!
//! OCR이 필요한 테스트는 `compare_ocr.rs`처럼 `ONNXRUNTIME_LIB_PATH`·`OCR_MODEL_DIR`이 없으면
//! 건너뛴다.

mod common;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use common::{assert_matches_golden, engine, fixture_path};
use pdf_core::{
    Change, ChangeKind, CompareError, CompareOptions, CompareOptionsError, CompareProgress,
    CompareRequest, CompareResult, CompareStage, ExtractionCache, NoTextReason, Notice, OcrCache,
    OcrEngine, ProgressDetail, Side, TextSource, compare_pdfs,
};
use serde::Serialize;

const JOB_ID: &str = "compare-1";
const OCR_ENVS: [&str; 2] = ["ONNXRUNTIME_LIB_PATH", "OCR_MODEL_DIR"];
/// golden 깊이는 각 golden을 만든 테스트와 같다: 변경 → 쪽 → 상자(`compare_diff.rs`), 행
/// (`compare_pages.rs`), 변경(`compare_ocr.rs`)
const CHANGES_GOLDEN_DEPTH: usize = 4;
const PAGE_PAIRS_GOLDEN_DEPTH: usize = 1;
const OCR_CHANGES_GOLDEN_DEPTH: usize = 1;
const STAGES: [CompareStage; 6] = [
    CompareStage::ExtractA,
    CompareStage::ExtractB,
    CompareStage::Ocr,
    CompareStage::Normalize,
    CompareStage::Diff,
    CompareStage::AlignPages,
];

/// 텍스트본 A와 금액·날짜·조항을 바꾼 B의 스캔본(2쪽 모두 OCR 대상)
const CONTRACT_A: &str = "ocr/contract-a.pdf";
const SCAN_OF_B: &str = "ocr/contract-b-scan-300dpi.pdf";

fn request(before: &Path, after: &Path, options: CompareOptions) -> CompareRequest {
    CompareRequest {
        job_id: JOB_ID.to_owned(),
        before: before.to_path_buf(),
        after: after.to_path_buf(),
        options,
    }
}

struct Run {
    result: Result<CompareResult, CompareError>,
    events: Vec<CompareProgress>,
}

/// 실행하고 진행 이벤트를 모은다. `cancel_at`이 맞는 이벤트를 받으면 그 자리에서 취소를 켠다.
fn run(
    request: &CompareRequest,
    ocr: Option<&mut OcrEngine>,
    ocr_cache: Option<&OcrCache>,
    extraction_cache: &ExtractionCache,
    cancel_at: impl Fn(&CompareProgress) -> bool,
) -> Run {
    let cancel = AtomicBool::new(false);
    let mut events = Vec::new();
    let result = compare_pdfs(
        engine(),
        request,
        ocr,
        ocr_cache,
        extraction_cache,
        &cancel,
        |progress| {
            if cancel_at(&progress) {
                cancel.store(true, Ordering::Relaxed);
            }
            events.push(progress);
        },
    );
    Run { result, events }
}

fn never(_: &CompareProgress) -> bool {
    false
}

fn finished(run: Run) -> (CompareResult, Vec<CompareProgress>) {
    match run.result {
        Ok(result) => (result, run.events),
        Err(error) => panic!("comparison failed: {error:?}"),
    }
}

fn stage_events(events: &[CompareProgress], stage: CompareStage) -> Vec<(u32, u32, u8)> {
    events
        .iter()
        .filter(|event| event.stage == stage)
        .map(|event| (event.done, event.total, event.stage_percent))
        .collect()
}

/// 끝까지 간 실행의 진행 이벤트 규칙(ADR 0001 §15):
/// - 여섯 단계가 순서대로 모두 나오고, 단계마다 마지막 이벤트는 100%다. 단계 %·전체 %는 줄지 않는다.
/// - 단계 %는 `done / total`을 내린 값(단위가 없으면 100)이고, 100은 `done == total`일 때만이다.
/// - 이어진 두 이벤트는 단계나 단계 %·전체 %가 다르다(1% 단위).
/// - 전체 100은 마지막 이벤트(쪽 짝짓기 100%)에만 있다.
fn assert_progress_rules(events: &[CompareProgress]) {
    let stages: Vec<CompareStage> = events.iter().map(|event| event.stage).collect();
    let mut distinct = stages.clone();
    distinct.dedup();
    assert_eq!(distinct, STAGES, "stage order: {stages:?}");
    for event in events {
        assert_eq!(event.job_id, JOB_ID);
        let expected = if event.total == 0 {
            100
        } else {
            u64::from(event.done) * 100 / u64::from(event.total)
        };
        assert_eq!(u64::from(event.stage_percent), expected, "{event:?}");
        assert_eq!(
            event.stage_percent == 100,
            event.done == event.total,
            "{event:?}"
        );
    }
    for pair in events.windows(2) {
        let (previous, next) = (&pair[0], &pair[1]);
        assert!(next.overall_percent >= previous.overall_percent, "{pair:?}");
        if next.stage == previous.stage {
            assert!(next.stage_percent > previous.stage_percent, "{pair:?}");
        } else {
            assert_eq!(previous.stage_percent, 100, "{pair:?}");
        }
    }
    let (last, rest) = events.split_last().expect("events");
    assert_eq!(
        (last.stage, last.stage_percent, last.overall_percent),
        (CompareStage::AlignPages, 100, 100)
    );
    assert!(rest.iter().all(|event| event.overall_percent < 100));
}

/// 텍스트끼리의 비교: 진행 규칙을 지키고, OCR 대상 쪽이 없으니 OCR 단계는 바로 100% 하나다. 결과의
/// 변경은 diff golden과 같고, 쪽 짝·크기·출처는 문서 전체 쪽이다.
#[test]
fn text_pair_reports_six_stages_and_assembles_result() {
    let request = request(
        &fixture_path("diff-base.pdf"),
        &fixture_path("diff-edit.pdf"),
        CompareOptions::default(),
    );

    let (result, events) = finished(run(&request, None, None, &ExtractionCache::new(), never));

    assert_progress_rules(&events);
    assert_eq!(stage_events(&events, CompareStage::Ocr), [(0, 0, 100)]);
    assert_eq!(
        stage_events(&events, CompareStage::ExtractA),
        [(0, 2, 0), (1, 2, 50), (2, 2, 100)]
    );
    assert_matches_golden(
        &result.changes,
        "diff-edit.changes.json",
        CHANGES_GOLDEN_DEPTH,
    );
    assert_eq!(result.page_pairs, [(Some(0), Some(0)), (Some(1), Some(1))]);
    assert_eq!(
        (
            result.page_sizes.before.len(),
            result.page_sizes.after.len()
        ),
        (2, 2)
    );
    assert_eq!(
        result.page_sources.before,
        vec![Some(TextSource::TextLayer); 2]
    );
    assert_eq!(result.notices, []);
}

/// 문서 전체 비교의 쪽 짝은 diff의 공통 토큰 짝으로 지은 페이지 짝짓기 golden과 같다. 빈 쪽(A 2쪽,
/// B 3쪽)은 OCR 대상인데 OCR 엔진이 없어 안내된다.
#[test]
fn full_range_rows_follow_common_tokens() {
    let request = request(
        &fixture_path("pages-base.pdf"),
        &fixture_path("pages-insert.pdf"),
        CompareOptions::default(),
    );

    let (result, _) = finished(run(&request, None, None, &ExtractionCache::new(), never));

    assert_matches_golden(
        &result.page_pairs,
        "pages-insert.page-pairs.json",
        PAGE_PAIRS_GOLDEN_DEPTH,
    );
    assert_eq!(
        result.notices,
        [(Side::Before, 2), (Side::After, 3)].map(|(side, page)| Notice::NoTextLayer {
            side,
            reason: NoTextReason::OcrUnavailable,
            pages: vec![page],
        })
    );
}

/// 쪽 범위가 0쪽부터 이어지지 않아도 결과는 문서 전체 쪽 번호다. 범위 밖 쪽은 출처가 `None`이고
/// OCR 대상(빈 쪽: A 2쪽, B 3쪽)이어도 읽거나 안내하지 않는다.
#[test]
fn page_range_limits_rows_sources_and_ocr_targets() {
    // pages-base 3·4쪽 ↔ pages-insert 4·5쪽은 golden `pages-insert.page-pairs.json`의 짝이다.
    let options = CompareOptions {
        range_a: "4-5".to_owned(),
        range_b: "5-6".to_owned(),
        ..CompareOptions::default()
    };
    let request = request(
        &fixture_path("pages-base.pdf"),
        &fixture_path("pages-insert.pdf"),
        options,
    );

    let (result, events) = finished(run(&request, None, None, &ExtractionCache::new(), never));

    assert_progress_rules(&events);
    assert_eq!(stage_events(&events, CompareStage::Ocr), [(0, 0, 100)]);
    assert_eq!(result.page_pairs, [(Some(3), Some(4)), (Some(4), Some(5))]);
    let text_layer = Some(TextSource::TextLayer);
    assert_eq!(
        result.page_sources.before,
        [None, None, None, text_layer, text_layer]
    );
    assert_eq!(
        result.page_sources.after,
        [None, None, None, None, text_layer, text_layer]
    );
    assert_eq!(
        (
            result.page_sizes.before.len(),
            result.page_sizes.after.len()
        ),
        (5, 6)
    );
    assert_eq!(result.notices, []);
}

/// 쪽 수를 넘는 범위는 비교 시작 때 거부하고 아무 단계도 시작하지 않는다.
#[test]
fn invalid_range_is_rejected_before_any_stage() {
    let options = CompareOptions {
        range_a: "2,9".to_owned(),
        ..CompareOptions::default()
    };
    let request = request(
        &fixture_path("pages-base.pdf"),
        &fixture_path("pages-insert.pdf"),
        options,
    );

    let Run { result, events } = run(&request, None, None, &ExtractionCache::new(), never);

    match result {
        Err(CompareError::Options(error)) => assert_eq!(
            error,
            CompareOptionsError::InvalidRange {
                side: Side::Before,
                range: "2,9".to_owned(),
                page_count: 5,
            }
        ),
        other => panic!("expected InvalidRange, got {other:?}"),
    }
    assert_eq!(events, []);
}

/// 추출 중 취소하면 다음 쪽을 읽기 전에 멈춘다(30쪽 중 1쪽에서 끝난다).
#[test]
fn cancel_during_extraction_stops_before_the_next_page() {
    let request = request(
        &fixture_path("thirty-pages.pdf"),
        &fixture_path("three-pages.pdf"),
        CompareOptions::default(),
    );

    let Run { result, events } = run(&request, None, None, &ExtractionCache::new(), |event| {
        event.stage == CompareStage::ExtractA && event.done == 1
    });

    assert!(matches!(result, Err(CompareError::Cancelled)), "{result:?}");
    let last = events.last().expect("events");
    assert_eq!(
        (last.stage, last.done, last.total),
        (CompareStage::ExtractA, 1, 30)
    );
}

/// 같은 파일을 옵션만 바꿔 다시 비교하면 추출하지 않고 두 추출 단계가 바로 100%(캐시) 하나다.
/// 결과는 캐시 없이 같은 옵션으로 비교한 것과 같다.
#[test]
fn options_only_rerun_reuses_extraction() {
    let (before, after) = (fixture_path("diff-base.pdf"), fixture_path("diff-edit.pdf"));
    let cache = ExtractionCache::new();
    finished(run(
        &request(&before, &after, CompareOptions::default()),
        None,
        None,
        &cache,
        never,
    ));
    let changed = request(
        &before,
        &after,
        CompareOptions {
            ignore_case: true,
            exclude_footer: true,
            range_b: "2".to_owned(),
            ..CompareOptions::default()
        },
    );

    let (rerun, events) = finished(run(&changed, None, None, &cache, never));

    assert_progress_rules(&events);
    for stage in [CompareStage::ExtractA, CompareStage::ExtractB] {
        let cached: Vec<(u32, u32, u8, Option<ProgressDetail>)> = events
            .iter()
            .filter(|event| event.stage == stage)
            .map(|event| (event.done, event.total, event.stage_percent, event.detail))
            .collect();
        assert_eq!(
            cached,
            [(2, 2, 100, Some(ProgressDetail::Cached))],
            "{stage:?}"
        );
    }
    let (fresh, _) = finished(run(&changed, None, None, &ExtractionCache::new(), never));
    assert_eq!(rerun, fresh);
}

/// 파일을 고치면(크기·수정 시각이 바뀐다) 같은 경로여도 다시 추출해 새 내용으로 비교한다.
#[test]
fn changed_file_is_extracted_again() {
    let dir = std::env::temp_dir().join(format!("pdf-core-runner-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    let before = dir.join("before.pdf");
    // `fs::copy`는 수정 시각까지 옮길 수 있어 읽고 쓴다(쓴 시각이 수정 시각이 된다).
    let write_as_before = |source: &Path| {
        std::fs::write(&before, std::fs::read(source).expect("read fixture"))
            .expect("write before");
    };
    write_as_before(&fixture_path("diff-base.pdf"));
    let after = fixture_path("diff-edit.pdf");
    let cache = ExtractionCache::new();
    let request = request(&before, &after, CompareOptions::default());
    let (first, _) = finished(run(&request, None, None, &cache, never));
    write_as_before(&after);

    let (second, events) = finished(run(&request, None, None, &cache, never));

    std::fs::remove_dir_all(&dir).expect("remove temp dir");
    assert!(!first.changes.is_empty());
    assert_eq!(
        stage_events(&events, CompareStage::ExtractA),
        [(0, 2, 0), (1, 2, 50), (2, 2, 100)]
    );
    assert_eq!(second.changes, []);
}

/// 변경 하나를 글자로 줄인 golden 모양(`compare_ocr.rs`와 같다. 상자·신뢰도는 OCR 실행마다 조금
/// 흔들릴 수 있어 뺀다)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangeText<'a> {
    kind: ChangeKind,
    before: Option<&'a str>,
    after: Option<&'a str>,
    needs_review: bool,
}

impl<'a> ChangeText<'a> {
    fn of(change: &'a Change) -> Self {
        Self {
            kind: change.kind,
            before: change.before.text(),
            after: change.after.text(),
            needs_review: change.needs_review,
        }
    }
}

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

/// 이 테스트만 쓰는 빈 캐시 폴더
fn fresh_cache_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("pdf-core-runner-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// 스캔 쪽 두 개를 쪽마다 알린다. 다시 비교할 때는 OCR 엔진 없이도 추출 캐시(메모리)나 OCR 캐시
/// (디스크)의 결과를 쓰고, OCR 단계는 바로 100%(캐시) 하나다.
#[test]
fn scan_pages_report_per_page_and_reruns_reuse_ocr_results() {
    let Some(mut ocr) = ocr_engine() else {
        return;
    };
    let (before, after) = (fixture_path(CONTRACT_A), fixture_path(SCAN_OF_B));
    let dir = fresh_cache_dir("scan");
    let ocr_cache = OcrCache::new(dir.clone());
    let extraction_cache = ExtractionCache::new();
    let default_request = request(&before, &after, CompareOptions::default());
    let (first, events) = finished(run(
        &default_request,
        Some(&mut ocr),
        Some(&ocr_cache),
        &extraction_cache,
        never,
    ));
    assert_progress_rules(&events);
    assert_eq!(
        stage_events(&events, CompareStage::Ocr),
        [(0, 2, 0), (1, 2, 50), (2, 2, 100)]
    );
    assert_eq!(first.page_sources.after, vec![Some(TextSource::Ocr); 2]);
    // `read_document_text` + `compare_texts`로 만든 `compare_ocr.rs`의 golden과 같은 변경이다.
    let summary: Vec<ChangeText> = first.changes.iter().map(ChangeText::of).collect();
    assert_matches_golden(&summary, "ocr-edit.changes.json", OCR_CHANGES_GOLDEN_DEPTH);

    let ignore_case = request(
        &before,
        &after,
        CompareOptions {
            ignore_case: true,
            ..CompareOptions::default()
        },
    );
    // 옵션만 바꾼 재실행: OCR 엔진·디스크 캐시 없이 메모리 캐시만
    let memory = finished(run(&ignore_case, None, None, &extraction_cache, never));
    // 새 실행(메모리 캐시 없음): OCR 엔진 없이 디스크 캐시만
    let disk = finished(run(
        &default_request,
        None,
        Some(&ocr_cache),
        &ExtractionCache::new(),
        never,
    ));

    std::fs::remove_dir_all(&dir).expect("remove cache dir");
    for (label, (result, events)) in [("memory", memory), ("disk", disk)] {
        let ocr_events: Vec<(u32, u32, u8, Option<ProgressDetail>)> = events
            .iter()
            .filter(|event| event.stage == CompareStage::Ocr)
            .map(|event| (event.done, event.total, event.stage_percent, event.detail))
            .collect();
        assert_eq!(
            ocr_events,
            [(2, 2, 100, Some(ProgressDetail::Cached))],
            "{label}"
        );
        assert_eq!(
            result.page_sources.after,
            vec![Some(TextSource::Ocr); 2],
            "{label}"
        );
        assert!(
            !result
                .notices
                .iter()
                .any(|notice| matches!(notice, Notice::NoTextLayer { .. })),
            "{label}: {:?}",
            result.notices
        );
    }
}

/// OCR 중 취소하면 다음 쪽을 읽기 전에 멈춘다(스캔 2쪽 중 1쪽에서 끝난다).
#[test]
fn cancel_during_ocr_stops_before_the_next_page() {
    let Some(mut ocr) = ocr_engine() else {
        return;
    };
    let request = request(
        &fixture_path(CONTRACT_A),
        &fixture_path(SCAN_OF_B),
        CompareOptions::default(),
    );

    let Run { result, events } = run(
        &request,
        Some(&mut ocr),
        None,
        &ExtractionCache::new(),
        |event| event.stage == CompareStage::Ocr && event.done == 1,
    );

    assert!(matches!(result, Err(CompareError::Cancelled)), "{result:?}");
    let last = events.last().expect("events");
    assert_eq!(
        (last.stage, last.done, last.total),
        (CompareStage::Ocr, 1, 2)
    );
}

/// OCR 엔진이 없으면 OCR 대상 쪽은 바로 끝나(100% 하나, 캐시 아님) 텍스트 레이어로 비교하고
/// `NoTextLayer`(`OcrUnavailable`)로 알린다.
#[test]
fn scan_pages_without_ocr_engine_finish_the_ocr_stage_at_once() {
    let request = request(
        &fixture_path(CONTRACT_A),
        &fixture_path(SCAN_OF_B),
        CompareOptions::default(),
    );

    let (result, events) = finished(run(&request, None, None, &ExtractionCache::new(), never));

    assert_progress_rules(&events);
    let ocr_events: Vec<(u32, u32, u8, Option<ProgressDetail>)> = events
        .iter()
        .filter(|event| event.stage == CompareStage::Ocr)
        .map(|event| (event.done, event.total, event.stage_percent, event.detail))
        .collect();
    assert_eq!(ocr_events, [(2, 2, 100, None)]);
    assert_eq!(
        result.notices,
        [Notice::NoTextLayer {
            side: Side::After,
            reason: NoTextReason::OcrUnavailable,
            pages: vec![0, 1],
        }]
    );
}
