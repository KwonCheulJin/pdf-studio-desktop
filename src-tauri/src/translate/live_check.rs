//! 사용자 본인 키로 번역 엔진을 화면 없이 실측하는 수동 테스트(`live_translation`). 평소 `cargo test`에서는 돌지
//! 않고(`#[ignore]`) 사용자가 직접 실행할 때만 실제 Anthropic API를 부른다. 앱과 같은 경로(`prepare` → 검사 →
//! `run`, 실제 `ReqwestTransport`)를 타며 기록 폴더만 임시 폴더다. 키는 환경변수 `ANTHROPIC_API_KEY`에서만 읽고
//! `ApiKey` 타입 안에서만 다룬다(출력·로그에 나오지 않는다).
//!
//! 실행:
//! ```text
//! set -a; source ~/.secrets/anthropic.env; set +a; PDFIUM_LIB_PATH=$PWD/src-tauri/pdfium/aarch64-apple-darwin/libpdfium.dylib cargo test -p pdf-studio live_translation -- --ignored --nocapture
//! ```
//! 환경변수(모두 선택):
//! - `LIVE_MODEL`: `sonnet` | `haiku`(기본 `haiku`)
//! - `LIVE_PAGES`: 1부터 센 쪽 범위(`"1,3-5"`, 기본 `1`)
//! - `LIVE_FIXTURE`: `zh`(paragraphs-zh-hans.pdf, 기본) | `en`(paragraphs-en.pdf)
//! - `LIVE_SCAN`: `1`이면 범위 안 스캔 쪽 그림도 보낸다(기본 끔)

use std::sync::atomic::AtomicBool;
use std::time::Instant;

use translate::{ProgressReporter, ReqwestTransport};

use super::{BlockingRenderer, Deps, TranslateState, check_translation, hash_file, prepare, run};
use crate::contract::{
    PageKind, ParagraphStatus, SourceLanguage, TranslateModel, TranslateOptions, TranslateRequest,
    TranslatedParagraph,
};
use crate::error::{AppError, CommandError};
use crate::test_support::{FakeKeySettings, FakeKeyStore, TestDir, engine};

const KEY_ENV: &str = "ANTHROPIC_API_KEY";
const MODEL_ENV: &str = "LIVE_MODEL";
const PAGES_ENV: &str = "LIVE_PAGES";
const FIXTURE_ENV: &str = "LIVE_FIXTURE";
const SCAN_ENV: &str = "LIVE_SCAN";

const DEFAULT_PAGES: &str = "1";
const ZH_FIXTURE: &str = "paragraphs-zh-hans.pdf";
const EN_FIXTURE: &str = "paragraphs-en.pdf";
const MICRO_USD_PER_USD: u32 = 1_000_000;

