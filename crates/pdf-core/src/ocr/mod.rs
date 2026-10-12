//! 스캔 쪽 OCR(계획서 §6.4, P2-2a 스파이크): pdfium 렌더 → PP-OCR 검출 → 한국어 인식.
//! ONNX Runtime은 `ort`의 동적 로드로 붙이고, 라이브러리·모델 경로는 `runtime.rs`에서 정한다.
//! 좌표 되돌리기(PDF pt)·캐시·비교 연결은 P2-4a에서 한다.

mod detect;
mod recognize;
mod runtime;

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use image::RgbImage;
use ort::session::{Session, SessionOutputs};
use pdfium_render::prelude::{PdfRenderConfig, PdfiumError};

use crate::document::{DocumentError, open_document};
use crate::engine::PdfEngine;

pub use detect::OCR_DET_MAX_SIDE;

/// OCR 렌더 해상도(dpi). 시작값이다. P2-2a 측정에서 400이 더 나았다(계획서 §6.4 제안).
pub const OCR_RENDER_DPI: u32 = 300;
/// 번들·`OCR_MODEL_DIR` 안의 모델 파일 이름(`scripts/fetch-ocr.mjs`와 같다)
const OCR_DET_MODEL_FILE: &str = "ch_PP-OCRv5_det_mobile.onnx";
const OCR_REC_MODEL_FILE: &str = "korean_PP-OCRv5_rec_mobile.onnx";
const OCR_REC_DICTIONARY_FILE: &str = "ppocrv5_korean_dict.txt";

const POINTS_PER_INCH: f32 = 72.0;
/// CTC 클래스 0번(빈칸) 자리. 사전의 글자는 1번부터이고 마지막 클래스는 공백이다(PP-OCR `use_space_char`).
const CTC_BLANK_SYMBOL: &str = "";
const SPACE_SYMBOL: &str = " ";

#[derive(Debug, thiserror::Error)]
pub enum OcrError {
    #[error("failed to load ONNX Runtime at {path}: {message}")]
    RuntimeLoad { path: PathBuf, message: String },
    #[error("failed to load OCR model {path}: {message}")]
    ModelLoad { path: PathBuf, message: String },
    #[error("failed to read OCR dictionary {path}: {source}")]
    Dictionary {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("OCR inference failed: {source}")]
    Inference {
        #[source]
        source: ort::Error,
    },
    #[error("unexpected OCR model output: {detail}")]
    UnexpectedOutput { detail: String },
    #[error(transparent)]
    Document(#[from] DocumentError),
    #[error("page {page_index} is out of range")]
    PageOutOfRange { page_index: u16 },
}

/// 이미지 위 사각형. 꼭짓점은 왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래 순서(px, 위·왼쪽 원점)이고
/// 기울어진 줄을 따라 회전해 있을 수 있다.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Quad {
    pub corners: [(f32, f32); 4],
}

#[derive(Debug, Clone, PartialEq)]
pub struct OcrChar {
    pub text: String,
    /// CTC 구간의 최대 확률(0~1)
    pub confidence: f32,
    /// 줄 상자를 글자 중심 사이 가운데에서 나눈 상자
    pub quad: Quad,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OcrLine {
    pub text: String,
    /// 줄 안 글자 신뢰도의 최솟값
    pub confidence: f32,
    pub quad: Quad,
    pub chars: Vec<OcrChar>,
}

pub struct OcrEngine {
    detector: Session,
    recognizer: Session,
    /// CTC 클래스 번호 → 글자
    characters: Vec<String>,
    library_path: PathBuf,
    model_dir: PathBuf,
}

impl OcrEngine {
    /// `ONNXRUNTIME_LIB_PATH`·`OCR_MODEL_DIR`가 있으면 그 경로를, 없으면 번들 폴더를 쓴다.
    /// ONNX Runtime 라이브러리는 프로세스에 한 번만 로드된다.
    pub fn load(bundled_library_dir: &Path, bundled_model_dir: &Path) -> Result<Self, OcrError> {
        let library_path = runtime::resolve_library_path(
            std::env::var_os(runtime::ONNXRUNTIME_LIB_PATH_ENV),
            bundled_library_dir,
        );
        let model_dir = runtime::resolve_model_dir(
            std::env::var_os(runtime::OCR_MODEL_DIR_ENV),
            bundled_model_dir,
        );
        let environment = ort::init_from(&library_path).map_err(|error| OcrError::RuntimeLoad {
            path: library_path.clone(),
            message: error.to_string(),
        })?;
        // 이미 만든 환경이 있으면 false 다. 그때도 그 환경으로 계속한다.
        environment.commit();

        let detector = load_session(&model_dir.join(OCR_DET_MODEL_FILE))?;
        let recognizer = load_session(&model_dir.join(OCR_REC_MODEL_FILE))?;
        let characters = load_characters(&model_dir.join(OCR_REC_DICTIONARY_FILE))?;
        Ok(Self {
            detector,
            recognizer,
            characters,
            library_path,
            model_dir,
        })
    }

