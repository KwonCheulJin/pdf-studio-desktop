//! Step 36 스파이크: 번역용 HTTP·TLS(`reqwest` + `native-tls`)와 키체인(`keyring`)이
//! 이 앱에서 돌아가는지 손으로 한 번 확인한다. 네트워크·OS 키체인이 있어야 해서 모두 `#[ignore]`다.
//! Step 41(키체인 어댑터)·Step 39(HTTP 어댑터)가 실제 코드를 넣으면 지운다.
//!
//! 실행: `cargo test -p pdf-studio translate_deps_spike -- --ignored --nocapture`

use std::time::Duration;

use serde_json::Value;

const MODELS_URL: &str = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION_HEADER: &str = "anthropic-version";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const REQUEST_ID_HEADER: &str = "request-id";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const UNAUTHORIZED: u16 = 401;

/// 실제 키(계정 `anthropic-api-key`)와 섞이지 않게 스파이크 전용 계정을 쓴다.
const KEYCHAIN_SERVICE: &str = "io.github.kwoncheuljin.pdfstudio";
const KEYCHAIN_ACCOUNT: &str = "step36-spike";
const KEYCHAIN_SECRET: &str = "step36-spike-not-a-real-key";

/// 키 없는 요청 한 번: TLS 연결과 401 `authentication_error` 오류 본문 모양(ADR 0002 §7).
#[test]
#[ignore = "실제 api.anthropic.com에 키 없이 요청한다(Step 36 일회 확인)"]
fn models_without_key_returns_authentication_error() {
    tauri::async_runtime::block_on(async {
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .build()
            .expect("build client");
        let response = client
            .get(MODELS_URL)
            .header(ANTHROPIC_VERSION_HEADER, ANTHROPIC_VERSION)
            .send()
            .await
            .expect("TLS connection");
        let status = response.status().as_u16();
        let has_request_id = response.headers().contains_key(REQUEST_ID_HEADER);
        let body: Value =
            serde_json::from_str(&response.text().await.expect("body")).expect("JSON body");

        println!(
            "status={status} request-id 헤더={has_request_id} type={} error.type={} request_id 있음={}",
            body["type"],
            body["error"]["type"],
            body["request_id"].is_string()
        );
        assert_eq!(status, UNAUTHORIZED);
        assert_eq!(body["type"], "error");
        assert_eq!(body["error"]["type"], "authentication_error");
        assert!(has_request_id);
    });
}

/// OS 키체인 쓰기 → 읽기 → 지우기 → 지운 뒤 읽기는 `NoEntry`.
#[test]
#[ignore = "OS 키체인에 쓴다(Step 36 일회 확인)"]
fn keychain_set_get_delete_round_trip() {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).expect("keychain store");
    entry.set_password(KEYCHAIN_SECRET).expect("write");
    assert_eq!(entry.get_password().expect("read"), KEYCHAIN_SECRET);
    entry.delete_credential().expect("delete");
    assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
}
