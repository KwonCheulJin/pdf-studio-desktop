//! 페이지 짝짓기(계획서 §6.2 4번). 규칙의 정본은 ADR 0001 §3·§12다.
//!
//! - 쪽 쌍마다 공통 토큰(diff가 맞춘 토큰 짝) 수를 센 매칭 행렬을 만들고, 두 쪽 번호가 함께
//!   늘어나는 칸들 중 무게 합이 가장 큰 경로의 칸을 짝으로 삼는다. 합이 같은 경로가 여럿이면
//!   앞에서부터 비교해 쪽 번호가 작은 짝을 고른다.
//! - 경로의 두 짝 사이에 남은 쪽들은 서로 공통 토큰이 없다(있으면 경로에 들어갔다). 빈 쪽
//!   (토큰이 하나도 없는 쪽)끼리 먼저 차례로 짝짓고, 그 사이사이 남은 쪽은 양쪽 개수가 같으면
//!   차례로 짝짓는다. 개수가 다르면 짝짓지 않고 A만 있는 행을 먼저 둔다.

use std::cmp::Reverse;
use std::collections::BTreeMap;
use std::ops::Range;

use super::model::PagePair;
use super::tokenize::Token;

/// 쪽 번호 대신 비교 범위 쪽 목록 안 색인으로 쓴 행. 마지막에 쪽 번호로 바꾼다.
type IndexRow = (Option<usize>, Option<usize>);

/// 매칭 행렬에서 0이 아닌 칸: 두 쪽 색인과 그 두 쪽 사이 공통 토큰 수
#[derive(Debug, Clone, Copy)]
struct Cell {
    before: usize,
    after: usize,
    weight: usize,
}

/// 비교 범위의 쪽들을 짝지어 화면 행 순서(`CompareResult.page_pairs`)를 만든다.
///
/// - `before_pages`·`after_pages`: 비교 범위의 쪽 번호(0부터, 오름차순, 중복 없음). 토큰이 없는
///   쪽도 넣는다. 결과에서 각 쪽 번호는 자기 쪽 성분에 정확히 한 번 나온다.
/// - `before`·`after`: 그 쪽들을 토큰화한 토큰열. 토큰의 쪽은 첫 키 글자 상자의 쪽이다(하이픈으로
///   쪽을 넘겨 이은 토큰은 앞 쪽).
/// - `matches`: `diff_tokens`가 낸 공통 토큰 짝(`TokenDiff::matches`). 범위 밖 쪽의 토큰이나 없는
///   토큰을 가리키는 짝은 세지 않는다.
pub fn pair_pages(
    before_pages: &[u32],
    after_pages: &[u32],
    before: &[Token],
    after: &[Token],
    matches: &[(usize, usize)],
) -> Vec<PagePair> {
    let cells = match_cells(before_pages, after_pages, before, after, matches);
    let before_empty = empty_pages(before_pages, before);
    let after_empty = empty_pages(after_pages, after);

    let mut rows: Vec<IndexRow> = Vec::with_capacity(before_pages.len() + after_pages.len());
    let (mut before_next, mut after_next) = (0, 0);
    for cell in heaviest_path(&cells) {
        fill_unmatched(
            before_next..cell.before,
            after_next..cell.after,
            (&before_empty, &after_empty),
            &mut rows,
        );
        rows.push((Some(cell.before), Some(cell.after)));
        (before_next, after_next) = (cell.before + 1, cell.after + 1);
    }
    fill_unmatched(
        before_next..before_pages.len(),
        after_next..after_pages.len(),
        (&before_empty, &after_empty),
        &mut rows,
    );
    rows.into_iter()
        .map(|(before_index, after_index)| {
            (
                before_index.map(|index| before_pages[index]),
                after_index.map(|index| after_pages[index]),
            )
        })
        .collect()
}

/// 토큰의 쪽(첫 키 글자 상자의 쪽)이 `pages`의 몇째인가
fn page_index(pages: &[u32], token: &Token) -> Option<usize> {
    let page = token.key_boxes.first()?.page;
    pages.binary_search(&page).ok()
}

