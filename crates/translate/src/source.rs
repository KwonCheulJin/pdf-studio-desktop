//! 번역 입력(ADR 0002 §1·§2). pdf-core `ParagraphPage`와 같은 모양이지만 pdf-core를 모른다.
//! `src-tauri`가 `ParagraphPage` → [`SourcePage`]로 옮긴다(상자·글자 크기는 번역에 쓰지 않아 뺀다).

/// 범위 안 쪽 하나. 쪽 번호 오름차순으로 넘긴다(ADR 0002 §2 "범위").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourcePage {
    /// 문서 전체에서 0부터
    pub page: u32,
    pub content: SourcePageContent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourcePageContent {
    /// 글자층 쪽의 문단(읽는 순서, `number` 오름차순). 문단이 없으면 빈 목록이다.
    Text(Vec<SourceParagraph>),
    /// 스캔 쪽(`needs_ocr`). 보낼 그림의 크기만 안다. 그림 바이트는 보내기 직전에 렌더한다(ADR 0002 §2).
    Scan(ScanImage),
}

/// 글자층 문단(ADR 0002 §2 `Paragraph`의 번역에 쓰는 필드)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceParagraph {
    /// 쪽 안 순번, 1부터
    pub number: u32,
    /// NFC, 줄을 이은 원문
    pub text: String,
    pub heading: bool,
}

/// 스캔 쪽을 렌더할 PNG 크기(긴 변 `SCAN_IMAGE_MAX_EDGE_PX` 이하, `/Rotate` 적용 방향)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScanImage {
    pub width_px: u32,
    pub height_px: u32,
}
