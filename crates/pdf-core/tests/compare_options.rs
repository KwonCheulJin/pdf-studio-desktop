//! 비교 옵션(ADR 0001 §13). pdfium 없이 손으로 만든 `ExtractedPage`로 쪽 범위 파싱, 밴드 제외,
//! 대소문자 무시, 0부터 이어지지 않는 범위의 쪽 짝짓기를 확인한다.

use std::time::Duration;

use pdf_core::{
    CompareOptions, CompareOptionsError, ComparedPages, DIFF_TIME_LIMIT, ExtractedChar,
    ExtractedPage, Glyph, LineExclusions, PageBox, PageRotation, PageSize, PageSizes, Side,
    TextBox, Token, TokenDiff, diff_tokens, exclude_lines, pair_pages, parse_page_range,
    select_pages, tokenize,
};

const PAGE_WIDTH: f32 = 612.0;
const PAGE_HEIGHT: f32 = 792.0;
const FONT_SIZE: f32 = 10.0;
const CHAR_WIDTH: f32 = 5.0;
/// 본문·머리말·꼬리말 줄의 기준선 y(사용자 공간, 회전 0)
const BODY_Y: f32 = 400.0;
const HEADER_Y: f32 = 750.0;
const FOOTER_Y: f32 = 30.0;
const LEFT_X: f32 = 72.0;

fn size(rotation: PageRotation) -> PageSize {
    PageSize {
        view_box: PageBox {
            left: 0.0,
            bottom: 0.0,
            right: PAGE_WIDTH,
            top: PAGE_HEIGHT,
        },
        rotation,
    }
}

/// `(x, y)`에서 오른쪽으로 쓴 한 줄(공백은 공백 글리프) 뒤에 pdfium이 만든 줄바꿈을 붙인다.
/// `vertical`이면 글자를 위쪽으로 쓴다(`/Rotate`로 세워 보이는 쪽의 내용).
fn line(page: u32, x: f32, y: f32, text: &str, vertical: bool) -> Vec<ExtractedChar> {
    let mut chars: Vec<ExtractedChar> = text
        .chars()
        .enumerate()
        .map(|(index, ch)| {
            let step = index as f32 * CHAR_WIDTH;
            let (x, y, w, h) = if vertical {
                (x, y + step, FONT_SIZE, CHAR_WIDTH)
            } else {
                (x + step, y, CHAR_WIDTH, FONT_SIZE)
            };
            ExtractedChar {
                ch,
                glyph: Some(Glyph {
                    bounds: TextBox { page, x, y, w, h },
                    font_size: FONT_SIZE,
                }),
                confidence: None,
            }
        })
        .collect();
    chars.push(ExtractedChar {
        ch: '\n',
        glyph: None,
        confidence: None,
    });
    chars
}

/// 두 문서(쪽 전체)의 비교 범위 `ranges`(A, B)에서 만든 토큰열을 diff한다.
fn diff_in(
    documents: [&[ExtractedPage]; 2],
    ranges: [&[u32]; 2],
    tokens: [&[Token]; 2],
    time_limit: Duration,
) -> TokenDiff {
    let sizes = |pages: &[ExtractedPage]| pages.iter().map(|page| page.size).collect();
    let page_sizes = PageSizes {
        before: sizes(documents[0]),
        after: sizes(documents[1]),
    };
    let pages = ComparedPages {
        before: ranges[0],
        after: ranges[1],
        sizes: &page_sizes,
    };
    diff_tokens(tokens[0], tokens[1], &pages, time_limit)
}

fn page(rotation: PageRotation, lines: Vec<Vec<ExtractedChar>>) -> ExtractedPage {
    ExtractedPage {
        size: size(rotation),
        chars: lines.concat(),
        needs_ocr: false,
    }
}

