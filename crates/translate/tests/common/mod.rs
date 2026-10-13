//! 가짜 전송과 손으로 쓴 Messages API 응답(공식 문서 `api/messages`·`api/errors` 모양). 실제 API를
//! 부르지 않는다. 응답 글은 가상 문서다.

#![allow(dead_code)] // 테스트 파일마다 쓰는 도우미가 다르다

use std::collections::VecDeque;
use std::sync::Mutex;

use serde_json::{Value, json};
use tokio::time::Instant;
use translate::{
    ApiKey, ChunkEstimate, ChunkItem, GlossaryTerm, HttpResponse, TextChunk, Transport,
    TransportError,
};

pub const KEY: &str = "sk-ant-api03-test-key-not-real";

pub fn key() -> ApiKey {
    ApiKey::parse(KEY).expect("key")
}

/// 받은 요청 하나
#[derive(Clone)]
pub struct Call {
    pub at: Instant,
    pub body: Value,
}

/// 차례로 쓸 응답을 들고, 받은 요청을 기록한다.
pub struct FakeTransport {
    replies: Mutex<VecDeque<Result<HttpResponse, TransportError>>>,
    calls: Mutex<Vec<Call>>,
}

impl FakeTransport {
    pub fn new(replies: impl IntoIterator<Item = Result<HttpResponse, TransportError>>) -> Self {
        Self {
            replies: Mutex::new(replies.into_iter().collect()),
            calls: Mutex::new(Vec::new()),
        }
    }

    /// 받은 요청(복사본. 잠금을 쥔 채 돌려주지 않는다)
    pub fn calls(&self) -> Vec<Call> {
        self.calls.lock().expect("calls").clone()
    }

    /// 요청마다 보낸 항목 원문
    pub fn sent_texts(&self) -> Vec<Vec<String>> {
        self.calls()
            .iter()
            .map(|call| item_texts(&call.body))
            .collect()
    }
}

impl Transport for FakeTransport {
    fn post_messages(
        &self,
        _key: &ApiKey,
        body: &[u8],
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send {
        self.calls.lock().expect("calls").push(Call {
            at: Instant::now(),
            body: serde_json::from_slice(body).expect("request JSON"),
        });
        let reply = self
            .replies
            .lock()
            .expect("replies")
            .pop_front()
            .expect("준비한 응답보다 요청이 많다");
        std::future::ready(reply)
    }

    async fn get_models(&self, _key: &ApiKey) -> Result<HttpResponse, TransportError> {
        panic!("번역 요청 테스트는 모델 목록을 받지 않는다")
    }
}

/// 텍스트 요청의 `<paragraphs>` 배열에서 항목 원문을 꺼낸다(ID가 1부터 차례인지도 본다).
pub fn item_texts(body: &Value) -> Vec<String> {
    let text = body["messages"][0]["content"][0]["text"]
        .as_str()
        .expect("user text");
    let start = text.find("<paragraphs>\n").expect("<paragraphs>") + "<paragraphs>\n".len();
    let end = text.find("\n</paragraphs>").expect("</paragraphs>");
    let items: Vec<Value> = serde_json::from_str(&text[start..end]).expect("paragraphs JSON");
    items
        .iter()
        .zip(1..)
        .map(|(item, id)| {
            assert_eq!(item["id"], id.to_string(), "요청 ID는 1부터 차례다");
            item["text"].as_str().expect("text").to_owned()
        })
        .collect()
}

/// 200 응답(본문 그대로)
pub fn ok(body: Value) -> Result<HttpResponse, TransportError> {
    ok_raw(&body.to_string())
}

pub fn ok_raw(body: &str) -> Result<HttpResponse, TransportError> {
    Ok(HttpResponse {
        status: 200,
        retry_after: None,
        request_id: Some("req_test".to_owned()),
        body: body.as_bytes().to_vec(),
    })
}

/// `stop_reason`과 content 블록으로 만든 Messages 응답 본문
pub fn message(stop_reason: &str, content: Value, input_tokens: u32, output_tokens: u32) -> Value {
    json!({
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-5-5",
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": null,
        "usage": { "input_tokens": input_tokens, "output_tokens": output_tokens },
    })
}

/// 정상 완료: structured outputs JSON 글 하나(`output`은 모델이 낸 JSON 글 그대로)
pub fn completed(output: &str) -> Result<HttpResponse, TransportError> {
    ok(message(
        "end_turn",
        json!([{ "type": "text", "text": output }]),
        100,
        50,
    ))
}

/// 텍스트 묶음 정상 응답: 번역 `texts`에 ID를 1부터 붙인다.
pub fn translated(texts: &[&str]) -> Result<HttpResponse, TransportError> {
    let paragraphs: Vec<Value> = texts
        .iter()
        .zip(1..)
        .map(|(text, id)| json!({ "id": id.to_string(), "text": text }))
        .collect();
    completed(&json!({ "paragraphs": paragraphs }).to_string())
}

/// 잘림(출력은 스키마를 어긴 채 끊긴다)
pub fn truncated() -> Result<HttpResponse, TransportError> {
    ok(message(
        "max_tokens",
        json!([{ "type": "text", "text": "{\"paragraphs\":[{\"id\":\"1\",\"text\":\"제1" }]),
        100,
        6200,
    ))
}

/// 오류 응답(공식 문서 오류 본문 모양)
pub fn error_reply(
    status: u16,
    error_type: &str,
    retry_after: Option<&str>,
) -> Result<HttpResponse, TransportError> {
    Ok(HttpResponse {
        status,
        retry_after: retry_after.map(str::to_owned),
        request_id: Some("req_err".to_owned()),
        body: json!({
            "type": "error",
            "error": { "type": error_type, "message": "test error" },
            "request_id": "req_err",
        })
        .to_string()
        .into_bytes(),
    })
}

/// 원문 `texts`를 차례로 담은 텍스트 묶음(쪽 0, 문단 번호 1부터). 출력 예상 3,000 → Sonnet
/// `max_tokens` 6,200(3,000 × 2 + 200).
pub fn text_chunk(texts: &[&str], glossary: &[GlossaryTerm]) -> TextChunk {
    TextChunk {
        items: texts
            .iter()
            .zip(1..)
            .map(|(text, number)| ChunkItem {
                page: 0,
                number,
                text: (*text).to_owned(),
                fragment: None,
            })
            .collect(),
        glossary: glossary.to_vec(),
        estimate: ChunkEstimate {
            input_tokens: 2_000,
            output_tokens: 3_000,
        },
    }
}

pub fn term(source: &str, target: &str) -> GlossaryTerm {
    GlossaryTerm {
        source: source.to_owned(),
        target: target.to_owned(),
    }
}
