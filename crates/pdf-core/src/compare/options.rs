//! 비교 옵션(계획서 §6.2 5번). 규칙의 정본은 ADR 0001 §13이다.
//!
//! - 쪽 범위(`range_a`·`range_b`)는 1부터 센 사용자 표기를 0부터 센 쪽 번호 목록(오름차순,
//!   중복 없음)으로 바꾼다. 이 목록이 `pair_pages`의 비교 범위 인자다.
//! - 머리말·꼬리말·쪽번호 제외는 추출한 글자를 토큰화하기 전에 줄 단위로 거른다. 줄과 밴드는
//!   화면 방향(`/Rotate` 적용 후) 기준이다.
//! - 대소문자 무시는 [`NormalizeOptions::ignore_case`]로 넘긴다. 유니코드 형식은 노출하지 않는다.

use super::diff::continues_line;
use super::extract::ExtractedPage;
use super::model::{PageSize, Side, TextBox};
use super::tokenize::{NormalizeOptions, union};
use crate::info::PageRotation;

/// 머리말·꼬리말 밴드 높이(pt). 쪽 위·아래 끝에서 이 거리 안에 줄의 세로 중심이 있으면 밴드 안이다.
///
/// 워드 기본 여백은 위·아래 72pt이고 머리말·꼬리말 줄은 끝에서 36pt 부근에 놓인다. 50pt면 그 줄
/// (글자 크기 10~12pt)의 중심이 들어오고 본문 첫 줄·끝 줄(72pt 안쪽)은 들어오지 않는다. 실제 계약서로
/// 잰 값이 아니라 기본 여백에서 정한 추정이다. 오탐이 보이면 다시 정한다.
pub const HEADER_FOOTER_BAND_PT: f32 = 50.0;

/// 쪽번호 표기로 보는 낱말. 지우고 나서 남은 글자가 숫자·구분 글자·공백뿐이어야 한다.
const PAGE_NUMBER_WORDS: [&str; 3] = ["page", "p.", "쪽"];
/// 쪽번호 줄에 숫자와 함께 올 수 있는 글자(`- 3 -`, `3 / 10`)
const PAGE_NUMBER_SEPARATORS: [char; 4] = ['-', '\u{2013}', '\u{2014}', '/'];

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CompareOptionsError {
    #[error("invalid page range {range:?} for {side:?} ({page_count} pages)")]
    InvalidRange {
        side: Side,
        range: String,
        page_count: u32,
    },
}

impl CompareOptionsError {
    /// 직렬화·화면 문구 선택에 쓰는 안정적인 코드
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRange { .. } => "INVALID_RANGE",
        }
    }
}

/// 비교 옵션. 기본값은 전체 쪽, 아무것도 제외하지 않음, 대소문자 구분이다.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CompareOptions {
    /// A 문서의 비교 범위(`"1,3-5"`, 1부터. 비우면 전체)
    pub range_a: String,
    /// B 문서의 비교 범위
    pub range_b: String,
    pub exclude_header: bool,
    pub exclude_footer: bool,
    pub exclude_page_numbers: bool,
    pub ignore_case: bool,
}

/// 비교에서 뺄 줄의 종류
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LineExclusions {
    pub header: bool,
    pub footer: bool,
    pub page_numbers: bool,
}

impl CompareOptions {
    /// 토큰화 옵션. 유니코드 형식은 기본(NFC)을 그대로 둔다.
    pub fn normalize_options(&self) -> NormalizeOptions {
        NormalizeOptions {
            ignore_case: self.ignore_case,
            ..NormalizeOptions::default()
        }
    }

    pub fn exclusions(&self) -> LineExclusions {
        LineExclusions {
            header: self.exclude_header,
            footer: self.exclude_footer,
            page_numbers: self.exclude_page_numbers,
        }
    }

    /// `side` 문서의 비교 범위(0부터 센 쪽 번호, 오름차순, 중복 없음)
    pub fn range_pages(
        &self,
        side: Side,
        page_count: u32,
    ) -> Result<Vec<u32>, CompareOptionsError> {
        let range = match side {
            Side::Before => &self.range_a,
            Side::After => &self.range_b,
        };
        parse_page_range(side, range, page_count)
    }
}