/// 위·가운데·아래 세 줄 쪽
fn three_line_page(page_number: u32, header: &str, body: &str, footer: &str) -> ExtractedPage {
    page(
        PageRotation::Degrees0,
        vec![
            line(page_number, LEFT_X, HEADER_Y, header, false),
            line(page_number, LEFT_X, BODY_Y, body, false),
            line(page_number, LEFT_X, FOOTER_Y, footer, false),
        ],
    )
}

fn texts(pages: &[ExtractedPage]) -> Vec<String> {
    tokenize(pages, Default::default())
        .into_iter()
        .map(|token| token.text)
        .collect()
}

fn exclusions(header: bool, footer: bool, page_numbers: bool) -> LineExclusions {
    LineExclusions {
        header,
        footer,
        page_numbers,
    }
}

// 잡는 결함: 0 기반/1 기반 혼동, 쪽 수 초과·역방향·빈 항목 허용, 정렬·중복 제거 누락
#[test]
fn page_range_parsing_table() {
    let ok: [(&str, &[u32]); 9] = [
        ("", &[0, 1, 2, 3, 4, 5]),
        ("   ", &[0, 1, 2, 3, 4, 5]),
        ("1", &[0]),
        ("6", &[5]),
        ("1,3-5", &[0, 2, 3, 4]),
        (" 2 - 3 , 6 ", &[1, 2, 5]),
        ("5,1", &[0, 4]),
        ("1-3,2", &[0, 1, 2]),
        ("4-4", &[3]),
    ];
    for (input, expected) in ok {
        assert_eq!(
            parse_page_range(Side::Before, input, 6).as_deref(),
            Ok(expected),
            "{input:?}"
        );
    }
    let invalid = [
        "0",
        "7",
        "1-7",
        "0-2",
        "5-3",
        "1,",
        ",1",
        "1,,2",
        "-",
        "1-",
        "-2",
        "a",
        "1-2-3",
        "+1",
        "1.5",
        "99999999999",
    ];
    for input in invalid {
        assert_eq!(
            parse_page_range(Side::After, input, 6),
            Err(CompareOptionsError::InvalidRange {
                side: Side::After,
                range: input.to_owned(),
                page_count: 6,
            }),
            "{input:?}"
        );
    }
}

// 잡는 결함: A·B 범위를 같은 문자열로 읽음, 오류 코드 변경
#[test]
fn ranges_are_per_side_and_error_has_code() {
    let options = CompareOptions {
        range_a: "1-2".to_owned(),
        range_b: "9".to_owned(),
        ..CompareOptions::default()
    };
    assert_eq!(options.range_pages(Side::Before, 3), Ok(vec![0, 1]));
    let error = options.range_pages(Side::After, 3).unwrap_err();
    assert_eq!(error.code(), "INVALID_RANGE");
}

// 잡는 결함: 밴드 플래그끼리 섞임(머리말만 켰는데 꼬리말도 빠짐), 본문이 밴드로 오판됨
#[test]
fn header_and_footer_are_excluded_independently() {
    let source = three_line_page(0, "Header", "Body", "Footer");
    let cases = [
        (
            exclusions(false, false, false),
            vec!["Header", "Body", "Footer"],
        ),
        (exclusions(true, false, false), vec!["Body", "Footer"]),
        (exclusions(false, true, false), vec!["Header", "Body"]),
        (exclusions(true, true, false), vec!["Body"]),
    ];
    for (flags, expected) in cases {
        assert_eq!(
            texts(&[exclude_lines(&source, flags)]),
            expected,
            "{flags:?}"
        );
    }
}

