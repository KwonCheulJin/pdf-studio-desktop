//! 프론트와 주고받는 계약 타입. tauri-specta가 이 타입으로 TS 바인딩을 만든다.
//!
//! - 필드 이름은 camelCase로 보낸다.
//! - 개수·번호는 `u32`로 보낸다. `usize`·`u64`는 JS 숫자로 정확히 표현되지 않아(BigInt)
//!   specta가 내보내지 않는다.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use specta_typescript::Number;

use crate::error::{AppError, ErrorCode, fail_code};

/// 페이지 회전(도). 0·90·180·270만 받는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(try_from = "u16", into = "u16")]
pub(crate) enum Rotation {
    Degrees0,
    Degrees90,
    Degrees180,
    Degrees270,
}

const DEGREES_0: u16 = 0;
const DEGREES_90: u16 = 90;
const DEGREES_180: u16 = 180;
const DEGREES_270: u16 = 270;

#[derive(Debug, thiserror::Error)]
#[error("rotation must be 0, 90, 180 or 270 degrees: {0}")]
pub(crate) struct InvalidRotation(u16);

impl TryFrom<u16> for Rotation {
    type Error = InvalidRotation;

    fn try_from(degrees: u16) -> Result<Self, Self::Error> {
        match degrees {
            DEGREES_0 => Ok(Self::Degrees0),
            DEGREES_90 => Ok(Self::Degrees90),
            DEGREES_180 => Ok(Self::Degrees180),
            DEGREES_270 => Ok(Self::Degrees270),
            other => Err(InvalidRotation(other)),
        }
    }
}

impl From<Rotation> for u16 {
    fn from(rotation: Rotation) -> Self {
        match rotation {
            Rotation::Degrees0 => DEGREES_0,
            Rotation::Degrees90 => DEGREES_90,
            Rotation::Degrees180 => DEGREES_180,
            Rotation::Degrees270 => DEGREES_270,
        }
    }
}

impl From<pdf_core::PageRotation> for Rotation {
    fn from(rotation: pdf_core::PageRotation) -> Self {
        match rotation {
            pdf_core::PageRotation::Degrees0 => Self::Degrees0,
            pdf_core::PageRotation::Degrees90 => Self::Degrees90,
            pdf_core::PageRotation::Degrees180 => Self::Degrees180,
            pdf_core::PageRotation::Degrees270 => Self::Degrees270,
        }
    }
}

impl From<Rotation> for pdf_core::PageRotation {
    fn from(rotation: Rotation) -> Self {
        match rotation {
            Rotation::Degrees0 => Self::Degrees0,
            Rotation::Degrees90 => Self::Degrees90,
            Rotation::Degrees180 => Self::Degrees180,
            Rotation::Degrees270 => Self::Degrees270,
        }
    }
}

/// 페이지 상자. PDF 사용자 공간 좌표(pt, 원점은 왼쪽 아래)이며 회전 전 값이다.
/// 좌표·크기는 pdfium이 돌려준 유한한 값이라 JSON `null`(NaN·무한대)이 되지 않는다.
/// 그래서 TS 타입을 `number | null`이 아닌 `number`로 내보낸다. 비교 결과의 쪽 크기로 다시 받기도 한다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct PageBox {
    #[specta(type = Number)]
    pub(crate) left: f32,
    #[specta(type = Number)]
    pub(crate) bottom: f32,
    #[specta(type = Number)]
    pub(crate) right: f32,
    #[specta(type = Number)]
    pub(crate) top: f32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageInfo {
    /// 화면에 보이는 너비(pt). CropBox와 `/Rotate`가 반영된 값이다.
    #[specta(type = Number)]
    pub(crate) width_pt: f32,
    #[specta(type = Number)]
    pub(crate) height_pt: f32,
    pub(crate) rotation: Rotation,
    pub(crate) media_box: PageBox,
    pub(crate) crop_box: PageBox,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfInfo {
    pub(crate) page_count: u32,
    /// 문서 제목. 없거나 빈 문자열이면 `null`
    pub(crate) title: Option<String>,
    pub(crate) pages: Vec<PageInfo>,
}

impl From<pdf_core::PageBox> for PageBox {
    fn from(page_box: pdf_core::PageBox) -> Self {
        Self {
            left: page_box.left,
            bottom: page_box.bottom,
            right: page_box.right,
            top: page_box.top,
        }
    }
}

impl From<pdf_core::PdfInfo> for PdfInfo {
    fn from(info: pdf_core::PdfInfo) -> Self {
        Self {
            page_count: count(info.page_count),
            title: info.title,
            pages: info
                .pages
                .into_iter()
                .map(|page| PageInfo {
                    width_pt: page.width_pt,
                    height_pt: page.height_pt,
                    rotation: page.rotation.into(),
                    media_box: page.media_box.into(),
                    crop_box: page.crop_box.into(),
                })
                .collect(),
        }
    }
}

/// `open_files`의 파일 하나 결과. 입력 순서 그대로 돌려준다.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum OpenedFile {
    #[serde(rename = "ok", rename_all = "camelCase")]
    Opened {
        /// 요청에 들어온 경로 그대로
        source_path: PathBuf,
        /// 표시·병합에 쓸 PDF. TIFF면 변환 결과(앱 캐시 폴더의 고유 이름)다.
        pdf_path: PathBuf,
        /// 화면에 보일 이름. TIFF면 원본 이름에서 확장자만 `.pdf`로 바꾼 것이다.
        display_name: String,
        /// 요청한 파일의 크기(바이트). TIFF면 변환 전 TIFF의 크기다.
        size_bytes: u32,
        info: PdfInfo,
    },
    #[serde(rename = "error", rename_all = "camelCase")]
    Failed {
        source_path: PathBuf,
        error: AppError,
    },
}

