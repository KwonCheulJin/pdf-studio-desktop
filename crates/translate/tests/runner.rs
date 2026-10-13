//! 실행기(ADR 0002 §4 "이어하기", §8 기록, §9 진행·취소). 실제 API를 부르지 않는다: 가짜 전송이 손으로 쓴
//! Messages 응답(`common`)을 차례로 돌려주고 받은 요청을 기록한다. 기록 폴더는 테스트마다 새 임시 폴더다.
//!
//! 묶음 경계: 한자 1,000자 문단(`big`)은 글 토큰 1,300이라 둘이 한 묶음(글 자리 1,900)에 들지 않아 묶음
//! 하나씩이고, 짧은 문단은 한 묶음에 함께 든다(`tests/chunk.rs`의 식).

mod common;

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use common::{completed, error_reply, item_texts, key, message, ok, translated};
use serde_json::{Value, json};
use translate::{
    ApiErrorCode, ApiKey, FailReason, Glossary, GlossaryTerm, HttpResponse, Language, PageFailure,
    PageKind, ParagraphStatus, ProgressReporter, RunError, ScanImage, ScanRenderer, SourcePage,
    SourcePageContent, SourceParagraph, TokenUsage, TranslateModel, TranslateProgress,
    TranslateStage, TranslatedPage, TranslationJob, TranslationOptions, TranslationOutput,
    Transport, TransportError, paragraph_key, run_translation,
};

const S_A: &str = "甲方应当交付设备。";
const S_B: &str = "乙方负责验收。";
const S_C: &str = "本合同自签字之日起生效。";

/// 멈춘 시계에서 이 시간 안에 끝나지 않으면(취소를 못 보고 매달리면) 실패한다.
const RUN_TIMEOUT: Duration = Duration::from_secs(3_600);

/// 한자 1,000자 문단(혼자 묶음 하나)
fn big(han: &str) -> String {
    han.repeat(1_000)
}

fn text_page(page: u32, texts: &[&str]) -> SourcePage {
    SourcePage {
        page,
        content: SourcePageContent::Text(
            texts
                .iter()
                .zip(1..)
                .map(|(text, number)| SourceParagraph {
                    number,
                    text: (*text).to_owned(),
                    heading: false,
                })
                .collect(),
        ),
    }
}

fn scan_page(page: u32) -> SourcePage {
    SourcePage {
        page,
        content: SourcePageContent::Scan(ScanImage {
            width_px: 1_568,
            height_px: 1_109,
        }),
    }
}

fn options(glossary: &Glossary) -> TranslationOptions<'_> {
    TranslationOptions {
        file_sha256: [7; 32],
        document_has_scan_pages: true,
        language: Language::Zh,
        model: TranslateModel::Sonnet,
        glossary,
        include_scan_pages: true,
    }
}

fn term(source: &str, target: &str) -> GlossaryTerm {
    GlossaryTerm {
        source: source.to_owned(),
        target: target.to_owned(),
    }
}

/// 테스트마다 새 기록 폴더(끝나면 지운다)
struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        static SEQUENCE: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "translate-runner-{}-{name}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::remove_dir_all(&path).ok();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn record_path(&self, record_key: &str) -> PathBuf {
        self.0.join(format!("{record_key}.json"))
    }

    fn record(&self, record_key: &str) -> Value {
        let bytes = fs::read(self.record_path(record_key)).expect("record file");
        serde_json::from_slice(&bytes).expect("record JSON")
    }

    /// 폴더의 파일 이름(정렬)
    fn file_names(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.0)
            .expect("record dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).ok();
    }
}

/// 기록의 문단 키(정렬)
fn recorded_keys(record: &Value) -> Vec<String> {
    record["paragraphs"]
        .as_object()
        .expect("paragraphs")
        .keys()
        .cloned()
        .collect()
}

enum Step {
    Reply(Result<HttpResponse, TransportError>),
    /// 응답을 돌려주면서 취소 토큰을 켠다(다음 묶음 전에 취소)
    ReplyThenCancel(Result<HttpResponse, TransportError>),
    /// 취소 토큰을 켜고 응답하지 않는다(요청 중 취소)
    CancelAndHang,
}

