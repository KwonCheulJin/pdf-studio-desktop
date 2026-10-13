//! Messages API 전송(ADR 0002 §5·§7). 재시도·응답 해석은 전송을 모르는 위 계층이 하고, 전송은
//! [`Transport`] trait 뒤에 둔다. 앱은 [`ReqwestTransport`](`native-tls`)를, 테스트는 가짜 전송이나 로컬
//! mock 서버를 쓴다. 요청·응답 헤더와 본문을 로그로 남기지 않는다(§12).

use std::future::Future;
use std::time::Duration;

use reqwest::header::{CONTENT_TYPE, HeaderMap, RETRY_AFTER};

use crate::error::{ApiError, ApiErrorCode};
use crate::key::ApiKey;

/// 전송 대상(상수 하나, 계획서 §9.1.4)
pub const ANTHROPIC_API_BASE: &str = "https://api.anthropic.com";
const MESSAGES_PATH: &str = "/v1/messages";

/// 공식 문서 `api/versioning`의 현행 값
pub const ANTHROPIC_VERSION: &str = "2023-06-01";
const ANTHROPIC_VERSION_HEADER: &str = "anthropic-version";
const API_KEY_HEADER: &str = "x-api-key";
const REQUEST_ID_HEADER: &str = "request-id";
const JSON_CONTENT_TYPE: &str = "application/json";

/// 요청 하나의 시간 제한(연결부터 응답 본문을 다 읽을 때까지, ADR 0002 §7)
const API_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// TCP keep-alive 간격. 긴 비스트리밍 요청에서 유휴 연결이 끊기지 않게 켠다(ADR 0002 §7). reqwest 0.13
/// 기본값과 같은 값을 드러내 적어 둔다.
const API_TCP_KEEPALIVE: Duration = Duration::from_secs(15);

/// 응답 하나(상태와 해석에 쓰는 헤더, 본문)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    /// `retry-after` 헤더(초)
    pub retry_after: Option<String>,
    /// `request-id` 헤더
    pub request_id: Option<String>,
    pub body: Vec<u8>,
}

/// 응답을 받지 못한 실패
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportError {
    /// 요청 시간 제한을 넘었다(`API_TIMEOUT`)
    Timeout,
    /// 연결 실패(DNS·TLS·연결 끊김·본문 읽다 끊김, `NETWORK_UNAVAILABLE`)
    Connection,
}

/// `POST /v1/messages` 한 번. 재시도하지 않는다.
pub trait Transport: Sync {
    fn post_messages(
        &self,
        key: &ApiKey,
        body: &[u8],
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send;
}

/// reqwest(`native-tls`) 전송. HTTPS만, 리디렉션을 따르지 않는다(ADR 0002 §7 "클라이언트 설정").
pub struct ReqwestTransport {
    client: reqwest::Client,
    base_url: String,
}

impl ReqwestTransport {
    /// `ANTHROPIC_API_BASE`로 보내는 전송. TLS를 준비하지 못하면 `NETWORK_UNAVAILABLE`이다.
    pub fn new() -> Result<Self, ApiError> {
        Self::build(ANTHROPIC_API_BASE, true, API_REQUEST_TIMEOUT)
    }

    fn build(base_url: &str, https_only: bool, timeout: Duration) -> Result<Self, ApiError> {
        let client = reqwest::Client::builder()
            .https_only(https_only)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(timeout)
            .tcp_keepalive(API_TCP_KEEPALIVE)
            .build()
            .map_err(|_| ApiError::without_response(ApiErrorCode::NetworkUnavailable))?;
        Ok(Self {
            client,
            base_url: base_url.to_owned(),
        })
    }

    /// 로컬 mock 서버(평문 HTTP)로 보내는 전송. 테스트에서만 쓴다.
    #[cfg(test)]
    pub(crate) fn for_local_server(base_url: &str, timeout: Duration) -> Result<Self, ApiError> {
        Self::build(base_url, false, timeout)
    }
}

impl Transport for ReqwestTransport {
    fn post_messages(
        &self,
        key: &ApiKey,
        body: &[u8],
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send {
        let request = self
            .client
            .post(format!("{}{MESSAGES_PATH}", self.base_url))
            .header(API_KEY_HEADER, key.header_value().clone())
            .header(ANTHROPIC_VERSION_HEADER, ANTHROPIC_VERSION)
            .header(CONTENT_TYPE, JSON_CONTENT_TYPE)
            .body(body.to_vec());
        async move {
            let response = request.send().await.map_err(transport_error)?;
            let status = response.status().as_u16();
            let retry_after = header_text(response.headers(), RETRY_AFTER.as_str());
            let request_id = header_text(response.headers(), REQUEST_ID_HEADER);
            let body = response.bytes().await.map_err(transport_error)?;
            Ok(HttpResponse {
                status,
                retry_after,
                request_id,
                body: body.to_vec(),
            })
        }
    }
}

/// reqwest 오류는 시간 제한인지만 본다. 오류 글(주소 등)은 담지 않는다.
fn transport_error(error: reqwest::Error) -> TransportError {
    if error.is_timeout() {
        TransportError::Timeout
    } else {
        TransportError::Connection
    }
}

fn header_text(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests;
