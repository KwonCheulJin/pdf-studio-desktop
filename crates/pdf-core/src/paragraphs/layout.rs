//! 쪽 글자 → 줄 → 덩어리(단) → 문단(ADR 0002 §2 "순서"·"문단 나누기"·"제목").
//!
//! - 좌표는 글자 흐름 좌표다: 쪽에서 이웃한 글자 쌍이 가장 많이 가는 방향을 오른쪽으로 두고 상자를
//!   돌린다(비교의 화면 방향 변환 `to_display`를 그 방향으로 쓴다). 그래서 `/Rotate`와 상관없이, 글자를
//!   돌려 그리고 `/Rotate`로 세운 쪽도, 가로 글자를 `/Rotate`로 눕힌 쪽도 가로줄로 읽는다.
//! - 줄: 글자 순서대로 같은 줄(비교와 같은 `continues_line`, ADR 0001 §10 세로 겹침·가로 간격 한도를
//!   글자 크기 높이로 편 상자에 쓴다)인 동안 한 줄이다. 가로 간격 한도가 2단의 같은 높이 줄을 가른다.
//! - 덩어리: 줄을 글자 순서대로 보며, 바로 위 줄이 이 줄과 가로로 겹치는 덩어리 중 가장 가까운 것에
//!   붙인다. 단 하나가 덩어리 하나가 되고, 덩어리는 처음 나온 순서로 읽는다(왼쪽 단을 다 읽고 오른쪽 단).
//! - 문단: 덩어리 안 이웃한 두 줄 사이에서 글자 크기·간격·목록 머리·들여쓰기 중 하나면 나눈다.

use crate::compare::{
    ExtractedPage, PageSize, SAME_LINE_MIN_OVERLAP, TextBox, continues_line, to_display, union,
};
use crate::compare::{HYPHEN, PDFIUM_LINE_END_HYPHEN};
use crate::info::PageRotation;

use super::Paragraph;
use super::text::{join_lines, starts_with_list_head};

/// 제목 문단: 문단 글자 크기가 쪽 본문 글자 크기의 이 배수 이상이다(ADR 0002 §2 시작값).
/// 본문 12pt에 14pt 절 제목(1.17배)부터 제목이다.
const HEADING_FONT_SIZE_RATIO: f32 = 1.15;
/// 이웃한 두 줄의 대표 글자 크기가 이 비율(큰 쪽 / 작은 쪽 - 1)을 넘게 다르면 문단을 나눈다.
/// 본문 11pt와 각주 8~9pt, 제목 14pt는 나누고, 10.5pt와 11pt(4.8%)처럼 같은 문단 안 자잘한 차이는 둔다.
const FONT_SIZE_CHANGE_RATIO: f32 = 0.1;
/// 줄 간격(위 줄 위 끝 → 이 줄 위 끝, 글자 크기 단위)이 쪽의 보통 줄 간격(중앙값)보다 이만큼 넓으면
/// 문단 간격이다. 0.5em(본문 12pt에 6pt) 띄운 문단부터 나눈다. 라틴 줄은 대문자·어센더가 없으면 위
/// 끝이 x-높이라 줄마다 0.2em 남짓 흔들리므로 그보다 크게 둔다.
const PARAGRAPH_GAP_RATIO: f32 = 0.4;
/// 들여쓰기로 보는 가로 차이(글자 크기 단위). tight 상자의 왼쪽 끝은 글리프 왼쪽 여백만큼(0.1em 안팎)
/// 흔들리고, 첫 줄 들여쓰기는 중국어 2em, 영어 1~3em이다.
const INDENT_MIN_RATIO: f32 = 0.5;
/// 이 줄 간격(글자 크기 단위)보다 멀리 떨어진 줄은 위 덩어리에 붙이지 않는다. 2배 줄 간격에 문단 간격
/// (보통 1em 안)을 더한 거리까지 같은 단이고, 제목 → 첫 본문 줄(픽스처 2.1~2.8배)도 같은 덩어리에 든다.
const BLOCK_MAX_PITCH_RATIO: f32 = 3.5;

