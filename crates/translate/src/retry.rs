//! 전송 재시도와 HTTP 상태 → 오류 코드(ADR 0002 §7). §6의 "나눠 다시"와 따로 센다: 한 요청은 처음
//! 1번 + 재시도 `API_MAX_RETRIES`번까지다. 짝짓기는 HTTP 상태가 먼저이고 모르는 오류 `type`은 상태로만
//! 판단한다. 읽는 것은 `error.type`·`error.details.error_code`·`request-id`뿐이다(`error.message`는 읽지
//! 않는다).
//!
//! 기다림은 `tokio::time::sleep`이다. 이 future를 버리면(취소) 기다림과 요청이 함께 멈춘다.

use std::future::Future;
use std::time::Duration;

use serde::Deserialize;

use crate::error::{ApiError, ApiErrorCode};
use crate::http::{HttpResponse, TransportError};
use crate::response::is_identifier;

/// 재시도 횟수 상한(처음 요청은 세지 않는다)
const API_MAX_RETRIES: usize = 3;

/// n번째 재시도 전에 기다리는 시간(`retry-after`가 없을 때). 길이가 `API_MAX_RETRIES`다.
const API_RETRY_DELAYS: [Duration; API_MAX_RETRIES] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
];

/// `retry-after`가 이보다 길면 기다리지 않고 바로 실패한다(진행 화면이 표시 없이 멈추지 않게,
/// 이어하기로 넘긴다).
const API_MAX_RETRY_AFTER: Duration = Duration::from_secs(60);

const STATUS_OK: u16 = 200;
const STATUS_BAD_REQUEST: u16 = 400;
const STATUS_UNAUTHORIZED: u16 = 401;
const STATUS_PAYMENT_REQUIRED: u16 = 402;
const STATUS_FORBIDDEN: u16 = 403;
const STATUS_NOT_FOUND: u16 = 404;
const STATUS_PAYLOAD_TOO_LARGE: u16 = 413;
const STATUS_TOO_MANY_REQUESTS: u16 = 429;
const STATUS_GATEWAY_TIMEOUT: u16 = 504;
const STATUS_SERVER_ERROR_START: u16 = 500;
const STATUS_SERVER_ERROR_END: u16 = 599;

/// 월 지출 상한 429의 `error.details.error_code`(공식 문서 `api/rate-limits`). 다음 달까지 실패한다.
const SPEND_LIMIT_ERROR_CODE: &str = "enforced_spend_limit_reached";

/// 재시도로 끝나지 않은 실패
#[derive(Debug)]
pub(crate) enum SendFailure {
    /// 413. 항목이 둘 이상이면 위에서 반으로 나눠 보내고, 나눌 수 없으면 이 오류(`API_REQUEST_REJECTED`)다.
    TooLarge(ApiError),
    /// 작업을 멈추는 오류
    Api(ApiError),
}

/// 응답 하나를 본 결정
enum Verdict {
    Success(Vec<u8>),
    TooLarge(ApiError),
    /// 다시 보내지 않는다
    Fail(ApiError),
    /// 다시 보낸다. 재시도가 바닥나면 `error`로 끝난다. `wait`가 없으면 `API_RETRY_DELAYS`를 쓴다.
    Retry {
        error: ApiError,
        wait: Option<Duration>,
    },
}

#[derive(Deserialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Deserialize)]
struct ErrorDetail {
    #[serde(rename = "type")]
    kind: Option<String>,
    details: Option<ErrorDetails>,
}

#[derive(Deserialize)]
struct ErrorDetails {
    error_code: Option<String>,
}

