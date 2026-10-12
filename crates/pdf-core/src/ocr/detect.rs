//! 글자 줄 검출(PP-OCR DB 모델): 확률 지도를 이진화하고 연결 요소마다 최소 넓이 회전 사각형을 만든다.

use image::imageops::{self, FilterType};
use image::{GrayImage, Luma, RgbImage};
use imageproc::geometry::min_area_rect;
use imageproc::point::Point;
use imageproc::region_labelling::{Connectivity, connected_components};
use ort::session::Session;
use ort::value::Tensor;

use super::{OcrError, Quad, first_output, run_error};

/// 검출 입력의 긴 변 상한(px). 300dpi A4(약 2480×3508)를 줄여 넣는다. 측정으로 정한 값이다.
pub const OCR_DET_MAX_SIDE: u32 = 2048;
/// 검출 입력 변은 이 배수여야 한다(DB 모델의 다운샘플 배율).
const DET_SIDE_MULTIPLE: u32 = 32;
/// PP-OCR 검출 전처리(ImageNet 평균·표준편차, BGR 순서)
const DET_MEAN_BGR: [f32; 3] = [0.485, 0.456, 0.406];
const DET_STD_BGR: [f32; 3] = [0.229, 0.224, 0.225];
const PIXEL_MAX: f32 = 255.0;
/// 확률 지도 이진화 기준
const DET_BINARY_THRESHOLD: f32 = 0.3;
/// 연결 요소의 평균 확률이 이 값 미만이면 버린다.
const DET_BOX_THRESHOLD: f32 = 0.6;
/// DB 모델은 글자 영역을 줄여 예측하므로 상자를 넓혀 되돌린다(넓이 × 비율 / 둘레 만큼).
const DET_UNCLIP_RATIO: f32 = 1.5;
/// 짧은 변이 이 값(확률 지도 px)보다 작은 요소는 잡음으로 본다.
const DET_MIN_SIDE: f32 = 3.0;
const BINARY_ON: u8 = 255;
const BINARY_OFF: u8 = 0;

/// `image`에서 글자 줄 상자를 찾아 원본 이미지 좌표(px)로 돌려준다.
pub(crate) fn detect_lines(session: &mut Session, image: &RgbImage) -> Result<Vec<Quad>, OcrError> {
    let (width, height) = image.dimensions();
    let (input_width, input_height) = det_input_size(width, height);
    let resized = imageops::resize(image, input_width, input_height, FilterType::Triangle);
    let tensor = Tensor::from_array((
        [1usize, 3, input_height as usize, input_width as usize],
        normalize_bgr(&resized),
    ))
    .map_err(run_error)?;
    let outputs = session.run(ort::inputs![tensor]).map_err(run_error)?;
    let (shape, probabilities) = first_output(&outputs)?;
    let map_height = shape.get(2).copied().unwrap_or_default();
    let map_width = shape.get(3).copied().unwrap_or_default();
    if map_height != i64::from(input_height) || map_width != i64::from(input_width) {
        return Err(OcrError::UnexpectedOutput {
            detail: format!("detection map shape {shape:?}"),
        });
    }
    let scale_x = width as f32 / input_width as f32;
    let scale_y = height as f32 / input_height as f32;
    Ok(
        boxes_from_probability_map(probabilities, input_width, input_height)
            .into_iter()
            .map(|quad| quad.scaled(scale_x, scale_y))
            .collect(),
    )
}

/// 긴 변을 `OCR_DET_MAX_SIDE` 이하로 줄이고 두 변을 32의 배수로 맞춘다.
fn det_input_size(width: u32, height: u32) -> (u32, u32) {
    let longest = width.max(height) as f32;
    let ratio = (OCR_DET_MAX_SIDE as f32 / longest).min(1.0);
    let round = |side: u32| {
        let scaled = (side as f32 * ratio / DET_SIDE_MULTIPLE as f32).round() as u32;
        scaled.max(1) * DET_SIDE_MULTIPLE
    };
    (round(width), round(height))
}

fn normalize_bgr(image: &RgbImage) -> Vec<f32> {
    let (width, height) = image.dimensions();
    let plane = (width * height) as usize;
    let mut data = vec![0.0f32; plane * 3];
    for (index, pixel) in image.pixels().enumerate() {
        let [red, green, blue] = pixel.0;
        for (channel, value) in [blue, green, red].into_iter().enumerate() {
            data[channel * plane + index] =
                (f32::from(value) / PIXEL_MAX - DET_MEAN_BGR[channel]) / DET_STD_BGR[channel];
        }
    }
    data
}

fn boxes_from_probability_map(probabilities: &[f32], width: u32, height: u32) -> Vec<Quad> {
    let binary = GrayImage::from_fn(width, height, |x, y| {
        let probability = probabilities[(y * width + x) as usize];
        Luma([if probability > DET_BINARY_THRESHOLD {
            BINARY_ON
        } else {
            BINARY_OFF
        }])
    });
    let labels = connected_components(&binary, Connectivity::Eight, Luma([BINARY_OFF]));
    let mut components: Vec<Component> = Vec::new();
    for (x, y, label) in labels.enumerate_pixels() {
        let label = label.0[0] as usize;
        if label == 0 {
            continue;
        }
        if components.len() < label {
            components.resize_with(label, Component::default);
        }
        let component = &mut components[label - 1];
        component.points.push(Point::new(x as f32, y as f32));
        component.probability_sum += probabilities[(y * width + x) as usize];
    }
    components
        .into_iter()
        .filter_map(|component| component.into_quad())
        .collect()
}

#[derive(Default)]
struct Component {
    points: Vec<Point<f32>>,
    probability_sum: f32,
}

impl Component {
    fn into_quad(self) -> Option<Quad> {
        if self.points.len() < 2 {
            return None;
        }
        let score = self.probability_sum / self.points.len() as f32;
        if score < DET_BOX_THRESHOLD {
            return None;
        }
        // 픽셀 중심 좌표의 사각형이므로 픽셀 넓이만큼(반 픽셀씩) 넓힌다.
        let quad = Quad::from_corners(min_area_rect(&self.points)).expanded(0.5);
        if quad.width().min(quad.height()) < DET_MIN_SIDE {
            return None;
        }
        let area = quad.width() * quad.height();
        let perimeter = 2.0 * (quad.width() + quad.height());
        Some(quad.expanded(area * DET_UNCLIP_RATIO / perimeter))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tilted_line_becomes_rotated_box_wider_than_its_shrunk_core() {
        // 1도 기울어진 200×6 픽셀 줄(확률 0.9) 하나
        let (width, height) = (256, 64);
        let angle = 1.0f32.to_radians();
        let mut map = vec![0.0f32; (width * height) as usize];
        for step in 0..200 {
            for thickness in 0..6 {
                let x = 20.0 + step as f32 * angle.cos();
                let y = 30.0 + thickness as f32 - step as f32 * angle.sin();
                map[(y.round() as u32 * width + x.round() as u32) as usize] = 0.9;
            }
        }

        let boxes = boxes_from_probability_map(&map, width, height);

        assert_eq!(boxes.len(), 1);
        let quad = boxes[0];
        assert!(quad.width() > 200.0 && quad.height() > 6.0);
        assert!(quad.height() < 20.0, "rotated box must hug the tilted line");
    }
}