// 잡는 결함: 쪽번호 표기 변형 누락, 숫자 없는 꼬리말·본문 숫자·머리말 숫자를 쪽번호로 오판
#[test]
fn page_number_lines_are_excluded_only_in_footer_band() {
    for footer in ["- 3 -", "3 / 10", "3", "Page 3", "p. 3", "3쪽", "– 3 –"] {
        let source = three_line_page(0, "Header", "Body", footer);
        assert_eq!(
            texts(&[exclude_lines(&source, exclusions(false, false, true))]),
            ["Header", "Body"],
            "{footer:?}"
        );
    }
    // 하단 밴드의 숫자 없는 줄, 숫자 외 글자가 섞인 줄은 남는다.
    for footer in ["Footer", "Annex 3", "2026-01-01 Seoul", "-"] {
        let source = three_line_page(0, "7", "3", footer);
        let kept = texts(&[exclude_lines(&source, exclusions(false, false, true))]);
        assert!(
            kept.contains(&"7".to_owned()),
            "header number kept: {footer:?}"
        );
        assert!(
            kept.contains(&"3".to_owned()),
            "body number kept: {footer:?}"
        );
        assert!(
            kept.contains(&footer.split(' ').next().unwrap_or_default().to_owned()),
            "{footer:?} kept"
        );
    }
}

// 잡는 결함: 회전 쪽에서 사용자 공간 위/아래를 그대로 써서 화면 위/아래와 어긋남
#[test]
fn bands_follow_the_displayed_orientation() {
    // 쪽 /Rotate 90(시계 방향): 사용자 공간 왼쪽 가장자리가 화면 위, 오른쪽 가장자리가 화면 아래다.
    // 글자를 위쪽(사용자 공간 +y)으로 써서 화면에서 가로로 읽힌다.
    let rotated = |rotation, header_x, footer_x| {
        page(
            rotation,
            vec![
                line(0, header_x, 100.0, "Header", true),
                line(0, 300.0, 100.0, "Body", true),
                line(0, footer_x, 100.0, "Footer", true),
            ],
        )
    };
    let cases = [
        (PageRotation::Degrees90, 20.0, PAGE_WIDTH - 30.0),
        (PageRotation::Degrees270, PAGE_WIDTH - 30.0, 20.0),
    ];
    for (rotation, header_x, footer_x) in cases {
        let source = rotated(rotation, header_x, footer_x);
        assert_eq!(
            texts(&[exclude_lines(&source, exclusions(true, false, false))]),
            ["Body", "Footer"],
            "{rotation:?}"
        );
        assert_eq!(
            texts(&[exclude_lines(&source, exclusions(false, true, false))]),
            ["Header", "Body"],
            "{rotation:?}"
        );
    }
    // 180: 사용자 공간 아래쪽이 화면 위다.
    let upside_down = page(
        PageRotation::Degrees180,
        vec![
            line(0, LEFT_X, FOOTER_Y, "Header", false),
            line(0, LEFT_X, BODY_Y, "Body", false),
            line(0, LEFT_X, HEADER_Y, "Footer", false),
        ],
    );
    assert_eq!(
        texts(&[exclude_lines(&upside_down, exclusions(true, false, false))]),
        ["Body", "Footer"]
    );
}

// 잡는 결함: 쪽 끝 꼬리말(쪽번호)이 남아 쪽을 넘는 하이픈 잇기(`co-` + `operation`)를 끊음
#[test]
fn hyphen_join_survives_an_excluded_footer() {
    let source = page(
        PageRotation::Degrees0,
        vec![
            line(0, LEFT_X, BODY_Y, "co-", false),
            line(0, LEFT_X, FOOTER_Y, "- 3 -", false),
        ],
    );
    let next = page(
        PageRotation::Degrees0,
        vec![line(1, LEFT_X, BODY_Y, "operation", false)],
    );
    let filtered: Vec<ExtractedPage> = [source, next]
        .iter()
        .map(|page| exclude_lines(page, exclusions(false, false, true)))
        .collect();
    assert_eq!(texts(&filtered), ["co-operation"]);
}