/// 쪽의 텍스트 레이어 글자를 문단으로 묶는다(번호는 1부터, 읽는 순서).
pub(super) fn paragraphs(page: &ExtractedPage) -> Vec<Paragraph> {
    let flow = PageSize {
        rotation: flow_rotation(page),
        ..page.size
    };
    let lines = lines(page, &flow);
    let blocks = blocks(&lines);
    let reference_pitch = reference_pitch(&lines, &blocks);
    let body_size = median(page_sizes(page));
    let mut paragraphs = Vec::new();
    for block in &blocks {
        let members: Vec<&Line> = block.iter().map(|&index| &lines[index]).collect();
        let column_left = members
            .iter()
            .map(|line| line.frame.x)
            .fold(f32::INFINITY, f32::min);
        let mut start = 0;
        for index in 1..=members.len() {
            let ends = index == members.len()
                || starts_paragraph(
                    &members[start..index],
                    members[index],
                    column_left,
                    reference_pitch,
                );
            if ends {
                if let Some(paragraph) = paragraph(&members[start..index], body_size) {
                    paragraphs.push(paragraph);
                }
                start = index;
            }
        }
    }
    for (number, paragraph) in (1_u32..).zip(&mut paragraphs) {
        paragraph.number = number;
    }
    paragraphs
}

/// 줄 하나. `frame`은 글자 흐름 좌표, `bounds`는 사용자 공간 상자다.
struct Line {
    frame: TextBox,
    /// 줄 판정용 상자: 글자마다 tight 상자 세로 중심 ± 글자 크기/2로 편 상자를 합친 것(흐름 좌표)
    band: TextBox,
    bounds: TextBox,
    text: String,
    /// 공백이 아닌 글리프의 글자 크기(글자 순서)
    sizes: Vec<f32>,
    /// `sizes`의 중앙값
    font_size: f32,
}

impl Line {
    fn top(&self) -> f32 {
        self.frame.y + self.frame.h
    }
}

/// 공백이 아닌 글리프 중심을 글자 순서로 이어, 가장 많이 가는 방향(같으면 0 → 90 → 180 → 270)을
/// 오른쪽으로 두는 회전. 사용자 공간 위쪽(+y)으로 가는 글자는 90이다(`to_display`가 +y를 오른쪽으로 둔다).
fn flow_rotation(page: &ExtractedPage) -> PageRotation {
    const DIRECTIONS: [PageRotation; 4] = [
        PageRotation::Degrees0,
        PageRotation::Degrees90,
        PageRotation::Degrees180,
        PageRotation::Degrees270,
    ];
    let centers: Vec<(f32, f32)> = page
        .chars
        .iter()
        .filter(|extracted| !extracted.ch.is_whitespace())
        .filter_map(|extracted| extracted.glyph)
        .map(|glyph| {
            let bounds = glyph.bounds;
            (bounds.x + bounds.w / 2.0, bounds.y + bounds.h / 2.0)
        })
        .collect();
    let mut votes = [0_u32; DIRECTIONS.len()];
    for pair in centers.windows(2) {
        let (dx, dy) = (pair[1].0 - pair[0].0, pair[1].1 - pair[0].1);
        let direction = match (dx.abs() >= dy.abs(), dx >= 0.0, dy >= 0.0) {
            (true, true, _) => 0,
            (false, _, true) => 1,
            (true, false, _) => 2,
            (false, _, false) => 3,
        };
        votes[direction] += 1;
    }
    let most = votes.iter().copied().max().unwrap_or_default();
    let direction = votes
        .iter()
        .position(|&count| count == most)
        .unwrap_or_default();
    DIRECTIONS[direction]
}