#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveDialogOptions {
    /// 다이얼로그가 처음 보일 폴더와 파일 이름
    pub(crate) default_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergeRequest {
    /// 프론트가 만든 작업 ID. `cancel_job`에 같은 값을 넘긴다.
    pub(crate) job_id: String,
    pub(crate) sources: Vec<MergeSource>,
    pub(crate) output: MergeOutput,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
pub(crate) struct MergeSource {
    pub(crate) path: PathBuf,
    /// 목록 순서가 출력 순서다. 같은 페이지를 여러 번 넣어도 된다.
    pub(crate) pages: Vec<MergePage>,
}

#[derive(Debug, Clone, Copy, Deserialize, specta::Type)]
pub(crate) struct MergePage {
    /// 소스 문서 안에서 0부터 센 페이지 번호
    pub(crate) index: u32,
    /// 출력 페이지의 최종 회전. 원본 `/Rotate`에 더하지 않는다.
    pub(crate) rotation: Rotation,
}

/// 병합 결과를 쓸 곳
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum MergeOutput {
    /// 미리보기용. 앱 임시 폴더에 고유 이름으로 쓴다.
    Temp,
    /// 저장 다이얼로그(`pick_save_path`)에서 고른 경로
    UserPath { path: PathBuf },
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergeResult {
    pub(crate) output_path: PathBuf,
    /// `output_path`의 파일 이름. 화면 표시와 저장 다이얼로그의 기본 이름에 쓴다
    /// (프론트가 경로 문자열을 나누지 않게 한다).
    pub(crate) file_name: String,
    pub(crate) page_count: u32,
}

#[derive(Debug, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MergeStage {
    ReadFiles,
    MergePages,
    Save,
}

/// 병합 진행률. 화면에 보이는 %(단계·전체)가 바뀔 때만 온다.
#[derive(Debug, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergeProgress {
    pub(crate) stage: MergeStage,
    pub(crate) done: u32,
    pub(crate) total: u32,
    pub(crate) stage_percent: u8,
    pub(crate) overall_percent: u8,
}

impl From<pdf_core::MergeProgress> for MergeProgress {
    fn from(progress: pdf_core::MergeProgress) -> Self {
        Self {
            stage: match progress.stage {
                pdf_core::MergeStage::ReadFiles => MergeStage::ReadFiles,
                pdf_core::MergeStage::MergePages => MergeStage::MergePages,
                pdf_core::MergeStage::Save => MergeStage::Save,
            },
            done: count(progress.done),
            total: count(progress.total),
            stage_percent: progress.stage_percent,
            overall_percent: progress.overall_percent,
        }
    }
}

// ── 비교(계획서 §6.2 6번). 결과 모양은 ADR 0001 §1·§7의 계약 JSON이고, pdf-core 모델의 미러다.
// pdf-core 타입에는 specta를 붙일 수 없어(고아 규칙) 같은 모양을 여기 두고 `From`으로 옮긴다.
// 결과는 리포트 내보내기 요청으로 다시 받으므로(ADR 0001 §17) 양쪽으로 옮긴다.

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompareRequest {
    /// 프론트가 만든 작업 ID. `cancel_job`에 같은 값을 넘긴다.
    pub(crate) job_id: String,
    /// A(이전, 왼쪽) 문서
    pub(crate) before: PathBuf,
    /// B(이후, 오른쪽) 문서
    pub(crate) after: PathBuf,
    pub(crate) options: CompareOptions,
}

/// 비교 옵션(ADR 0001 §13). 쪽 범위는 1부터 센 사용자 표기(`"1,3-5"`, 비우면 전체)다.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompareOptions {
    pub(crate) range_a: String,
    pub(crate) range_b: String,
    pub(crate) exclude_header: bool,
    pub(crate) exclude_footer: bool,
    pub(crate) exclude_page_numbers: bool,
    pub(crate) ignore_case: bool,
}

impl From<CompareOptions> for pdf_core::CompareOptions {
    fn from(options: CompareOptions) -> Self {
        Self {
            range_a: options.range_a,
            range_b: options.range_b,
            exclude_header: options.exclude_header,
            exclude_footer: options.exclude_footer,
            exclude_page_numbers: options.exclude_page_numbers,
            ignore_case: options.ignore_case,
        }
    }
}

/// 비교 단계. 이 순서대로 진행한다(ADR 0001 §15).
#[derive(Debug, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CompareStage {
    ExtractA,
    ExtractB,
    Ocr,
    Normalize,
    Diff,
    AlignPages,
}

/// `done`·`total`로 알 수 없는 덧붙임 정보
#[derive(Debug, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProgressDetail {
    /// 이 단계를 앞선 실행의 캐시로 바로 끝냈다.
    Cached,
}

