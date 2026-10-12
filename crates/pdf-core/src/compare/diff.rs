//! 정렬과 diff(계획서 §6.2 3번). 규칙의 정본은 ADR 0001 §4·§6·§10이다.
//!
//! - 두 문서의 토큰열 전체를 비교 키(`Token::key`)로 비교한다. 쪽 경계는 보지 않는다.
//! - 양쪽에 한 번씩만 나오는 키를 앵커로 잡고(Patience: 두 위치가 함께 늘어나는 가장 긴 사슬),
//!   앵커 사이 구간만 Myers(`similar`)로 비교한다.
//! - 공통 토큰 사이에서 바뀐 토큰 묶음 하나가 변경 하나다(양쪽에 토큰이 있으면 `Replace`).
//!   띄어쓰기만 다른 묶음(양쪽 키를 공백 없이 이은 문자열이 같다)은 변경으로 내지 않는다. 단
//!   한쪽에만 있는 토큰 경계가 숫자와 숫자 사이에 있으면(`1 000` ↔ `10 00`) 숫자를 다르게 읽히게
//!   하므로 `Replace`로 낸다.
//! - `Replace`의 상자는 키 글자 단위 2차 diff에서 실제로 다른 글자만 덮는다.
//! - 시간 제한이 지나면 남은 정밀 diff(앵커 구간의 토큰 diff, `Replace`의 글자 diff)를 하지
//!   않고 통째로 낸 뒤 `Truncated`로 알린다.

use std::collections::{BTreeSet, HashMap};
use std::ops::Range;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use similar::{Algorithm, DiffTag, capture_diff_deadline, capture_diff_slices_deadline};

use super::model::{Change, ChangeKind, ChangeSide, Notice, TextBox};
use super::tokenize::{Token, union};

/// diff 시간 제한. 지나면 남은 정밀 diff를 하지 않고 통째로 낸 뒤 `Truncated`로 알린다.
///
/// 정상 입력에서는 닿지 않는 값이다. release 빌드(Apple M 계열)에서 500쪽 합성 문서(한 문서 20만
/// 토큰, 200곳 수정)는 약 15 ms, 문단 블록 이동도 같고, 유일 토큰이 거의 없는 서로 다른 500쪽
/// 문서도 2~7초에 끝났다(ADR 0001 §10). 그보다 나쁜 입력(더 느린 PC의 전혀 다른 문서)에서 화면이
/// 오래 멈추지 않게 하는 상한이다.
pub const DIFF_TIME_LIMIT: Duration = Duration::from_secs(10);

/// `Change.id` 문맥으로 쓰는 앞·뒤 공통 토큰 수(ADR 0001 §4)
const CHANGE_ID_CONTEXT_TOKENS: usize = 3;
/// `Change.id` 해시 입력 맨 앞의 버전 표시
const CHANGE_ID_PREFIX: &[u8] = b"pdfstudio.change.v1";
/// `Change.id`에 쓰는 SHA-256 앞부분 바이트 수(16진수 16자)
const CHANGE_ID_HASH_BYTES: usize = 8;
/// 다음 글자 상자가 지금 상자와 세로로 이만큼(낮은 쪽 높이 기준 비율) 겹쳐야 같은 줄이다.
/// tight 상자는 글자마다 높이가 다르므로(`.`과 `가`) 겹침을 낮은 쪽 높이로 잰다. 줄 간격이 좁아
/// 윗줄 아래 끝과 아랫줄 위 끝이 조금 겹쳐도 다른 줄로 본다.
const SAME_LINE_MIN_OVERLAP: f32 = 0.5;
/// 같은 줄 두 상자 사이 가로 간격이 높은 쪽 높이(≈ 글꼴 크기)의 이 배수를 넘으면 합치지 않는다.
/// 단어 사이 공백(0.25~0.5em)은 합치고, 표의 다른 칸처럼 멀리 떨어진 글자는 따로 둔다.
const SAME_LINE_MAX_GAP: f32 = 1.0;

/// 토큰 diff 결과
#[derive(Debug, Clone, PartialEq)]
pub struct TokenDiff {
    /// diff 순서(ADR 0001 §4). `needs_review`는 아직 늘 `false`, `min_confidence`는 `None`이다.
    pub changes: Vec<Change>,
    /// 시간 제한 때문에 통째로 낸 변경이 있으면 [`Notice::Truncated`]
    pub truncated: Option<Notice>,
    /// 공통(Equal) 토큰의 `(A 토큰 색인, B 토큰 색인)` 짝. 두 색인이 함께 늘어난다. 변경에 걸린
    /// 토큰과 띄어쓰기만 다른 묶음의 토큰은 들지 않는다. 페이지 짝짓기(ADR 0001 §12)가 쓴다.
    pub matches: Vec<(usize, usize)>,
}

