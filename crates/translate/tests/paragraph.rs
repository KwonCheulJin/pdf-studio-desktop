//! 문단 하나 다시 번역·직접 고치기(ADR 0002 §5 "다시 번역", §8, §10). 기록은 테스트마다 새 폴더에 손으로 쓰고,
//! 다시 번역은 가짜 전송(`common`)이 손으로 쓴 응답을 돌려준다. 실제 API를 부르지 않는다.

mod common;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use common::{FakeTransport, key, translated};
use serde_json::{Value, json};
use translate::{
    FailReason, Glossary, GlossaryTerm, Language, ParagraphNotFound, ParagraphStatus,
    ParagraphTarget, SourcePage, SourcePageContent, SourceParagraph, TokenUsage, TranslateModel,
    TranslatedParagraph, TranslationOptions, edit_translated_paragraph, locate_paragraph,
    paragraph_key, retranslate_paragraph,
};

const S_A: &str = "甲方应当交付设备。";
const S_B: &str = "乙方负责验收。";
const S_C: &str = "本合同自签字之日起生效。";
const B_TARGET: &str = "을은 검수를 맡는다.";

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

/// 쪽 0: A, B / 쪽 1: C
fn pages() -> Vec<SourcePage> {
    vec![text_page(0, &[S_A, S_B]), text_page(1, &[S_C])]
}

fn options(glossary: &Glossary) -> TranslationOptions<'_> {
    TranslationOptions {
        file_sha256: [9; 32],
        document_has_scan_pages: false,
        language: Language::Zh,
        model: TranslateModel::Sonnet,
        glossary,
        include_scan_pages: false,
    }
}

/// 테스트마다 새 기록 폴더(끝나면 지운다)
struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        static SEQUENCE: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "translate-paragraph-{}-{name}-{}",
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

    fn write_record(&self, record_key: &str, paragraphs: Value) {
        let record = json!({
            "version": 1,
            "recordKey": record_key,
            "createdAtMs": 0,
            "usage": { "inputTokens": 1000, "outputTokens": 500 },
            "paragraphs": paragraphs,
            "scanPages": {},
        });
        fs::write(
            self.0.join(format!("{record_key}.json")),
            serde_json::to_vec(&record).expect("record JSON"),
        )
        .expect("write record");
    }

    fn record(&self, record_key: &str) -> Value {
        let bytes = fs::read(self.0.join(format!("{record_key}.json"))).expect("record file");
        serde_json::from_slice(&bytes).expect("record JSON")
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).ok();
    }
}

fn target<'a>(
    pages: &'a [SourcePage],
    glossary: &'a Glossary,
    dir: &'a Path,
    record_key: &'a str,
    key: &'a str,
) -> ParagraphTarget<'a> {
    ParagraphTarget {
        pages,
        options: options(glossary),
        record_dir: dir,
        record_key,
        key,
    }
}

fn paragraph(
    key: &str,
    number: u32,
    source: &str,
    target: Option<&str>,
    status: ParagraphStatus,
) -> TranslatedParagraph {
    TranslatedParagraph {
        key: key.to_owned(),
        number,
        source: source.to_owned(),
        target: target.map(str::to_owned),
        heading: false,
        status,
    }
}

/// 다시 번역은 그 문단 하나(ID "1")에 문서 순서의 앞·뒤 문단 원문(쪽을 넘어도)을 `<context>`로 싣는다. 받은 번역이
/// 직접 고친 글을 대신하고(고친 글을 지운다), 받은 사용량을 기록 누적에 더한다.
#[tokio::test]
async fn retranslation_sends_neighbors_as_context_and_replaces_the_recorded_text() {
    let glossary = Glossary::new([GlossaryTerm {
        source: "乙方".to_owned(),
        target: "을".to_owned(),
    }]);
    let pages = pages();
    let dir = TempDir::new("retranslate");
    let record_key = options(&glossary).record_key();
    let key_b = paragraph_key(0, 2, S_B);
    dir.write_record(
        &record_key,
        json!({ key_b.clone(): { "target": B_TARGET, "edited": "을이 검수한다(고침)" } }),
    );
    let transport = FakeTransport::new([translated(&["을은 인수 검사를 맡는다."])]);

    let located = locate_paragraph(target(&pages, &glossary, dir.path(), &record_key, &key_b))
        .expect("paragraph");
    let retranslated = retranslate_paragraph(located, &transport, key(), &AtomicBool::new(false))
        .await
        .expect("retranslated");

    let calls = transport.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(common::item_texts(&calls[0].body), [S_B]);
    let user_text = calls[0].body["messages"][0]["content"][0]["text"]
        .as_str()
        .expect("user text");
    let context_start = user_text.find("<context>\n").expect("<context>") + "<context>\n".len();
    let context_end = user_text.find("\n</context>").expect("</context>");
    let context: Value =
        serde_json::from_str(&user_text[context_start..context_end]).expect("context JSON");
    assert_eq!(context, json!({ "before": S_A, "after": S_C }));
    assert_eq!(
        retranslated.paragraph,
        paragraph(
            &key_b,
            2,
            S_B,
            Some("을은 인수 검사를 맡는다."),
            ParagraphStatus::Translated
        )
    );
    assert_eq!(
        retranslated.usage,
        TokenUsage {
            input_tokens: 100,
            output_tokens: 50
        }
    );
    let record = dir.record(&record_key);
    assert_eq!(
        record["paragraphs"][&key_b],
        json!({ "target": "을은 인수 검사를 맡는다.", "edited": null })
    );
    assert_eq!(
        record["usage"],
        json!({ "inputTokens": 1100, "outputTokens": 550 })
    );
}