/// 비교 진행률. 화면에 보이는 %(단계·전체)가 바뀔 때만 온다.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompareProgress {
    pub(crate) job_id: String,
    pub(crate) stage: CompareStage,
    pub(crate) done: u32,
    pub(crate) total: u32,
    pub(crate) stage_percent: u8,
    pub(crate) overall_percent: u8,
    pub(crate) detail: Option<ProgressDetail>,
}

impl From<pdf_core::CompareProgress> for CompareProgress {
    fn from(progress: pdf_core::CompareProgress) -> Self {
        Self {
            job_id: progress.job_id,
            stage: match progress.stage {
                pdf_core::CompareStage::ExtractA => CompareStage::ExtractA,
                pdf_core::CompareStage::ExtractB => CompareStage::ExtractB,
                pdf_core::CompareStage::Ocr => CompareStage::Ocr,
                pdf_core::CompareStage::Normalize => CompareStage::Normalize,
                pdf_core::CompareStage::Diff => CompareStage::Diff,
                pdf_core::CompareStage::AlignPages => CompareStage::AlignPages,
            },
            done: progress.done,
            total: progress.total,
            stage_percent: progress.stage_percent,
            overall_percent: progress.overall_percent,
            detail: progress.detail.map(|detail| match detail {
                pdf_core::ProgressDetail::Cached => ProgressDetail::Cached,
            }),
        }
    }
}

/// 비교하는 두 문서 중 한쪽. `before`가 A(왼쪽), `after`가 B(오른쪽)다.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Side {
    Before,
    After,
}

/// 변경 글자를 덮는 상자(PDF 사용자 공간, ADR 0001 §2). 좌표는 유한한 값이라 JSON `null`이 되지 않는다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct TextBox {
    /// 0부터 센 쪽 번호
    pub(crate) page: u32,
    #[specta(type = Number)]
    pub(crate) x: f32,
    #[specta(type = Number)]
    pub(crate) y: f32,
    #[specta(type = Number)]
    pub(crate) w: f32,
    #[specta(type = Number)]
    pub(crate) h: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ChangeKind {
    Insert,
    Delete,
    Replace,
}

/// 한 쪽의 글자를 어디서 얻었나
#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TextSource {
    TextLayer,
    Ocr,
}

/// 변경의 한쪽이 그 문서에 놓이는 곳(ADR 0001 §4). `kind`로 가른다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Placement {
    /// 그 쪽에 변경 글자가 있다.
    #[serde(rename_all = "camelCase")]
    Boxes {
        /// 변경에 걸린 토큰을 공백 하나로 이은 원문 글자
        text: String,
        /// 텍스트 순서. 비어 있지 않다.
        boxes: Vec<TextBox>,
        /// 걸린 OCR 토큰의 가장 낮은 신뢰도(0~1, NaN 없음). OCR 토큰이 없으면 `null`
        #[specta(type = Option<Number>)]
        min_confidence: Option<f32>,
    },
    /// 그 쪽에 글자가 없다(삽입의 A 쪽, 삭제의 B 쪽). 반대쪽 글자가 들어갈 자리로, (`x`, `y`)부터
    /// (`x`, `y + h`)까지 사용자 공간 세로 막대다. `page`가 `page_sizes`에 없으면(쪽이 0개인 PDF)
    /// 놓을 곳이 없다.
    Anchor {
        /// 0부터 센 쪽 번호
        page: u32,
        #[specta(type = Number)]
        x: f32,
        #[specta(type = Number)]
        y: f32,
        #[specta(type = Number)]
        h: f32,
    },
}

/// `[A 쪽, B 쪽]`(0부터). 그 문서에 해당하는 쪽이 없으면 `null`이다.
pub(crate) type PagePair = (Option<u32>, Option<u32>);

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Change {
    /// 같은 입력·옵션이면 다시 실행해도 같은 키(ADR 0001 §4)
    pub(crate) id: String,
    pub(crate) kind: ChangeKind,
    pub(crate) before: Placement,
    pub(crate) after: Placement,
    /// 각 쪽 첫 상자의 쪽. 앵커 쪽은 `null`이다(ADR 0001 §3).
    pub(crate) page_pair: PagePair,
    /// "확인 필요". 차이 개수와 따로 센다(ADR 0001 §5).
    pub(crate) needs_review: bool,
}

/// 한 쪽의 보이는 영역(CropBox ∩ MediaBox, 회전 전)과 회전
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageSize {
    pub(crate) view_box: PageBox,
    pub(crate) rotation: Rotation,
}

/// 문서의 모든 쪽. 쪽 번호가 곧 색인이다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct PageSizes {
    pub(crate) before: Vec<PageSize>,
    pub(crate) after: Vec<PageSize>,
}

/// 문서의 모든 쪽. 비교 범위 밖이라 읽지 않은 쪽은 `null`이다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct PageSources {
    pub(crate) before: Vec<Option<TextSource>>,
    pub(crate) after: Vec<Option<TextSource>>,
}

/// OCR로 글자를 얻지 못한 이유
#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum NoTextReason {
    OcrUnavailable,
    OcrFailed,
}