    pub fn library_path(&self) -> &Path {
        &self.library_path
    }

    pub fn model_dir(&self) -> &Path {
        &self.model_dir
    }

    /// 이미지에서 글자 줄을 찾아 읽는다. 결과는 위에서 아래, 왼쪽에서 오른쪽 순서다.
    pub fn recognize(&mut self, image: &RgbImage) -> Result<Vec<OcrLine>, OcrError> {
        let image = &red_channel_gray(image);
        let quads = detect::detect_lines(&mut self.detector, image)?;
        let mut lines =
            recognize::recognize_lines(&mut self.recognizer, &self.characters, image, &quads)?;
        lines.sort_by(|left, right| {
            let (left_x, left_y) = left.quad.center();
            let (right_x, right_y) = right.quad.center();
            left_y.total_cmp(&right_y).then(left_x.total_cmp(&right_x))
        });
        Ok(lines)
    }
}

/// 쪽을 `OCR_RENDER_DPI`로 렌더한다. 이미지는 메모리에만 둔다.
pub fn render_page_for_ocr(
    engine: &PdfEngine,
    path: &Path,
    page_index: u16,
) -> Result<RgbImage, OcrError> {
    let document = open_document(engine.pdfium(), path)?;
    let to_error = |source: PdfiumError| {
        OcrError::Document(DocumentError::Pdfium {
            path: path.to_path_buf(),
            source,
        })
    };
    let page = document
        .pages()
        .get(i32::from(page_index))
        .map_err(|_| OcrError::PageOutOfRange { page_index })?;
    let config =
        PdfRenderConfig::new().scale_page_by_factor(OCR_RENDER_DPI as f32 / POINTS_PER_INCH);
    let bitmap = page.render_with_config(&config).map_err(to_error)?;
    let (width, height) = (bitmap.width() as u32, bitmap.height() as u32);
    let rgb: Vec<u8> = bitmap
        .as_rgba_bytes()
        .chunks_exact(4)
        .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect();
    RgbImage::from_raw(width, height, rgb).ok_or_else(|| OcrError::UnexpectedOutput {
        detail: format!("rendered bitmap size {width}x{height}"),
    })
}

/// 빨강 채널만 남긴 회색 이미지. 붉은 도장(빨강 채널이 밝음)은 거의 흰색이 되고, 검은 글자는
/// (도장 아래에 있어도) 어둡게 남는다. 회색 스캔은 바뀌지 않는다.
fn red_channel_gray(image: &RgbImage) -> RgbImage {
    let mut gray = image.clone();
    for pixel in gray.pixels_mut() {
        let red = pixel.0[0];
        pixel.0 = [red, red, red];
    }
    gray
}

fn load_session(path: &Path) -> Result<Session, OcrError> {
    let to_error = |message: String| OcrError::ModelLoad {
        path: path.to_path_buf(),
        message,
    };
    Session::builder()
        .map_err(|error| to_error(error.to_string()))?
        .commit_from_file(path)
        .map_err(|error| to_error(error.to_string()))
}

fn load_characters(path: &Path) -> Result<Vec<String>, OcrError> {
    let text = fs::read_to_string(path).map_err(|source| OcrError::Dictionary {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(std::iter::once(CTC_BLANK_SYMBOL.to_owned())
        .chain(text.lines().map(str::to_owned))
        .chain(std::iter::once(SPACE_SYMBOL.to_owned()))
        .collect())
}

fn run_error(source: ort::Error) -> OcrError {
    OcrError::Inference { source }
}

/// 모델의 첫 출력(f32 텐서)의 모양과 값
fn first_output<'a>(outputs: &'a SessionOutputs<'_>) -> Result<(Vec<i64>, &'a [f32]), OcrError> {
    if outputs.len() == 0 {
        return Err(OcrError::UnexpectedOutput {
            detail: "model returned no outputs".to_owned(),
        });
    }
    let (shape, data) = outputs[0].try_extract_tensor::<f32>().map_err(run_error)?;
    Ok((shape.to_vec(), data))
}

impl Quad {
    /// 최소 넓이 사각형의 네 점을 (왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래)로 정렬한다.
    /// 기울기가 45도 미만인 줄을 가정한다.
    fn from_corners(points: [imageproc::point::Point<f32>; 4]) -> Self {
        let by = |key: fn(&(f32, f32)) -> f32, take_max: bool| {
            let corners = points.map(|point| (point.x, point.y));
            let mut sorted = corners;
            sorted.sort_by(|left, right| key(left).total_cmp(&key(right)));
            if take_max { sorted[3] } else { sorted[0] }
        };
        let sum = |point: &(f32, f32)| point.0 + point.1;
        let difference = |point: &(f32, f32)| point.1 - point.0;
        Self {
            corners: [
                by(sum, false),
                by(difference, false),
                by(sum, true),
                by(difference, true),
            ],
        }
    }

    pub fn width(&self) -> f32 {
        let [top_left, top_right, bottom_right, bottom_left] = self.corners;
        distance(top_left, top_right).max(distance(bottom_left, bottom_right))
    }

    pub fn height(&self) -> f32 {
        let [top_left, top_right, bottom_right, bottom_left] = self.corners;
        distance(top_left, bottom_left).max(distance(top_right, bottom_right))
    }

    pub fn center(&self) -> (f32, f32) {
        let (sum_x, sum_y) = self
            .corners
            .iter()
            .fold((0.0, 0.0), |(x, y), corner| (x + corner.0, y + corner.1));
        (sum_x / 4.0, sum_y / 4.0)
    }

    fn corner_tuples(&self) -> [(f32, f32); 4] {
        self.corners
    }

    fn scaled(&self, scale_x: f32, scale_y: f32) -> Self {
        Self {
            corners: self.corners.map(|(x, y)| (x * scale_x, y * scale_y)),
        }
    }

    /// 네 변을 바깥으로 `amount`만큼 민다(직사각형 가정).
    fn expanded(&self, amount: f32) -> Self {
        let [top_left, top_right, bottom_right, bottom_left] = self.corners;
        let right = unit(top_left, top_right);
        let down = unit(top_left, bottom_left);
        let shift = |point: (f32, f32), x_sign: f32, y_sign: f32| {
            (
                point.0 + amount * (x_sign * right.0 + y_sign * down.0),
                point.1 + amount * (x_sign * right.1 + y_sign * down.1),
            )
        };
        Self {
            corners: [
                shift(top_left, -1.0, -1.0),
                shift(top_right, 1.0, -1.0),
                shift(bottom_right, 1.0, 1.0),
                shift(bottom_left, -1.0, 1.0),
            ],
        }
    }

    /// 줄 방향(왼쪽→오른쪽)의 비율 구간 [start, end]에 해당하는 조각
    fn sub_quad(&self, start: f32, end: f32) -> Self {
        let [top_left, top_right, bottom_right, bottom_left] = self.corners;
        Self {
            corners: [
                lerp(top_left, top_right, start),
                lerp(top_left, top_right, end),
                lerp(bottom_left, bottom_right, end),
                lerp(bottom_left, bottom_right, start),
            ],
        }
    }

    /// 세로 줄(위→아래)의 비율 구간 [start, end]에 해당하는 조각
    fn sub_quad_vertical(&self, start: f32, end: f32) -> Self {
        let [top_left, top_right, bottom_right, bottom_left] = self.corners;
        Self {
            corners: [
                lerp(top_left, bottom_left, start),
                lerp(top_right, bottom_right, start),
                lerp(top_right, bottom_right, end),
                lerp(top_left, bottom_left, end),
            ],
        }
    }
}

fn distance(from: (f32, f32), to: (f32, f32)) -> f32 {
    (to.0 - from.0).hypot(to.1 - from.1)
}

fn unit(from: (f32, f32), to: (f32, f32)) -> (f32, f32) {
    let length = distance(from, to).max(f32::EPSILON);
    ((to.0 - from.0) / length, (to.1 - from.1) / length)
}

fn lerp(from: (f32, f32), to: (f32, f32), ratio: f32) -> (f32, f32) {
    (
        from.0 + (to.0 - from.0) * ratio,
        from.1 + (to.1 - from.1) * ratio,
    )
}