/// 두 토큰열을 비교해 변경 목록을 만든다. `time_limit`(보통 [`DIFF_TIME_LIMIT`])이 지나면 남은
/// 정밀 diff를 하지 않는다.
pub fn diff_tokens(before: &[Token], after: &[Token], time_limit: Duration) -> TokenDiff {
    let deadline = Instant::now().checked_add(time_limit);
    let (before_ids, after_ids, vocabulary) = intern_keys(before, after);
    let anchors = anchors(&before_ids, &after_ids, vocabulary);
    let hunks = diff_between_anchors(&before_ids, &after_ids, &anchors, deadline);
    let matches = equal_pairs(before.len(), after.len(), &hunks);
    let equal_positions: Vec<usize> = matches.iter().map(|&(position, _)| position).collect();

    let mut changes = Vec::new();
    let mut id_counts: HashMap<String, usize> = HashMap::new();
    let (mut before_pages, mut after_pages) = (BTreeSet::new(), BTreeSet::new());
    for hunk in &hunks {
        let before_tokens = &before[hunk.before.clone()];
        let after_tokens = &after[hunk.after.clone()];
        let Some(kind) = change_kind(before_tokens, after_tokens) else {
            continue;
        };
        let precise = match kind {
            ChangeKind::Replace if !hunk.truncated => {
                replace_sides(before_tokens, after_tokens, deadline)
            }
            _ => None,
        };
        let is_truncated = hunk.truncated || (kind == ChangeKind::Replace && precise.is_none());
        let (before_side, after_side) =
            precise.unwrap_or_else(|| (whole_side(before_tokens), whole_side(after_tokens)));
        if is_truncated {
            before_pages.extend(token_pages(before_tokens));
            after_pages.extend(token_pages(after_tokens));
        }

        let context = |range: Range<usize>| -> Vec<&str> {
            range
                .map(|position| before[equal_positions[position]].key.as_str())
                .collect()
        };
        let base_id = change_id(
            kind,
            before_tokens,
            after_tokens,
            &context(context_before(&equal_positions, hunk.before.start)),
            &context(context_after(&equal_positions, hunk.before.end)),
        );
        let occurrence = id_counts.entry(base_id.clone()).or_default();
        *occurrence += 1;
        let id = match *occurrence {
            1 => base_id,
            occurrence => format!("{base_id}-{occurrence}"),
        };
        changes.push(Change {
            id,
            kind,
            page_pair: (first_page(&before_side), first_page(&after_side)),
            before: before_side,
            after: after_side,
            needs_review: false,
        });
    }

    let truncated =
        (!before_pages.is_empty() || !after_pages.is_empty()).then(|| Notice::Truncated {
            before_pages: before_pages.into_iter().collect(),
            after_pages: after_pages.into_iter().collect(),
        });
    TokenDiff {
        changes,
        truncated,
        matches,
    }
}

/// 키를 정수로 바꾼다(같은 키 = 같은 수). 앵커 셈과 Myers 비교가 문자열 대신 정수를 본다.
fn intern_keys<'a>(before: &'a [Token], after: &'a [Token]) -> (Vec<usize>, Vec<usize>, usize) {
    let mut ids: HashMap<&'a str, usize> = HashMap::new();
    let mut intern = |tokens: &'a [Token]| -> Vec<usize> {
        tokens
            .iter()
            .map(|token| {
                let next = ids.len();
                *ids.entry(token.key.as_str()).or_insert(next)
            })
            .collect()
    };
    let before_ids = intern(before);
    let after_ids = intern(after);
    (before_ids, after_ids, ids.len())
}

/// 양쪽에 한 번씩만 나오는 키의 위치 쌍 중 두 위치가 함께 늘어나는 가장 긴 사슬(Patience 앵커)
fn anchors(before: &[usize], after: &[usize], vocabulary: usize) -> Vec<(usize, usize)> {
    #[derive(Clone, Copy, Default)]
    struct Occurrence {
        before_count: usize,
        before_at: usize,
        after_count: usize,
        after_at: usize,
    }
    let mut occurrences = vec![Occurrence::default(); vocabulary];
    for (position, &id) in before.iter().enumerate() {
        occurrences[id].before_count += 1;
        occurrences[id].before_at = position;
    }
    for (position, &id) in after.iter().enumerate() {
        occurrences[id].after_count += 1;
        occurrences[id].after_at = position;
    }
    let unique_pairs: Vec<(usize, usize)> = before
        .iter()
        .filter_map(|&id| {
            let occurrence = occurrences[id];
            (occurrence.before_count == 1 && occurrence.after_count == 1)
                .then_some((occurrence.before_at, occurrence.after_at))
        })
        .collect();
    longest_increasing_chain(&unique_pairs)
}