/// 글자 순서대로 같은 줄인 동안 잇는다. 같은 줄 판정은 비교와 같은 `continues_line`(ADR 0001 §10)을
/// tight 상자 대신 글자 크기 높이로 편 상자에 쓴다. `一`·`、`·`.`처럼 납작하거나 낮은 글리프는 tight
/// 상자끼리 세로로 겹치지 않아 줄이 갈리기 때문이다. 공백 글리프와 pdfium이 만든 글자(공백·줄바꿈)는
/// 직전 줄에 공백으로 붙이고, pdfium이 다음 줄과 이은 줄 끝 하이픈(U+0002)은 `-`로 되돌린다(ADR 0001 §9).
fn lines(page: &ExtractedPage, flow: &PageSize) -> Vec<Line> {
    let mut lines: Vec<Line> = Vec::new();
    for extracted in &page.chars {
        let glyph = match extracted.glyph {
            Some(glyph) if !extracted.ch.is_whitespace() => glyph,
            _ => {
                if let Some(line) = lines.last_mut() {
                    line.text.push(' ');
                }
                continue;
            }
        };
        let ch = if extracted.ch == PDFIUM_LINE_END_HYPHEN {
            HYPHEN
        } else {
            extracted.ch
        };
        let frame = to_display(&glyph.bounds, flow);
        let band = font_size_band(&frame, glyph.font_size);
        match lines.last_mut() {
            Some(line) if continues_line(&line.band, &band) => {
                line.frame = union(line.frame, frame);
                line.band = union(line.band, band);
                line.bounds = union(line.bounds, glyph.bounds);
                line.text.push(ch);
                line.sizes.push(glyph.font_size);
            }
            _ => lines.push(Line {
                frame,
                band,
                bounds: glyph.bounds,
                text: ch.to_string(),
                sizes: vec![glyph.font_size],
                font_size: 0.0,
            }),
        }
    }
    for line in &mut lines {
        line.font_size = median(line.sizes.clone());
    }
    lines
}

/// tight 상자를 세로 중심은 두고 높이만 글자 크기로 편다.
fn font_size_band(frame: &TextBox, font_size: f32) -> TextBox {
    TextBox {
        y: frame.y + frame.h / 2.0 - font_size / 2.0,
        h: font_size,
        ..*frame
    }
}

/// 줄을 덩어리(단)로 모은다. 줄마다 마지막 줄이 이 줄 바로 위에 있고(같은 줄이 아니고 위 끝이 위),
/// 이 줄과 가로로 겹치며, 줄 간격이 [`BLOCK_MAX_PITCH_RATIO`] 안인 덩어리 중 마지막 줄이 가장 가까운
/// 것에 붙인다(같으면 먼저 생긴 덩어리). 없으면 새 덩어리다. 겹침은 덩어리의 둘째 줄부터의 가로 범위로
/// 본다(첫 줄은 들여쓰기나 두 단에 걸친 제목일 수 있다).
fn blocks(lines: &[Line]) -> Vec<Vec<usize>> {
    let mut blocks: Vec<Vec<usize>> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let nearest = blocks
            .iter()
            .enumerate()
            .filter_map(|(block_index, members)| {
                let last = &lines[*members.last()?];
                let pitch = last.top() - line.top();
                let size = last.font_size.max(line.font_size);
                let is_near = pitch <= BLOCK_MAX_PITCH_RATIO * size;
                let overlaps = width_of(lines, members)
                    .is_some_and(|width| overlaps_horizontally(&width, &line.frame));
                (is_above(last, line) && is_near && overlaps).then_some((block_index, pitch))
            })
            .min_by(|first, second| first.1.total_cmp(&second.1));
        match nearest {
            Some((block_index, _)) => blocks[block_index].push(index),
            None => blocks.push(vec![index]),
        }
    }
    blocks
}

/// `upper`가 `lower`보다 위 줄이다: 세로 겹침이 같은 줄 기준([`SAME_LINE_MIN_OVERLAP`])보다 작고 위 끝이 위다.
fn is_above(upper: &Line, lower: &Line) -> bool {
    let (upper, lower) = (&upper.frame, &lower.frame);
    let overlap = (upper.y + upper.h).min(lower.y + lower.h) - upper.y.max(lower.y);
    overlap < SAME_LINE_MIN_OVERLAP * upper.h.min(lower.h) && upper.y + upper.h > lower.y + lower.h
}

/// 덩어리의 가로 범위(둘째 줄부터, 한 줄뿐이면 그 줄)
fn width_of(lines: &[Line], members: &[usize]) -> Option<TextBox> {
    let body = match members {
        [_, rest @ ..] if !rest.is_empty() => rest,
        _ => members,
    };
    body.iter().map(|&index| lines[index].frame).reduce(union)
}

fn overlaps_horizontally(first: &TextBox, second: &TextBox) -> bool {
    first.x <= second.x + second.w && second.x <= first.x + first.w
}

