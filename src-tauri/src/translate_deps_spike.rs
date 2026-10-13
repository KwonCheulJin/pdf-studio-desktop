//! Step 36 스파이크: 키체인(`keyring`)이 이 앱에서 돌아가는지 손으로 한 번 확인한다. OS 키체인이 있어야
//! 해서 `#[ignore]`다. HTTP·TLS 확인은 Step 39가 `crates/translate`의 전송(`http.rs`)과 로컬 mock 서버
//! 테스트로 바꿨다. Step 41(키체인 어댑터)이 실제 코드를 넣으면 이 파일을 지운다.
//!
//! 실행: `cargo test -p pdf-studio translate_deps_spike -- --ignored --nocapture`

/// 실제 키(계정 `anthropic-api-key`)와 섞이지 않게 스파이크 전용 계정을 쓴다.
const KEYCHAIN_SERVICE: &str = "io.github.kwoncheuljin.pdfstudio";
const KEYCHAIN_ACCOUNT: &str = "step36-spike";
const KEYCHAIN_SECRET: &str = "step36-spike-not-a-real-key";

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
