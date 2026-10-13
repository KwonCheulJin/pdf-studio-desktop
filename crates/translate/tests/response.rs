//! 응답 검증과 나눠 다시(ADR 0002 §6, §7 413). 응답은 공식 문서 Messages API 모양대로 손으로 쓴 JSON
//! 이고(`common`), 가짜 전송이 차례로 돌려준다.

mod common;

use common::{
    FakeTransport, completed, error_reply, key, message, ok, ok_raw, term, text_chunk, translated,
    truncated,
};
use serde_json::json;
use translate::{
    ApiErrorCode, ChunkEstimate, FailReason, ItemOutcome, Language, MessagesClient, ScanChunk,
    ScanImage, ScanOutcome, ScanParagraph, TokenUsage, TranslateModel,
};

const A: &str = "甲方应当交付设备。";
const B: &str = "乙方负责验收。";
const C: &str = "本合同自签字之日起生效。";

fn translated_item(text: &str) -> ItemOutcome {
    ItemOutcome::Translated(text.to_owned())
}

fn client(transport: &FakeTransport) -> MessagesClient<&FakeTransport> {
    MessagesClient::new(transport, key(), TranslateModel::Sonnet, Language::Zh)
}

#[tokio::test]
async fn completed_reply_gives_trimmed_translations_and_skips_thinking_blocks() {
    let output = json!({ "paragraphs": [
        { "id": "1", "text": "  갑은 설비를 인도한다. " },
        { "id": "2", "text": "을은 검수를 맡는다.\n" },
    ]})
    .to_string();
    let transport = FakeTransport::new([ok(message(
        "end_turn",
        json!([
            { "type": "thinking", "thinking": "", "signature": "sig" },
            { "type": "text", "text": output },
        ]),
        321,
        45,
    ))]);

    let attempt = client(&transport)
        .translate_text(&text_chunk(&[A, B], &[]))
        .await;

    assert_eq!(
        attempt.result,
        Ok(vec![
            translated_item("갑은 설비를 인도한다."),
            translated_item("을은 검수를 맡는다."),
        ])
    );
    assert_eq!(
        attempt.usage,
        TokenUsage {
            input_tokens: 321,
            output_tokens: 45
        }
    );
}

