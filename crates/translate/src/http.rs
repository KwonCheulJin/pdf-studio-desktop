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
const MODELS_PATH: &str = "/v1/models";

/// 키 확인에서 모델 목록 한 쪽에 받을 수(공식 상한). 기본 20개라 앱 모델이 다음 쪽에 있으면 키 확인이
/// `MODEL_UNAVAILABLE`로 틀린다(ADR 0002 §10 `verify_api_key`).
const MODELS_LIST_LIMIT: u32 = 1_000;

/// 공식 문서 `api/versioning`의 현행 값
pub const ANTHROPIC_VERSION: &str = "2023-06-01";
const ANTHROPIC_VERSION_HEADER: &str = "anthropic-version";
const API_KEY_HEADER: &str = "x-api-key";
const REQUEST_ID_HEADER: &str = "request-id";
const JSON_CONTENT_TYPE: &str = "application/json";

/// 요청 하나의 시간 제한(연결부터 응답 본문을 다 읽을 때까지, ADR 0002 §7)
const API_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// 연결 단계(DNS·TCP·TLS)의 시간 제한. 이 안에 연결하지 못하면 `Connection`이다(ADR 0002 §7). 응답을 기다리는
/// 시간은 `API_REQUEST_TIMEOUT`이 따로 맡는다.
const API_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

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
    /// 연결된 뒤 요청 시간 제한 안에 응답을 다 받지 못했다(`API_TIMEOUT`)
    Timeout,
    /// 연결 실패(DNS·TCP·TLS·연결 단계 시간 초과·연결 끊김·본문 읽다 끊김, `NETWORK_UNAVAILABLE`)
    Connection,
}

/// Messages API·Models API 요청 한 번. 재시도하지 않는다.
pub trait Transport: Sync {
    /// `POST /v1/messages`
    fn post_messages(
        &self,
        key: &ApiKey,
        body: &[u8],
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send;

    /// `GET /v1/models?limit=1000`(키 확인. 문서를 보내지 않고 요금이 들지 않는다)
    fn get_models(
        &self,
        key: &ApiKey,
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send;
}

/// 앱 상태가 전송 하나(연결 풀)를 들고 작업마다 빌려 준다.
impl<T: Transport> Transport for &T {
    fn post_messages(
        &self,
        key: &ApiKey,
        body: &[u8],
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send {
        (**self).post_messages(key, body)
    }

    fn get_models(
        &self,
        key: &ApiKey,
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send {
        (**self).get_models(key)
    }
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
            .connect_timeout(API_CONNECT_TIMEOUT)
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
        send(request)
    }

    fn get_models(
        &self,
        key: &ApiKey,
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send {
        let request = self
            .client
            .get(format!(
                "{}{MODELS_PATH}?limit={MODELS_LIST_LIMIT}",
                self.base_url
            ))
            .header(API_KEY_HEADER, key.header_value().clone())
            .header(ANTHROPIC_VERSION_HEADER, ANTHROPIC_VERSION);
        send(request)
    }
}

/// 요청을 보내고 상태·해석에 쓰는 헤더·본문을 읽는다.
async fn send(request: reqwest::RequestBuilder) -> Result<HttpResponse, TransportError> {
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

/// 연결 단계 실패를 먼저 가른다. 연결 시간 초과는 `is_connect()`와 `is_timeout()`이 둘 다 참이고(Windows는
/// 닫힌 포트에서도 RST를 바로 받지 않고 SYN을 재시도하다 시간 초과가 난다), 이것은 응답이 느린 것이 아니라
/// 연결 실패다. 오류 글(주소 등)은 담지 않는다.
fn transport_error(error: reqwest::Error) -> TransportError {
    if error.is_connect() {
        TransportError::Connection
    } else if error.is_timeout() {
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
