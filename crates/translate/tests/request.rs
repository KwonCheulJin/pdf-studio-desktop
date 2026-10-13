//! 요청 JSON golden(ADR 0002 §5): 모델 ID·thinking·`output_config.format` 스키마·system·용어집·이미지
//! 블록·`max_tokens`. 가짜 전송이 받은 본문 그대로를 golden과 맞댄다. `anthropic-version`·`x-api-key`
//! 헤더는 HTTP 어댑터 테스트(`src/http/tests.rs`)가 로컬 mock 서버로 본다.
//!
//! golden은 `tests/golden/`에 있다. 문구·형식을 바꾸면 `UPDATE_GOLDEN=1 cargo test -p translate --test
//! request`로 다시 쓰고 바뀐 값을 눈으로 확인한다. system 프롬프트나 user 틀이 바뀌었으면
//! `PROMPT_VERSION`을 올린다.

mod common;

use std::path::PathBuf;

use common::{FakeTransport, key, term, text_chunk, translated};
use serde_json::{Value, json};
use translate::{ChunkEstimate, Language, MessagesClient, ScanChunk, ScanImage, TranslateModel};

/// 보내면 안 되는 최상위 필드(도구 강제·샘플링·스트리밍, ADR 0002 §5)
const FORBIDDEN_FIELDS: [&str; 6] = [
    "tools",
    "tool_choice",
    "temperature",
    "top_p",
    "top_k",
    "stream",
];

fn assert_golden(name: &str, actual: &Value) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden")
        .join(name);
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        let pretty = serde_json::to_string_pretty(actual).expect("pretty JSON");
        std::fs::write(&path, pretty + "\n").expect("write golden");
    }
    let golden: Value = serde_json::from_str(&std::fs::read_to_string(&path).expect("read golden"))
        .expect("golden JSON");
    assert_eq!(actual, &golden, "{name}");
    for field in FORBIDDEN_FIELDS {
        assert!(actual.get(field).is_none(), "{name}에 {field}가 있다");
    }
}

#[tokio::test]
async fn sonnet_text_request_matches_golden() {
    let transport = FakeTransport::new([translated(&["가", "나"])]);
    let client = MessagesClient::new(&transport, key(), TranslateModel::Sonnet, Language::Zh);
    let chunk = text_chunk(
        &[
            "第一条 甲方应当在2026年10月前交付 Model-X 设备。",
            "第二条 乙方的联系人\"张三\"<负责>验收。",
        ],
        &[term("甲方", "갑"), term("乙方", "을")],
    );

    client
        .translate_text(&chunk)
        .await
        .result
        .expect("translated");

    assert_golden("request-text-sonnet.json", &transport.calls()[0].body);
}

#[tokio::test]
async fn haiku_scan_request_matches_golden() {
    let png = b"\x89PNG\r\n\x1a\n";
    let transport = FakeTransport::new([common::completed(r#"{"paragraphs":[]}"#)]);
    let client = MessagesClient::new(&transport, key(), TranslateModel::Haiku, Language::En);
    let chunk = ScanChunk {
        page: 3,
        image: ScanImage {
            width_px: 1568,
            height_px: 1109,
        },
        glossary: vec![term("Party A", "갑")],
        estimate: ChunkEstimate {
            input_tokens: 2_850,
            output_tokens: 3_500,
        },
    };

    client
        .translate_scan(&chunk, png)
        .await
        .result
        .expect("scanned");

    let body = &transport.calls()[0].body;
    assert_golden("request-scan-haiku.json", body);
    assert_eq!(
        body["messages"][0]["content"][0]["source"],
        json!({ "type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo=" })
    );
}
