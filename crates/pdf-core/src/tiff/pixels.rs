//! 디코드한 TIFF 픽셀을 pdfium 비트맵 버퍼로 옮긴다.
//! 받는 형식: 1·2·4·8비트 그레이, 8비트 RGB, 8비트 YCbCr(JPEG 압축 TIFF에 흔함).
//! `tiff` 크레이트가 WhiteIsZero를 이미 뒤집어 주므로 그레이 값은 항상 0이 검정이다.

use pdfium_render::prelude::PdfBitmapFormat;
use tiff::ColorType;
use tiff::decoder::DecodingResult;

const BITS_PER_BYTE: u8 = 8;
const MAX_CHANNEL: u16 = 255;
const RGB_CHANNELS: usize = 3;
/// pdfium 비트맵의 행 길이는 4바이트 배수다(`PdfBitmap::from_bytes`가 같은 값으로 계산한다).
const ROW_ALIGNMENT: usize = 4;

/// ITU-R BT.601 전범위(JFIF) YCbCr → RGB 계수
const CHROMA_OFFSET: f32 = 128.0;
const RED_FROM_CR: f32 = 1.402;
const GREEN_FROM_CB: f32 = 0.344_136;
const GREEN_FROM_CR: f32 = 0.714_136;
const BLUE_FROM_CB: f32 = 1.772;

/// `PdfBitmap::from_bytes`에 넘길 버퍼. 행마다 4바이트 정렬, 그레이 또는 BGR
pub(crate) struct PageBitmap {
    pub(crate) format: PdfBitmapFormat,
    pub(crate) buffer: Vec<u8>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum PixelError {
    #[error("{color:?} decoded into an unexpected sample type")]
    UnexpectedSampleType { color: ColorType },
    #[error("decoded {actual} bytes, expected at least {expected} (planar or truncated data)")]
    TooFewBytes { expected: usize, actual: usize },
}

pub(crate) fn is_supported(color: ColorType) -> bool {
    matches!(
        color,
        ColorType::Gray(1 | 2 | 4 | 8) | ColorType::RGB(8) | ColorType::YCbCr(8)
    )
}

/// `is_supported`인 형식만 받는다. 다른 형식은 `UnexpectedSampleType`이다.
pub(crate) fn to_bitmap(
    color: ColorType,
    decoded: &DecodingResult,
    width: u32,
    height: u32,
) -> Result<PageBitmap, PixelError> {
    let DecodingResult::U8(samples) = decoded else {
        return Err(PixelError::UnexpectedSampleType { color });
    };
    // u32 → usize: 지원하는 64비트·32비트 대상에서 손실이 없다.
    let size = Size {
        width: width as usize,
        height: height as usize,
    };
    match color {
        ColorType::Gray(bits @ (1 | 2 | 4 | 8)) => gray(samples, size, bits),
        ColorType::RGB(8) => bgr(samples, size, |[red, green, blue]| [blue, green, red]),
        ColorType::YCbCr(8) => bgr(samples, size, ycbcr_to_bgr),
        color => Err(PixelError::UnexpectedSampleType { color }),
    }
}

#[derive(Debug, Clone, Copy)]
struct Size {
    width: usize,
    height: usize,
}

/// 한 바이트에 `bits`비트씩 앞(높은 비트)부터 채운 행을 8비트 그레이로 편다.
fn gray(samples: &[u8], size: Size, bits: u8) -> Result<PageBitmap, PixelError> {
    let source_stride = (size.width * usize::from(bits)).div_ceil(usize::from(BITS_PER_BYTE));
    let source_rows = rows(samples, source_stride, size.height)?;
    let stride = aligned(size.width);
    let max_value = (1_u16 << bits) - 1;
    let mask = u8::try_from(max_value).unwrap_or(u8::MAX);
    let pixels_per_byte = BITS_PER_BYTE / bits;

    let mut buffer = vec![0; stride * size.height];
    for (source_row, target_row) in source_rows.zip(buffer.chunks_exact_mut(stride)) {
        let values = source_row.iter().flat_map(|byte| {
            (1..=pixels_per_byte)
                .map(move |position| (byte >> (BITS_PER_BYTE - position * bits)) & mask)
        });
        for (target, value) in target_row.iter_mut().take(size.width).zip(values) {
            // value ≤ max_value 이므로 결과는 255 이하다.
            *target = u8::try_from(u16::from(value) * MAX_CHANNEL / max_value).unwrap_or(u8::MAX);
        }
    }
    Ok(PageBitmap {
        format: PdfBitmapFormat::Gray,
        buffer,
    })
}

/// 3채널 픽셀을 `to_bgr`로 바꿔 BGR 버퍼에 옮긴다.
fn bgr(
    samples: &[u8],
    size: Size,
    to_bgr: impl Fn([u8; RGB_CHANNELS]) -> [u8; RGB_CHANNELS],
) -> Result<PageBitmap, PixelError> {
    let source_stride = size.width * RGB_CHANNELS;
    let source_rows = rows(samples, source_stride, size.height)?;
    let stride = aligned(source_stride);

    let mut buffer = vec![0; stride * size.height];
    for (source_row, target_row) in source_rows.zip(buffer.chunks_exact_mut(stride)) {
        let (source_pixels, _) = source_row.as_chunks::<RGB_CHANNELS>();
        let (target_pixels, _) = target_row.as_chunks_mut::<RGB_CHANNELS>();
        for (target, source) in target_pixels.iter_mut().zip(source_pixels) {
            *target = to_bgr(*source);
        }
    }
    Ok(PageBitmap {
        format: PdfBitmapFormat::BGR,
        buffer,
    })
}

/// 디코드 결과를 `height`개 행으로 나눈다. 모자라면(평면 배치·잘린 데이터) 에러다.
fn rows(
    samples: &[u8],
    stride: usize,
    height: usize,
) -> Result<std::iter::Take<std::slice::ChunksExact<'_, u8>>, PixelError> {
    let expected = stride * height;
    if stride == 0 || samples.len() < expected {
        return Err(PixelError::TooFewBytes {
            expected,
            actual: samples.len(),
        });
    }
    Ok(samples.chunks_exact(stride).take(height))
}

fn aligned(row_bytes: usize) -> usize {
    row_bytes.div_ceil(ROW_ALIGNMENT) * ROW_ALIGNMENT
}

fn ycbcr_to_bgr([luma, blue_difference, red_difference]: [u8; RGB_CHANNELS]) -> [u8; RGB_CHANNELS] {
    let luma = f32::from(luma);
    let blue_difference = f32::from(blue_difference) - CHROMA_OFFSET;
    let red_difference = f32::from(red_difference) - CHROMA_OFFSET;
    let red = luma + RED_FROM_CR * red_difference;
    let green = luma - GREEN_FROM_CB * blue_difference - GREEN_FROM_CR * red_difference;
    let blue = luma + BLUE_FROM_CB * blue_difference;
    [channel(blue), channel(green), channel(red)]
}

fn channel(value: f32) -> u8 {
    // 0~255로 자른 뒤 바꾸므로 값이 잘리지 않는다.
    value.round().clamp(0.0, f32::from(u8::MAX)) as u8
}