// 잡는 결함: ignore_case가 토큰화로 전달되지 않음, 옵션 켠 것이 NFKC 등 다른 형식까지 바꿈
#[test]
fn ignore_case_reaches_the_diff() {
    let before = [three_line_page(0, "", "Total AMOUNT", "")];
    let after = [three_line_page(0, "", "total amount", "")];
    let changes = |options: &CompareOptions| {
        let normalize = options.normalize_options();
        let (a, b) = (tokenize(&before, normalize), tokenize(&after, normalize));
        diff_in([&before, &after], [&[0], &[0]], [&a, &b], DIFF_TIME_LIMIT)
            .changes
            .len()
    };
    let sensitive = CompareOptions::default();
    let insensitive = CompareOptions {
        ignore_case: true,
        ..CompareOptions::default()
    };
    assert_eq!(changes(&sensitive), 1);
    assert_eq!(changes(&insensitive), 0);
    assert_eq!(
        insensitive.normalize_options().form,
        sensitive.normalize_options().form
    );
}

// 잡는 결함: 범위가 0부터 이어지지 않을 때 쪽 번호 ↔ 색인 변환 오류(원래 쪽 번호가 아닌 색인을
// 돌려주거나 토큰의 쪽을 범위 안 색인으로 못 찾음), 전부 제외된 쪽이 빈 쪽 규칙을 타지 않음
#[test]
fn pairs_use_original_page_numbers_for_a_non_zero_based_range() {
    // A는 3~5쪽(색인 2·3·4), B는 2~4쪽(색인 1·2·3)을 비교한다. 각 문서의 4쪽(색인 3)·3쪽(색인 2)은
    // 꼬리말 쪽번호뿐이라 제외하면 빈 쪽이다.
    let document = |first: u32, bodies: [&str; 3], middle_is_empty: bool| {
        (first..first + 3)
            .zip(bodies)
            .enumerate()
            .map(|(offset, (number, body))| {
                if middle_is_empty && offset == 1 {
                    page(
                        PageRotation::Degrees0,
                        vec![line(number, LEFT_X, FOOTER_Y, "- 9 -", false)],
                    )
                } else {
                    three_line_page(number, "", body, "")
                }
            })
            .collect::<Vec<_>>()
    };
    let pages_a: Vec<ExtractedPage> = (0..2)
        .map(|number| three_line_page(number, "", "skipped", ""))
        .chain(document(2, ["alpha one", "", "gamma three"], true))
        .collect();
    let pages_b: Vec<ExtractedPage> = (0..1)
        .map(|number| three_line_page(number, "", "skipped", ""))
        .chain(document(1, ["alpha one", "", "gamma three"], true))
        .collect();
    let options = CompareOptions {
        range_a: "3-5".to_owned(),
        range_b: "2-4".to_owned(),
        exclude_page_numbers: true,
        ..CompareOptions::default()
    };
    let numbers_a = options.range_pages(Side::Before, 5).unwrap();
    let numbers_b = options.range_pages(Side::After, 4).unwrap();
    assert_eq!(
        (&numbers_a[..], &numbers_b[..]),
        (&[2, 3, 4][..], &[1, 2, 3][..])
    );

    let prepare = |pages: &[ExtractedPage], numbers: &[u32]| {
        let selected: Vec<ExtractedPage> = select_pages(pages, numbers)
            .iter()
            .map(|page| exclude_lines(page, options.exclusions()))
            .collect();
        tokenize(&selected, options.normalize_options())
    };
    let (tokens_a, tokens_b) = (prepare(&pages_a, &numbers_a), prepare(&pages_b, &numbers_b));
    let diff = diff_in(
        [&pages_a, &pages_b],
        [&numbers_a, &numbers_b],
        [&tokens_a, &tokens_b],
        Duration::from_secs(10),
    );
    assert!(diff.changes.is_empty());
    assert_eq!(
        pair_pages(&numbers_a, &numbers_b, &tokens_a, &tokens_b, &diff.matches),
        [(Some(2), Some(1)), (Some(3), Some(2)), (Some(4), Some(3)),]
    );
}