/// 차례로 쓸 동작을 들고 받은 요청을 기록하는 가짜 전송. 실행기의 취소 토큰도 들고 있다.
struct Script {
    steps: Mutex<VecDeque<Step>>,
    calls: Mutex<Vec<Value>>,
    cancel: Arc<AtomicBool>,
    /// 응답하지 않던 요청 future가 버려졌다(연결을 끊었다)
    hung_request_dropped: Arc<AtomicBool>,
}

impl Script {
    fn new(steps: impl IntoIterator<Item = Step>) -> Self {
        Self {
            steps: Mutex::new(steps.into_iter().collect()),
            calls: Mutex::new(Vec::new()),
            cancel: Arc::new(AtomicBool::new(false)),
            hung_request_dropped: Arc::new(AtomicBool::new(false)),
        }
    }

    fn replies(replies: impl IntoIterator<Item = Result<HttpResponse, TransportError>>) -> Self {
        Self::new(replies.into_iter().map(Step::Reply))
    }

    /// 요청마다 보낸 항목 원문(스캔 요청은 `["<scan>"]`)
    fn sent(&self) -> Vec<Vec<String>> {
        self.calls
            .lock()
            .expect("calls")
            .iter()
            .map(|body| {
                if body["messages"][0]["content"][0]["type"] == "image" {
                    vec!["<scan>".to_owned()]
                } else {
                    item_texts(body)
                }
            })
            .collect()
    }
}

/// 버려질 때 표시를 켠다
struct DropFlag(Arc<AtomicBool>);

impl Drop for DropFlag {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

impl Transport for &Script {
    fn post_messages(
        &self,
        _key: &ApiKey,
        body: &[u8],
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send {
        self.calls
            .lock()
            .expect("calls")
            .push(serde_json::from_slice(body).expect("request JSON"));
        let step = self
            .steps
            .lock()
            .expect("steps")
            .pop_front()
            .expect("준비한 응답보다 요청이 많다");
        let cancel = Arc::clone(&self.cancel);
        let dropped = Arc::clone(&self.hung_request_dropped);
        async move {
            match step {
                Step::Reply(reply) => reply,
                Step::ReplyThenCancel(reply) => {
                    cancel.store(true, Ordering::Relaxed);
                    reply
                }
                Step::CancelAndHang => {
                    let _dropped = DropFlag(dropped);
                    cancel.store(true, Ordering::Relaxed);
                    std::future::pending().await
                }
            }
        }
    }
}

/// 스캔 쪽 그림을 만든 쪽을 기록한다. `fail`이면 실패한다.
#[derive(Default)]
struct Renderer {
    rendered: Vec<u32>,
    fail: bool,
}

const RENDER_FAILED: &str = "render failed";

impl ScanRenderer for Renderer {
    type Error = &'static str;