/// 공통 토큰 짝을 쪽 쌍마다 센 매칭 행렬의 0이 아닌 칸. (A 쪽, B 쪽) 오름차순이다.
fn match_cells(
    before_pages: &[u32],
    after_pages: &[u32],
    before: &[Token],
    after: &[Token],
    matches: &[(usize, usize)],
) -> Vec<Cell> {
    let mut weights: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    for &(before_token, after_token) in matches {
        let before_index = before
            .get(before_token)
            .and_then(|token| page_index(before_pages, token));
        let after_index = after
            .get(after_token)
            .and_then(|token| page_index(after_pages, token));
        if let (Some(before_index), Some(after_index)) = (before_index, after_index) {
            *weights.entry((before_index, after_index)).or_default() += 1;
        }
    }
    weights
        .into_iter()
        .map(|((before, after), weight)| Cell {
            before,
            after,
            weight,
        })
        .collect()
}

/// 쪽마다 토큰이 하나도 없는가(빈 쪽, 글자 없는 스캔 쪽)
fn empty_pages(pages: &[u32], tokens: &[Token]) -> Vec<bool> {
    let mut empty = vec![true; pages.len()];
    for index in tokens.iter().filter_map(|token| page_index(pages, token)) {
        empty[index] = false;
    }
    empty
}

/// 두 쪽 색인이 함께(엄격히) 늘어나는 칸들 중 무게 합이 가장 큰 경로. 합이 같은 경로가 여럿이면
/// 앞에서부터 비교해 (A 쪽, B 쪽)이 작은 칸을 가진 경로다.
///
/// 뒤 칸부터 "그 칸에서 시작하는 가장 무거운 경로"의 합과 다음 칸(합이 같으면 (A, B)가 작은 칸)을
/// 정해 두고, 합이 가장 큰 첫 칸(같으면 작은 칸)부터 따라간다. 그래서 동률이 앞에서부터 정해진다.
/// 칸 수 C에 대해 O(C²)다. diff 짝은 두 위치가 함께 늘어나므로 0이 아닌 칸이 계단 하나를 이뤄
/// C가 두 범위 쪽 수의 합보다 작다(ADR 0001 §12 측정).
fn heaviest_path(cells: &[Cell]) -> Vec<Cell> {
    let mut totals = vec![0; cells.len()];
    let mut next: Vec<Option<usize>> = vec![None; cells.len()];
    for index in (0..cells.len()).rev() {
        let cell = cells[index];
        // `cells`가 (A, B) 오름차순이라 색인이 작을수록 (A, B)가 작다.
        let best_next = (index + 1..cells.len())
            .filter(|&later| cells[later].before > cell.before && cells[later].after > cell.after)
            .min_by_key(|&later| (Reverse(totals[later]), later));
        totals[index] = cell.weight + best_next.map_or(0, |later| totals[later]);
        next[index] = best_next;
    }
    let mut cursor = (0..cells.len()).min_by_key(|&index| (Reverse(totals[index]), index));
    let mut path = Vec::new();
    while let Some(index) = cursor {
        path.push(cells[index]);
        cursor = next[index];
    }
    path
}

/// 경로의 두 짝 사이(문서 처음·끝 포함)에 남은 쪽들의 행. 빈 쪽끼리 먼저 앞에서부터 차례로
/// 짝짓고, 그 사이사이 남은 쪽은 [`pair_in_order`]를 따른다.
fn fill_unmatched(
    before: Range<usize>,
    after: Range<usize>,
    (before_empty, after_empty): (&[bool], &[bool]),
    rows: &mut Vec<IndexRow>,
) {
    let empty_before = before.clone().filter(|&index| before_empty[index]);
    let empty_after = after.clone().filter(|&index| after_empty[index]);
    let (mut before_next, mut after_next) = (before.start, after.start);
    for (before_index, after_index) in empty_before.zip(empty_after) {
        pair_in_order(before_next..before_index, after_next..after_index, rows);
        rows.push((Some(before_index), Some(after_index)));
        (before_next, after_next) = (before_index + 1, after_index + 1);
    }
    pair_in_order(before_next..before.end, after_next..after.end, rows);
}

/// 양쪽 쪽 수가 같으면 차례로 짝짓고, 다르면 짝짓지 않고 A만 있는 행을 먼저 둔다(ADR 0001 §3).
fn pair_in_order(before: Range<usize>, after: Range<usize>, rows: &mut Vec<IndexRow>) {
    if before.len() == after.len() {
        rows.extend(
            before
                .zip(after)
                .map(|(before, after)| (Some(before), Some(after))),
        );
    } else {
        rows.extend(before.map(|before| (Some(before), None)));
        rows.extend(after.map(|after| (None, Some(after))));
    }
}