/// `pairs`(첫 값 오름차순) 중 둘째 값도 오름차순인 가장 긴 부분열(patience sorting, O(n log n))
fn longest_increasing_chain(pairs: &[(usize, usize)]) -> Vec<(usize, usize)> {
    // tails[k]: 길이 k + 1인 사슬 중 끝값이 가장 작은 사슬의 끝(pairs 색인)
    let mut tails: Vec<usize> = Vec::new();
    let mut previous: Vec<Option<usize>> = Vec::with_capacity(pairs.len());
    for (index, &(_, after)) in pairs.iter().enumerate() {
        let length = tails.partition_point(|&tail| pairs[tail].1 < after);
        previous.push(length.checked_sub(1).map(|shorter| tails[shorter]));
        if length == tails.len() {
            tails.push(index);
        } else {
            tails[length] = index;
        }
    }
    let mut chain = Vec::with_capacity(tails.len());
    let mut cursor = tails.last().copied();
    while let Some(index) = cursor {
        chain.push(pairs[index]);
        cursor = previous[index];
    }
    chain.reverse();
    chain
}

/// 공통 토큰 사이에서 바뀐 토큰 범위. 한쪽 범위는 빌 수 있지만 둘 다 비지는 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Hunk {
    before: Range<usize>,
    after: Range<usize>,
    /// 시간 제한을 넘어 정밀 diff 없이 통째로 낸 구간
    truncated: bool,
}

#[derive(Default)]
struct Hunks(Vec<Hunk>);

impl Hunks {
    /// 바뀐 범위를 더한다. 바로 앞 범위와 양쪽 모두 이어지면(사이에 공통 토큰이 없으면) 합친다.
    fn push(&mut self, before: Range<usize>, after: Range<usize>, truncated: bool) {
        if before.is_empty() && after.is_empty() {
            return;
        }
        match self.0.last_mut() {
            Some(last) if last.before.end == before.start && last.after.end == after.start => {
                last.before.end = before.end;
                last.after.end = after.end;
                last.truncated |= truncated;
            }
            _ => self.0.push(Hunk {
                before,
                after,
                truncated,
            }),
        }
    }
}

fn diff_between_anchors(
    before: &[usize],
    after: &[usize],
    anchors: &[(usize, usize)],
    deadline: Option<Instant>,
) -> Vec<Hunk> {
    let mut hunks = Hunks::default();
    let (mut before_start, mut after_start) = (0, 0);
    let document_end = (before.len(), after.len());
    for &(before_anchor, after_anchor) in anchors.iter().chain([&document_end]) {
        diff_gap(
            before,
            before_start..before_anchor,
            after,
            after_start..after_anchor,
            deadline,
            &mut hunks,
        );
        (before_start, after_start) = (before_anchor + 1, after_anchor + 1);
    }
    hunks.0
}

/// 앵커 사이 한 구간. 앞뒤 공통 토큰을 먼저 떼고(시간 제한과 상관없이 정확하다), 양쪽에 토큰이
/// 남으면 Myers로 비교한다. 시작 전이나 끝난 뒤 시간 제한이 지났으면 구간을 통째로 낸다
/// (`similar`는 제한을 넘으면 근사 결과를 내므로 끝난 뒤에도 본다).
fn diff_gap(
    before: &[usize],
    mut before_range: Range<usize>,
    after: &[usize],
    mut after_range: Range<usize>,
    deadline: Option<Instant>,
    hunks: &mut Hunks,
) {
    while !before_range.is_empty()
        && !after_range.is_empty()
        && before[before_range.start] == after[after_range.start]
    {
        before_range.start += 1;
        after_range.start += 1;
    }
    while !before_range.is_empty()
        && !after_range.is_empty()
        && before[before_range.end - 1] == after[after_range.end - 1]
    {
        before_range.end -= 1;
        after_range.end -= 1;
    }
    if before_range.is_empty() || after_range.is_empty() {
        hunks.push(before_range, after_range, false);
        return;
    }
    if is_past(deadline) {
        hunks.push(before_range, after_range, true);
        return;
    }
    let ops = capture_diff_deadline(
        Algorithm::Myers,
        before,
        before_range.clone(),
        after,
        after_range.clone(),
        deadline,
    );
    if is_past(deadline) {
        hunks.push(before_range, after_range, true);
        return;
    }
    for op in ops {
        let (tag, before_op, after_op) = op.as_tag_tuple();
        if tag != DiffTag::Equal {
            hunks.push(before_op, after_op, false);
        }
    }
}

