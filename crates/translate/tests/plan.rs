//! 계획(ADR 0002 §4 "계획", §10 `TranslationPlan`): 묶음 수는 범위 전체, 예상치는 보낼 것만, 이어하기 가능
//! 여부는 같은 옵션의 기록으로 센다. 기대값은 `chunk.rs`·`models.rs` 상수로 손으로 셈한 리터럴이다(글 토큰은
//! Python으로 따로 셈해 맞췄다: `甲方应当交付设备。` 12, `乙方负责验收。` 9, `本合同自签字之日起生效。` 16,
//! `甲方`·`乙方` 3, `갑`·`을` 1).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::json;
use translate::{
    Glossary, GlossaryTerm, Language, PlanInput, ResumeState, ScanImage, SourcePage,
    SourcePageContent, SourceParagraph, TranslateModel, TranslationOptions, TranslationPlan,
    load_translation_record, paragraph_key, plan_translation,
};

const S_A: &str = "甲方应当交付设备。";
const S_B: &str = "乙方负责验收。";
const S_C: &str = "本合同自签字之日起生效。";

fn term(source: &str, target: &str) -> GlossaryTerm {
    GlossaryTerm {
        source: source.to_owned(),
        target: target.to_owned(),
    }
}

/// 쪽 0: 짧은 문단 셋(묶음 하나), 쪽 1: A4 세로 스캔 쪽(그림 1568 × 1109)
fn pages() -> Vec<SourcePage> {
    vec![
        SourcePage {
            page: 0,
            content: SourcePageContent::Text(
                [S_A, S_B, S_C]
                    .iter()
                    .zip(1..)
                    .map(|(text, number)| SourceParagraph {
                        number,
                        text: (*text).to_owned(),
                        heading: false,
                    })
                    .collect(),
            ),
        },
        SourcePage {
            page: 1,
            content: SourcePageContent::Scan(ScanImage {
                width_px: 1_568,
                height_px: 1_109,
            }),
        },
    ]
}

fn options(glossary: &Glossary) -> TranslationOptions<'_> {
    TranslationOptions {
        file_sha256: [3; 32],
        document_has_scan_pages: true,
        language: Language::Zh,
        model: TranslateModel::Sonnet,
        glossary,
        include_scan_pages: true,
    }
}

fn plan(
    pages: &[SourcePage],
    glossary: &Glossary,
    language: Option<Language>,
    record: Option<&translate::TranslationRecord>,
) -> TranslationPlan {
    plan_translation(PlanInput {
        pages,
        glossary,
        language,
        model: TranslateModel::Sonnet,
        include_scan_pages: true,
        record,
    })
}

/// 테스트마다 새 기록 폴더(끝나면 지운다)
struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        static SEQUENCE: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "translate-plan-{}-{name}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::remove_dir_all(&path).ok();
        fs::create_dir_all(&path).expect("record dir");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).ok();
    }
}

/// 기록 하나: 쪽 0의 첫 문단과 스캔 쪽 1(받아 적은 문단 둘)이 끝났다.
fn write_record(dir: &Path, record_key: &str) {
    let record = json!({
        "version": 1,
        "recordKey": record_key,
        "createdAtMs": 0,
        "usage": { "inputTokens": 700, "outputTokens": 90 },
        "paragraphs": { paragraph_key(0, 1, S_A): { "target": "갑은 설비를 인도해야 한다.", "edited": null } },
        "scanPages": {
            "1": [
                { "key": "1-1-aaaaaaaaaaaaaaaa", "number": 1, "source": "第四章", "target": "제4장", "edited": null },
                { "key": "1-2-bbbbbbbbbbbbbbbb", "number": 2, "source": "附则", "target": "부칙", "edited": null },
            ],
        },
    });
    fs::write(
        dir.join(format!("{record_key}.json")),
        serde_json::to_vec(&record).expect("record JSON"),
    )
    .expect("write record");
}

/// 기록이 없으면 묶음 전체가 보낼 것이다: 텍스트 묶음 입력 1,100 + 용어 `甲方 → 갑` 4 + `乙方 → 을` 4 + 글
/// 12 + 9 + 16 = 1,145, 출력 ⌈37 × 1.5⌉ + 문단 3 × 12 = 92. 스캔 묶음 입력 1,100 + 그림 56 × 40 = 2,240 + 용어
/// 전체 8 = 3,348, 출력 3,500. 합 4,493 / 3,592, 요금(Sonnet $2·$10) 4,493 × 2 + 3,592 × 10 = 44,906 micro-USD.
///
/// 같은 옵션의 기록에 첫 문단과 스캔 쪽이 있으면 남은 두 문단만 센다: 입력 1,100 + 그 둘에 나오는 용어
/// `乙方 → 을` 4 + 글 9 + 16 = 1,129, 출력 ⌈25 × 1.5⌉ + 문단 2 × 12 = 62, 요금 1,129 × 2 + 62 × 10 = 2,878. 묶음 수는 그대로
/// 둘이고, 이어하기는 끝난 문단 3(텍스트 1 + 받아 적은 2) / 문단 5다.
#[test]
fn estimates_count_only_what_is_left_to_send_while_chunks_count_the_whole_range() {
    let glossary = Glossary::new([term("甲方", "갑"), term("乙方", "을")]);
    let pages = pages();
    let dir = TempDir::new("resume");
    let options = options(&glossary);
    write_record(dir.path(), &options.record_key());

    let fresh = plan(&pages, &glossary, Some(Language::Zh), None);
    let record = load_translation_record(dir.path(), &options).expect("same options record");
    let resumed = plan(&pages, &glossary, Some(Language::Zh), Some(&record));

    assert_eq!(
        fresh,
        TranslationPlan {
            paragraph_count: 3,
            chunk_count: 2,
            estimated_input_tokens: 4_493,
            estimated_output_tokens: 3_592,
            estimated_cost_micro_usd: 44_906,
            resumable: None,
        }
    );
    assert_eq!(
        resumed,
        TranslationPlan {
            paragraph_count: 5,
            chunk_count: 2,
            estimated_input_tokens: 1_129,
            estimated_output_tokens: 62,
            estimated_cost_micro_usd: 2_878,
            resumable: Some(ResumeState {
                translated_paragraphs: 3,
                paragraph_count: 5,
            }),
        }
    );
}

/// 자동 감지로 원문 언어를 정하지 못하면(화면이 실행을 막는다) 묶음·문단 수만 세고 예상치는 0이다.
#[test]
fn undetermined_language_counts_chunks_without_estimates() {
    let glossary = Glossary::default();

    assert_eq!(
        plan(&pages(), &glossary, None, None),
        TranslationPlan {
            paragraph_count: 3,
            chunk_count: 2,
            estimated_input_tokens: 0,
            estimated_output_tokens: 0,
            estimated_cost_micro_usd: 0,
            resumable: None,
        }
    );
}