    fn render(&mut self, page: u32) -> impl Future<Output = Result<Vec<u8>, Self::Error>> + Send {
        self.rendered.push(page);
        std::future::ready(if self.fail {
            Err(RENDER_FAILED)
        } else {
            Ok(b"\x89PNG test".to_vec())
        })
    }
}

struct Outcome {
    result: Result<TranslationOutput, RunError<&'static str>>,
    events: Vec<TranslateProgress>,
}

/// 부르는 쪽(`src-tauri`)처럼 `readDocument` 0%를 알린 뒤 실행한다.
async fn run(
    pages: &[SourcePage],
    options: TranslationOptions<'_>,
    resume: bool,
    dir: &Path,
    script: &Script,
    renderer: &mut Renderer,
) -> Outcome {
    let mut events = Vec::new();
    let result = {
        let mut reporter = ProgressReporter::new("job-1", |progress| events.push(progress));
        reporter.read_document_started(u32::try_from(pages.len()).expect("pages"));
        let job = TranslationJob {
            pages,
            options,
            resume,
            record_dir: dir,
        };
        tokio::time::timeout(
            RUN_TIMEOUT,
            run_translation(job, script, key(), renderer, &mut reporter, &script.cancel),
        )
        .await
        .expect("실행이 매달리지 않고 끝난다")
    };
    Outcome { result, events }
}

fn output(outcome: Outcome) -> TranslationOutput {
    outcome.result.expect("translation finished")
}

/// 쪽마다 (문단 원문, 화면 글, 상태)
fn shown(pages: &[TranslatedPage]) -> Vec<Vec<(String, Option<String>, ParagraphStatus)>> {
    pages
        .iter()
        .map(|page| {
            page.paragraphs
                .iter()
                .map(|paragraph| {
                    (
                        paragraph.source.clone(),
                        paragraph.target.clone(),
                        paragraph.status,
                    )
                })
                .collect()
        })
        .collect()
}

fn translated_paragraph(source: &str, target: &str) -> (String, Option<String>, ParagraphStatus) {
    (
        source.to_owned(),
        Some(target.to_owned()),
        ParagraphStatus::Translated,
    )
}

type EventRow = (TranslateStage, u32, u32, u32, u32, u32, u32, u32, u32);

/// (단계, done, total, 단계 %, 전체 %, 끝난 문단, 문단 수, 입력 토큰, 출력 토큰)
fn rows(events: &[TranslateProgress]) -> Vec<EventRow> {
    events
        .iter()
        .map(|event| {
            assert_eq!(event.job_id, "job-1");
            (
                event.stage,
                event.done,
                event.total,
                event.stage_percent,
                event.overall_percent,
                event.paragraphs_done,
                event.paragraph_count,
                event.usage.input_tokens,
                event.usage.output_tokens,
            )
        })
        .collect()
}

/// 쪽 2개, 묶음 3개(문단 하나씩), 응답마다 사용량 100/50. 전체 % = ⌊(앞 단계 가중치 × 100 + 단계 % ×
/// 지금 가중치) / 100⌋을 손으로 셈한 값이다: 번역 1/3 → (10 × 100 + 33 × 80) / 100 = 36.4 → 36,
/// 2/3 → (1000 + 66 × 80) / 100 = 62.8 → 62, 배치 1/2 → (90 × 100 + 50 × 10) / 100 = 95. 100은 마지막
/// 이벤트뿐이다.
#[tokio::test]
async fn progress_runs_through_three_weighted_stages_with_usage_and_paragraph_counts() {
    use TranslateStage::{Arrange, ReadDocument, Translate};
    let dir = TempDir::new("progress");
    let glossary = Glossary::default();
    let (a, b, c) = (big("甲"), big("乙"), big("丙"));
    let pages = [text_page(0, &[&a]), text_page(1, &[&b, &c])];
    let script = Script::replies([
        translated(&["가"]),
        translated(&["나"]),
        translated(&["다"]),
    ]);

    let outcome = run(
        &pages,
        options(&glossary),
        true,
        dir.path(),
        &script,
        &mut Renderer::default(),
    )
    .await;

    assert_eq!(
        rows(&outcome.events),
        [
            (ReadDocument, 0, 2, 0, 0, 0, 0, 0, 0),
            (ReadDocument, 2, 2, 100, 10, 0, 3, 0, 0),
            (Translate, 0, 3, 0, 10, 0, 3, 0, 0),
            (Translate, 1, 3, 33, 36, 1, 3, 100, 50),
            (Translate, 2, 3, 66, 62, 2, 3, 200, 100),
            (Translate, 3, 3, 100, 90, 3, 3, 300, 150),
            (Arrange, 1, 2, 50, 95, 3, 3, 300, 150),
            (Arrange, 2, 2, 100, 100, 3, 3, 300, 150),
        ]
    );
    let output = output(outcome);
    assert_eq!(
        shown(&output.pages),
        [
            vec![translated_paragraph(&a, "가")],
            vec![
                translated_paragraph(&b, "나"),
                translated_paragraph(&c, "다")
            ],
        ]
    );
    assert_eq!(
        output.usage,
        TokenUsage {
            input_tokens: 300,
            output_tokens: 150
        }
    );
}

/// API 오류로 멈추면 기록에는 끝난 묶음만 있고, 이어하기는 남은 묶음만 보낸다. 이어하기 진행은 끝난 묶음을
/// 첫 이벤트부터 세고, 결과 사용량은 두 실행의 누적이다.
#[tokio::test]
async fn resume_after_an_api_error_sends_only_the_remaining_chunks() {
    let dir = TempDir::new("resume-error");
    let glossary = Glossary::default();
    let (a, b, c) = (big("甲"), big("乙"), big("丙"));
    let pages = [text_page(0, &[&a]), text_page(1, &[&b, &c])];
    let record_key = options(&glossary).record_key();

    let failed = Script::replies([
        translated(&["가"]),
        error_reply(401, "authentication_error", None),
    ]);
    let first = run(
        &pages,
        options(&glossary),
        true,
        dir.path(),
        &failed,
        &mut Renderer::default(),
    )
    .await;
    let Err(RunError::Api(error)) = first.result else {
        panic!("API 오류로 멈춘다");
    };
    assert_eq!(error.code, ApiErrorCode::KeyInvalid);
    assert_eq!(
        recorded_keys(&dir.record(&record_key)),
        [paragraph_key(0, 1, &a)]
    );

    let resumed = Script::replies([translated(&["나"]), translated(&["다"])]);
    let second = run(
        &pages,
        options(&glossary),
        true,
        dir.path(),
        &resumed,
        &mut Renderer::default(),
    )
    .await;

    assert_eq!(resumed.sent(), [vec![b.clone()], vec![c.clone()]]);
    assert_eq!(
        rows(&second.events)[2],
        (TranslateStage::Translate, 1, 3, 33, 36, 1, 3, 0, 0)
    );
    let output = output(second);
    assert_eq!(
        shown(&output.pages),
        [
            vec![translated_paragraph(&a, "가")],
            vec![
                translated_paragraph(&b, "나"),
                translated_paragraph(&c, "다")
            ],
        ]
    );
    assert_eq!(
        output.usage,
        TokenUsage {
            input_tokens: 300,
            output_tokens: 150
        }
    );
}

/// 묶음 사이 취소: 끝난 묶음은 기록하고 다음 묶음을 보내지 않는다.
#[tokio::test(start_paused = true)]
async fn cancel_between_chunks_keeps_finished_chunks_and_sends_no_more() {
    let dir = TempDir::new("cancel-between");
    let glossary = Glossary::default();
    let (a, b) = (big("甲"), big("乙"));
    let pages = [text_page(0, &[&a, &b])];
    let script = Script::new([Step::ReplyThenCancel(translated(&["가"]))]);

    let outcome = run(
        &pages,
        options(&glossary),
        true,
        dir.path(),
        &script,
        &mut Renderer::default(),
    )
    .await;

    assert!(matches!(outcome.result, Err(RunError::Cancelled)));
    assert_eq!(script.sent(), [vec![a.clone()]]);
    assert_eq!(
        recorded_keys(&dir.record(&options(&glossary).record_key())),
        [paragraph_key(0, 1, &a)]
    );
}

/// 요청 중 취소: 응답을 기다리지 않고 그 요청 future를 버린다(연결을 끊는다). 기록에는 끝난 묶음만 있다.
#[tokio::test(start_paused = true)]
async fn cancel_during_a_request_drops_the_request_and_keeps_finished_chunks() {
    let dir = TempDir::new("cancel-request");
    let glossary = Glossary::default();
    let (a, b, c) = (big("甲"), big("乙"), big("丙"));
    let pages = [text_page(0, &[&a, &b, &c])];
    let script = Script::new([Step::Reply(translated(&["가"])), Step::CancelAndHang]);

    let outcome = run(
        &pages,
        options(&glossary),
        true,
        dir.path(),
        &script,
        &mut Renderer::default(),
    )
    .await;

    assert!(matches!(outcome.result, Err(RunError::Cancelled)));
    assert!(script.hung_request_dropped.load(Ordering::Relaxed));
    assert_eq!(script.sent(), [vec![a.clone()], vec![b.clone()]]);
    assert_eq!(
        recorded_keys(&dir.record(&options(&glossary).record_key())),
        [paragraph_key(0, 1, &a)]
    );
}

/// 긴 문단은 문단 단위로만 기록한다: 조각 일부만 끝난 채 취소되면 기록이 생기지 않고, 이어하기는 조각을
/// 처음부터 다시 보내 번역을 공백 하나로 잇는다.
#[tokio::test(start_paused = true)]
async fn long_paragraph_is_recorded_only_after_all_fragments_and_resent_from_the_start() {
    let dir = TempDir::new("fragments");
    let glossary = Glossary::default();
    // "甲。" 하나가 글 토큰 2.3이라 900번이면 2,070 > 1,900(묶음 글 자리)으로 조각 둘이다.
    let long = "甲。".repeat(900);
    let pages = [text_page(0, &[&long])];
    let record_key = options(&glossary).record_key();

    let cancelled = Script::new([Step::ReplyThenCancel(translated(&["가."]))]);
    let first = run(
        &pages,
        options(&glossary),
        true,
        dir.path(),
        &cancelled,
        &mut Renderer::default(),
    )
    .await;
    assert!(matches!(first.result, Err(RunError::Cancelled)));
    assert!(!dir.record_path(&record_key).exists());

    let resumed = Script::replies([translated(&["가."]), translated(&["나."])]);
    let second = run(
        &pages,
        options(&glossary),
        true,
        dir.path(),
        &resumed,
        &mut Renderer::default(),
    )
    .await;

    let sent = resumed.sent();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0], cancelled.sent()[0]);
    assert_eq!(format!("{}{}", sent[0][0], sent[1][0]), long);
    assert_eq!(
        shown(&output(second).pages),
        [vec![translated_paragraph(&long, "가. 나.")]]
    );
}

