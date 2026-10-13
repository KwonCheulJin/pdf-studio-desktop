//! reqwest 전송을 로컬 mock HTTP 서버(127.0.0.1, 평문)로 확인한다: 보내는 헤더·본문, 시간 제한, 연결
//! 실패, 리디렉션을 따르지 않음, 오류 본문 → 코드. 인터넷에 나가지 않는다.

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use super::*;
use crate::chunk::{ChunkEstimate, ChunkItem, TextChunk};
use crate::client::MessagesClient;
use crate::language::Language;
use crate::models::TranslateModel;

const KEY: &str = "sk-ant-api03-local-mock-key";
const TEST_TIMEOUT: Duration = Duration::from_millis(300);
/// 거절 연결 테스트의 요청 시간 제한. 앱과 같게 연결 시간 제한(`API_CONNECT_TIMEOUT` 10초)보다 길게 둔다. Windows는
/// 닫힌 포트에서 RST 대신 SYN을 약 2초 재시도한 뒤 연결 실패를 내는데, 요청 시간 제한이 그보다 짧으면 연결 오류보다
/// 먼저 요청 시간 초과(`is_connect()`가 아닌 타임아웃)가 발동해 `Timeout`이 된다.
const REFUSED_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const HEADER_END: &[u8] = b"\r\n\r\n";

/// 서버가 받은 요청
struct Received {
    request_line: String,
    /// (소문자 이름, 값)
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Received {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(header, _)| header == name)
            .map(|(_, value)| value.as_str())
    }
}

/// 연결 하나를 받아 요청을 읽고 `reply`(없으면 답하지 않고 붙잡는다)를 보낸다.
async fn serve_once(reply: Option<String>) -> (String, JoinHandle<Received>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let base_url = format!("http://{}", listener.local_addr().expect("addr"));
    let handle = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept");
        let mut buffer = Vec::new();
        let header_end = loop {
            let mut chunk = [0_u8; 4096];
            let read = stream.read(&mut chunk).await.expect("read");
            assert!(read > 0, "요청 머리가 끝나기 전에 끊겼다");
            buffer.extend_from_slice(&chunk[..read]);
            if let Some(position) = buffer
                .windows(HEADER_END.len())
                .position(|window| window == HEADER_END)
            {
                break position;
            }
        };
        let head = String::from_utf8(buffer[..header_end].to_vec()).expect("utf-8 head");
        let mut lines = head.split("\r\n");
        let request_line = lines.next().unwrap_or_default().to_owned();
        let headers: Vec<(String, String)> = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_owned()))
            .collect();
        let length: usize = headers
            .iter()
            .find(|(name, _)| name == "content-length")
            .map_or(0, |(_, value)| value.parse().expect("content-length"));
        let mut body = buffer[header_end + HEADER_END.len()..].to_vec();
        while body.len() < length {
            let mut chunk = [0_u8; 4096];
            let read = stream.read(&mut chunk).await.expect("read body");
            assert!(read > 0, "본문이 끝나기 전에 끊겼다");
            body.extend_from_slice(&chunk[..read]);
        }
        match reply {
            Some(reply) => stream.write_all(reply.as_bytes()).await.expect("write"),
            None => std::future::pending::<()>().await,
        }
        Received {
            request_line,
            headers,
            body,
        }
    });
    (base_url, handle)
}

fn http_reply(status_line: &str, headers: &[(&str, &str)], body: &str) -> String {
    let mut reply = format!(
        "HTTP/1.1 {status_line}\r\ncontent-length: {}\r\nconnection: close\r\n",
        body.len()
    );
    for (name, value) in headers {
        reply.push_str(&format!("{name}: {value}\r\n"));
    }
    reply.push_str("\r\n");
    reply.push_str(body);
    reply
}

fn transport(base_url: &str) -> ReqwestTransport {
    ReqwestTransport::for_local_server(base_url, TEST_TIMEOUT).expect("client")
}

fn key() -> ApiKey {
    ApiKey::parse(KEY).expect("key")
}

