//! 작업을 멈추는 API·네트워크 오류(ADR 0002 §7·§11). `src-tauri`가 [`ApiErrorCode`]를 계약
//! `ErrorCode`로 한 곳(`error.rs`)에서 짝짓는다.
//!
//! 오류에는 로그에 남겨도 되는 것만 담는다: 코드, HTTP 상태, 오류 `type`, `request-id`(ADR 0002 §12).
//! 키·문서 글·응답 본문·`error.message`는 담지 않는다.

use std::fmt;

/// 오류 코드(계약 `ErrorCode`의 `API_`·`MODEL_UNAVAILABLE`·`NETWORK_UNAVAILABLE`)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiErrorCode {
    /// 401 `authentication_error`
    KeyInvalid,
    /// 403 `permission_error`
    PermissionDenied,
    /// 402 `billing_error`, 429 + `enforced_spend_limit_reached`(월 지출 상한)
    Billing,
    /// 404 `not_found_error`
    ModelUnavailable,
    /// 400, 나눌 수 없는 413, 그 밖 4xx·3xx
    RequestRejected,
    /// 429를 다시 보내도 안 된다, `retry-after`가 상한보다 길다
    RateLimited,
    /// 500·529·그 밖 5xx를 다시 보내도 안 된다
    Unavailable,
    /// 요청 시간 제한, 504를 다시 보내도 안 된다
    Timeout,
    /// 연결 실패를 다시 보내도 안 된다
    NetworkUnavailable,
}

impl ApiErrorCode {
    /// 계약 `ErrorCode` 직렬화 값(로그·오류 글에 쓴다)
    pub fn as_str(self) -> &'static str {
        match self {
            Self::KeyInvalid => "API_KEY_INVALID",
            Self::PermissionDenied => "API_PERMISSION_DENIED",
            Self::Billing => "API_BILLING",
            Self::ModelUnavailable => "MODEL_UNAVAILABLE",
            Self::RequestRejected => "API_REQUEST_REJECTED",
            Self::RateLimited => "API_RATE_LIMITED",
            Self::Unavailable => "API_UNAVAILABLE",
            Self::Timeout => "API_TIMEOUT",
            Self::NetworkUnavailable => "NETWORK_UNAVAILABLE",
        }
    }
}

/// 작업을 멈추는 오류. 응답이 있었으면 상태·오류 `type`(식별자 모양일 때만)·`request-id`를 담는다.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub struct ApiError {
    pub code: ApiErrorCode,
    pub status: Option<u16>,
    pub error_type: Option<String>,
    pub request_id: Option<String>,
}

impl ApiError {
    pub(crate) fn without_response(code: ApiErrorCode) -> Self {
        Self {
            code,
            status: None,
            error_type: None,
            request_id: None,
        }
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code.as_str())?;
        if let Some(status) = self.status {
            write!(f, " status={status}")?;
        }
        if let Some(error_type) = &self.error_type {
            write!(f, " type={error_type}")?;
        }
        if let Some(request_id) = &self.request_id {
            write!(f, " request-id={request_id}")?;
        }
        Ok(())
    }
}