/// 실패·거절한 문단은 기록하지 않아 이어하기가 다시 보낸다.
#[tokio::test]
async fn refused_paragraphs_are_not_recorded_and_are_resent_on_resume() {
    let dir = TempDir::new("refused");
    let glossary = Glossary::default();
    let (a, b) = (big("甲"), big("乙"));
    let pages = [text_page(0, &[&a, &b])];

    let first_script = Script::replies([
        ok(message("refusal", json!([]), 100, 0)),
        translated(&["나"]),
    ]);
    let first = run(
        &pages,
        options(&glossary),
        true,
        dir.path(),
        &first_script,
        &mut Renderer::default(),
    )
    .await;
    assert_eq!(
        rows(&first.events).last().map(|row| (row.5, row.6)),
        Some((2, 2))
    );
    assert_eq!(
        shown(&output(first).pages),
        [vec![
            (a.clone(), None, ParagraphStatus::Refused),
            translated_paragraph(&b, "나"),
        ]]
    );

    let resumed = Script::replies([translated(&["가"])]);
    let second = run(
        &pages,
        options(&glossary),
        true,
        dir.path(),
        &resumed,
        &mut Renderer::default(),
    )
    .await;

    assert_eq!(resumed.sent(), [vec![a.clone()]]);
    assert_eq!(
        shown(&output(second).pages),
        [vec![
            translated_paragraph(&a, "가"),
            translated_paragraph(&b, "나")
        ]]
    );
}