/// 쪽의 보통 줄 간격(글자 크기 단위): 덩어리 안 이웃한 두 줄 중 글자 크기가 바뀌지 않는 쌍의 간격 중앙값.
/// 그런 쌍이 없으면 `None`(간격으로 나눌 일이 없다).
fn reference_pitch(lines: &[Line], blocks: &[Vec<usize>]) -> Option<f32> {
    let pitches: Vec<f32> = blocks
        .iter()
        .flat_map(|block| block.windows(2))
        .map(|pair| (&lines[pair[0]], &lines[pair[1]]))
        .filter(|(upper, lower)| !changes_font_size(upper, lower))
        .map(|(upper, lower)| relative_pitch(upper, lower))
        .collect();
    (!pitches.is_empty()).then(|| median(pitches))
}

fn relative_pitch(upper: &Line, lower: &Line) -> f32 {
    (upper.top() - lower.top()) / upper.font_size.max(lower.font_size)
}

fn changes_font_size(first: &Line, second: &Line) -> bool {
    let (small, large) = if first.font_size <= second.font_size {
        (first.font_size, second.font_size)
    } else {
        (second.font_size, first.font_size)
    };
    large > small * (1.0 + FONT_SIZE_CHANGE_RATIO)
}

/// `current`(지금 문단의 줄들) 다음 줄 `next`가 새 문단을 시작하는가.
///
/// - 글자 크기가 바뀐다([`FONT_SIZE_CHANGE_RATIO`]).
/// - 줄 간격이 쪽의 보통 줄 간격보다 [`PARAGRAPH_GAP_RATIO`] 넘게 넓다.
/// - 목록 머리로 시작한다.
/// - 들여쓰기: 위 줄보다 [`INDENT_MIN_RATIO`] 넘게 오른쪽에서 시작한다(목록 머리 문단의 둘째 줄이 머리
///   뒤에 맞춘 매단 들여쓰기는 빼고). 또는 위 줄이 들여쓴 첫 줄(단 왼쪽 끝보다 오른쪽)이고 이 줄도 같은
///   자리에서 시작한다(한 줄짜리 들여쓴 문단 뒤의 들여쓴 문단).
fn starts_paragraph(
    current: &[&Line],
    next: &Line,
    column_left: f32,
    reference_pitch: Option<f32>,
) -> bool {
    let (Some(&first), Some(&previous)) = (current.first(), current.last()) else {
        return true;
    };
    let size = previous.font_size.max(next.font_size);
    let indent = INDENT_MIN_RATIO * size;
    let is_list = starts_with_list_head(&first.text);
    let is_first_line = current.len() == 1;
    let shift = next.frame.x - previous.frame.x;
    let wider_gap = reference_pitch
        .is_some_and(|reference| relative_pitch(previous, next) - reference > PARAGRAPH_GAP_RATIO);
    let deeper_indent = shift > indent && !(is_first_line && is_list);
    let repeated_indent = is_first_line
        && !is_list
        && previous.frame.x - column_left > indent
        && shift.abs() <= indent;
    changes_font_size(previous, next)
        || wider_gap
        || starts_with_list_head(&next.text)
        || deeper_indent
        || repeated_indent
}

/// 줄들을 문단 하나로 만든다. 글이 비면 `None`이다. 번호는 다 모은 뒤 매긴다.
fn paragraph(lines: &[&Line], body_size: f32) -> Option<Paragraph> {
    let text = join_lines(lines.iter().map(|line| line.text.as_str()));
    let bounds = lines.iter().map(|line| line.bounds).reduce(union)?;
    if text.is_empty() {
        return None;
    }
    let font_size = median(
        lines
            .iter()
            .flat_map(|line| line.sizes.iter().copied())
            .collect(),
    );
    Some(Paragraph {
        number: 0,
        text,
        bounds,
        font_size,
        heading: font_size >= body_size * HEADING_FONT_SIZE_RATIO,
    })
}

/// 쪽의 공백이 아닌 글리프 글자 크기
fn page_sizes(page: &ExtractedPage) -> Vec<f32> {
    page.chars
        .iter()
        .filter(|extracted| !extracted.ch.is_whitespace())
        .filter_map(|extracted| extracted.glyph)
        .map(|glyph| glyph.font_size)
        .collect()
}

/// 글자 수 가중 중앙값(짝수 개면 아래 중앙값, 실제 값 하나). 비면 0이다.
fn median(mut values: Vec<f32>) -> f32 {
    values.sort_by(f32::total_cmp);
    values
        .get(values.len().saturating_sub(1) / 2)
        .copied()
        .unwrap_or_default()
}