/// 검증 실패 모양 하나하나: 항목 2개 묶음이 반으로 나뉘어 각각 한 번 더 가고, 또 실패하면 둘 다
/// `Failed(Mismatch)`다(요청 3번).
#[tokio::test]
async fn every_invalid_reply_shape_splits_once_then_fails_as_mismatch() {
    let paragraphs = |items: serde_json::Value| json!({ "paragraphs": items }).to_string();
    let cases = [
        ("JSON이 아닌 출력", completed("갑은 설비를 인도한다.")),
        ("필수 필드 없음", completed(r#"{"items":[]}"#)),
        (
            "모르는 필드",
            completed(&paragraphs(
                json!([{ "id": "1", "text": "가", "note": "x" }]),
            )),
        ),
        (
            "타입 다름",
            completed(&paragraphs(json!([{ "id": 1, "text": "가" }]))),
        ),
        ("ID 빠짐", completed(&paragraphs(json!([])))),
        (
            "ID 남음",
            completed(&paragraphs(json!([
                { "id": "1", "text": "가" }, { "id": "2", "text": "나" }, { "id": "3", "text": "다" },
            ]))),
        ),
        (
            "ID 순서 다름",
            completed(&paragraphs(
                json!([{ "id": "2", "text": "나" }, { "id": "1", "text": "가" }]),
            )),
        ),
        (
            "빈 번역",
            completed(&paragraphs(json!([{ "id": "1", "text": "  " }]))),
        ),
        ("text 블록 없음", ok(message("end_turn", json!([]), 10, 0))),
        (
            "text 블록 둘",
            ok(message(
                "end_turn",
                json!([{ "type": "text", "text": "{}" }, { "type": "text", "text": "{}" }]),
                10,
                5,
            )),
        ),
        (
            "모르는 stop_reason",
            ok(message(
                "tool_use",
                json!([{ "type": "text", "text": "{}" }]),
                10,
                5,
            )),
        ),
        ("본문이 JSON이 아님", ok_raw("<html>bad gateway</html>")),
        ("stop_reason 없음", ok(json!({ "content": [] }))),
    ];
    for (name, reply) in cases {
        let transport = FakeTransport::new([reply.clone(), reply.clone(), reply]);

        let attempt = client(&transport)
            .translate_text(&text_chunk(&[A, B], &[]))
            .await;

        assert_eq!(
            attempt.result,
            Ok(vec![ItemOutcome::Failed(FailReason::Mismatch); 2]),
            "{name}"
        );
        assert_eq!(
            transport.sent_texts(),
            vec![
                vec![A.to_owned(), B.to_owned()],
                vec![A.to_owned()],
                vec![B.to_owned()]
            ],
            "{name}"
        );
    }
}

/// 나눈 요청은 한 번만 간다: 앞 반쪽이 또 실패하면 그 문단만 실패, 뒤 반쪽은 번역.
#[tokio::test]
async fn split_after_mismatch_is_sent_once_per_half() {
    let missing_id = completed(r#"{"paragraphs":[]}"#);
    let transport = FakeTransport::new([missing_id.clone(), missing_id, translated(&["다"])]);

    let attempt = client(&transport)
        .translate_text(&text_chunk(&[A, B, C], &[]))
        .await;

    assert_eq!(
        attempt.result,
        Ok(vec![
            ItemOutcome::Failed(FailReason::Mismatch),
            ItemOutcome::Failed(FailReason::Mismatch),
            translated_item("다"),
        ])
    );
    assert_eq!(
        transport.sent_texts(),
        vec![
            vec![A.to_owned(), B.to_owned(), C.to_owned()],
            vec![A.to_owned(), B.to_owned()],
            vec![C.to_owned()],
        ]
    );
}

#[tokio::test]
async fn single_item_mismatch_resends_same_request_once() {
    let transport = FakeTransport::new([completed("not json"), translated(&["가"])]);

    let attempt = client(&transport)
        .translate_text(&text_chunk(&[A], &[]))
        .await;

    assert_eq!(attempt.result, Ok(vec![translated_item("가")]));
    let calls = transport.calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].body, calls[1].body);
}

/// 잘림은 항목이 하나가 될 때까지 반으로 나눈다. 하나가 또 잘리면 `Failed(Truncated)`.
/// `model_context_window_exceeded`도 잘림이다. 사용량은 잘린 응답까지 모두 더한다.
#[tokio::test]
async fn truncation_halves_until_single_item_fails_as_truncated() {
    let context_exceeded = ok(message(
        "model_context_window_exceeded",
        json!([]),
        100,
        900,
    ));
    let transport = FakeTransport::new([
        truncated(),         // [A, B, C]
        truncated(),         // [A, B]
        context_exceeded,    // [A]
        translated(&["나"]), // [B]
        translated(&["다"]), // [C]
    ]);

    let attempt = client(&transport)
        .translate_text(&text_chunk(&[A, B, C], &[]))
        .await;

    assert_eq!(
        attempt.result,
        Ok(vec![
            ItemOutcome::Failed(FailReason::Truncated),
            translated_item("나"),
            translated_item("다"),
        ])
    );
    assert_eq!(
        transport.sent_texts(),
        vec![
            vec![A.to_owned(), B.to_owned(), C.to_owned()],
            vec![A.to_owned(), B.to_owned()],
            vec![A.to_owned()],
            vec![B.to_owned()],
            vec![C.to_owned()],
        ]
    );
    assert_eq!(
        attempt.usage,
        TokenUsage {
            input_tokens: 500,
            output_tokens: 6_200 + 6_200 + 900 + 50 + 50,
        }
    );
}

/// 나눈 요청은 그 항목에 나오는 용어만 싣는다.
#[tokio::test]
async fn split_request_carries_only_terms_in_its_items() {
    let transport = FakeTransport::new([truncated(), translated(&["가"]), translated(&["나"])]);
    let glossary = [term("甲方", "갑"), term("乙方", "을")];

    client(&transport)
        .translate_text(&text_chunk(&[A, B], &glossary))
        .await
        .result
        .expect("translated");

    let user_text = |index: usize| {
        transport.calls()[index].body["messages"][0]["content"][0]["text"]
            .as_str()
            .expect("text")
            .to_owned()
    };
    assert!(user_text(0).contains("甲方 → 갑\n乙方 → 을"));
    assert!(user_text(1).contains("甲方 → 갑") && !user_text(1).contains("乙方 → 을"));
    assert!(user_text(2).contains("乙方 → 을") && !user_text(2).contains("甲方 → 갑"));
}

#[tokio::test]
async fn refusal_marks_every_item_refused_without_resending() {
    let transport = FakeTransport::new([ok(json!({
        "content": [{ "type": "text", "text": "{\"paragraphs\":[{\"id\":\"1\"" }],
        "stop_reason": "refusal",
        "stop_details": { "type": "refusal", "category": "general_harms", "explanation": "x" },
        "usage": { "input_tokens": 700, "output_tokens": 3 },
    }))]);

    let attempt = client(&transport)
        .translate_text(&text_chunk(&[A, B], &[]))
        .await;

    assert_eq!(attempt.result, Ok(vec![ItemOutcome::Refused; 2]));
    assert_eq!(transport.calls().len(), 1);
    assert_eq!(
        attempt.usage,
        TokenUsage {
            input_tokens: 700,
            output_tokens: 3
        }
    );
}

/// 413은 다시 보내지 않고 반으로 나눠 보낸다. 항목 하나가 413이면 `API_REQUEST_REJECTED`로 멈추고
/// 그때까지 받은 사용량을 돌려준다.
#[tokio::test]
async fn request_too_large_splits_then_rejects_single_item() {
    let too_large = || error_reply(413, "request_too_large", None);
    let transport = FakeTransport::new([too_large(), translated(&["가"]), too_large()]);

    let attempt = client(&transport)
        .translate_text(&text_chunk(&[A, B], &[]))
        .await;

    assert_eq!(
        attempt.result.map_err(|error| (error.code, error.status)),
        Err((ApiErrorCode::RequestRejected, Some(413)))
    );
    assert_eq!(
        attempt.usage,
        TokenUsage {
            input_tokens: 100,
            output_tokens: 50
        }
    );
    assert_eq!(
        transport.sent_texts(),
        vec![
            vec![A.to_owned(), B.to_owned()],
            vec![A.to_owned()],
            vec![B.to_owned()]
        ]
    );
}

fn scan_chunk() -> ScanChunk {
    ScanChunk {
        page: 4,
        image: ScanImage {
            width_px: 1109,
            height_px: 1568,
        },
        glossary: Vec::new(),
        estimate: ChunkEstimate {
            input_tokens: 2_840,
            output_tokens: 3_500,
        },
    }
}

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

/// 받아 적은 원문·번역은 NFC로 바꾸고 앞뒤 공백을 지우며, 둘 중 하나라도 빈 항목은 버린다.
#[tokio::test]
async fn scan_reply_is_normalized_and_drops_empty_paragraphs() {
    let decomposed = "\u{1100}\u{1161}"; // 가(NFD)
    let output = json!({ "paragraphs": [
        { "source": " 第四章 ", "text": format!("제4장 {decomposed}") },
        { "source": "页码 5", "text": "  " },
        { "source": "", "text": "빈 원문" },
    ]})
    .to_string();
    let transport = FakeTransport::new([completed(&output)]);

    let attempt = client(&transport).translate_scan(&scan_chunk(), PNG).await;

    assert_eq!(
        attempt.result,
        Ok(ScanOutcome::Paragraphs(vec![ScanParagraph {
            source: "第四章".to_owned(),
            text: "제4장 가".to_owned(),
        }]))
    );
}

#[tokio::test]
async fn scan_reply_outcomes_for_mismatch_truncation_and_refusal() {
    let refusal = ok(message("refusal", json!([]), 10, 0));
    let cases = [
        (
            vec![completed("x"), completed(r#"{"paragraphs":[]}"#)],
            ScanOutcome::Paragraphs(Vec::new()),
        ),
        (
            vec![completed("x"), completed("y")],
            ScanOutcome::Failed(FailReason::Mismatch),
        ),
        (
            vec![truncated()],
            ScanOutcome::Failed(FailReason::Truncated),
        ),
        (vec![refusal], ScanOutcome::Refused),
    ];
    for (replies, expected) in cases {
        let count = replies.len();
        let transport = FakeTransport::new(replies);

        let attempt = client(&transport).translate_scan(&scan_chunk(), PNG).await;

        assert_eq!(attempt.result, Ok(expected.clone()), "{expected:?}");
        assert_eq!(transport.calls().len(), count, "{expected:?}");
    }
}

#[tokio::test]
async fn scan_request_too_large_is_rejected() {
    let transport = FakeTransport::new([error_reply(413, "request_too_large", None)]);

    let attempt = client(&transport).translate_scan(&scan_chunk(), PNG).await;

    assert_eq!(
        attempt.result.map_err(|error| error.code),
        Err(ApiErrorCode::RequestRejected)
    );
}