/// 기록 키에 든 옵션(모델·용어집·원문 언어·스캔 옵션)이 다르면 이어하지 않고 모두 보낸다. 같은 옵션이면
/// 아무것도 보내지 않고, `resume = false`면 기록을 읽지 않는다.
#[tokio::test]
async fn resume_needs_the_same_model_glossary_language_and_scan_option() {
    let dir = TempDir::new("options");
    let glossary = Glossary::default();
    let with_term = Glossary::new([term("设备", "설비")]);
    let pages = [text_page(0, &[S_A]), scan_page(1)];
    let scan_reply = || {
        completed(&json!({ "paragraphs": [{ "source": "第四章", "text": "제4장" }] }).to_string())
    };
    let full_run = || Script::replies([translated(&["가"]), scan_reply()]);
    let both = vec![vec![S_A.to_owned()], vec!["<scan>".to_owned()]];

    let baseline = full_run();
    output(
        run(
            &pages,
            options(&glossary),
            true,
            dir.path(),
            &baseline,
            &mut Renderer::default(),
        )
        .await,
    );
    let same = Script::replies([]);
    output(
        run(
            &pages,
            options(&glossary),
            true,
            dir.path(),
            &same,
            &mut Renderer::default(),
        )
        .await,
    );
    assert_eq!(same.sent(), Vec::<Vec<String>>::new());

    let variants = [
        (
            "모델",
            TranslationOptions {
                model: TranslateModel::Haiku,
                ..options(&glossary)
            },
            full_run(),
            both.clone(),
        ),
        ("용어집", options(&with_term), full_run(), both.clone()),
        (
            "원문 언어",
            TranslationOptions {
                language: Language::En,
                ..options(&glossary)
            },
            full_run(),
            both.clone(),
        ),
        (
            "스캔 옵션",
            TranslationOptions {
                include_scan_pages: false,
                ..options(&glossary)
            },
            Script::replies([translated(&["가"])]),
            vec![vec![S_A.to_owned()]],
        ),
    ];
    for (name, changed, script, expected) in variants {
        output(
            run(
                &pages,
                changed,
                true,
                dir.path(),
                &script,
                &mut Renderer::default(),
            )
            .await,
        );
        assert_eq!(script.sent(), expected, "{name}");
    }

    let restart = full_run();
    output(
        run(
            &pages,
            options(&glossary),
            false,
            dir.path(),
            &restart,
            &mut Renderer::default(),
        )
        .await,
    );
    assert_eq!(restart.sent(), both);
}