fn is_past(deadline: Option<Instant>) -> bool {
    deadline.is_some_and(|deadline| Instant::now() >= deadline)
}

/// 어느 구간에도 들지 않은 토큰(공통 토큰)의 `(A 위치, B 위치)` 짝. 구간 사이 공통 토큰은 양쪽
/// 개수가 같고 차례로 짝이 된다. 두 위치 모두 오름차순이다.
fn equal_pairs(before_len: usize, after_len: usize, hunks: &[Hunk]) -> Vec<(usize, usize)> {
    let mut pairs = Vec::with_capacity(before_len.min(after_len));
    let (mut before_start, mut after_start) = (0, 0);
    for hunk in hunks {
        pairs.extend((before_start..hunk.before.start).zip(after_start..hunk.after.start));
        (before_start, after_start) = (hunk.before.end, hunk.after.end);
    }
    pairs.extend((before_start..before_len).zip(after_start..after_len));
    pairs
}

/// A 위치 `start` 바로 앞 공통 토큰 [`CHANGE_ID_CONTEXT_TOKENS`]개(`equal_positions` 색인 범위)
fn context_before(equal_positions: &[usize], start: usize) -> Range<usize> {
    let end = equal_positions.partition_point(|&position| position < start);
    end.saturating_sub(CHANGE_ID_CONTEXT_TOKENS)..end
}

/// A 위치 `end`부터 공통 토큰 [`CHANGE_ID_CONTEXT_TOKENS`]개(`equal_positions` 색인 범위)
fn context_after(equal_positions: &[usize], end: usize) -> Range<usize> {
    let start = equal_positions.partition_point(|&position| position < end);
    start..(start + CHANGE_ID_CONTEXT_TOKENS).min(equal_positions.len())
}

/// 변경 종류. 띄어쓰기만 다른 묶음([`is_spacing_only`])은 변경이 아니다(`None`).
fn change_kind(before: &[Token], after: &[Token]) -> Option<ChangeKind> {
    match (before.is_empty(), after.is_empty()) {
        (true, true) => None,
        (true, false) => Some(ChangeKind::Insert),
        (false, true) => Some(ChangeKind::Delete),
        (false, false) if is_spacing_only(before, after) => None,
        (false, false) => Some(ChangeKind::Replace),
    }
}

/// 양쪽 키를 공백 없이 이은 글자열이 같고, 한쪽에만 있는 토큰 경계가 하나도 숫자와 숫자
/// 사이에 있지 않다. 줄 배치로 갈린 단어(`계약기` + `간은`, `제3조` + `의`)는 띄어쓰기 차이로
/// 보지만, 숫자 사이 경계가 옮겨지면(`1 000` ↔ `10 00`, `제 1 2 조` ↔ `제 12 조`) 읽히는 숫자가
/// 달라지므로 변경이다.
fn is_spacing_only(before: &[Token], after: &[Token]) -> bool {
    let chars: Vec<char> = joined_key_chars(before).collect();
    if !chars.iter().copied().eq(joined_key_chars(after)) {
        return false;
    }
    let (before_bounds, after_bounds) = (boundary_offsets(before), boundary_offsets(after));
    let one_sided = |own: &[usize], other: &[usize]| -> Vec<usize> {
        own.iter()
            .copied()
            .filter(|offset| other.binary_search(offset).is_err())
            .collect()
    };
    !one_sided(&before_bounds, &after_bounds)
        .into_iter()
        .chain(one_sided(&after_bounds, &before_bounds))
        .any(|offset| splits_number(&chars, offset))
}

/// 토큰 사이 경계의 위치(이은 글자열에서 경계 앞 글자 수). 오름차순이고 처음·끝은 없다.
fn boundary_offsets(tokens: &[Token]) -> Vec<usize> {
    tokens
        .iter()
        .scan(0, |offset, token| {
            *offset += token.key.chars().count();
            Some(*offset)
        })
        .take(tokens.len().saturating_sub(1))
        .collect()
}