/// 결과와 함께 보이는 안내(ADR 0001 §6). 쪽 번호는 0부터 센 오름차순이다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Notice {
    LowTextConfidence {
        side: Side,
        pages: Vec<u32>,
    },
    NoTextLayer {
        side: Side,
        reason: NoTextReason,
        pages: Vec<u32>,
    },
    #[serde(rename_all = "camelCase")]
    Truncated {
        before_pages: Vec<u32>,
        after_pages: Vec<u32>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompareResult {
    /// diff 순서
    pub(crate) changes: Vec<Change>,
    /// 화면 행 순서
    pub(crate) page_pairs: Vec<PagePair>,
    pub(crate) page_sizes: PageSizes,
    pub(crate) page_sources: PageSources,
    pub(crate) notices: Vec<Notice>,
}

impl From<pdf_core::Side> for Side {
    fn from(side: pdf_core::Side) -> Self {
        match side {
            pdf_core::Side::Before => Self::Before,
            pdf_core::Side::After => Self::After,
        }
    }
}

impl From<pdf_core::TextBox> for TextBox {
    fn from(text_box: pdf_core::TextBox) -> Self {
        Self {
            page: text_box.page,
            x: text_box.x,
            y: text_box.y,
            w: text_box.w,
            h: text_box.h,
        }
    }
}

impl From<pdf_core::ChangeKind> for ChangeKind {
    fn from(kind: pdf_core::ChangeKind) -> Self {
        match kind {
            pdf_core::ChangeKind::Insert => Self::Insert,
            pdf_core::ChangeKind::Delete => Self::Delete,
            pdf_core::ChangeKind::Replace => Self::Replace,
        }
    }
}

impl From<pdf_core::TextSource> for TextSource {
    fn from(source: pdf_core::TextSource) -> Self {
        match source {
            pdf_core::TextSource::TextLayer => Self::TextLayer,
            pdf_core::TextSource::Ocr => Self::Ocr,
        }
    }
}

impl From<pdf_core::Placement> for Placement {
    fn from(placement: pdf_core::Placement) -> Self {
        match placement {
            pdf_core::Placement::Boxes {
                text,
                boxes,
                min_confidence,
            } => Self::Boxes {
                text,
                boxes: boxes.into_iter().map(TextBox::from).collect(),
                min_confidence,
            },
            pdf_core::Placement::Anchor { page, x, y, h } => Self::Anchor { page, x, y, h },
        }
    }
}

impl From<pdf_core::Change> for Change {
    fn from(change: pdf_core::Change) -> Self {
        Self {
            id: change.id,
            kind: change.kind.into(),
            before: change.before.into(),
            after: change.after.into(),
            page_pair: change.page_pair,
            needs_review: change.needs_review,
        }
    }
}

impl From<pdf_core::PageSize> for PageSize {
    fn from(size: pdf_core::PageSize) -> Self {
        Self {
            view_box: size.view_box.into(),
            rotation: size.rotation.into(),
        }
    }
}

impl From<pdf_core::NoTextReason> for NoTextReason {
    fn from(reason: pdf_core::NoTextReason) -> Self {
        match reason {
            pdf_core::NoTextReason::OcrUnavailable => Self::OcrUnavailable,
            pdf_core::NoTextReason::OcrFailed => Self::OcrFailed,
        }
    }
}

impl From<pdf_core::Notice> for Notice {
    fn from(notice: pdf_core::Notice) -> Self {
        match notice {
            pdf_core::Notice::LowTextConfidence { side, pages } => Self::LowTextConfidence {
                side: side.into(),
                pages,
            },
            pdf_core::Notice::NoTextLayer {
                side,
                reason,
                pages,
            } => Self::NoTextLayer {
                side: side.into(),
                reason: reason.into(),
                pages,
            },
            pdf_core::Notice::Truncated {
                before_pages,
                after_pages,
            } => Self::Truncated {
                before_pages,
                after_pages,
            },
        }
    }
}

fn page_sources(sources: Vec<Option<pdf_core::TextSource>>) -> Vec<Option<TextSource>> {
    sources
        .into_iter()
        .map(|source| source.map(TextSource::from))
        .collect()
}

impl From<pdf_core::CompareResult> for CompareResult {
    fn from(result: pdf_core::CompareResult) -> Self {
        Self {
            changes: result.changes.into_iter().map(Change::from).collect(),
            page_pairs: result.page_pairs,
            page_sizes: PageSizes {
                before: result
                    .page_sizes
                    .before
                    .into_iter()
                    .map(PageSize::from)
                    .collect(),
                after: result
                    .page_sizes
                    .after
                    .into_iter()
                    .map(PageSize::from)
                    .collect(),
            },
            page_sources: PageSources {
                before: page_sources(result.page_sources.before),
                after: page_sources(result.page_sources.after),
            },
            notices: result.notices.into_iter().map(Notice::from).collect(),
        }
    }
}

// 리포트 내보내기 요청으로 돌아온 결과를 pdf-core 모델로 옮긴다(위 `From`의 반대 방향).

impl From<PageBox> for pdf_core::PageBox {
    fn from(page_box: PageBox) -> Self {
        Self {
            left: page_box.left,
            bottom: page_box.bottom,
            right: page_box.right,
            top: page_box.top,
        }
    }
}

impl From<Side> for pdf_core::Side {
    fn from(side: Side) -> Self {
        match side {
            Side::Before => Self::Before,
            Side::After => Self::After,
        }
    }
}

impl From<TextBox> for pdf_core::TextBox {
    fn from(text_box: TextBox) -> Self {
        Self {
            page: text_box.page,
            x: text_box.x,
            y: text_box.y,
            w: text_box.w,
            h: text_box.h,
        }
    }
}

impl From<ChangeKind> for pdf_core::ChangeKind {
    fn from(kind: ChangeKind) -> Self {
        match kind {
            ChangeKind::Insert => Self::Insert,
            ChangeKind::Delete => Self::Delete,
            ChangeKind::Replace => Self::Replace,
        }
    }
}

impl From<TextSource> for pdf_core::TextSource {
    fn from(source: TextSource) -> Self {
        match source {
            TextSource::TextLayer => Self::TextLayer,
            TextSource::Ocr => Self::Ocr,
        }
    }
}

impl From<Placement> for pdf_core::Placement {
    fn from(placement: Placement) -> Self {
        match placement {
            Placement::Boxes {
                text,
                boxes,
                min_confidence,
            } => Self::Boxes {
                text,
                boxes: boxes.into_iter().map(pdf_core::TextBox::from).collect(),
                min_confidence,
            },
            Placement::Anchor { page, x, y, h } => Self::Anchor { page, x, y, h },
        }
    }
}

impl From<Change> for pdf_core::Change {
    fn from(change: Change) -> Self {
        Self {
            id: change.id,
            kind: change.kind.into(),
            before: change.before.into(),
            after: change.after.into(),
            page_pair: change.page_pair,
            needs_review: change.needs_review,
        }
    }
}

impl From<PageSize> for pdf_core::PageSize {
    fn from(size: PageSize) -> Self {
        Self {
            view_box: size.view_box.into(),
            rotation: size.rotation.into(),
        }
    }
}

impl From<NoTextReason> for pdf_core::NoTextReason {
    fn from(reason: NoTextReason) -> Self {
        match reason {
            NoTextReason::OcrUnavailable => Self::OcrUnavailable,
            NoTextReason::OcrFailed => Self::OcrFailed,
        }
    }
}

impl From<Notice> for pdf_core::Notice {
    fn from(notice: Notice) -> Self {
        match notice {
            Notice::LowTextConfidence { side, pages } => Self::LowTextConfidence {
                side: side.into(),
                pages,
            },
            Notice::NoTextLayer {
                side,
                reason,
                pages,
            } => Self::NoTextLayer {
                side: side.into(),
                reason: reason.into(),
                pages,
            },
            Notice::Truncated {
                before_pages,
                after_pages,
            } => Self::Truncated {
                before_pages,
                after_pages,
            },
        }
    }
}

fn core_page_sources(sources: Vec<Option<TextSource>>) -> Vec<Option<pdf_core::TextSource>> {
    sources
        .into_iter()
        .map(|source| source.map(pdf_core::TextSource::from))
        .collect()
}

impl From<CompareResult> for pdf_core::CompareResult {
    fn from(result: CompareResult) -> Self {
        Self {
            changes: result
                .changes
                .into_iter()
                .map(pdf_core::Change::from)
                .collect(),
            page_pairs: result.page_pairs,
            page_sizes: pdf_core::PageSizes {
                before: result
                    .page_sizes
                    .before
                    .into_iter()
                    .map(pdf_core::PageSize::from)
                    .collect(),
                after: result
                    .page_sizes
                    .after
                    .into_iter()
                    .map(pdf_core::PageSize::from)
                    .collect(),
            },
            page_sources: pdf_core::PageSources {
                before: core_page_sources(result.page_sources.before),
                after: core_page_sources(result.page_sources.after),
            },
            notices: result
                .notices
                .into_iter()
                .map(pdf_core::Notice::from)
                .collect(),
        }
    }
}

// ── 리포트 내보내기(계획서 P3-5, ADR 0001 §14·§17). 결과는 비교 커맨드가 돌려준 계약 JSON을 프론트가
// 그대로 다시 보낸다.

/// 비교 PDF 한 장에 쪽을 놓는 방식(화면의 `A·B 나란히 | A만 | B만`)
#[derive(Debug, Clone, Copy, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ReportLayout {
    SideBySide,
    AOnly,
    BOnly,
}

