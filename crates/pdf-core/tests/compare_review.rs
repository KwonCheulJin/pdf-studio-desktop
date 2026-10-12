//! OCR 쪽이 섞인 비교의 신뢰도·확인 필요·정규화 규칙(ADR 0001 §5). pdfium·OCR 없이 글자를 직접
//! 만든 문서로 확인한다.

use pdf_core::{
    ChangeKind, DIFF_TIME_LIMIT, DocumentText, ExtractedChar, ExtractedPage, Glyph,
    NormalizeOptions, OCR_MIN_CONFIDENCE, OCR_MIN_CONFIDENCE_NUMERIC, PageBox, PageRotation,
    PageSize, TextBox, TextSource, compare_texts,
};

const GLYPH_WIDTH: f32 = 10.0;
const GLYPH_HEIGHT: f32 = 12.0;
const PAGE_SIDE: f32 = 1000.0;
/// 기준과 상관없이 통과하는 OCR 신뢰도
const CONFIDENT: f32 = 0.99;

/// 한 쪽짜리 문서. 글자는 한 줄에 왼쪽부터 놓고, 공백은 만든 글자(`glyph: None`)다. OCR 문서는
/// 글자마다 `confidence(글자 위치)`를 신뢰도로 갖는다.
fn document(text: &str, ocr_confidence: Option<&dyn Fn(usize) -> f32>) -> DocumentText {
    let chars = (0_u16..)
        .zip(text.chars())
        .map(|(index, ch)| {
            let is_glyph = !ch.is_whitespace();
            ExtractedChar {
                ch,
                glyph: is_glyph.then(|| Glyph {
                    bounds: TextBox {
                        page: 0,
                        x: f32::from(index) * GLYPH_WIDTH,
                        y: 0.0,
                        w: GLYPH_WIDTH,
                        h: GLYPH_HEIGHT,
                    },
                    font_size: GLYPH_HEIGHT,
                }),
                confidence: ocr_confidence
                    .filter(|_| is_glyph)
                    .map(|confidence| confidence(usize::from(index))),
            }
        })
        .collect();
    DocumentText {
        pages: vec![ExtractedPage {
            size: PageSize {
                view_box: PageBox {
                    left: 0.0,
                    bottom: 0.0,
                    right: PAGE_SIDE,
                    top: PAGE_SIDE,
                },
                rotation: PageRotation::Degrees0,
            },
            chars,
            needs_ocr: ocr_confidence.is_some(),
        }],
        sources: vec![if ocr_confidence.is_some() {
            TextSource::Ocr
        } else {
            TextSource::TextLayer
        }],
        ocr_failures: Vec::new(),
    }
}

fn text_layer(text: &str) -> DocumentText {
    document(text, None)
}

fn ocr(text: &str, confidence: f32) -> DocumentText {
    document(text, Some(&move |_| confidence))
}

/// 변경마다 (종류, A 원문, B 원문, 확인 필요, B 쪽 최소 신뢰도)
fn changes(
    before: &DocumentText,
    after: &DocumentText,
) -> Vec<(ChangeKind, String, String, bool, Option<f32>)> {
    compare_texts(before, after, NormalizeOptions::default(), DIFF_TIME_LIMIT)
        .changes
        .into_iter()
        .map(|change| {
            let text = |side: &Option<pdf_core::ChangeSide>| {
                side.as_ref()
                    .map(|side| side.text.clone())
                    .unwrap_or_default()
            };
            (
                change.kind,
                text(&change.before),
                text(&change.after),
                change.needs_review,
                change.after.and_then(|side| side.min_confidence),
            )
        })
        .collect()
}