/// `offset` 경계 앞뒤 글자가 둘 다 숫자다(`char::is_numeric`: 전각 숫자 포함, 한글 수사 제외).
fn splits_number(chars: &[char], offset: usize) -> bool {
    let previous = offset.checked_sub(1).and_then(|index| chars.get(index));
    matches!(
        (previous, chars.get(offset)),
        (Some(previous), Some(next)) if previous.is_numeric() && next.is_numeric()
    )
}

/// 토큰 키를 공백 없이 이은 글자열
fn joined_key_chars(tokens: &[Token]) -> impl Iterator<Item = char> + '_ {
    tokens.iter().flat_map(|token| token.key.chars())
}

/// 걸린 토큰 전체 글자를 덮는 쪽. 토큰이 없으면 `None`이다.
fn whole_side(tokens: &[Token]) -> Option<ChangeSide> {
    let boxes: Vec<TextBox> = key_boxes(tokens).collect();
    let marked = vec![true; boxes.len()];
    side(tokens, &boxes, &marked)
}

/// 키 글자 단위 2차 diff로 다른 글자만 덮는 두 쪽. 한쪽에 다른 글자가 없으면 그 쪽은 전체를
/// 덮는다(ADR 0001 §4). 시작 전이나 끝난 뒤 시간 제한이 지났으면(근사 결과) `None`이다.
fn replace_sides(
    before: &[Token],
    after: &[Token],
    deadline: Option<Instant>,
) -> Option<(Option<ChangeSide>, Option<ChangeSide>)> {
    if is_past(deadline) {
        return None;
    }
    let before_chars: Vec<char> = joined_key_chars(before).collect();
    let after_chars: Vec<char> = joined_key_chars(after).collect();
    let ops = capture_diff_slices_deadline(Algorithm::Myers, &before_chars, &after_chars, deadline);
    if is_past(deadline) {
        return None;
    }
    let mut before_marked = vec![false; before_chars.len()];
    let mut after_marked = vec![false; after_chars.len()];
    for op in ops {
        let (tag, before_range, after_range) = op.as_tag_tuple();
        if tag != DiffTag::Equal {
            before_marked[before_range].fill(true);
            after_marked[after_range].fill(true);
        }
    }
    for marked in [&mut before_marked, &mut after_marked] {
        if !marked.contains(&true) {
            marked.fill(true);
        }
    }
    let before_boxes: Vec<TextBox> = key_boxes(before).collect();
    let after_boxes: Vec<TextBox> = key_boxes(after).collect();
    Some((
        side(before, &before_boxes, &before_marked),
        side(after, &after_boxes, &after_marked),
    ))
}

/// 키 글자 상자(텍스트 순서). `key`를 이은 글자열과 색인이 같다.
fn key_boxes(tokens: &[Token]) -> impl Iterator<Item = TextBox> + '_ {
    tokens
        .iter()
        .flat_map(|token| token.key_boxes.iter().copied())
}

