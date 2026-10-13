//! 전송 재시도(ADR 0002 §7): 가짜 전송 + 멈춘 시계(`start_paused`). 기다림은 가상 시간이라 요청 사이
//! 간격을 정확히 본다. 한 요청은 처음 1번 + 재시도 3번(1·2·4초)까지다.

mod common;

use common::{FakeTransport, error_reply, key, text_chunk, translated};
use serde_json::json;
use translate::{
    ApiError, ApiErrorCode, HttpResponse, ItemOutcome, Language, MessagesClient, TranslateModel,
    TransportError,
};

const A: &str = "甲方应当交付设备。";

/// 응답 하나를 만드는 함수(같은 응답을 여러 번 쓴다)
type Reply = fn() -> Result<HttpResponse, TransportError>;

/// 요청 사이 간격(초)
fn gaps(transport: &FakeTransport) -> Vec<u64> {
    transport
        .calls()
        .windows(2)
        .map(|pair| (pair[1].at - pair[0].at).as_secs())
        .collect()
}

async fn send(transport: &FakeTransport) -> Result<Vec<ItemOutcome>, ApiError> {
    MessagesClient::new(transport, key(), TranslateModel::Sonnet, Language::Zh)
        .translate_text(&text_chunk(&[A], &[]))
        .await
        .result
}

fn code(result: Result<Vec<ItemOutcome>, ApiError>) -> Result<Vec<ItemOutcome>, ApiErrorCode> {
    result.map_err(|error| error.code)
}

#[tokio::test(start_paused = true)]
async fn rate_limit_waits_retry_after_then_succeeds() {
    let transport = FakeTransport::new([
        error_reply(429, "rate_limit_error", Some("5")),
        translated(&["가"]),
    ]);

    let result = send(&transport).await;

    assert_eq!(result, Ok(vec![ItemOutcome::Translated("가".to_owned())]));
    assert_eq!(gaps(&transport), vec![5]);
}

#[tokio::test(start_paused = true)]
async fn retry_after_longer_than_cap_fails_without_waiting() {
    let transport = FakeTransport::new([error_reply(429, "rate_limit_error", Some("61"))]);

    let result = send(&transport).await;

    assert_eq!(code(result), Err(ApiErrorCode::RateLimited));
    assert_eq!(transport.calls().len(), 1);
}

/// 재시도할 실패가 이어지면 1·2·4초 뒤 다시 보내고(429는 `retry-after`가 없을 때) 4번째 실패의 코드로
/// 끝난다.
#[tokio::test(start_paused = true)]
async fn retryable_failures_stop_after_three_retries() {
    let cases: [(Reply, ApiErrorCode); 7] = [
        (
            || error_reply(429, "rate_limit_error", None),
            ApiErrorCode::RateLimited,
        ),
        (
            || error_reply(500, "api_error", None),
            ApiErrorCode::Unavailable,
        ),
        (
            || error_reply(529, "overloaded_error", None),
            ApiErrorCode::Unavailable,
        ),
        (
            || error_reply(503, "unknown_new_type", None),
            ApiErrorCode::Unavailable,
        ),
        (
            || error_reply(504, "timeout_error", None),
            ApiErrorCode::Timeout,
        ),
        (|| Err(TransportError::Timeout), ApiErrorCode::Timeout),
        (
            || Err(TransportError::Connection),
            ApiErrorCode::NetworkUnavailable,
        ),
    ];
    for (reply, expected) in cases {
        let transport = FakeTransport::new([reply(), reply(), reply(), reply()]);

        let result = send(&transport).await;

        assert_eq!(code(result), Err(expected), "{expected:?}");
        assert_eq!(gaps(&transport), vec![1, 2, 4], "{expected:?}");
    }
}

#[tokio::test(start_paused = true)]
async fn overloaded_then_success_returns_translation() {
    let transport = FakeTransport::new([
        error_reply(529, "overloaded_error", None),
        error_reply(529, "overloaded_error", None),
        translated(&["가"]),
    ]);

    let result = send(&transport).await;

    assert_eq!(result, Ok(vec![ItemOutcome::Translated("가".to_owned())]));
    assert_eq!(gaps(&transport), vec![1, 2]);
}

/// 다시 보내지 않는 상태: 요청 한 번으로 끝난다. 짝짓기는 상태가 먼저다(`type`이 달라도 상태로).
#[tokio::test(start_paused = true)]
async fn non_retryable_statuses_fail_after_one_request() {
    let cases = [
        (400, "invalid_request_error", ApiErrorCode::RequestRejected),
        (401, "authentication_error", ApiErrorCode::KeyInvalid),
        (402, "billing_error", ApiErrorCode::Billing),
        (403, "permission_error", ApiErrorCode::PermissionDenied),
        (404, "not_found_error", ApiErrorCode::ModelUnavailable),
        (409, "conflict_error", ApiErrorCode::RequestRejected),
        (401, "some_future_type", ApiErrorCode::KeyInvalid),
    ];
    for (status, error_type, expected) in cases {
        let transport = FakeTransport::new([error_reply(status, error_type, None)]);

        let result = send(&transport).await;

        assert_eq!(
            result,
            Err(ApiError {
                code: expected,
                status: Some(status),
                error_type: Some(error_type.to_owned()),
                request_id: Some("req_err".to_owned()),
            }),
            "{status}"
        );
        assert_eq!(transport.calls().len(), 1, "{status}");
    }
}

/// 월 지출 상한 429는 `retry-after`가 없고 다음 달까지 실패하므로 다시 보내지 않고 `API_BILLING`이다.
#[tokio::test(start_paused = true)]
async fn spend_limit_rate_limit_is_billing_without_retry() {
    let transport = FakeTransport::new([Ok(HttpResponse {
        status: 429,
        retry_after: None,
        request_id: None,
        body: json!({
            "type": "error",
            "error": {
                "type": "rate_limit_error",
                "message": "monthly spend limit",
                "details": { "error_code": "enforced_spend_limit_reached" },
            },
        })
        .to_string()
        .into_bytes(),
    })]);

    let result = send(&transport).await;

    assert_eq!(code(result), Err(ApiErrorCode::Billing));
    assert_eq!(transport.calls().len(), 1);
}