/// 비교 PDF 옵션(ADR 0001 §14). 연결선은 따로 고르지 않는다(나란히 + 색 상자일 때 그린다).
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompareReportOptions {
    pub(crate) layout: ReportLayout,
    /// 그 장에 보이는 쪽에 (숨기지 않은) 변경 상자가 있는 장만 넣는다.
    pub(crate) changed_pages_only: bool,
    /// 변경 상자를 색 사각형으로 그린다.
    pub(crate) draw_boxes: bool,
    /// 화면 필터에서 끈 종류. 이 종류의 변경은 그리지 않고 차이 있는 쪽 판정에도 쓰지 않는다.
    pub(crate) hidden_kinds: Vec<ChangeKind>,
}

impl From<CompareReportOptions> for pdf_core::CompareReportOptions {
    fn from(options: CompareReportOptions) -> Self {
        Self {
            layout: match options.layout {
                ReportLayout::SideBySide => pdf_core::ReportLayout::SideBySide,
                ReportLayout::AOnly => pdf_core::ReportLayout::AOnly,
                ReportLayout::BOnly => pdf_core::ReportLayout::BOnly,
            },
            changed_pages_only: options.changed_pages_only,
            draw_boxes: options.draw_boxes,
            hidden_kinds: core_kinds(options.hidden_kinds),
        }
    }
}

