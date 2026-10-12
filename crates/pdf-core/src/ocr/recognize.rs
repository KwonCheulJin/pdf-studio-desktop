//! 줄 인식(PP-OCR CTC 모델): 회전 상자를 바로 세워 잘라 높이 48로 맞추고, CTC 출력에서
//! 글자·신뢰도·글자별 위치(타임스텝)를 얻는다.

use image::imageops::{self, FilterType};
use image::{Rgb, RgbImage};
use imageproc::geometric_transformations::{Border, Interpolation, Projection, warp_into};
use ort::session::Session;
use ort::value::Tensor;

use super::{OcrChar, OcrError, OcrLine, Quad, first_output, run_error};

/// 인식 입력 높이(px)
const REC_IMAGE_HEIGHT: u32 = 48;
/// 배치의 최소 너비 비율(PP-OCR 기본 입력 320×48)
const REC_MIN_WIDTH_RATIO: f32 = 320.0 / 48.0;
/// 한 번에 넣는 줄 수. 너비가 비슷한 줄끼리 묶어 덧댐을 줄인다.
const REC_BATCH_SIZE: usize = 8;
/// 높이가 너비의 이 배수 이상이면 세로 글자 줄로 보고 90도 돌린다(PP-OCR 규칙).
const VERTICAL_LINE_RATIO: f32 = 1.5;
const PIXEL_HALF: f32 = 127.5;
/// CTC 빈칸(blank)의 클래스 번호
const CTC_BLANK: usize = 0;
const WHITE: Rgb<u8> = Rgb([255, 255, 255]);

/// 상자 하나를 잘라 바로 세운 줄 이미지
struct LineCrop {
    quad: Quad,
    image: RgbImage,
    /// 세로 줄을 돌려 세웠는가(글자 위치를 상자 위로 되돌릴 때 축이 바뀐다)
    rotated: bool,
}

/// 줄 상자들을 인식해 줄마다 글자열·신뢰도·글자 상자를 돌려준다. 빈 결과 줄은 뺀다.
pub(crate) fn recognize_lines(
    session: &mut Session,
    characters: &[String],
    image: &RgbImage,
    quads: &[Quad],
) -> Result<Vec<OcrLine>, OcrError> {
    let crops: Vec<LineCrop> = quads.iter().map(|quad| crop_line(image, *quad)).collect();
    let mut order: Vec<usize> = (0..crops.len()).collect();
    order.sort_by(|left, right| aspect(&crops[*left]).total_cmp(&aspect(&crops[*right])));

    let mut lines: Vec<Option<OcrLine>> = (0..crops.len()).map(|_| None).collect();
    for batch in order.chunks(REC_BATCH_SIZE) {
        let decoded = recognize_batch(session, characters, &crops, batch)?;
        for (index, line) in batch.iter().zip(decoded) {
            lines[*index] = line;
        }
    }
    Ok(lines.into_iter().flatten().collect())
}

fn aspect(crop: &LineCrop) -> f32 {
    crop.image.width() as f32 / crop.image.height().max(1) as f32
}

fn crop_line(image: &RgbImage, quad: Quad) -> LineCrop {
    let width = quad.width().round().max(1.0);
    let height = quad.height().round().max(1.0);
    let target = [(0.0, 0.0), (width, 0.0), (width, height), (0.0, height)];
    let mut crop = RgbImage::new(width as u32, height as u32);
    if let Some(projection) = Projection::from_control_points(quad.corner_tuples(), target) {
        warp_into(
            image,
            projection,
            Interpolation::Bilinear,
            Border::Constant(WHITE),
            &mut crop,
        );
    }
    let rotated = height >= width * VERTICAL_LINE_RATIO;
    let image = if rotated {
        imageops::rotate270(&crop)
    } else {
        crop
    };
    LineCrop {
        quad,
        image,
        rotated,
    }
}

fn recognize_batch(
    session: &mut Session,
    characters: &[String],
    crops: &[LineCrop],
    batch: &[usize],
) -> Result<Vec<Option<OcrLine>>, OcrError> {
    let max_ratio = batch
        .iter()
        .map(|index| aspect(&crops[*index]))
        .fold(REC_MIN_WIDTH_RATIO, f32::max);
    let input_width = (REC_IMAGE_HEIGHT as f32 * max_ratio).ceil() as usize;
    let input_height = REC_IMAGE_HEIGHT as usize;
    let plane = input_width * input_height;
    // 덧댄 부분은 0(정규화 뒤 값, 회색)이다. PP-OCR 전처리와 같다.
    let mut data = vec![0.0f32; batch.len() * 3 * plane];
    let mut content_widths = Vec::with_capacity(batch.len());
    for (slot, index) in batch.iter().enumerate() {
        let crop = &crops[*index].image;
        let resized_width = ((REC_IMAGE_HEIGHT as f32 * aspect(&crops[*index])).ceil() as usize)
            .clamp(1, input_width);
        let resized = imageops::resize(
            crop,
            resized_width as u32,
            REC_IMAGE_HEIGHT,
            FilterType::Triangle,
        );
        let base = slot * 3 * plane;
        for (x, y, pixel) in resized.enumerate_pixels() {
            let [red, green, blue] = pixel.0;
            let offset = y as usize * input_width + x as usize;
            for (channel, value) in [blue, green, red].into_iter().enumerate() {
                data[base + channel * plane + offset] =
                    (f32::from(value) - PIXEL_HALF) / PIXEL_HALF;
            }
        }
        content_widths.push(resized_width);
    }
    let tensor = Tensor::from_array(([batch.len(), 3, input_height, input_width], data))
        .map_err(run_error)?;
    let outputs = session.run(ort::inputs![tensor]).map_err(run_error)?;
    let (shape, probabilities) = first_output(&outputs)?;
    let (steps, classes) = match shape[..] {
        [count, steps, classes] if count as usize == batch.len() => {
            (steps as usize, classes as usize)
        }
        _ => {
            return Err(OcrError::UnexpectedOutput {
                detail: format!("recognition output shape {shape:?}"),
            });
        }
    };
    if classes != characters.len() {
        return Err(OcrError::UnexpectedOutput {
            detail: format!(
                "recognition classes {classes} != dictionary {}",
                characters.len()
            ),
        });
    }
    let step_width = input_width as f32 / steps as f32;
    Ok(batch
        .iter()
        .enumerate()
        .map(|(slot, index)| {
            let rows = &probabilities[slot * steps * classes..(slot + 1) * steps * classes];
            let peaks = ctc_decode(rows, classes);
            let crop = &crops[*index];
            // 타임스텝 → 크기 맞춘 줄 이미지 x → 잘라낸 줄 이미지 x
            let to_crop = crop.image.width() as f32 / content_widths[slot] as f32;
            build_line(characters, crop, &peaks, step_width * to_crop)
        })
        .collect())
}

