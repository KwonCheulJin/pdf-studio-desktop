//! API 키(ADR 0002 §12). 키 원문은 이 타입 밖으로 글자로 나가지 않는다: `Debug`는 `ApiKey(***)`이고
//! `Display`·`Serialize`는 없다. 요청 헤더 값으로 바로 들고 있어 `set_sensitive(true)`가 늘 켜져 있다.

use std::fmt;

use reqwest::header::HeaderValue;

/// 키 접두(Anthropic API 키)
const API_KEY_PREFIX: &str = "sk-ant-";

/// 키 길이 상한(ADR 0002 §12). 실제 키는 100자 남짓이고 붙여 넣기 실수(문서 통째)를 막는다.
const API_KEY_MAX_LEN: usize = 256;

/// 형식 검사를 통과한 API 키
pub struct ApiKey(HeaderValue);

/// 키 형식이 맞지 않다(`API_KEY_INVALID`). 받은 값은 담지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("API 키 형식이 맞지 않다")]
pub struct InvalidApiKey;

impl ApiKey {
    /// 앞뒤 공백을 지운 뒤 `sk-ant-`로 시작, `API_KEY_MAX_LEN` 이하, ASCII 그래픽 글자만(공백·제어
    /// 문자 없음)이면 받는다(ADR 0002 §12 "형식 검사"). 네트워크를 쓰지 않는다.
    pub fn parse(raw: &str) -> Result<Self, InvalidApiKey> {
        let key = raw.trim();
        let well_formed = key.starts_with(API_KEY_PREFIX)
            && key.len() <= API_KEY_MAX_LEN
            && key.bytes().all(|byte| byte.is_ascii_graphic());
        if !well_formed {
            return Err(InvalidApiKey);
        }
        let mut header = HeaderValue::from_str(key).map_err(|_| InvalidApiKey)?;
        header.set_sensitive(true);
        Ok(Self(header))
    }

    /// `x-api-key` 헤더 값(민감 표시가 켜진)
    pub(crate) fn header_value(&self) -> &HeaderValue {
        &self.0
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApiKey(***)")
    }
}