#[cfg(test)]
mod tests {
    use std::iter::repeat_n;

    use super::*;
    use crate::compare::model::TextBox;

    /// 토큰마다 한 글자이고 그 글자가 `pages`의 쪽에 있는 토큰열(키는 짝짓기에 쓰이지 않는다)
    fn tokens(pages: &[u32]) -> Vec<Token> {
        pages
            .iter()
            .map(|&page| Token {
                key: "가".to_owned(),
                text: "가".to_owned(),
                key_boxes: vec![TextBox {
                    page,
                    x: 0.0,
                    y: 0.0,
                    w: 1.0,
                    h: 1.0,
                }],
            })
            .collect()
    }

    /// 칸 무게: A 0쪽↔B 0쪽, A 0쪽↔B 1쪽, A 1쪽↔B 1쪽, A 1쪽↔B 2쪽이 2·`shifted`·2·2.
    /// 무게 합이 가장 큰 경로를 고르고(옮겨 간 쪽이 무거우면 같은 위치가 아니어도 짝),
    /// 합이 같으면 앞에서부터 쪽 번호가 작은 짝을 고른다.
    fn pairs_for_shift(shifted: usize) -> Vec<PagePair> {
        let before_token_pages: Vec<u32> = repeat_n(0, 2 + shifted).chain(repeat_n(1, 4)).collect();
        let after_token_pages: Vec<u32> = repeat_n(0, 2)
            .chain(repeat_n(1, shifted + 2))
            .chain(repeat_n(2, 2))
            .collect();
        let (before, after) = (tokens(&before_token_pages), tokens(&after_token_pages));
        let matches: Vec<(usize, usize)> = (0..before.len()).map(|index| (index, index)).collect();
        pair_pages(&[0, 1], &[0, 1, 2], &before, &after, &matches)
    }

    #[test]
    fn heaviest_monotone_path_wins_and_ties_go_to_earlier_pages() {
        // (0,0)+(1,1) = (0,0)+(1,2) = (0,1)+(1,2) = 4: 앞쪽끼리
        assert_eq!(
            pairs_for_shift(2),
            [(Some(0), Some(0)), (Some(1), Some(1)), (None, Some(2))]
        );
        // (0,1)+(1,2) = 5가 가장 무겁다: A 0쪽 내용이 더 많이 옮겨 간 B 1쪽과 짝
        assert_eq!(
            pairs_for_shift(3),
            [(None, Some(0)), (Some(0), Some(1)), (Some(1), Some(2))]
        );
    }

    /// 경로가 짝짓지 않은 쪽: 빈 쪽끼리 먼저 차례로 짝짓고, 그 사이사이 남은 쪽은 양쪽 개수가
    /// 같으면 차례로 짝짓고, 다르면 A만 있는 행을 먼저 둔다.
    ///
    /// A: 0 공통, 1, 2 빈 쪽, 3, 4, 5 공통, 6, 7
    /// B: 0 공통, 1 빈 쪽, 2, 3, 4, 5, 6 공통, 7, 8
    #[test]
    fn unmatched_pages_pair_empty_pages_first_then_equal_counts() {
        let before = tokens(&[0, 1, 3, 4, 5, 6, 7]);
        let after = tokens(&[0, 2, 3, 4, 5, 6, 7, 8]);
        let matches = [(0, 0), (4, 5)];

        let pairs = pair_pages(
            &(0..8).collect::<Vec<_>>(),
            &(0..9).collect::<Vec<_>>(),
            &before,
            &after,
            &matches,
        );

        assert_eq!(
            pairs,
            [
                (Some(0), Some(0)),
                // 공통 짝 사이 A 1~4 · B 1~5: 빈 쪽 A 2 ↔ B 1을 먼저 짝짓는다.
                (Some(1), None),
                (Some(2), Some(1)),
                // 그 뒤 A 3·4 와 B 2~5는 개수가 달라 짝짓지 않고 A만 있는 행을 먼저 둔다.
                (Some(3), None),
                (Some(4), None),
                (None, Some(2)),
                (None, Some(3)),
                (None, Some(4)),
                (None, Some(5)),
                (Some(5), Some(6)),
                // 문서 끝까지 A 6·7 과 B 7·8은 개수가 같아 차례로 짝짓는다.
                (Some(6), Some(7)),
                (Some(7), Some(8)),
            ]
        );
    }
}