/// 쪽 범위는 기록 키에 들지 않는다: 범위를 바꿔도 겹친 문단은 보내지 않고 기록의 번역을 쓴다.
#[tokio::test]
async fn changing_the_page_range_does_not_resend_overlapping_paragraphs() {
    let dir = TempDir::new("range");
    let glossary = Glossary::default();
    let pages = [
        text_page(0, &[S_A]),
        text_page(1, &[S_B]),
        text_page(2, &[S_C]),
    ];

    let first = Script::replies([translated(&["가", "나"])]);
    output(
        run(
            &pages[0..2],
            options(&glossary),
            true,
            dir.path(),
            &first,
            &mut Renderer::default(),
        )
        .await,
    );

    let second = Script::replies([translated(&["다"])]);
    let result = output(
        run(
            &pages[1..3],
            options(&glossary),
            true,
            dir.path(),
            &second,
            &mut Renderer::default(),
        )
        .await,
    );

    assert_eq!(second.sent(), [vec![S_C.to_owned()]]);
    assert_eq!(
        shown(&result.pages),
        [
            vec![translated_paragraph(S_B, "나")],
            vec![translated_paragraph(S_C, "다")]
        ]
    );
}

/// 쓸 수 없는 기록(JSON이 아님, `version`이 다름, `recordKey`가 파일 이름과 다름)은 없는 것으로 보고 모두
/// 보낸 뒤 새 기록으로 덮는다.
#[tokio::test]
async fn unusable_records_are_ignored_and_overwritten() {
    let dir = TempDir::new("corrupt");
    let glossary = Glossary::default();
    let pages = [text_page(0, &[S_A])];
    let record_key = options(&glossary).record_key();
    output(
        run(
            &pages,
            options(&glossary),
            true,
            dir.path(),
            &Script::replies([translated(&["가"])]),
            &mut Renderer::default(),
        )
        .await,
    );
    let valid = dir.record(&record_key);
    let mut other_version = valid.clone();
    other_version["version"] = json!(2);
    let mut other_key = valid.clone();
    other_key["recordKey"] = json!("0".repeat(32));

    let cases = [
        ("JSON이 아님", b"{\"version\":1,".to_vec()),
        ("version 다름", other_version.to_string().into_bytes()),
        ("recordKey 다름", other_key.to_string().into_bytes()),
    ];
    for (name, bytes) in cases {
        fs::write(dir.record_path(&record_key), bytes).expect("write corrupt record");
        let script = Script::replies([translated(&["새 번역"])]);

        let result = output(
            run(
                &pages,
                options(&glossary),
                true,
                dir.path(),
                &script,
                &mut Renderer::default(),
            )
            .await,
        );

        assert_eq!(script.sent(), [vec![S_A.to_owned()]], "{name}");
        assert_eq!(
            shown(&result.pages),
            [vec![translated_paragraph(S_A, "새 번역")]],
            "{name}"
        );
        let rewritten = dir.record(&record_key);
        assert_eq!(rewritten["version"], 1, "{name}");
        assert_eq!(rewritten["recordKey"], record_key.as_str(), "{name}");
        assert_eq!(
            rewritten["paragraphs"][paragraph_key(0, 1, S_A)]["target"],
            "새 번역",
            "{name}"
        );
    }
}