/// CTC 출력에서 모은 글자 하나: 클래스, 신뢰도(연속 구간의 최대 확률), 구간 중심 타임스텝
struct Peak {
    class: usize,
    confidence: f32,
    center_step: f32,
}

/// 타임스텝마다 가장 높은 클래스를 고르고, 연속된 같은 클래스를 하나로 합치고, 빈칸을 뺀다.
fn ctc_decode(rows: &[f32], classes: usize) -> Vec<Peak> {
    let mut peaks: Vec<Peak> = Vec::new();
    let mut previous = CTC_BLANK;
    let mut run_start = 0usize;
    for (step, row) in rows.chunks_exact(classes).enumerate() {
        let (class, probability) =
            row.iter()
                .copied()
                .enumerate()
                .fold((CTC_BLANK, f32::MIN), |best, candidate| {
                    if candidate.1 > best.1 {
                        candidate
                    } else {
                        best
                    }
                });
        if class != CTC_BLANK && class == previous {
            if let Some(peak) = peaks.last_mut() {
                peak.confidence = peak.confidence.max(probability);
                peak.center_step = (run_start + step) as f32 / 2.0;
            }
        } else if class != CTC_BLANK {
            run_start = step;
            peaks.push(Peak {
                class,
                confidence: probability,
                center_step: step as f32,
            });
        }
        previous = class;
    }
    peaks
}

/// 글자 중심 사이의 가운데를 글자 경계로 삼아 줄 상자를 글자 상자로 나눈다.
fn build_line(
    characters: &[String],
    crop: &LineCrop,
    peaks: &[Peak],
    pixels_per_step: f32,
) -> Option<OcrLine> {
    if peaks.is_empty() {
        return None;
    }
    let length = crop.image.width() as f32;
    let centers: Vec<f32> = peaks
        .iter()
        .map(|peak| ((peak.center_step + 0.5) * pixels_per_step).min(length))
        .collect();
    let boundary = |index: usize| -> f32 {
        if index == 0 {
            let half = centers
                .get(1)
                .map_or(crop.image.height() as f32 / 2.0, |next| {
                    (next - centers[0]) / 2.0
                });
            (centers[0] - half).max(0.0)
        } else if index == centers.len() {
            let last = centers[index - 1];
            let half = if index >= 2 {
                (last - centers[index - 2]) / 2.0
            } else {
                crop.image.height() as f32 / 2.0
            };
            (last + half).min(length)
        } else {
            (centers[index - 1] + centers[index]) / 2.0
        }
    };
    let chars: Vec<OcrChar> = peaks
        .iter()
        .enumerate()
        .map(|(index, peak)| {
            let start = boundary(index) / length;
            let end = boundary(index + 1) / length;
            OcrChar {
                text: characters[peak.class].clone(),
                confidence: peak.confidence,
                quad: if crop.rotated {
                    crop.quad.sub_quad_vertical(start, end)
                } else {
                    crop.quad.sub_quad(start, end)
                },
            }
        })
        .collect();
    let text: String = chars
        .iter()
        .map(|character| character.text.as_str())
        .collect();
    if text.trim().is_empty() {
        return None;
    }
    let confidence = chars
        .iter()
        .map(|character| character.confidence)
        .fold(f32::MAX, f32::min);
    Some(OcrLine {
        text,
        confidence,
        quad: crop.quad,
        chars,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 타임스텝 6개, 클래스 3개(0=빈칸, 1, 2)의 확률표
    fn table(argmax: &[usize]) -> Vec<f32> {
        argmax
            .iter()
            .flat_map(|class| {
                let mut row = vec![0.05f32; 3];
                row[*class] = 0.9;
                row
            })
            .collect()
    }

    #[test]
    fn ctc_merges_repeats_and_keeps_blank_separated_duplicates() {
        // 1 1 _ 1 2 2 → "1", "1", "2"
        let peaks = ctc_decode(&table(&[1, 1, 0, 1, 2, 2]), 3);

        let classes: Vec<usize> = peaks.iter().map(|peak| peak.class).collect();
        assert_eq!(classes, vec![1, 1, 2]);
        let centers: Vec<f32> = peaks.iter().map(|peak| peak.center_step).collect();
        assert_eq!(centers, vec![0.5, 3.0, 4.5]);
    }
}