/// 기준 미만 OCR 토큰이 걸린 변경만 확인 필요다. 숫자 토큰은 더 높은 기준(0.95)을 쓰고, 기준과 같은
/// 신뢰도는 통과한다. `min_confidence`는 걸린 OCR 토큰 신뢰도의 최솟값이다.
#[test]
fn change_with_ocr_token_below_threshold_needs_review() {
    let before = text_layer("금 100원 지급 갑");
    let cases = [
        // 숫자 토큰 `700원`: 0.95 미만이면 확인 필요, 0.95면 차이
        (0.94, "700원", true),
        (OCR_MIN_CONFIDENCE_NUMERIC, "700원", false),
        // 일반 토큰 `을`: 0.80 미만이면 확인 필요, 0.80이면 차이(0.94는 숫자 기준으로만 미만)
        (0.79, "을", true),
        (OCR_MIN_CONFIDENCE, "을", false),
        (0.94, "을", false),
    ];
    for (confidence, changed, needs_review) in cases {
        let after_text = match changed {
            "을" => "금 100원 지급 을",
            _ => "금 700원 지급 갑",
        };
        // 바뀐 토큰만 `confidence`, 나머지는 충분히 높다.
        let changed_start = after_text
            .find(changed)
            .map(|byte| after_text[..byte].chars().count());
        let changed_range = changed_start.map(|start| start..start + changed.chars().count());
        let after = document(
            after_text,
            Some(&|index| {
                if changed_range
                    .as_ref()
                    .is_some_and(|range| range.contains(&index))
                {
                    confidence
                } else {
                    CONFIDENT
                }
            }),
        );

        let [(kind, _, ref after_side, review, min_confidence)] = changes(&before, &after)[..]
        else {
            panic!("expected one change for {changed} at {confidence}");
        };
        assert_eq!(kind, ChangeKind::Replace);
        assert_eq!(after_side, changed);
        assert_eq!(review, needs_review, "{changed} at {confidence}");
        assert_eq!(min_confidence, Some(confidence));
    }
}

/// OCR 쪽이 걸린 치환이 띄어쓰기만, 또는 문장부호와 띄어쓰기만 다르면 신뢰도가 높아도 확인 필요다.
/// 텍스트 레이어끼리라면 띄어쓰기만 다른 묶음은 변경이 아니고 문장부호 차이는 차이다.
#[test]
fn ocr_spacing_or_punctuation_only_replace_needs_review() {
    let before = "계약 기간은 금 8,900원이다. “계약” 끝";
    let after = "계약기간은 금 8,900원이다 \"계약\" 끝";

    let expected_ocr = vec![
        (
            ChangeKind::Replace,
            "계약 기간은".to_owned(),
            "계약기간은".to_owned(),
            true,
            Some(CONFIDENT),
        ),
        (
            ChangeKind::Replace,
            "8,900원이다. “계약”".to_owned(),
            "8,900원이다 \"계약\"".to_owned(),
            true,
            Some(CONFIDENT),
        ),
    ];
    assert_eq!(
        changes(&text_layer(before), &ocr(after, CONFIDENT)),
        expected_ocr
    );
    assert_eq!(
        changes(&text_layer(before), &text_layer(after)),
        vec![(
            ChangeKind::Replace,
            "8,900원이다. “계약”".to_owned(),
            "8,900원이다 \"계약\"".to_owned(),
            false,
            None,
        )]
    );
}

/// 어느 쪽이든 OCR 쪽이 있으면 사용자 옵션(NFC)과 상관없이 두 문서를 NFKC로 비교한다. OCR은
/// 원문자·전각 숫자를 일반 문자로 읽는다. 텍스트 레이어끼리는 옵션대로 NFC라 차이다.
#[test]
fn ocr_side_forces_nfkc_on_both_documents() {
    let before = text_layer("제②조 금 １,０００원");
    let after = "제2조 금 1,000원";

    assert_eq!(changes(&before, &ocr(after, CONFIDENT)), vec![]);
    let text_layer_changes: Vec<(String, String)> = changes(&before, &text_layer(after))
        .into_iter()
        .map(|(_, before, after, _, _)| (before, after))
        .collect();
    assert_eq!(
        text_layer_changes,
        [("제②조", "제2조"), ("１,０００원", "1,000원")]
            .map(|(before, after)| (before.to_owned(), after.to_owned()))
    );
}