/// 기록은 제자리에 쓰지 않고 임시 파일 + rename으로 바꾼다: 폴더에 새 파일을 만들 수 없으면(읽기 전용
/// 폴더) 파일 자체는 쓸 수 있어도 기록이 그대로이고, 작업은 멈추지 않는다. 쓴 뒤 임시 파일이 남지 않는다.
#[cfg(unix)]
#[tokio::test]
async fn record_is_replaced_atomically_and_a_failed_write_does_not_stop_the_job() {
    use std::os::unix::fs::PermissionsExt;

    let dir = TempDir::new("atomic");
    let glossary = Glossary::default();
    let pages = [text_page(0, &[S_A])];
    let record_key = options(&glossary).record_key();
    output(
        run(
            &pages,
            options(&glossary),
            true,
            dir.path(),
            &Script::replies([translated(&["가"])]),
            &mut Renderer::default(),
        )
        .await,
    );
    assert_eq!(dir.file_names(), [format!("{record_key}.json")]);
    let before = fs::read(dir.record_path(&record_key)).expect("record");

    let read_only = fs::Permissions::from_mode(0o555);
    fs::set_permissions(dir.path(), read_only).expect("read-only dir");
    let restart = Script::replies([translated(&["새 번역"])]);
    let outcome = run(
        &pages,
        options(&glossary),
        false,
        dir.path(),
        &restart,
        &mut Renderer::default(),
    )
    .await;
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).expect("writable dir");

    assert_eq!(
        shown(&output(outcome).pages),
        [vec![translated_paragraph(S_A, "새 번역")]]
    );
    assert_eq!(
        fs::read(dir.record_path(&record_key)).expect("record"),
        before
    );
    assert_eq!(dir.file_names(), [format!("{record_key}.json")]);
}

/// 쓴 뒤 `.json` 기록이 20개를 넘으면 수정 시각이 오래된 것부터 지운다(방금 쓴 기록은 남는다).
#[tokio::test]
async fn records_beyond_the_limit_are_pruned_oldest_first() {
    let dir = TempDir::new("prune");
    fs::create_dir_all(dir.path()).expect("record dir");
    let day = Duration::from_secs(86_400);
    for index in 0..21_u32 {
        let path = dir.path().join(format!("old-{index:02}.json"));
        fs::write(&path, "{}").expect("old record");
        let modified = SystemTime::UNIX_EPOCH + day * (index + 1);
        fs::File::options()
            .write(true)
            .open(&path)
            .and_then(|file| file.set_modified(modified))
            .expect("set modified");
    }
    fs::write(dir.path().join("notes.txt"), "not a record").expect("other file");
    let glossary = Glossary::default();
    let record_key = options(&glossary).record_key();

    output(
        run(
            &[text_page(0, &[S_A])],
            options(&glossary),
            true,
            dir.path(),
            &Script::replies([translated(&["가"])]),
            &mut Renderer::default(),
        )
        .await,
    );

    let mut expected: Vec<String> = (2..21)
        .map(|index| format!("old-{index:02}.json"))
        .collect();
    expected.push(format!("{record_key}.json"));
    expected.push("notes.txt".to_owned());
    expected.sort();
    assert_eq!(dir.file_names(), expected);
}