/// 200 본문을 받을 때까지 `request`(같은 요청 한 번)를 다시 부른다.
pub(crate) async fn send_with_retry<F, Fut>(mut request: F) -> Result<Vec<u8>, SendFailure>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<HttpResponse, TransportError>>,
{
    let mut retries = 0;
    loop {
        let verdict = match request().await {
            Ok(response) => judge(response),
            Err(error) => judge_transport(error),
        };
        let (error, wait) = match verdict {
            Verdict::Success(body) => return Ok(body),
            Verdict::TooLarge(error) => return Err(SendFailure::TooLarge(error)),
            Verdict::Fail(error) => {
                log_attempt(&error, retries);
                return Err(SendFailure::Api(error));
            }
            Verdict::Retry { error, wait } => (error, wait),
        };
        log_attempt(&error, retries);
        let Some(&delay) = API_RETRY_DELAYS.get(retries) else {
            return Err(SendFailure::Api(error));
        };
        let wait = wait.unwrap_or(delay);
        if wait > API_MAX_RETRY_AFTER {
            return Err(SendFailure::Api(error));
        }
        tokio::time::sleep(wait).await;
        retries += 1;
    }
}

fn judge(response: HttpResponse) -> Verdict {
    if response.status == STATUS_OK {
        return Verdict::Success(response.body);
    }
    let detail = serde_json::from_slice::<ErrorBody>(&response.body)
        .ok()
        .map(|body| body.error);
    let error_code = detail
        .as_ref()
        .and_then(|detail| detail.details.as_ref())
        .and_then(|details| details.error_code.as_deref());
    let spend_limit = error_code == Some(SPEND_LIMIT_ERROR_CODE);
    let error = |code| ApiError {
        code,
        status: Some(response.status),
        error_type: detail
            .as_ref()
            .and_then(|detail| detail.kind.clone())
            .filter(|kind| is_identifier(kind)),
        request_id: response.request_id.clone(),
    };
    match response.status {
        STATUS_BAD_REQUEST => Verdict::Fail(error(ApiErrorCode::RequestRejected)),
        STATUS_UNAUTHORIZED => Verdict::Fail(error(ApiErrorCode::KeyInvalid)),
        STATUS_PAYMENT_REQUIRED => Verdict::Fail(error(ApiErrorCode::Billing)),
        STATUS_FORBIDDEN => Verdict::Fail(error(ApiErrorCode::PermissionDenied)),
        STATUS_NOT_FOUND => Verdict::Fail(error(ApiErrorCode::ModelUnavailable)),
        STATUS_PAYLOAD_TOO_LARGE => Verdict::TooLarge(error(ApiErrorCode::RequestRejected)),
        STATUS_TOO_MANY_REQUESTS if spend_limit => Verdict::Fail(error(ApiErrorCode::Billing)),
        STATUS_TOO_MANY_REQUESTS => Verdict::Retry {
            error: error(ApiErrorCode::RateLimited),
            wait: response.retry_after.as_deref().and_then(parse_retry_after),
        },
        STATUS_GATEWAY_TIMEOUT => Verdict::Retry {
            error: error(ApiErrorCode::Timeout),
            wait: None,
        },
        STATUS_SERVER_ERROR_START..=STATUS_SERVER_ERROR_END => Verdict::Retry {
            error: error(ApiErrorCode::Unavailable),
            wait: None,
        },
        _ => Verdict::Fail(error(ApiErrorCode::RequestRejected)),
    }
}

fn judge_transport(error: TransportError) -> Verdict {
    let code = match error {
        TransportError::Timeout => ApiErrorCode::Timeout,
        TransportError::Connection => ApiErrorCode::NetworkUnavailable,
    };
    Verdict::Retry {
        error: ApiError::without_response(code),
        wait: None,
    }
}

/// `retry-after`는 기다릴 초(정수)다. 읽을 수 없으면 없는 것으로 본다.
fn parse_retry_after(value: &str) -> Option<Duration> {
    value.trim().parse::<u64>().ok().map(Duration::from_secs)
}

/// 시도 하나의 실패를 로그에 남긴다(코드·상태·type·request-id·시도 번호만, ADR 0002 §12).
fn log_attempt(error: &ApiError, retries: usize) {
    log::warn!(
        "번역 요청 실패: {error} (시도 {}/{})",
        retries + 1,
        API_MAX_RETRIES + 1
    );
}