pub(crate) fn core_kinds(kinds: Vec<ChangeKind>) -> Vec<pdf_core::ChangeKind> {
    kinds.into_iter().map(pdf_core::ChangeKind::from).collect()
}

/// 내보낼 파일을 둘 곳: 폴더 다이얼로그(`pick_save_directory`)에서 고른 폴더와 그 안에 만들 이름.
/// 같은 이름의 파일이 있으면 덮어쓰지 않고 `이름 (2).pdf`처럼 번호를 붙인다.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportOutput {
    pub(crate) directory: PathBuf,
    /// 확장자(`.pdf`)까지 포함한 파일 이름 하나. 경로 구분자는 받지 않는다.
    pub(crate) file_name: String,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportComparePdfRequest {
    /// 프론트가 만든 작업 ID. `cancel_job`에 같은 값을 넘긴다.
    pub(crate) job_id: String,
    /// 비교 커맨드가 돌려준 결과 그대로
    pub(crate) result: CompareResult,
    /// 결과를 만든 A(이전) 문서
    pub(crate) before: PathBuf,
    /// 결과를 만든 B(이후) 문서
    pub(crate) after: PathBuf,
    pub(crate) options: CompareReportOptions,
    pub(crate) output: ExportOutput,
}

/// B 문서 사본에 차이를 주석으로 단 PDF
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportAnnotatedPdfRequest {
    /// 프론트가 만든 작업 ID. `cancel_job`에 같은 값을 넘긴다.
    pub(crate) job_id: String,
    pub(crate) result: CompareResult,
    /// 결과를 만든 B(이후) 문서. 이 사본에 주석을 단다.
    pub(crate) after: PathBuf,
    /// 화면 필터에서 끈 종류. 이 종류의 변경은 달지 않는다.
    pub(crate) hidden_kinds: Vec<ChangeKind>,
    pub(crate) output: ExportOutput,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewCompareReportRequest {
    pub(crate) result: CompareResult,
    pub(crate) before: PathBuf,
    pub(crate) after: PathBuf,
    pub(crate) options: CompareReportOptions,
    /// 그림 너비(px). Rust가 1 ~ 2400으로 자른다.
    pub(crate) width_px: u32,
}

/// 내보낸 파일 하나
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportedFile {
    pub(crate) output_path: PathBuf,
    /// 실제로 만든 이름(같은 이름이 있었으면 번호가 붙는다). 프론트가 경로 문자열을 나누지 않게 한다.
    pub(crate) file_name: String,
}

/// 비교 PDF 미리보기: 첫 장부터 몇 장의 그림과 내보낼 때의 전체 장 수
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReportPreview {
    /// 같은 옵션으로 내보낼 때의 전체 장 수(그린 장 수가 아니다)
    pub(crate) sheet_count: u32,
    /// 첫 장부터 차례로, 장마다 PNG를 base64로 쓴 문자열(`data:image/png;base64,` 뒤에 그대로 붙인다)
    pub(crate) images: Vec<String>,
}

/// 폴더 다이얼로그 옵션
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveDirectoryDialogOptions {
    /// 다이얼로그가 처음 보일 폴더
    pub(crate) default_directory: Option<PathBuf>,
}

// ── 번역(ADR 0002 §10). crates/translate 타입에는 specta를 붙이지 않으므로(serde만 쓴다) 같은 모양을 여기 두고
// `From`으로 옮긴다. 개수·번호·토큰은 `u32`다.

/// 원문 언어 고르기(옵션 화면 `자동 감지 | 중국어 | 영어`)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SourceLanguage {
    Auto,
    Zh,
    En,
}

/// 감지·정한 원문 언어. 간체·번체는 표시용이고 요청은 "중국어"다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DetectedLanguage {
    ZhHans,
    ZhHant,
    Zh,
    En,
    Unknown,
}