fn side(tokens: &[Token], boxes: &[TextBox], marked: &[bool]) -> Option<ChangeSide> {
    if tokens.is_empty() {
        return None;
    }
    let text = tokens
        .iter()
        .map(|token| token.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    Some(ChangeSide {
        text,
        boxes: highlight_boxes(boxes, marked),
        min_confidence: None,
    })
}

/// 표시한 키 글자의 상자를 텍스트 순서로 합친다.
///
/// - 한 원본 글자에서 나온 키 글자(`㈜` → `(주)`)는 같은 상자를 가지므로 먼저 하나로 묶는다.
///   하나라도 표시됐으면 묶음 전체가 표시된 것이다. 그래서 같은 상자가 두 번 나오지 않는다.
/// - 글자열에서 이어서 표시된 글자가 같은 줄([`continues_line`])이면 상자 하나로 합친다.
fn highlight_boxes(boxes: &[TextBox], marked: &[bool]) -> Vec<TextBox> {
    let mut glyphs: Vec<(TextBox, bool)> = Vec::with_capacity(boxes.len());
    for (&bounds, &is_marked) in boxes.iter().zip(marked) {
        match glyphs.last_mut() {
            Some((last, last_marked)) if *last == bounds => *last_marked |= is_marked,
            _ => glyphs.push((bounds, is_marked)),
        }
    }
    let mut merged: Vec<TextBox> = Vec::new();
    let mut previous_marked = false;
    for (bounds, is_marked) in glyphs {
        if is_marked {
            match merged.last_mut() {
                Some(current) if previous_marked && continues_line(current, &bounds) => {
                    *current = union(*current, bounds);
                }
                _ => merged.push(bounds),
            }
        }
        previous_marked = is_marked;
    }
    merged
}

/// `next`가 `current`(같은 줄에서 합쳐 온 상자)에 이어지는 같은 줄 글자인가. 같은 쪽이고, 세로로
/// 충분히 겹치고, 오른쪽으로 너무 멀지 않아야 한다. 사용자 공간에서 세로로 흐르는 글자(돌려
/// 그린 글자)는 세로로 겹치지 않으므로 글자마다 상자가 따로 남는다.
fn continues_line(current: &TextBox, next: &TextBox) -> bool {
    let overlap = (current.y + current.h).min(next.y + next.h) - current.y.max(next.y);
    let gap = next.x - (current.x + current.w);
    current.page == next.page
        && overlap >= SAME_LINE_MIN_OVERLAP * current.h.min(next.h)
        && next.x >= current.x
        && gap <= SAME_LINE_MAX_GAP * current.h.max(next.h)
}

fn first_page(side: &Option<ChangeSide>) -> Option<u32> {
    side.as_ref()
        .and_then(|side| side.boxes.first())
        .map(|bounds| bounds.page)
}

/// 토큰 글자 상자가 걸친 쪽(하이픈으로 이은 토큰은 두 쪽에 걸칠 수 있다)
fn token_pages(tokens: &[Token]) -> impl Iterator<Item = u32> + '_ {
    key_boxes(tokens).map(|bounds| bounds.page)
}