/// 스캔 쪽: 보내기 직전에 그림을 만들고, 받아 적은 문단에 `{쪽}-{번호}-{원문 해시}` 키(Python `hashlib`
/// 리터럴)를 매겨 쪽째 기록한다. 이어하기는 그 쪽을 보내지 않고 기록으로 같은 결과를 만든다. 쓴 용어는
/// 받아 적은 원문까지 본다.
#[tokio::test]
async fn scan_page_is_recorded_as_a_whole_page_and_not_resent() {
    let dir = TempDir::new("scan");
    let glossary = Glossary::new([term("验收", "검수"), term("乙方", "을")]);
    let pages = [text_page(0, &[S_A]), scan_page(1)];
    let scan_reply = completed(
        &json!({ "paragraphs": [
            { "source": "第四章 验收", "text": "제4장 검수" },
            { "source": "第五条 付款", "text": "제5조 지급" },
        ]})
        .to_string(),
    );
    let first_script = Script::replies([translated(&["가"]), scan_reply]);
    let mut first_renderer = Renderer::default();

    let first = run(
        &pages,
        options(&glossary),
        true,
        dir.path(),
        &first_script,
        &mut first_renderer,
    )
    .await;

    assert_eq!(first_renderer.rendered, [1]);
    let counts: Vec<(u32, u32)> = rows(&first.events)
        .iter()
        .filter(|row| row.0 == TranslateStage::Translate)
        .map(|row| (row.5, row.6))
        .collect();
    assert_eq!(counts, [(0, 1), (1, 1), (3, 3)]);
    let first = output(first);
    let scan = &first.pages[1];
    assert_eq!(scan.kind, PageKind::Image);
    let keys: Vec<&str> = scan
        .paragraphs
        .iter()
        .map(|paragraph| paragraph.key.as_str())
        .collect();
    assert_eq!(keys, ["1-1-bcfdf28f7f846c51", "1-2-6726d5f590cb2a96"]);
    assert_eq!(first.glossary_used, [term("验收", "검수")]);

    let resumed = Script::replies([]);
    let mut second_renderer = Renderer::default();
    let second = output(
        run(
            &pages,
            options(&glossary),
            true,
            dir.path(),
            &resumed,
            &mut second_renderer,
        )
        .await,
    );

    assert_eq!(resumed.sent(), Vec::<Vec<String>>::new());
    assert_eq!(second_renderer.rendered, Vec::<u32>::new());
    assert_eq!(second.pages, first.pages);
    assert_eq!(second.glossary_used, first.glossary_used);
}

/// 스캔 쪽이 거절되면 쪽 실패로 두고 기록하지 않는다. 그림을 만들지 못하면 작업을 멈춘다(끝난 묶음은 기록에 있다).
#[tokio::test]
async fn refused_scan_page_fails_the_page_and_render_failure_stops_the_job() {
    let glossary = Glossary::default();
    let pages = [text_page(0, &[S_A]), scan_page(1)];

    let refused_dir = TempDir::new("scan-refused");
    let refused = output(
        run(
            &pages,
            options(&glossary),
            true,
            refused_dir.path(),
            &Script::replies([
                translated(&["가"]),
                ok(message("refusal", json!([]), 100, 0)),
            ]),
            &mut Renderer::default(),
        )
        .await,
    );
    assert_eq!(refused.pages[1].failure, Some(PageFailure::Refused));
    assert_eq!(
        refused_dir.record(&refused.record_key)["scanPages"],
        json!({})
    );

    let render_dir = TempDir::new("scan-render");
    let script = Script::replies([translated(&["가"])]);
    let outcome = run(
        &pages,
        options(&glossary),
        true,
        render_dir.path(),
        &script,
        &mut Renderer {
            fail: true,
            ..Renderer::default()
        },
    )
    .await;
    assert!(matches!(
        outcome.result,
        Err(RunError::Render(RENDER_FAILED))
    ));
    assert_eq!(script.sent(), [vec![S_A.to_owned()]]);
    assert_eq!(
        recorded_keys(&render_dir.record(&options(&glossary).record_key())),
        [paragraph_key(0, 1, S_A)]
    );
}

/// 문단 하나뿐인 묶음이 잘리면 그 문단은 `Failed(Truncated)`이고 화면 글이 없다.
#[tokio::test]
async fn truncated_single_paragraph_is_failed_without_target() {
    let dir = TempDir::new("truncated");
    let glossary = Glossary::default();
    let result = output(
        run(
            &[text_page(0, &[S_A])],
            options(&glossary),
            true,
            dir.path(),
            &Script::replies([common::truncated()]),
            &mut Renderer::default(),
        )
        .await,
    );

    assert_eq!(
        shown(&result.pages),
        [vec![(
            S_A.to_owned(),
            None,
            ParagraphStatus::Failed(FailReason::Truncated)
        )]]
    );
    assert!(!dir.record_path(&result.record_key).exists());
}