/// 쪽 범위 문자열(`"1,3-5"`)을 0부터 센 쪽 번호 목록으로 바꾼다.
///
/// - 비었거나 공백뿐이면 전체 쪽이다.
/// - 쉼표로 나눈 항목은 `N` 또는 `N-M`(1 ≤ N ≤ M ≤ `page_count`)이고, 항목과 `-` 둘레의 공백은
///   무시한다. 빈 항목(`"1,,2"`, 끝 쉼표), 0, 쪽 수 초과, 역방향 구간, 숫자 외 글자는
///   [`CompareOptionsError::InvalidRange`]다.
/// - 순서가 뒤바뀌거나 겹친 입력(`"5,1"`, `"1-3,2"`)은 정렬하고 중복을 없애 받아준다.
pub fn parse_page_range(
    side: Side,
    input: &str,
    page_count: u32,
) -> Result<Vec<u32>, CompareOptionsError> {
    if input.trim().is_empty() {
        return Ok((0..page_count).collect());
    }
    let invalid = || CompareOptionsError::InvalidRange {
        side,
        range: input.to_owned(),
        page_count,
    };
    let mut selected = vec![false; page_count as usize];
    for item in input.split(',') {
        let (first, last) = match item.split_once('-') {
            Some((first, last)) => (parse_page_number(first), parse_page_number(last)),
            None => {
                let single = parse_page_number(item);
                (single, single)
            }
        };
        match (first, last) {
            (Some(first), Some(last)) if 1 <= first && first <= last && last <= page_count => {
                selected[(first - 1) as usize..last as usize].fill(true);
            }
            _ => return Err(invalid()),
        }
    }
    Ok((0..page_count)
        .zip(selected)
        .filter_map(|(page, is_selected)| is_selected.then_some(page))
        .collect())
}