#[tokio::test]
async fn sends_api_headers_and_body_and_reads_response() {
    let (base_url, server) = serve_once(Some(http_reply(
        "200 OK",
        &[("request-id", "req_mock_1"), ("retry-after", "7")],
        r#"{"ok":true}"#,
    )))
    .await;

    let response = transport(&base_url)
        .post_messages(&key(), br#"{"model":"m"}"#)
        .await
        .expect("response");
    let received = server.await.expect("server");

    assert_eq!(received.request_line, "POST /v1/messages HTTP/1.1");
    assert_eq!(received.header("x-api-key"), Some(KEY));
    assert_eq!(received.header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(received.header("content-type"), Some("application/json"));
    assert_eq!(received.body, br#"{"model":"m"}"#);
    assert_eq!(
        response,
        HttpResponse {
            status: 200,
            retry_after: Some("7".to_owned()),
            request_id: Some("req_mock_1".to_owned()),
            body: br#"{"ok":true}"#.to_vec(),
        }
    );
}

#[tokio::test]
async fn response_slower_than_timeout_is_timeout() {
    let (base_url, server) = serve_once(None).await;

    let result = transport(&base_url).post_messages(&key(), b"{}").await;
    server.abort();

    assert_eq!(result, Err(TransportError::Timeout));
}

#[tokio::test]
async fn refused_connection_is_connection_error() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let base_url = format!("http://{}", listener.local_addr().expect("addr"));
    drop(listener);
    let transport =
        ReqwestTransport::for_local_server(&base_url, REFUSED_REQUEST_TIMEOUT).expect("client");

    let result = transport.post_messages(&key(), b"{}").await;

    assert_eq!(result, Err(TransportError::Connection));
}

/// 이름 풀이가 끝나지 않는 해석기: 연결 단계에서 멈춰 `connect_timeout`이 걸린다. OS의 TCP 동작(Windows의 SYN
/// 재시도 등)에 기대지 않고 연결 단계 시간 초과를 만든다.
struct NeverResolves;

impl reqwest::dns::Resolve for NeverResolves {
    fn resolve(&self, _name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(std::future::pending())
    }
}

/// 연결 단계 시간 초과는 응답 지연이 아니라 연결 실패다(reqwest 오류가 `is_timeout()`이어도). 요청 시간 제한은
/// 연결 시간 제한보다 훨씬 길게 두어 연결 단계 시간 초과만 일어나게 한다.
#[tokio::test]
async fn connect_stage_timeout_is_connection_error() {
    let client = reqwest::Client::builder()
        .dns_resolver(NeverResolves)
        .connect_timeout(Duration::from_millis(100))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("client");
    let transport = ReqwestTransport {
        client,
        base_url: "http://never-resolves.invalid".to_owned(),
    };

    let result = transport.post_messages(&key(), b"{}").await;

    assert_eq!(result, Err(TransportError::Connection));
}

#[tokio::test]
async fn redirect_is_returned_not_followed() {
    let (base_url, server) = serve_once(Some(http_reply(
        "307 Temporary Redirect",
        &[("location", "http://127.0.0.1:1/v1/messages")],
        "",
    )))
    .await;

    let response = transport(&base_url)
        .post_messages(&key(), b"{}")
        .await
        .expect("response");
    server.await.expect("server");

    assert_eq!(response.status, 307);
}

/// 다시 보내지 않는 상태 하나: 오류 본문의 `type`·`details.error_code`와 `request-id` 헤더 → 오류
#[tokio::test]
async fn error_response_maps_to_code_with_type_and_request_id() {
    let cases = [
        (
            "401 Unauthorized",
            r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}"#,
            ApiErrorCode::KeyInvalid,
            401,
            "authentication_error",
        ),
        (
            "404 Not Found",
            r#"{"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-5-5"},"request_id":"req_1"}"#,
            ApiErrorCode::ModelUnavailable,
            404,
            "not_found_error",
        ),
        (
            "429 Too Many Requests",
            r#"{"type":"error","error":{"type":"rate_limit_error","message":"spend limit","details":{"error_code":"enforced_spend_limit_reached"}},"request_id":"req_1"}"#,
            ApiErrorCode::Billing,
            429,
            "rate_limit_error",
        ),
    ];
    for (status_line, body, code, status, error_type) in cases {
        let (base_url, server) = serve_once(Some(http_reply(
            status_line,
            &[("request-id", "req_mock_err")],
            body,
        )))
        .await;
        let client = MessagesClient::new(
            transport(&base_url),
            key(),
            TranslateModel::Sonnet,
            Language::Zh,
        );

        let attempt = client.translate_text(&one_item_chunk()).await;
        server.await.expect("server");

        assert_eq!(
            attempt.result,
            Err(ApiError {
                code,
                status: Some(status),
                error_type: Some(error_type.to_owned()),
                request_id: Some("req_mock_err".to_owned()),
            }),
            "{status_line}"
        );
    }
}

fn one_item_chunk() -> TextChunk {
    TextChunk {
        items: vec![ChunkItem {
            page: 0,
            number: 1,
            text: "第一条".to_owned(),
            fragment: None,
        }],
        glossary: Vec::new(),
        estimate: ChunkEstimate {
            input_tokens: 604,
            output_tokens: 6,
        },
    }
}
