//! 프론트와 주고받는 계약 타입. tauri-specta가 이 타입으로 TS 바인딩을 만든다.
//!
//! - 필드 이름은 camelCase로 보낸다.
//! - 개수·번호는 `u32`로 보낸다. `usize`·`u64`는 JS 숫자로 정확히 표현되지 않아(BigInt)
//!   specta가 내보내지 않는다.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use specta_typescript::Number;

use crate::error::AppError;

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
/// 그래서 TS 타입을 `number | null`이 아닌 `number`로 내보낸다.
#[derive(Debug, Clone, Serialize, specta::Type)]
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

/// 개수를 `u32`로 보낸다. 상한(파일 512MB, 소스 200개)으로 보아 넘칠 수 없지만,
/// 넘치면 최댓값으로 막는다.
pub(crate) fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}
