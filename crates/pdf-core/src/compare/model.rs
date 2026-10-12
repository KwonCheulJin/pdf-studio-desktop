//! 비교 결과 모델. 필드의 의미·불변식·좌표 규칙은 ADR 0001이 정본이고, 여기에는 요점만 적는다.
//!
//! - 쪽 번호는 문서 전체에서 0부터 센다. 화면에 보일 때만 1을 더한다.
//! - 좌표는 PDF 사용자 공간(pt, 원점은 왼쪽 아래, `/Rotate` 적용 전)이고 CropBox 원점이
//!   이미 들어 있다. 화면은 pdf.js `viewport.convertToViewportRectangle`로만 바꾼다.

use crate::info::{PageBox, PageRotation};

/// 비교하는 두 문서 중 한쪽. `Before`가 A(왼쪽), `After`가 B(오른쪽)다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Before,
    After,
}

/// 변경 글자를 덮는 상자. 같은 줄에서 이어진 글자는 상자 하나로 합친다.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextBox {
    /// 상자가 있는 쪽(0부터). 어느 문서인지는 상자를 담은 [`ChangeSide`]가 정한다.
    pub page: u32,
    /// 왼쪽 아래 모서리
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    /// `before`가 `None`, `after`가 `Some`
    Insert,
    /// `before`가 `Some`, `after`가 `None`
    Delete,
    /// 둘 다 `Some`
    Replace,
}

/// 한 쪽의 글자를 어디서 얻었나
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextSource {
    TextLayer,
    Ocr,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChangeSide {
    /// 변경에 걸린 토큰을 공백 하나로 이은 원문 글자(NFC만 적용, 대소문자 그대로)
    pub text: String,
    /// 텍스트 순서. 비어 있지 않다.
    pub boxes: Vec<TextBox>,
    /// 걸린 토큰 중 OCR 토큰의 가장 낮은 신뢰도(0~1). OCR 토큰이 없으면 `None`
    pub min_confidence: Option<f32>,
}

/// `(A 쪽, B 쪽)`. 0부터 센 쪽 번호이고, 그 문서에 해당하는 쪽이 없으면 `None`이다.
pub type PagePair = (Option<u32>, Option<u32>);

#[derive(Debug, Clone, PartialEq)]
pub struct Change {
    /// 같은 입력·옵션이면 다시 실행해도 같은 키(ADR 0001의 계산 규칙)
    pub id: String,
    pub kind: ChangeKind,
    pub before: Option<ChangeSide>,
    pub after: Option<ChangeSide>,
    /// 각 쪽 첫 상자의 쪽 번호. 그 쪽이 없으면 `None`
    pub page_pair: PagePair,
    /// OCR 신뢰도 기준 미만 토큰이나 OCR 띄어쓰기만 다른 치환이 걸린 변경("확인 필요").
    /// 차이 개수와 따로 센다.
    pub needs_review: bool,
}

/// 한 쪽의 보이는 영역과 회전
#[derive(Debug, Clone, Copy, PartialEq)]
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
