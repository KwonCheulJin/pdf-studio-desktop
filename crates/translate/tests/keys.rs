//! 문단 키(ADR 0002 §3)와 기록 키(§8). 기대값은 Python `hashlib`로 셈한 리터럴이다:
//! `sha256(b"pdfstudio.paragraph.v1" + struct.pack("<I", len(t)) + t)[:8].hex()`,
//! `sha256(b"pdfstudio.translation.v1" + 필드마다 struct.pack("<I", len(f)) + f)[:16].hex()`.

use translate::{
    Glossary, GlossaryTerm, Language, TranslateModel, TranslationOptions, paragraph_key,
};

/// 파일 내용 SHA-256 자리(값은 아무거나, Python 계산과 같은 `bytes([7] * 32)`)
const FILE_SHA256: [u8; 32] = [7; 32];

fn term(source: &str, target: &str) -> GlossaryTerm {
    GlossaryTerm {
        source: source.to_owned(),
        target: target.to_owned(),
    }
}

fn options(
    glossary: &Glossary,
    document_has_scan_pages: bool,
    include_scan_pages: bool,
) -> TranslationOptions<'_> {
    TranslationOptions {
        file_sha256: FILE_SHA256,
        document_has_scan_pages,
        language: Language::Zh,
        model: TranslateModel::Sonnet,
        glossary,
        include_scan_pages,
    }
}

#[test]
fn paragraph_key_is_page_number_and_length_prefixed_text_hash() {
    assert_eq!(
        paragraph_key(2, 3, "甲方应当交付设备。"),
        "2-3-633c27805efdd40d"
    );
}

/// 필드 ①~⑥(파일 해시, `zh`, 모델 ID, 정렬한 용어집, 스캔 `1`, `PROMPT_VERSION` `1`). 용어집은 넘긴
/// 순서와 상관없이 코드 포인트 순(`甲方` U+7532 < `设备` U+8BBE)으로 넣는다.
#[test]
fn record_key_hashes_all_options_with_the_glossary_sorted() {
    let glossary = Glossary::new([term("设备", "설비"), term("甲方", "갑")]);
    let reversed = Glossary::new([term("甲方", "갑"), term("设备", "설비")]);

    assert_eq!(
        options(&glossary, true, true).record_key(),
        "e45eba021dd59c59d6e00608421a4e0e"
    );
    assert_eq!(
        options(&reversed, true, true).record_key(),
        "e45eba021dd59c59d6e00608421a4e0e"
    );
}

/// 문서에 스캔 쪽이 없으면 스캔 옵션을 켜도 ⑤는 `0`이다(쓸모없는 무효화를 막는다).
#[test]
fn scan_option_is_off_in_the_record_key_when_the_document_has_no_scan_pages() {
    let glossary = Glossary::new([term("设备", "설비"), term("甲方", "갑")]);

    assert_eq!(
        options(&glossary, false, true).record_key(),
        "f46d2e564c8043dd5363b467a677b351"
    );
    assert_eq!(
        options(&glossary, true, false).record_key(),
        "f46d2e564c8043dd5363b467a677b351"
    );
}