/// 번역 모델. API ID·요금은 crates/translate 모델 표에만 있다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TranslateModel {
    Sonnet,
    Haiku,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub(crate) struct GlossaryTerm {
    pub(crate) source: String,
    pub(crate) target: String,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranslateOptions {
    pub(crate) source_language: SourceLanguage,
    /// 1부터 센 쪽 범위(`"1,3-5"`, 비우면 전체. 비교와 같은 문법·검사)
    pub(crate) range: String,
    /// 범위 안 스캔 쪽 그림을 보낸다.
    pub(crate) include_scan_pages: bool,
    pub(crate) model: TranslateModel,
    /// 문서별 + 공용(문서별을 앞에), 프론트가 합친다. 정규화(앞뒤 공백·NFC·같은 원어)는 Rust도 한다.
    pub(crate) glossary: Vec<GlossaryTerm>,
}

/// 실행 전 확인(네트워크 없음)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranslationPlan {
    /// 문서 전체 쪽 수
    pub(crate) page_count: u32,
    /// 문서 전체의 글자층 쪽 수
    pub(crate) text_pages: u32,
    /// 문서 전체의 스캔 쪽 수(`text_pages + scan_pages = page_count`)
    pub(crate) scan_pages: u32,
    /// 범위 안 쪽 수
    pub(crate) range_pages: u32,
    /// 범위 안 글자층 문단으로 감지한 언어
    pub(crate) detected_language: DetectedLanguage,
    /// 범위 안 글자층 문단 수 + 이어하기 기록에 있는 스캔 쪽의 받아 적은 문단 수
    pub(crate) paragraph_count: u32,
    /// 범위 전체 묶음 수
    pub(crate) chunk_count: u32,
    /// 보낼 것만(이어하기면 남은 것만). 원문 언어를 정하지 못하면 0
    pub(crate) estimated_input_tokens: u32,
    pub(crate) estimated_output_tokens: u32,
    /// 0.000001 USD 단위
    pub(crate) estimated_cost_micro_usd: u32,
    /// 모델 표 요금 기준일 `YYYY-MM-DD`
    pub(crate) pricing_date: String,
    /// 같은 옵션의 기록에 끝난 문단이 있으면 그 수
    pub(crate) resumable: Option<ResumeState>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResumeState {
    pub(crate) translated_paragraphs: u32,
    pub(crate) paragraph_count: u32,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranslateRequest {
    /// 프론트가 만든 작업 ID. `cancel_job`에 같은 값을 넘긴다.
    pub(crate) job_id: String,
    pub(crate) path: PathBuf,
    pub(crate) options: TranslateOptions,
    /// `false`면 같은 옵션의 기록을 읽지 않고 처음부터 번역해 새 기록으로 덮는다.
    pub(crate) resume: bool,
}

/// 번역 단계. 이 순서대로 진행한다(ADR 0002 §9).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TranslateStage {
    ReadDocument,
    Translate,
    Arrange,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TokenUsage {
    pub(crate) input_tokens: u32,
    pub(crate) output_tokens: u32,
}

/// 번역 진행률. 화면에 보이는 %(단계·전체)가 바뀔 때만 온다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranslateProgress {
    pub(crate) job_id: String,
    pub(crate) stage: TranslateStage,
    pub(crate) done: u32,
    pub(crate) total: u32,
    pub(crate) stage_percent: u32,
    pub(crate) overall_percent: u32,
    pub(crate) paragraphs_done: u32,
    pub(crate) paragraph_count: u32,
    /// 이번 실행에서 받은 응답의 사용량
    pub(crate) usage: TokenUsage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PageKind {
    TextLayer,
    /// 스캔 쪽 + 스캔 옵션 켬(받아 적은 문단)
    Image,
    /// 스캔 쪽 + 스캔 옵션 끔(문단 없음)
    ScanSkipped,
    /// 범위 밖(문단 없음)
    OutOfRange,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ParagraphStatus {
    Translated,
    Edited,
    Failed,
    Refused,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranslatedParagraph {
    /// 문단 키(ADR 0002 §3). 다시 번역·직접 고치기가 이 키로 찾는다.
    pub(crate) key: String,
    /// 쪽 안 순번, 1부터
    pub(crate) number: u32,
    pub(crate) source: String,
    /// 화면에 보일 글(직접 고친 글 우선). 실패·거절이면 `null`
    pub(crate) target: Option<String>,
    /// 제목 문단(굵게). 스캔 쪽은 `false`
    pub(crate) heading: bool,
    pub(crate) status: ParagraphStatus,
    /// `failed` → `TRANSLATION_MISMATCH`·`TRANSLATION_TRUNCATED`, `refused` → `TRANSLATION_REFUSED`, 그 밖 `null`
    pub(crate) fail_code: Option<ErrorCode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranslatedPage {
    /// 0부터
    pub(crate) page: u32,
    pub(crate) kind: PageKind,
    pub(crate) paragraphs: Vec<TranslatedParagraph>,
    /// 스캔 쪽 자체가 실패했다(`image`일 때만, 문단 없음)
    pub(crate) fail_code: Option<ErrorCode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranslationResult {
    /// 기록 키. 다시 번역·직접 고치기에 그대로 보낸다.
    pub(crate) record_id: String,
    /// canonical 경로
    pub(crate) path: PathBuf,
    pub(crate) language: DetectedLanguage,
    pub(crate) model: TranslateModel,
    /// 문서 전체 쪽(색인 = 쪽 번호, 0부터)
    pub(crate) pages: Vec<TranslatedPage>,
    /// 이 기록의 누적 사용량(모든 실행과 다시 번역)
    pub(crate) usage: TokenUsage,
    /// 이번 실행
    pub(crate) elapsed_ms: u32,
    /// 범위 안 원문(스캔 쪽은 받아 적은 원문)에 원어가 나오는 용어
    pub(crate) glossary_used: Vec<GlossaryTerm>,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetranslateRequest {
    /// 프론트가 만든 작업 ID. `cancel_job`에 같은 값을 넘긴다.
    pub(crate) job_id: String,
    /// 결과의 `recordId`
    pub(crate) record_id: String,
    pub(crate) path: PathBuf,
    /// 문단 키
    pub(crate) key: String,
    /// 결과를 만든 옵션 그대로
    pub(crate) options: TranslateOptions,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetranslateResult {
    /// 번역이면 새 글, 실패·거절이면 그 상태(기록의 글은 그대로다)
    pub(crate) paragraph: TranslatedParagraph,
    /// 이 요청의 사용량
    pub(crate) usage: TokenUsage,
}

/// 직접 고치기. 다시 번역처럼 `path`·`options`로 기록 키를 다시 세어 결과의 `recordId`와 같을 때만 쓴다.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditParagraphRequest {
    pub(crate) record_id: String,
    pub(crate) path: PathBuf,
    pub(crate) key: String,
    /// 앞뒤 공백을 지운다. 비면 고친 글을 지워 원래 번역으로 돌린다.
    pub(crate) text: String,
    pub(crate) options: TranslateOptions,
}

/// 키 등록 상태. 키 원문은 웹뷰로 다시 보내지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiKeyStatus {
    pub(crate) registered: bool,
    /// 키 끝 4자리
    pub(crate) hint: Option<String>,
}

impl From<TranslateModel> for translate::TranslateModel {
    fn from(model: TranslateModel) -> Self {
        match model {
            TranslateModel::Sonnet => Self::Sonnet,
            TranslateModel::Haiku => Self::Haiku,
        }
    }
}

impl From<translate::DetectedLanguage> for DetectedLanguage {
    fn from(language: translate::DetectedLanguage) -> Self {
        match language {
            translate::DetectedLanguage::ZhHans => Self::ZhHans,
            translate::DetectedLanguage::ZhHant => Self::ZhHant,
            translate::DetectedLanguage::Zh => Self::Zh,
            translate::DetectedLanguage::En => Self::En,
            translate::DetectedLanguage::Unknown => Self::Unknown,
        }
    }
}

impl From<GlossaryTerm> for translate::GlossaryTerm {
    fn from(term: GlossaryTerm) -> Self {
        Self {
            source: term.source,
            target: term.target,
        }
    }
}

impl From<translate::GlossaryTerm> for GlossaryTerm {
    fn from(term: translate::GlossaryTerm) -> Self {
        Self {
            source: term.source,
            target: term.target,
        }
    }
}

impl From<translate::TokenUsage> for TokenUsage {
    fn from(usage: translate::TokenUsage) -> Self {
        Self {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
        }
    }
}

impl From<translate::ResumeState> for ResumeState {
    fn from(state: translate::ResumeState) -> Self {
        Self {
            translated_paragraphs: state.translated_paragraphs,
            paragraph_count: state.paragraph_count,
        }
    }
}

impl From<translate::TranslateProgress> for TranslateProgress {
    fn from(progress: translate::TranslateProgress) -> Self {
        Self {
            job_id: progress.job_id,
            stage: match progress.stage {
                translate::TranslateStage::ReadDocument => TranslateStage::ReadDocument,
                translate::TranslateStage::Translate => TranslateStage::Translate,
                translate::TranslateStage::Arrange => TranslateStage::Arrange,
            },
            done: progress.done,
            total: progress.total,
            stage_percent: progress.stage_percent,
            overall_percent: progress.overall_percent,
            paragraphs_done: progress.paragraphs_done,
            paragraph_count: progress.paragraph_count,
            usage: progress.usage.into(),
        }
    }
}

impl From<translate::TranslatedParagraph> for TranslatedParagraph {
    fn from(paragraph: translate::TranslatedParagraph) -> Self {
        let (status, fail_code) = match paragraph.status {
            translate::ParagraphStatus::Translated => (ParagraphStatus::Translated, None),
            translate::ParagraphStatus::Edited => (ParagraphStatus::Edited, None),
            translate::ParagraphStatus::Failed(reason) => {
                (ParagraphStatus::Failed, Some(fail_code(reason)))
            }
            translate::ParagraphStatus::Refused => (
                ParagraphStatus::Refused,
                Some(ErrorCode::TranslationRefused),
            ),
        };
        Self {
            key: paragraph.key,
            number: paragraph.number,
            source: paragraph.source,
            target: paragraph.target,
            heading: paragraph.heading,
            status,
            fail_code,
        }
    }
}

impl From<translate::TranslatedPage> for TranslatedPage {
    fn from(page: translate::TranslatedPage) -> Self {
        Self {
            page: page.page,
            kind: match page.kind {
                translate::PageKind::TextLayer => PageKind::TextLayer,
                translate::PageKind::Image => PageKind::Image,
                translate::PageKind::ScanSkipped => PageKind::ScanSkipped,
            },
            paragraphs: page
                .paragraphs
                .into_iter()
                .map(TranslatedParagraph::from)
                .collect(),
            fail_code: page.failure.map(|failure| match failure {
                translate::PageFailure::Failed(reason) => fail_code(reason),
                translate::PageFailure::Refused => ErrorCode::TranslationRefused,
            }),
        }
    }
}

impl TranslatedPage {
    /// 범위 밖 쪽(문단 없음)
    pub(crate) fn out_of_range(page: u32) -> Self {
        Self {
            page,
            kind: PageKind::OutOfRange,
            paragraphs: Vec::new(),
            fail_code: None,
        }
    }
}

/// 파일 크기를 `u32`로 보낸다. 열 수 있는 파일은 입력 상한(512MB) 안이라 넘칠 수 없지만,
/// 넘치면 최댓값으로 막는다.
pub(crate) fn byte_count(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// 개수를 `u32`로 보낸다. 상한(파일 512MB, 소스 200개)으로 보아 넘칠 수 없지만,
/// 넘치면 최댓값으로 막는다.
pub(crate) fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}
