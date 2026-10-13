//! Messages API 200 응답 읽기와 검증(ADR 0002 §6). structured outputs의 스키마 보장은 정상 완료에만
//! 성립하므로 `stop_reason`을 먼저 보고 파싱한다. 응답 본문·글은 로그·오류에 남기지 않는다(§12).

use serde::Deserialize;
use serde_json::Value;
use unicode_normalization::UnicodeNormalization;

use crate::usage::TokenUsage;

/// `stop_reason` 값(공식 문서 `build-with-claude/handling-stop-reasons`)
const STOP_END_TURN: &str = "end_turn";
const STOP_MAX_TOKENS: &str = "max_tokens";
const STOP_CONTEXT_WINDOW_EXCEEDED: &str = "model_context_window_exceeded";
const STOP_REFUSAL: &str = "refusal";

/// 200 응답 하나를 읽은 결과
pub(crate) struct Reply {
    /// 본문에서 읽은 사용량(없거나 읽을 수 없으면 0)
    pub usage: TokenUsage,
    pub kind: ReplyKind,
}

pub(crate) enum ReplyKind {
    /// `end_turn`이고 `text` 블록이 정확히 하나. 그 글(structured outputs JSON)이다.
    Complete(String),
    /// `max_tokens`·`model_context_window_exceeded`. 출력은 버린다.
    Truncated,
    /// `refusal`. `stop_details.category`(식별자 모양일 때만, 로그용)
    Refused(Option<String>),
    /// 그 밖 모양. 사유는 로그용 고정 문구다.
    Invalid(&'static str),
}

/// 스캔 쪽에서 받아 적은 문단 하나(NFC, 앞뒤 공백을 지운, 비지 않은)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanParagraph {
    pub source: String,
    pub text: String,
}

#[derive(Deserialize)]
struct Envelope {
    content: Option<Vec<ContentBlock>>,
    stop_reason: Option<String>,
    stop_details: Option<StopDetails>,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    /// `thinking` 등 나머지 블록은 버린다.
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct StopDetails {
    category: Option<String>,
}

#[derive(Deserialize)]
struct RawUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

/// 텍스트 묶음 출력 스키마(모르는 필드 거부)
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TextOutput {
    paragraphs: Vec<TextOutputItem>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TextOutputItem {
    id: String,
    text: String,
}

/// 스캔 묶음 출력 스키마(모르는 필드 거부)
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ScanOutput {
    paragraphs: Vec<ScanOutputItem>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ScanOutputItem {
    source: String,
    text: String,
}

pub(crate) fn read_reply(body: &[u8]) -> Reply {
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return Reply {
            usage: TokenUsage::default(),
            kind: ReplyKind::Invalid("응답 본문이 JSON이 아니다"),
        };
    };
    let usage = read_usage(&value);
    let kind = match serde_json::from_value::<Envelope>(value) {
        Ok(envelope) => classify(envelope),
        Err(_) => ReplyKind::Invalid("응답 모양이 다르다"),
    };
    Reply { usage, kind }
}

fn read_usage(value: &Value) -> TokenUsage {
    value
        .get("usage")
        .and_then(|usage| RawUsage::deserialize(usage).ok())
        .map(|usage| TokenUsage::new(usage.input_tokens, usage.output_tokens))
        .unwrap_or_default()
}

fn classify(envelope: Envelope) -> ReplyKind {
    let (Some(content), Some(stop_reason)) = (envelope.content, envelope.stop_reason) else {
        return ReplyKind::Invalid("content·stop_reason이 없다");
    };
    match stop_reason.as_str() {
        STOP_END_TURN => {
            let mut texts = content.into_iter().filter_map(|block| match block {
                ContentBlock::Text { text } => Some(text),
                ContentBlock::Other => None,
            });
            match (texts.next(), texts.next()) {
                (Some(text), None) => ReplyKind::Complete(text),
                _ => ReplyKind::Invalid("text 블록이 하나가 아니다"),
            }
        }
        STOP_MAX_TOKENS | STOP_CONTEXT_WINDOW_EXCEEDED => ReplyKind::Truncated,
        STOP_REFUSAL => ReplyKind::Refused(
            envelope
                .stop_details
                .and_then(|details| details.category)
                .filter(|category| is_identifier(category)),
        ),
        _ => ReplyKind::Invalid("알 수 없는 stop_reason"),
    }
}

/// 텍스트 묶음 출력 검증: ID가 보낸 `"1"`..`"n"`과 길이·순서까지 같고, 번역(앞뒤 공백을 지운)이 비지
/// 않아야 한다(ADR 0002 §6 "내용 검증(텍스트)").
pub(crate) fn validate_text(output: &str, item_count: usize) -> Result<Vec<String>, &'static str> {
    let output: TextOutput = serde_json::from_str(output).map_err(|_| "출력이 스키마와 다르다")?;
    if output.paragraphs.len() != item_count {
        return Err("항목 수가 다르다");
    }
    output
        .paragraphs
        .into_iter()
        .zip(1_usize..)
        .map(|(item, expected_id)| {
            if item.id != expected_id.to_string() {
                return Err("ID가 보낸 순서와 다르다");
            }
            let text = item.text.trim();
            if text.is_empty() {
                return Err("빈 번역이 있다");
            }
            Ok(text.to_owned())
        })
        .collect()
}

/// 스캔 묶음 출력 검증: `source`·`text`를 NFC로 바꾸고 앞뒤 공백을 지운 뒤 둘 중 하나라도 빈 항목은
/// 버린다. 0개면 글이 없는 쪽이다(ADR 0002 §6 "내용 검증(스캔)").
pub(crate) fn validate_scan(output: &str) -> Result<Vec<ScanParagraph>, &'static str> {
    let output: ScanOutput = serde_json::from_str(output).map_err(|_| "출력이 스키마와 다르다")?;
    Ok(output
        .paragraphs
        .into_iter()
        .map(|item| ScanParagraph {
            source: normalize(&item.source),
            text: normalize(&item.text),
        })
        .filter(|paragraph| !paragraph.source.is_empty() && !paragraph.text.is_empty())
        .collect())
}

fn normalize(text: &str) -> String {
    text.nfc().collect::<String>().trim().to_owned()
}

/// 서버가 준 식별자(오류 `type`, 거절 범주 등)를 로그에 남겨도 되는 모양인가: ASCII 소문자·숫자·`_`
/// 만, `MAX_IDENTIFIER_LEN` 이하. 문서 글이 섞인 값은 버린다.
pub(crate) fn is_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_IDENTIFIER_LEN
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

/// 로그에 남기는 서버 식별자 길이 상한. 공식 값(`enforced_spend_limit_reached` 등)은 30자 안이다.
const MAX_IDENTIFIER_LEN: usize = 64;
