//! 문단 키(ADR 0002 §3)와 이어하기 기록 키(§8). 두 키 모두 SHA-256에 ASCII 판 이름을 먼저 넣고, 필드마다
//! `u32` 리틀엔디언 바이트 길이 + 바이트를 잇는다(ADR 0001 §4 `Change.id`와 같은 방식).

use sha2::{Digest, Sha256};

use crate::glossary::{Glossary, GlossaryTerm};
use crate::language::Language;
use crate::models::TranslateModel;
use crate::request::PROMPT_VERSION;

/// 문단 키 판 이름. 키 형식을 바꾸면 올린다(예전 기록의 문단은 다시 보낸다).
const PARAGRAPH_KEY_DOMAIN: &[u8] = b"pdfstudio.paragraph.v1";
/// 문단 키에 쓰는 해시 앞 바이트 수(16진수 16자)
const PARAGRAPH_KEY_HASH_BYTES: usize = 8;

/// 기록 키 판 이름. 기록 형식을 바꾸면 올린다(예전 기록은 없는 것으로 본다).
const RECORD_KEY_DOMAIN: &[u8] = b"pdfstudio.translation.v1";
/// 기록 키에 쓰는 해시 앞 바이트 수(16진수 32자)
const RECORD_KEY_HASH_BYTES: usize = 16;

/// 기록 키 ②: 정해진 원문 언어(간체·번체는 `zh`)
const LANGUAGE_ZH: &str = "zh";
const LANGUAGE_EN: &str = "en";

/// 기록 키 ⑤: 스캔 옵션
const SCAN_OPTION_ON: &str = "1";
const SCAN_OPTION_OFF: &str = "0";

/// 문단 키 `{page}-{number}-{hash}`. `hash`는 SHA-256(판 이름 ‖ 길이 ‖ 원문 UTF-8)의 앞 8바이트를 소문자
/// 16진수로 쓴 것이다. `page`는 0부터, `number`는 1부터다. 원문은 글자층 문단이면 추출한 `text`, 스캔 쪽
/// 문단이면 받아 적은 `source`(NFC)다.
pub fn paragraph_key(page: u32, number: u32, text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(PARAGRAPH_KEY_DOMAIN);
    update_field(&mut hasher, text.as_bytes());
    let hash = hex(&hasher.finalize()[..PARAGRAPH_KEY_HASH_BYTES]);
    format!("{page}-{number}-{hash}")
}

/// 번역 작업의 옵션. 기록 키(§8 ①~⑤)를 정하고, 실행기가 이것으로 묶음을 만든다. 쪽 범위는 키에 넣지
/// 않는다(범위를 바꿔도 겹친 문단은 다시 보내지 않는다).
#[derive(Debug, Clone, Copy)]
pub struct TranslationOptions<'a> {
    /// ① 파일 내용 SHA-256
    pub file_sha256: [u8; 32],
    /// 문서(범위가 아니라 전체)에 스캔 쪽이 있는가. 없으면 ⑤를 늘 `0`으로 둔다.
    pub document_has_scan_pages: bool,
    /// ② 정해진 원문 언어
    pub language: Language,
    /// ③ 모델
    pub model: TranslateModel,
    /// ④ 합친 용어집(정규화 뒤)
    pub glossary: &'a Glossary,
    /// ⑤ 스캔 쪽을 보내는가
    pub include_scan_pages: bool,
}

impl TranslationOptions<'_> {
    /// 기록 키: SHA-256(판 이름 ‖ ①~⑥ 필드)의 앞 16바이트를 소문자 16진수 32자로 쓴 것(ADR 0002 §8).
    /// ⑥은 `PROMPT_VERSION` 10진수다.
    pub fn record_key(&self) -> String {
        let language = match self.language {
            Language::Zh => LANGUAGE_ZH,
            Language::En => LANGUAGE_EN,
        };
        let scan_option = if self.include_scan_pages && self.document_has_scan_pages {
            SCAN_OPTION_ON
        } else {
            SCAN_OPTION_OFF
        };
        let mut hasher = Sha256::new();
        hasher.update(RECORD_KEY_DOMAIN);
        update_field(&mut hasher, &self.file_sha256);
        update_field(&mut hasher, language.as_bytes());
        update_field(&mut hasher, self.model.spec().api_id.as_bytes());
        update_field(&mut hasher, &glossary_bytes(self.glossary.terms()));
        update_field(&mut hasher, scan_option.as_bytes());
        update_field(&mut hasher, PROMPT_VERSION.to_string().as_bytes());
        hex(&hasher.finalize()[..RECORD_KEY_HASH_BYTES])
    }
}

/// 기록 키 ④: 용어를 (원어, 번역어) 코드 포인트 순으로 정렬해 `u32` 개수 + 용어마다 [길이 + 원어]
/// [길이 + 번역어]. 같은 용어집이면 프론트가 넘긴 순서와 상관없이 같은 바이트다.
fn glossary_bytes(terms: &[GlossaryTerm]) -> Vec<u8> {
    // `str`의 순서는 UTF-8 바이트 순이고 UTF-8 바이트 순은 코드 포인트 순과 같다.
    let mut sorted: Vec<&GlossaryTerm> = terms.iter().collect();
    sorted.sort_by(|a, b| (&a.source, &a.target).cmp(&(&b.source, &b.target)));
    let mut bytes = length_prefix(sorted.len()).to_vec();
    for term in sorted {
        bytes.extend_from_slice(&length_prefix(term.source.len()));
        bytes.extend_from_slice(term.source.as_bytes());
        bytes.extend_from_slice(&length_prefix(term.target.len()));
        bytes.extend_from_slice(term.target.as_bytes());
    }
    bytes
}

fn update_field(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update(length_prefix(bytes.len()));
    hasher.update(bytes);
}

/// `u32` 리틀엔디언 길이. 4 GiB를 넘는 필드는 만들 수 없지만(문단·용어집 상한) 넘으면 최댓값으로 둔다.
fn length_prefix(length: usize) -> [u8; 4] {
    u32::try_from(length).unwrap_or(u32::MAX).to_le_bytes()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