/// 직접 고친 글은 앞뒤 공백을 지워 `edited`로 둔다. 빈 글이면 고친 글을 지워 원래 번역으로 돌아가고, 원래 번역이
/// 없는(실패한) 문단은 기록에서 빠져 다시 보낼 문단이 된다(기록 문단은 `target`·`edited` 가운데 하나는 있다).
#[test]
fn edits_are_trimmed_and_an_empty_edit_reverts_to_the_translation_or_the_failure() {
    let glossary = Glossary::default();
    let pages = pages();
    let dir = TempDir::new("edit");
    let record_key = options(&glossary).record_key();
    let key_a = paragraph_key(0, 1, S_A);
    let key_b = paragraph_key(0, 2, S_B);
    dir.write_record(
        &record_key,
        json!({ key_b.clone(): { "target": B_TARGET, "edited": null } }),
    );
    let edit = |key: &str, text: &str| {
        let located = locate_paragraph(target(&pages, &glossary, dir.path(), &record_key, key))
            .expect("paragraph");
        edit_translated_paragraph(located, text).expect("saved")
    };

    let failed_edited = edit(&key_a, "  갑이 설비를 인도한다.\n");
    let recorded_failed_edit = dir.record(&record_key)["paragraphs"][&key_a].clone();
    let failed_reverted = edit(&key_a, " \t ");
    let recorded_after_revert = dir.record(&record_key)["paragraphs"].get(&key_a).cloned();
    let translated_edited = edit(&key_b, "을이 검수한다.");
    let translated_reverted = edit(&key_b, "");

    assert_eq!(
        failed_edited,
        paragraph(
            &key_a,
            1,
            S_A,
            Some("갑이 설비를 인도한다."),
            ParagraphStatus::Edited
        )
    );
    assert_eq!(
        recorded_failed_edit,
        json!({ "target": null, "edited": "갑이 설비를 인도한다." })
    );
    assert_eq!(
        failed_reverted,
        paragraph(
            &key_a,
            1,
            S_A,
            None,
            ParagraphStatus::Failed(FailReason::Mismatch)
        )
    );
    assert_eq!(
        translated_edited,
        paragraph(
            &key_b,
            2,
            S_B,
            Some("을이 검수한다."),
            ParagraphStatus::Edited
        )
    );
    assert_eq!(
        translated_reverted,
        paragraph(&key_b, 2, S_B, Some(B_TARGET), ParagraphStatus::Translated)
    );
    assert_eq!(recorded_after_revert, None);
    assert_eq!(
        dir.record(&record_key)["paragraphs"][&key_b],
        json!({ "target": B_TARGET, "edited": null })
    );
}

/// 결과의 기록 키가 지금 파일·옵션으로 다시 센 키와 다르거나(파일이 바뀌었다) 문단 키가 지금 범위에 없으면
/// 찾지 못한다.
#[test]
fn a_different_record_key_or_an_unknown_paragraph_is_not_found() {
    let glossary = Glossary::default();
    let pages = pages();
    let dir = TempDir::new("not-found");
    let record_key = options(&glossary).record_key();
    let key_a = paragraph_key(0, 1, S_A);
    let stale_key = paragraph_key(0, 1, "甲方应当交付设备");

    let other_record = locate_paragraph(target(
        &pages,
        &glossary,
        dir.path(),
        "00000000000000000000000000000000",
        &key_a,
    ));
    let unknown_paragraph = locate_paragraph(target(
        &pages,
        &glossary,
        dir.path(),
        &record_key,
        &stale_key,
    ));

    assert_eq!(other_record.err(), Some(ParagraphNotFound));
    assert_eq!(unknown_paragraph.err(), Some(ParagraphNotFound));
}
