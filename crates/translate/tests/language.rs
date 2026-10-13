//! 원문 언어 감지(계획서 §9.1.2 "언어 감지"): 간체·번체·영어·모름과 비율 경계.
//! 한자 비율 경계 0.5, 라틴 비율 경계 0.7(분모는 글자, 숫자·문장부호·공백 제외).

use translate::{
    DetectedLanguage, ScanImage, SourcePage, SourcePageContent, SourceParagraph, detect_language,
};

fn text_page(page: u32, texts: &[&str]) -> SourcePage {
    let paragraphs = texts
        .iter()
        .zip(1..)
        .map(|(text, number)| SourceParagraph {
            number,
            text: (*text).to_owned(),
            heading: false,
        })
        .collect();
    SourcePage {
        page,
        content: SourcePageContent::Text(paragraphs),
    }
}

fn detect(texts: &[&str]) -> DetectedLanguage {
    detect_language(&[text_page(0, texts)])
}

#[test]
fn chinese_script_is_decided_by_simplified_and_traditional_only_characters() {
    assert_eq!(detect(&["这是我们的国家。"]), DetectedLanguage::ZhHans);
    assert_eq!(detect(&["這是我們的國家。"]), DetectedLanguage::ZhHant);
    // 짝 글자가 없거나 같은 수면 그냥 중국어
    assert_eq!(detect(&["中文文件"]), DetectedLanguage::Zh);
    assert_eq!(detect(&["这這"]), DetectedLanguage::Zh);
}

/// 여러 쪽·문단을 합쳐 센다: 간체 1(这) < 번체 2(們·國)
#[test]
fn counts_are_summed_over_all_pages_and_paragraphs() {
    let pages = [text_page(0, &["这是"]), text_page(3, &["我們", "國"])];

    assert_eq!(detect_language(&pages), DetectedLanguage::ZhHant);
}

#[test]
fn english_text_is_english() {
    assert_eq!(
        detect(&["This agreement applies to all parties."]),
        DetectedLanguage::En
    );
}

/// 한자가 글자의 정확히 절반이면 중국어, 그보다 적으면(라틴도 0.7 미만) 모름. 숫자·문장부호는 세지 않는다.
#[test]
fn han_ratio_boundary_is_half_of_letters() {
    assert_eq!(detect(&["中a 2026。"]), DetectedLanguage::Zh);
    assert_eq!(detect(&["中ab"]), DetectedLanguage::Unknown);
}

/// 라틴 글자가 글자의 70% 이상이면 영어(가나 3자 + 라틴 7자 = 0.7), 아래면 모름(6/9)
#[test]
fn latin_ratio_boundary_is_seventy_percent_of_letters() {
    assert_eq!(detect(&["abcdefg あいう"]), DetectedLanguage::En);
    assert_eq!(detect(&["abcdef あいう"]), DetectedLanguage::Unknown);
}

/// 글자가 없으면(스캔 쪽뿐, 빈 쪽, 숫자뿐) 모름이다. 스캔 쪽은 세지 않는다.
#[test]
fn no_letters_is_unknown() {
    let scan = SourcePage {
        page: 0,
        content: SourcePageContent::Scan(ScanImage {
            width_px: 1568,
            height_px: 1109,
        }),
    };

    assert_eq!(
        detect_language(&[scan, text_page(1, &[])]),
        DetectedLanguage::Unknown
    );
    assert_eq!(detect(&["2026. 10. 13."]), DetectedLanguage::Unknown);
}
