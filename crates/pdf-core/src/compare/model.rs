//! 비교 결과 모델. 필드의 의미·불변식·좌표 규칙은 ADR 0001이 정본이고, 여기에는 요점만 적는다.
//!
//! - 쪽 번호는 문서 전체에서 0부터 센다. 화면에 보일 때만 1을 더한다.
//! - 좌표는 PDF 사용자 공간(pt, 원점은 왼쪽 아래, `/Rotate` 적용 전)이고 CropBox 원점이
//!   이미 들어 있다. 화면은 pdf.js `viewport.convertToViewportRectangle`로만 바꾼다.
//! - `Serialize`는 golden JSON을 쓰는 타입에만 붙인다. 모양은 ADR 0001 §7의 계약 JSON과 같다.

use serde::Serialize;

use crate::info::{PageBox, PageRotation};

/// 비교하는 두 문서 중 한쪽. `Before`가 A(왼쪽), `After`가 B(오른쪽)다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Before,
    After,
}

/// 변경 글자를 덮는 상자. 같은 줄에서 이어진 글자는 상자 하나로 합친다.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBox {
    /// 상자가 있는 쪽(0부터). 어느 문서인지는 상자를 담은 [`Placement`]가 정한다.
    pub page: u32,
    /// 왼쪽 아래 모서리
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    /// `before`가 [`Placement::Anchor`], `after`가 [`Placement::Boxes`]
    Insert,
    /// `before`가 [`Placement::Boxes`], `after`가 [`Placement::Anchor`]
    Delete,
    /// 둘 다 [`Placement::Boxes`]
    Replace,
}

/// 한 쪽의 글자를 어디서 얻었나
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextSource {
    TextLayer,
    Ocr,
}

/// 변경의 한쪽(A 또는 B)이 그 문서에 놓이는 곳(ADR 0001 §4)
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Placement {
    /// 그 쪽에 변경 글자가 있다.
    Boxes {
        /// 변경에 걸린 토큰을 공백 하나로 이은 원문 글자(NFC만 적용, 대소문자 그대로)
        text: String,
        /// 텍스트 순서. 비어 있지 않다.
        boxes: Vec<TextBox>,
        /// 걸린 토큰 중 OCR 토큰의 가장 낮은 신뢰도(0~1). OCR 토큰이 없으면 `None`
        min_confidence: Option<f32>,
    },
    /// 그 쪽에 글자가 없다(삽입의 A 쪽, 삭제의 B 쪽). 반대쪽 글자가 이 문서에서 들어갈 자리이고,
    /// (`x`, `y`)부터 (`x`, `y + h`)까지 사용자 공간 세로 막대다(너비 0인 [`TextBox`]와 같은 뜻).
    Anchor {
        /// 0부터 센 쪽 번호
        page: u32,
        x: f32,
        /// 막대 아래 끝(줄 상자 아래 모서리. 기준선의 근사)
        y: f32,
        /// 막대 높이(이웃 줄 상자 높이, 0 이상)
        h: f32,
    },
}

impl Placement {
    /// 변경 글자 상자. 앵커는 상자가 없다.
    pub fn boxes(&self) -> &[TextBox] {
        match self {
            Self::Boxes { boxes, .. } => boxes,
            Self::Anchor { .. } => &[],
        }
    }

    /// 변경 글자. 앵커는 글자가 없다.
    pub fn text(&self) -> Option<&str> {
        match self {
            Self::Boxes { text, .. } => Some(text),
            Self::Anchor { .. } => None,
        }
    }
}

/// `(A 쪽, B 쪽)`. 0부터 센 쪽 번호이고, 그 문서에 해당하는 쪽이 없으면 `None`이다.
pub type PagePair = (Option<u32>, Option<u32>);

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    /// 같은 입력·옵션이면 다시 실행해도 같은 키(ADR 0001의 계산 규칙)
    pub id: String,
    pub kind: ChangeKind,
    pub before: Placement,
    pub after: Placement,
    /// 각 쪽 첫 상자의 쪽 번호. 그 쪽이 앵커면 `None`(앵커의 쪽은 [`Placement::Anchor`]의 `page`)
    pub page_pair: PagePair,
    /// OCR 신뢰도 기준 미만 토큰이나 OCR 띄어쓰기만 다른 치환이 걸린 변경("확인 필요").
    /// 차이 개수와 따로 센다.
    pub needs_review: bool,
}

/// 한 쪽의 보이는 영역과 회전
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSize {
    /// CropBox ∩ MediaBox(교집합이 비면 MediaBox). pdf.js `page.view`와 같은 정의이고
    /// 회전 전 사용자 공간 좌표다. CropBox 원점은 `left`·`bottom`이다.
    pub view_box: PageBox,
    /// 정규화한 `/Rotate`
    pub rotation: PageRotation,
}

/// 문서의 모든 쪽. 쪽 번호가 곧 색인이다.
#[derive(Debug, Clone, PartialEq)]
pub struct PageSizes {
    pub before: Vec<PageSize>,
    pub after: Vec<PageSize>,
}

/// 문서의 모든 쪽. 쪽 번호가 곧 색인이고, 비교 범위 밖이라 읽지 않은 쪽은 `None`이다.
#[derive(Debug, Clone, PartialEq)]
pub struct PageSources {
    pub before: Vec<Option<TextSource>>,
    pub after: Vec<Option<TextSource>>,
}

/// OCR로 글자를 얻지 못한 이유
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoTextReason {
    /// OCR 런타임이나 모델 파일이 없다.
    OcrUnavailable,
    /// 그 쪽의 렌더나 추론이 실패했다.
    OcrFailed,
}

/// 비교 결과와 함께 보이는 안내. `pages`는 0부터 센 오름차순이고 비어 있지 않다.
#[derive(Debug, Clone, PartialEq)]
pub enum Notice {
    /// 텍스트 레이어의 대체 문자(U+FFFD)·PUA 비율이 높은 쪽(ToUnicode가 깨진 PDF 등)
    LowTextConfidence { side: Side, pages: Vec<u32> },
    /// OCR 대상 쪽인데 OCR로 글자를 얻지 못한 쪽. 그 쪽은 텍스트 레이어 글자로 비교했다.
    NoTextLayer {
        side: Side,
        reason: NoTextReason,
        pages: Vec<u32>,
    },
    /// diff 시간 제한을 넘어 구간을 통째 치환으로 낸 곳이 걸친 쪽
    Truncated {
        before_pages: Vec<u32>,
        after_pages: Vec<u32>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompareResult {
    /// diff 순서(A·B 토큰열 위치가 함께 늘어나는 순서)
    pub changes: Vec<Change>,
    /// 화면 행 순서. 비교 범위의 각 쪽이 자기 쪽에서 정확히 한 번 나오고 `(None, None)`은 없다.
    pub page_pairs: Vec<PagePair>,
    pub page_sizes: PageSizes,
    pub page_sources: PageSources,
    /// 종류(정의 순서) → 쪽(`Before` 먼저) → 이유(정의 순서) 순서. 같은 조합은 하나뿐이다.
    pub notices: Vec<Notice>,
}