/// ADR 0001 §4의 안정 키(중복 꼬리표 `-2`… 전). 다섯 필드를 `u32` LE 바이트 길이 + UTF-8로
/// 이어 SHA-256을 구하고 앞 [`CHANGE_ID_HASH_BYTES`]바이트를 소문자 16진수로 쓴다.
fn change_id(
    kind: ChangeKind,
    before: &[Token],
    after: &[Token],
    context_before: &[&str],
    context_after: &[&str],
) -> String {
    let kind_name = match kind {
        ChangeKind::Insert => "insert",
        ChangeKind::Delete => "delete",
        ChangeKind::Replace => "replace",
    };
    let join_keys = |tokens: &[Token]| {
        tokens
            .iter()
            .map(|token| token.key.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    };
    let fields = [
        kind_name.to_owned(),
        join_keys(before),
        join_keys(after),
        context_before.join(" "),
        context_after.join(" "),
    ];
    let mut hasher = Sha256::new();
    hasher.update(CHANGE_ID_PREFIX);
    for field in &fields {
        // 필드는 문서 글자라 4 GiB를 넘지 않는다. 넘는 입력은 메모리에 올릴 수 없다.
        let length = u32::try_from(field.len()).unwrap_or(u32::MAX);
        hasher.update(length.to_le_bytes());
        hasher.update(field.as_bytes());
    }
    hasher.finalize()[..CHANGE_ID_HASH_BYTES]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const GLYPH_WIDTH: f32 = 10.0;
    const GLYPH_HEIGHT: f32 = 12.0;
    const SPACE_WIDTH: f32 = 4.0;

    fn glyph(page: u32, x: f32) -> TextBox {
        TextBox {
            page,
            x,
            y: 0.0,
            w: GLYPH_WIDTH,
            h: GLYPH_HEIGHT,
        }
    }

    /// `page` 쪽 한 줄에 왼쪽부터 놓은 단어(키 = 원문). 글자는 `GLYPH_WIDTH`, 단어 사이는
    /// `SPACE_WIDTH` 간격이다.
    fn line(page: u32, words: &[&str]) -> Vec<Token> {
        let mut x = 0.0;
        words
            .iter()
            .map(|word| {
                let key_boxes = word
                    .chars()
                    .map(|_| {
                        let bounds = glyph(page, x);
                        x += GLYPH_WIDTH;
                        bounds
                    })
                    .collect();
                x += SPACE_WIDTH;
                Token {
                    key: (*word).to_owned(),
                    text: (*word).to_owned(),
                    key_boxes,
                }
            })
            .collect()
    }

    /// 기대값은 ADR 0001 §4 규칙을 Python `hashlib`으로 따로 계산했다. 둘째 변경의 앞 문맥은
    /// 사이에 낀 첫째 변경(`갑은`)을 건너뛴 공통 토큰 셋이다.
    #[test]
    fn change_id_follows_adr_hash_rule() {
        let before = line(
            0,
            &[
                "제3조",
                "갑은",
                "을에게",
                "금",
                "1,000,000원을",
                "지급한다.",
            ],
        );
        let after = line(
            0,
            &[
                "제3조",
                "갑이",
                "을에게",
                "금",
                "1,500,000원을",
                "지급한다.",
            ],
        );

        let diff = diff_tokens(&before, &after, DIFF_TIME_LIMIT);

        let ids: Vec<&str> = diff
            .changes
            .iter()
            .map(|change| change.id.as_str())
            .collect();
        assert_eq!(ids, ["5fa49bb83cbf464e", "551158c9244c8f97"]);
    }

    /// 같은 조항이 반복돼 종류·토큰·문맥이 모두 같으면 둘째부터 `-2`를 붙인다.
    #[test]
    fn repeated_change_gets_numbered_id() {
        let clause = |changed| {
            [
                ["가", "나", "다"].as_slice(),
                &[changed],
                &["라", "마", "바"],
            ]
            .concat()
        };
        let before = line(0, &[clause("X"), clause("X")].concat());
        let after = line(0, &[clause("Y"), clause("Y")].concat());

        let diff = diff_tokens(&before, &after, DIFF_TIME_LIMIT);

        let [first, second] = diff.changes.as_slice() else {
            panic!("expected two changes, got {:#?}", diff.changes);
        };
        assert_eq!(first.id.len(), 2 * CHANGE_ID_HASH_BYTES);
        assert_eq!(second.id, format!("{}-2", first.id));
    }

    /// 시간 제한이 이미 지났으면 양쪽에 토큰이 남은 구간은 글자 diff 없이 통째 `Replace`(상자는
    /// 토큰 전체)이고 `Truncated`가 그 구간의 쪽을 알린다. 구간 앞뒤의 공통 토큰(`금`)은 그래도
    /// 떼고, 한쪽에만 토큰이 있는 구간(`새`)은 정밀 결과와 같으므로 안내에 넣지 않는다.
    #[test]
    fn expired_time_limit_replaces_whole_gap_and_reports_pages() {
        let before = [
            line(0, &["제1조", "금"]),
            line(2, &["100원을", "금", "준다.", "끝."]),
        ]
        .concat();
        let after = [
            line(0, &["제1조", "금"]),
            line(3, &["200원을", "금", "준다.", "새", "끝."]),
        ]
        .concat();

        let diff = diff_tokens(&before, &after, Duration::ZERO);

        let whole_token = |page| TextBox {
            w: 5.0 * GLYPH_WIDTH,
            ..glyph(page, 0.0)
        };
        let summary: Vec<_> = diff
            .changes
            .iter()
            .map(|change| {
                let side = |side: &Option<ChangeSide>| {
                    side.as_ref()
                        .map(|side| (side.text.clone(), side.boxes.clone()))
                };
                (change.kind, side(&change.before), side(&change.after))
            })
            .collect();
        // `200원을`·`금`·`준다.`(아홉 글자)와 공백 셋 뒤
        let new_word_x = 9.0 * GLYPH_WIDTH + 3.0 * SPACE_WIDTH;
        assert_eq!(
            summary,
            [
                (
                    ChangeKind::Replace,
                    Some(("100원을".to_owned(), vec![whole_token(2)])),
                    Some(("200원을".to_owned(), vec![whole_token(3)])),
                ),
                (
                    ChangeKind::Insert,
                    None,
                    Some(("새".to_owned(), vec![glyph(3, new_word_x)])),
                ),
            ]
        );
        assert_eq!(
            diff.truncated,
            Some(Notice::Truncated {
                before_pages: vec![2],
                after_pages: vec![3],
            })
        );
    }

    /// NFKC로 늘어난 키 글자(`㈜` → `(주)`)는 원본 상자를 함께 쓴다. 그중 `(`와 `)`만 달라도
    /// 상자는 하나다. 다른 쪽의 떨어진 두 글자(`[`, `]`)는 상자 둘이다.
    #[test]
    fn expanded_key_chars_share_one_highlight_box() {
        let circled = TextBox {
            w: 12.0,
            ..glyph(0, 0.0)
        };
        let before = [Token {
            key: "(주)한빛".to_owned(),
            text: "㈜한빛".to_owned(),
            key_boxes: vec![circled, circled, circled, glyph(0, 12.0), glyph(0, 22.0)],
        }];
        let after = line(0, &["[주]한빛"]);

        let diff = diff_tokens(&before, &after, DIFF_TIME_LIMIT);

        let [change] = diff.changes.as_slice() else {
            panic!("expected one change, got {:#?}", diff.changes);
        };
        let boxes = |side: &Option<ChangeSide>| side.as_ref().map(|side| side.boxes.clone());
        assert_eq!(boxes(&change.before), Some(vec![circled]));
        assert_eq!(
            boxes(&change.after),
            Some(vec![glyph(0, 0.0), glyph(0, 2.0 * GLYPH_WIDTH)])
        );
    }

    /// (A 단어, B 단어, 기대 변경마다 (종류, A 원문, B 원문))
    type Case<'a> = (
        &'a [&'a str],
        &'a [&'a str],
        &'a [(ChangeKind, &'a str, &'a str)],
    );

    fn assert_cases(cases: &[Case]) {
        for &(before, after, expected) in cases {
            let expected: Vec<_> = expected
                .iter()
                .map(|&(kind, before, after)| (kind, before.to_owned(), after.to_owned()))
                .collect();
            assert_eq!(
                change_texts(before, after),
                expected,
                "{before:?} -> {after:?}"
            );
        }
    }

    /// 변경마다 (종류, A 원문, B 원문)
    fn change_texts(before: &[&str], after: &[&str]) -> Vec<(ChangeKind, String, String)> {
        let text = |side: &Option<ChangeSide>| {
            side.as_ref()
                .map(|side| side.text.clone())
                .unwrap_or_default()
        };
        diff_tokens(&line(0, before), &line(0, after), DIFF_TIME_LIMIT)
            .changes
            .iter()
            .map(|change| (change.kind, text(&change.before), text(&change.after)))
            .collect()
    }

    /// 이은 글자열이 같아도 한쪽에만 있는 경계가 숫자 사이에 있으면 읽히는 숫자가 달라지므로
    /// `Replace`다. 숫자가 든 토큰이라도 경계가 숫자 사이가 아니면(`제3조` + `의`) 줄 배치 차이다.
    #[test]
    fn spacing_only_difference_is_ignored_unless_it_splits_digits() {
        let cases: [Case; 4] = [
            (
                &["금", "1", "000원"],
                &["금", "10", "00원"],
                &[(ChangeKind::Replace, "1 000원", "10 00원")],
            ),
            (
                &["제", "1", "2", "조"],
                &["제", "12", "조"],
                &[(ChangeKind::Replace, "1 2", "12")],
            ),
            (&["계약기", "간은", "1년"], &["계약기간은", "1년"], &[]),
            (&["제3조의", "규정"], &["제3조", "의", "규정"], &[]),
        ];
        assert_cases(&cases);
    }

    /// 앵커는 양쪽에 한 번씩만 나오는 키 중 두 위치가 함께 늘어나는 가장 긴 사슬이다. 유일 키가
    /// 없으면 문서 전체가 한 구간이고, 한쪽에만 있는 키는 앵커가 아니며, 엇갈린 유일 키는 가장 긴
    /// 사슬(`갑 을 병 무`)만 남기고 나머지(`정`)를 옮긴 것으로 낸다.
    #[test]
    fn anchors_are_the_longest_chain_of_keys_unique_on_both_sides() {
        let cases: [Case; 4] = [
            (
                &["가", "나", "가", "나"],
                &["가", "나", "가"],
                &[(ChangeKind::Delete, "나", "")],
            ),
            // A에만 있는 `갑`을 앵커로 잡으면 B 첫 토큰 `을`과 같다고 보아 치환이 사라진다.
            (
                &["갑", "나", "다"],
                &["을", "나", "다"],
                &[(ChangeKind::Replace, "갑", "을")],
            ),
            // 앞에서부터 고르면 `갑 정 무`가 되어 `을 병`을 옮긴 것으로 낸다.
            (
                &["갑", "정", "을", "병", "무"],
                &["갑", "을", "병", "정", "무"],
                &[
                    (ChangeKind::Delete, "정", ""),
                    (ChangeKind::Insert, "", "정"),
                ],
            ),
            // 사슬을 끝값 목록에서 바로 읽으면 (병, 갑)·(을, 병) 순서가 되어 위치가 거꾸로 간다.
            (
                &["갑", "을", "병"],
                &["병", "갑", "을"],
                &[
                    (ChangeKind::Insert, "", "병"),
                    (ChangeKind::Delete, "병", ""),
                ],
            ),
        ];
        assert_cases(&cases);
    }
}
