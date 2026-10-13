//! 키·문서 글 보호(ADR 0002 §12): 키와 문서 글(원문·용어집)이 든 요청이 실패했을 때 오류 글(`Display`·
//! `Debug`)과 로그에 키·글이 없다. 서버가 오류 `message`·거절 설명·출력에 문서 글을 되돌려 보내도 남지
//! 않아야 한다. 키 형식 검사도 여기서 본다.

mod common;

use std::sync::{Mutex, Once};

use common::{FakeTransport, KEY, completed, key, message, ok, term, text_chunk};
use serde_json::json;
use translate::{
    ApiKey, HttpResponse, InvalidApiKey, Language, MessagesClient, TranslateModel, TransportError,
};

const DOCUMENT_TEXT: &str = "机密条款甲方须支付违约金";
const GLOSSARY_TARGET: &str = "비밀용어번역";

static LOG_LINES: Mutex<Vec<String>> = Mutex::new(Vec::new());
static INIT_LOGGER: Once = Once::new();

struct CapturingLogger;

impl log::Log for CapturingLogger {
    fn enabled(&self, _metadata: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        LOG_LINES
            .lock()
            .expect("log lines")
            .push(record.args().to_string());
    }

    fn flush(&self) {}
}

fn capture_logs() {
    INIT_LOGGER.call_once(|| {
        log::set_logger(&CapturingLogger).expect("logger");
        log::set_max_level(log::LevelFilter::Trace);
    });
}

fn assert_no_secret(text: &str) {
    for secret in [KEY, DOCUMENT_TEXT, "机密条款", GLOSSARY_TARGET] {
        assert!(!text.contains(secret), "{text:?}에 {secret:?}가 있다");
    }
}

/// 서버가 보낸 오류 본문: `message`·`type`에 문서 글과 키를 되돌려 보낸다.
fn echoing_error(status: u16, error_type: &str) -> Result<HttpResponse, TransportError> {
    Ok(HttpResponse {
        status,
        retry_after: None,
        request_id: Some("req_echo".to_owned()),
        body: json!({
            "type": "error",
            "error": { "type": error_type, "message": format!("bad input: {DOCUMENT_TEXT} key {KEY}") },
        })
        .to_string()
        .into_bytes(),
    })
}

#[tokio::test(start_paused = true)]
async fn failed_requests_leave_no_key_or_document_text_in_errors_or_logs() {
    capture_logs();
    let scenarios = [
        vec![echoing_error(400, "invalid_request_error")],
        vec![echoing_error(401, DOCUMENT_TEXT)],
        vec![
            echoing_error(529, "overloaded_error"),
            Err(TransportError::Connection),
            Err(TransportError::Timeout),
            echoing_error(500, "api_error"),
        ],
        vec![ok(json!({
            "content": [{ "type": "text", "text": DOCUMENT_TEXT }],
            "stop_reason": "refusal",
            "stop_details": { "type": "refusal", "category": DOCUMENT_TEXT, "explanation": DOCUMENT_TEXT },
            "usage": { "input_tokens": 10, "output_tokens": 1 },
        }))],
        vec![
            completed(DOCUMENT_TEXT),
            completed(&format!(
                "{{\"paragraphs\":[{{\"id\":\"9\",\"text\":\"{DOCUMENT_TEXT}\"}}]}}"
            )),
        ],
        vec![ok(message(
            "max_tokens",
            json!([{ "type": "text", "text": DOCUMENT_TEXT }]),
            10,
            9,
        ))],
    ];
    for replies in scenarios {
        let transport = FakeTransport::new(replies);
        let client = MessagesClient::new(&transport, key(), TranslateModel::Sonnet, Language::Zh);

        let attempt = client
            .translate_text(&text_chunk(
                &[DOCUMENT_TEXT],
                &[term("机密条款", GLOSSARY_TARGET)],
            ))
            .await;

        if let Err(error) = &attempt.result {
            assert_no_secret(&error.to_string());
            assert_no_secret(&format!("{error:?}"));
        }
    }

    let lines = LOG_LINES.lock().expect("log lines").clone();
    assert!(lines.len() >= 6, "실패마다 로그가 남는다: {lines:?}");
    lines.iter().for_each(|line| assert_no_secret(line));
    assert_eq!(format!("{:?}", key()), "ApiKey(***)");
}

/// 앞뒤 공백을 지운 뒤 `sk-ant-` 접두, 256자 이하, ASCII 그래픽 글자만
#[test]
fn api_key_format_is_checked_without_network() {
    let at_limit = format!("sk-ant-{}", "a".repeat(256 - "sk-ant-".len()));
    assert!(ApiKey::parse(&format!("  {KEY}\n")).is_ok());
    assert!(ApiKey::parse(&at_limit).is_ok());

    let rejected = [
        String::new(),
        "sk-proj-abc".to_owned(),
        format!("{at_limit}a"),
        "sk-ant-abc def".to_owned(),
        "sk-ant-abc\u{7}".to_owned(),
        "sk-ant-한글".to_owned(),
    ];
    for raw in rejected {
        assert_eq!(
            ApiKey::parse(&raw).map(|_| ()),
            Err(InvalidApiKey),
            "{raw:?}"
        );
    }
}
