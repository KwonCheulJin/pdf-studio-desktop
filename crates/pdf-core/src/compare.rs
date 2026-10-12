//! 두 PDF의 글자를 비교한다. 결과 모델과 좌표 규칙의 정본은
//! `docs/adr/0001-compare-result-model.md`다.

mod model;

pub use model::{
    Change, ChangeKind, ChangeSide, CompareResult, NoTextReason, Notice, PagePair, PageSize,
    PageSizes, PageSources, Side, TextBox, TextSource,
};