fn env_text(name: &str) -> Option<String> {
    std::env::var_os(name)
        .and_then(|value| value.into_string().ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn live_model() -> TranslateModel {
    match env_text(MODEL_ENV).as_deref() {
        None | Some("haiku") => TranslateModel::Haiku,
        Some("sonnet") => TranslateModel::Sonnet,
        Some(other) => panic!("{MODEL_ENV}는 sonnet 또는 haiku여야 한다: {other}"),
    }
}

fn live_fixture() -> &'static str {
    match env_text(FIXTURE_ENV).as_deref() {
        None | Some("zh") => ZH_FIXTURE,
        Some("en") => EN_FIXTURE,
        Some(other) => panic!("{FIXTURE_ENV}는 zh 또는 en이어야 한다: {other}"),
    }
}

/// micro-USD → `$0.001234`
fn usd(micro_usd: u32) -> String {
    format!(
        "${}.{:06}",
        micro_usd / MICRO_USD_PER_USD,
        micro_usd % MICRO_USD_PER_USD
    )
}

fn status_label(paragraph: &TranslatedParagraph) -> String {
    let label = match paragraph.status {
        ParagraphStatus::Translated => "번역됨",
        ParagraphStatus::Edited => "직접 고침",
        ParagraphStatus::Failed => "실패",
        ParagraphStatus::Refused => "거절",
    };
    match paragraph.fail_code {
        Some(code) => format!("{label} {code}"),
        None => label.to_owned(),
    }
}

/// 실제 값이 예상의 몇 %인가(예상이 0이면 `-`)
fn percent_of(actual: u32, estimated: u32) -> String {
    if estimated == 0 {
        return "-".to_owned();
    }
    format!("{}%", u64::from(actual) * 100 / u64::from(estimated))
}

#[test]
#[ignore = "실제 Anthropic API를 부른다. 사용자가 ANTHROPIC_API_KEY와 함께 직접 실행한다(위 주석)"]
fn live_translation() {
    // 키가 없으면 pdfium·임시 폴더를 만들기 전에 안내로 실패한다.
    let raw_key = env_text(KEY_ENV).unwrap_or_else(|| {
        panic!(
            "{KEY_ENV}가 없다. `set -a; source ~/.secrets/anthropic.env; set +a` 뒤에 다시 실행한다"
        )
    });
    let model = live_model();
    let fixture = live_fixture();
    let range = env_text(PAGES_ENV).unwrap_or_else(|| DEFAULT_PAGES.to_owned());
    let include_scan_pages = env_text(SCAN_ENV).as_deref() == Some("1");

    let test_dir = TestDir::new("translate-live");
    let access = test_dir.access();
    let path = access
        .allow_opened(&test_dir.copy_fixture(fixture, "document.pdf"))
        .expect("pick fixture");
    let state = TranslateState::new(test_dir.user("translations"), ReqwestTransport::new());
    let extraction = pdf_core::ExtractionCache::new();
    let deps = Deps {
        engine: engine(),
        access: &access,
        extraction: &extraction,
        state: &state,
    };
    let options = TranslateOptions {
        source_language: SourceLanguage::Auto,
        range: range.clone(),
        include_scan_pages,
        model,
        glossary: Vec::new(),
    };

    let plan = prepare(&deps, &path, &options)
        .unwrap_or_else(|error| panic!("계획을 세우지 못했다: {}", AppError::from(error)));
    println!(
        "== 대상 == {fixture} · 모델 {model:?} · 쪽 {range} · 스캔 {}",
        if include_scan_pages {
            "포함"
        } else {
            "제외"
        }
    );
    println!(
        "== 계획 == 문단 {} · 묶음 {} · 예상 입력 {} / 출력 {} 토큰 · 예상 요금 {} (요금 기준일 {})",
        plan.paragraph_count,
        plan.chunk_count,
        plan.estimated_input_tokens,
        plan.estimated_output_tokens,
        usd(plan.estimated_cost_micro_usd),
        plan.pricing_date,
    );

    let started = Instant::now();
    let result = (|| {
        let request = TranslateRequest {
            job_id: "live-check".to_owned(),
            path: path.clone(),
            options: options.clone(),
            resume: false,
        };
        let checked = check_translation(
            &deps,
            &FakeKeyStore::with_key(&raw_key),
            &FakeKeySettings::default(),
            request,
        )?;
        let mut reporter = ProgressReporter::new(checked.job_id(), |progress| {
            println!(
                "[진행] {:?} {}/{} (전체 {}%)",
                progress.stage, progress.done, progress.total, progress.overall_percent
            );
        });
        reporter.read_document_started(checked.range_pages());
        let file_sha256 = hash_file(&state, checked.path())?;
        let render_path = checked.path().to_path_buf();
        let mut renderer = BlockingRenderer::new(move |page| {
            pdf_core::render_scan_page(engine(), &render_path, page).map_err(CommandError::from)
        });
        tauri::async_runtime::block_on(run(
            &state,
            checked,
            file_sha256,
            &mut renderer,
            &mut reporter,
            &AtomicBool::new(false),
            started,
        ))
    })()
    .unwrap_or_else(|error| panic!("번역이 멈췄다: {}", AppError::from(error)));
    let wall = started.elapsed();

    println!("== 문단 ==");
    let mut translated_count = 0_usize;
    let mut paragraph_total = 0_usize;
    for page in result
        .pages
        .iter()
        .filter(|page| !matches!(page.kind, PageKind::OutOfRange | PageKind::ScanSkipped))
    {
        println!("-- {}쪽 ({:?}) --", page.page + 1, page.kind);
        if let Some(code) = page.fail_code {
            println!("  쪽 실패: {code}");
        }
        for paragraph in &page.paragraphs {
            paragraph_total += 1;
            if matches!(paragraph.status, ParagraphStatus::Translated) {
                translated_count += 1;
            }
            println!(
                "[{}] ({})\n  원문: {}\n  번역: {}",
                paragraph.number,
                status_label(paragraph),
                paragraph.source,
                paragraph.target.as_deref().unwrap_or("(없음)"),
            );
        }
    }

    let usage = result.usage;
    let actual_cost = translate::estimated_cost_micro_usd(
        u64::from(usage.input_tokens),
        u64::from(usage.output_tokens),
        model.into(),
    );
    println!("== 사용량 ==");
    println!(
        "입력 토큰: 실제 {} / 예상 {} ({})",
        usage.input_tokens,
        plan.estimated_input_tokens,
        percent_of(usage.input_tokens, plan.estimated_input_tokens)
    );
    println!(
        "출력 토큰: 실제 {} / 예상 {} ({})",
        usage.output_tokens,
        plan.estimated_output_tokens,
        percent_of(usage.output_tokens, plan.estimated_output_tokens)
    );
    println!(
        "요금: 실제 {} / 예상 {} ({})",
        usd(actual_cost),
        usd(plan.estimated_cost_micro_usd),
        percent_of(actual_cost, plan.estimated_cost_micro_usd)
    );
    println!(
        "걸린 시간: 번역 {:.1}초 (실행기 {}ms) · 문단 {translated_count}/{paragraph_total} 번역됨",
        wall.as_secs_f64(),
        result.elapsed_ms
    );

    assert!(
        translated_count > 0,
        "번역된 문단이 하나도 없다(위 문단 상태를 본다)"
    );
}