/// 앞뒤 공백을 뗀 10진수 숫자(부호 없음). 숫자가 아니거나 `u32`를 넘으면 `None`
fn parse_page_number(text: &str) -> Option<u32> {
    let digits = text.trim();
    if digits.is_empty() || !digits.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// `numbers`(0부터 센 쪽 번호)에 해당하는 쪽을 번호 순서대로 고른다. 글자 상자의 `page`는
/// 문서 전체 기준 그대로다. 범위를 넘는 번호는 건너뛴다.
pub fn select_pages(pages: &[ExtractedPage], numbers: &[u32]) -> Vec<ExtractedPage> {
    numbers
        .iter()
        .filter_map(|&number| pages.get(number as usize).cloned())
        .collect()
}

/// 밴드 안의 줄을 뺀 쪽을 돌려준다. 줄의 글자(줄 끝에 붙은 공백·줄바꿈 포함)를 통째로 뺀다.
/// `needs_ocr`와 `size`는 그대로다(OCR 대상 판정은 제외 전 텍스트 레이어로 한다).
pub fn exclude_lines(page: &ExtractedPage, exclusions: LineExclusions) -> ExtractedPage {
    if exclusions == LineExclusions::default() {
        return page.clone();
    }
    let (line_of, lines) = group_lines(page);
    let display_height = display_size(&page.size).1;
    let is_excluded: Vec<bool> = lines
        .iter()
        .map(|line| {
            let center = line.bounds.y + line.bounds.h / 2.0;
            let in_header = center >= display_height - HEADER_FOOTER_BAND_PT;
            let in_footer = center <= HEADER_FOOTER_BAND_PT;
            (exclusions.header && in_header)
                || (exclusions.footer && in_footer)
                || (exclusions.page_numbers && in_footer && is_page_number(&line.text))
        })
        .collect();
    let chars = page
        .chars
        .iter()
        .zip(&line_of)
        .filter(|(_, line)| !line.is_some_and(|index| is_excluded[index]))
        .map(|(extracted, _)| *extracted)
        .collect();
    ExtractedPage {
        chars,
        ..page.clone()
    }
}

/// 화면 방향 좌표(원점 = 화면 왼쪽 아래, y는 위로)로 옮긴 줄
struct Line {
    bounds: TextBox,
    text: String,
}

/// 글자마다 속한 줄 색인과 줄 목록. 글리프가 없는 글자(pdfium이 만든 공백·줄바꿈)와 공백 글리프는
/// 직전 줄에 붙인다. 첫 줄 앞에 있는 것은 어느 줄에도 속하지 않는다.
///
/// 줄은 글자열에서 이어진 글자가 같은 줄([`continues_line`], 상자 병합과 같은 규칙)인 동안 이어진다.
fn group_lines(page: &ExtractedPage) -> (Vec<Option<usize>>, Vec<Line>) {
    let mut lines: Vec<Line> = Vec::new();
    let mut line_of = Vec::with_capacity(page.chars.len());
    for extracted in &page.chars {
        match extracted.glyph {
            Some(glyph) if !extracted.ch.is_whitespace() => {
                let bounds = to_display(&glyph.bounds, &page.size);
                match lines.last_mut() {
                    Some(line) if continues_line(&line.bounds, &bounds) => {
                        line.bounds = union(line.bounds, bounds);
                        line.text.push(extracted.ch);
                    }
                    _ => lines.push(Line {
                        bounds,
                        text: extracted.ch.to_string(),
                    }),
                }
            }
            _ => {
                if let Some(line) = lines.last_mut() {
                    line.text.push(if extracted.ch.is_whitespace() {
                        ' '
                    } else {
                        extracted.ch
                    });
                }
            }
        }
        line_of.push(lines.len().checked_sub(1));
    }
    (line_of, lines)
}

/// 화면 방향 쪽 크기 `(너비, 높이)`
fn display_size(size: &PageSize) -> (f32, f32) {
    let view = size.view_box;
    let (width, height) = (view.right - view.left, view.top - view.bottom);
    match size.rotation {
        PageRotation::Degrees0 | PageRotation::Degrees180 => (width, height),
        PageRotation::Degrees90 | PageRotation::Degrees270 => (height, width),
    }
}

/// 사용자 공간 상자를 화면 방향 좌표로 옮긴다. `/Rotate`는 시계 방향이라 90이면 사용자 공간
/// 왼쪽 가장자리가 화면 위, 180이면 아래쪽 가장자리가 화면 위, 270이면 오른쪽 가장자리가 화면 위다.
fn to_display(bounds: &TextBox, size: &PageSize) -> TextBox {
    let view = size.view_box;
    let (x, y) = (bounds.x - view.left, bounds.y - view.bottom);
    let (width, height) = (view.right - view.left, view.top - view.bottom);
    let (display_x, display_y, display_w, display_h) = match size.rotation {
        PageRotation::Degrees0 => (x, y, bounds.w, bounds.h),
        PageRotation::Degrees90 => (y, width - x - bounds.w, bounds.h, bounds.w),
        PageRotation::Degrees180 => (
            width - x - bounds.w,
            height - y - bounds.h,
            bounds.w,
            bounds.h,
        ),
        PageRotation::Degrees270 => (height - y - bounds.h, x, bounds.h, bounds.w),
    };
    TextBox {
        page: bounds.page,
        x: display_x,
        y: display_y,
        w: display_w,
        h: display_h,
    }
}

/// 숫자와 `-`·`/`·공백, 쪽번호 표기(`쪽`, `Page`, `p.`)만 있고 숫자가 하나 이상인 줄인가
fn is_page_number(line_text: &str) -> bool {
    let mut rest = line_text.to_lowercase();
    for word in PAGE_NUMBER_WORDS {
        rest = rest.replace(word, " ");
    }
    rest.chars().any(|ch| ch.is_ascii_digit())
        && rest.chars().all(|ch| {
            ch.is_ascii_digit() || ch.is_whitespace() || PAGE_NUMBER_SEPARATORS.contains(&ch)
        })
}
