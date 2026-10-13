//! TIFF(여러 페이지 포함)를 TIFF 페이지마다 이미지 한 장짜리 PDF 페이지로 바꿔
//! 호출자가 준 폴더에 고유 이름으로 저장한다.
//!
//! - 페이지 크기는 TIFF 해상도로 정한다. 해상도가 없으면 72dpi(1px = 1pt)로 본다.
//! - CCITT(G3/G4) 페이지는 `tiff` 크레이트로 디코드하고, 디코드하지 못하거나 비트 순서가
//!   뒤집힌 경우(`FillOrder` 2)에는 압축을 풀지 않고 원본 스트립을 `/CCITTFaxDecode`로 넣는다.

mod ccitt;
mod pixels;

use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use pdfium_render::prelude::{
    PdfBitmap, PdfDocument, PdfPageImageObject, PdfPageObjectsCommon, PdfPagePaperSize, PdfPoints,
    Pdfium, PdfiumError, Pixels,
};
use tiff::decoder::ifd::Value;
use tiff::decoder::{Decoder, DecodingResult, Limits};
use tiff::tags::{CompressionMethod, ResolutionUnit, Tag};
use tiff::{TiffError, TiffUnsupportedError};

use crate::document::{
    DocumentError, MAX_INPUT_FILE_BYTES, classify_io_error, ensure_within_limit, load_exclusively,
};
use crate::engine::PdfEngine;
use crate::output::{SaveError, ensure_output_directory, save_atomically, unique_file_name};

/// TIFF 한 페이지의 최대 픽셀 수(1억). A3 600dpi(약 7천만)까지 받는다.
/// 이보다 크면 디코드하기 전에 거부한다. 측정 후 조정한다.
pub const MAX_TIFF_PAGE_PIXELS: u64 = 100_000_000;

/// 디코드 결과 한 픽셀의 최대 바이트 수(8비트 RGB·YCbCr)
const MAX_DECODED_BYTES_PER_PIXEL: u64 = 3;
/// 결과 PDF 이름 앞부분. 화면에는 `display_name`을 보인다.
const OUTPUT_FILE_PREFIX: &str = "tiff-";
const PDF_EXTENSION: &str = "pdf";
const POINTS_PER_INCH: f32 = 72.0;
const CENTIMETERS_PER_INCH: f32 = 2.54;
/// 해상도 태그가 없거나 쓸 수 없을 때의 해상도. 1px = 1pt가 된다.
const DEFAULT_DPI: f32 = POINTS_PER_INCH;
/// `FillOrder` 태그 값: 한 바이트 안의 픽셀을 낮은 비트부터 채웠다.
const FILL_ORDER_LSB_TO_MSB: u16 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TiffConversion {
    /// 저장한 PDF. 출력 폴더 안의 고유 이름이라 화면에 보이면 안 된다.
    pub pdf_path: PathBuf,
    pub page_count: usize,
    /// 화면에 보일 이름: 원본 TIFF 파일 이름에서 확장자를 `.pdf`로 바꾼 것
    pub display_name: String,
}

#[derive(Debug, thiserror::Error)]
pub enum TiffConversionError {
    #[error("file is not a valid TIFF ({detail}): {path}")]
    InvalidTiff { path: PathBuf, detail: String },
    #[error("TIFF page {page_index} uses unsupported compression {compression}: {path}")]
    UnsupportedCompression {
        path: PathBuf,
        page_index: usize,
        compression: u16,
    },
    #[error("TIFF page {page_index} has an unsupported image format ({detail}): {path}")]
    UnsupportedFormat {
        path: PathBuf,
        page_index: usize,
        detail: String,
    },
    #[error(
        "TIFF page {page_index} is {width}x{height} pixels, \
         over the {MAX_TIFF_PAGE_PIXELS} pixel limit: {path}"
    )]
    ImageTooLarge {
        path: PathBuf,
        page_index: usize,
        width: u32,
        height: u32,
    },
    #[error("TIFF conversion was cancelled")]
    Cancelled,
    #[error(transparent)]
    Document(#[from] DocumentError),
    #[error(transparent)]
    Save(#[from] SaveError),
}

impl TiffConversionError {
    /// 직렬화·화면 문구 선택에 쓰는 안정적인 코드. 변형의 이름이 바뀌어도 값은 유지한다.
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidTiff { .. } => "INVALID_TIFF",
            Self::UnsupportedCompression { .. } => "UNSUPPORTED_TIFF_COMPRESSION",
            Self::UnsupportedFormat { .. } => "UNSUPPORTED_TIFF_FORMAT",
            Self::ImageTooLarge { .. } => "IMAGE_TOO_LARGE",
            Self::Cancelled => "CANCELLED",
            Self::Document(error) => error.code(),
            Self::Save(error) => error.code(),
        }
    }
}

type TiffDecoder = Decoder<BufReader<File>>;

/// `tiff_path`의 모든 페이지를 PDF로 바꿔 `output_directory` 안에 고유 이름으로 저장한다.
///
/// - 출력 폴더는 이미 있어야 한다(앱 캐시 폴더는 호출자가 만든다).
/// - `cancel`은 페이지마다와 저장 직전에 확인하고, 켜져 있으면 `Cancelled`를 돌려준다.
///   저장은 임시 파일에 쓴 뒤 rename하므로 취소·실패 때 출력 폴더에 파일이 남지 않는다.
/// - 원본 TIFF는 읽기만 한다.
pub fn convert_tiff(
    engine: &PdfEngine,
    tiff_path: &Path,
    output_directory: &Path,
    cancel: &AtomicBool,
) -> Result<TiffConversion, TiffConversionError> {
    let pdf_path = output_directory.join(unique_file_name(OUTPUT_FILE_PREFIX, PDF_EXTENSION));
    ensure_output_directory(&pdf_path)?;
    let mut decoder = open_decoder(tiff_path)?;
    let pdfium = engine.pdfium();
    let mut document = pdfium
        .create_new_pdf()
        .map_err(|source| pdfium_error(tiff_path, source))?;

    let mut page_index = 0;
    loop {
        ensure_not_cancelled(cancel)?;
        append_page(pdfium, &mut document, &mut decoder, tiff_path, page_index)?;
        if !decoder.more_images() {
            break;
        }
        page_index += 1;
        decoder
            .next_image()
            .map_err(|error| tiff_error(tiff_path, page_index, error))?;
    }

    ensure_not_cancelled(cancel)?;
    save_atomically(&document, &pdf_path)?;
    Ok(TiffConversion {
        pdf_path,
        page_count: page_index + 1,
        display_name: display_name_of(tiff_path),
    })
}

/// 파일 크기를 먼저 확인한 뒤 첫 페이지까지 읽은 디코더를 만든다.
fn open_decoder(tiff_path: &Path) -> Result<TiffDecoder, TiffConversionError> {
    ensure_within_limit(tiff_path, MAX_INPUT_FILE_BYTES)?;
    let file = File::open(tiff_path).map_err(|source| classify_io_error(tiff_path, source))?;
    // 픽셀 상한 안의 페이지는 버퍼 한도에 걸리지 않게 한다. 기본 한도(256MiB)는 RGB 약 9천만 화소다.
    let decoded_page_bytes = MAX_TIFF_PAGE_PIXELS * MAX_DECODED_BYTES_PER_PIXEL;
    let buffer_limit = usize::try_from(decoded_page_bytes).unwrap_or(usize::MAX);
    let mut limits = Limits::default();
    limits.decoding_buffer_size = buffer_limit;
    limits.intermediate_buffer_size = buffer_limit;
    Decoder::new(BufReader::new(file))
        .map(|decoder| decoder.with_limits(limits))
        .map_err(|error| tiff_error(tiff_path, 0, error))
}

/// 디코더가 가리키는 TIFF 페이지 하나를 문서 끝에 붙인다.
fn append_page(
    pdfium: &Pdfium,
    document: &mut PdfDocument,
    decoder: &mut TiffDecoder,
    tiff_path: &Path,
    page_index: usize,
) -> Result<(), TiffConversionError> {
    let (width, height) = decoder
        .dimensions()
        .map_err(|error| tiff_error(tiff_path, page_index, error))?;
    let page = PageRef {
        path: tiff_path,
        index: page_index,
        width,
        height,
    };
    if u64::from(width) * u64::from(height) > MAX_TIFF_PAGE_PIXELS {
        return Err(page.too_large());
    }
    let size = page_size(decoder, width, height);
    let compression = decoder
        .find_tag_unsigned::<u16>(Tag::Compression)
        .map_err(|error| page.tiff(error))?
        .map_or(
            CompressionMethod::None,
            CompressionMethod::from_u16_exhaustive,
        );
    let is_ccitt = matches!(
        compression,
        CompressionMethod::Fax3 | CompressionMethod::Fax4
    );

    // `tiff` 크레이트는 `FillOrder`를 보지 않으므로 뒤집힌 비트를 그대로 디코드한다.
    if is_ccitt && has_reversed_fill_order(decoder, page)? {
        return append_ccitt_page(pdfium, document, decoder, page, size);
    }
    match decode_bitmap(decoder, page) {
        Ok(bitmap) => append_bitmap_page(document, bitmap, page, size),
        Err(_) if is_ccitt => append_ccitt_page(pdfium, document, decoder, page, size),
        Err(error) => Err(error),
    }
}

fn decode_bitmap(
    decoder: &mut TiffDecoder,
    page: PageRef,
) -> Result<pixels::PageBitmap, TiffConversionError> {
    let color = decoder.colortype().map_err(|error| page.tiff(error))?;
    if !pixels::is_supported(color) {
        return Err(page.unsupported_format(format!("{color:?}")));
    }
    let mut decoded = DecodingResult::U8(Vec::new());
    decoder
        .read_image_to_buffer(&mut decoded)
        .map_err(|error| page.tiff(error))?;
    pixels::to_bitmap(color, &decoded, page.width, page.height)
        .map_err(|error| page.unsupported_format(error.to_string()))
}

fn append_bitmap_page(
    document: &mut PdfDocument,
    mut bitmap: pixels::PageBitmap,
    page: PageRef,
    size: PageSize,
) -> Result<(), TiffConversionError> {
    let pdfium_error = |source| pdfium_error(page.path, source);
    let width = Pixels::try_from(page.width).map_err(|_| page.too_large())?;
    let height = Pixels::try_from(page.height).map_err(|_| page.too_large())?;
    let pixels = PdfBitmap::from_bytes(width, height, bitmap.format, &mut bitmap.buffer)
        .map_err(pdfium_error)?;
    let mut image = PdfPageImageObject::new(document).map_err(pdfium_error)?;
    image.set_bitmap(&pixels).map_err(pdfium_error)?;
    // 이미지 객체는 1x1pt로 만들어진다. 페이지 크기로 늘린다.
    image
        .scale(size.width_pt, size.height_pt)
        .map_err(pdfium_error)?;
    let mut pdf_page = document
        .pages_mut()
        .create_page_at_end(PdfPagePaperSize::Custom(
            PdfPoints::new(size.width_pt),
            PdfPoints::new(size.height_pt),
        ))
        .map_err(pdfium_error)?;
    pdf_page
        .objects_mut()
        .add_image_object(image)
        .map_err(pdfium_error)?;
    Ok(())
}

/// 압축된 CCITT 스트립을 담은 한 쪽짜리 PDF를 만들어 그 페이지를 가져온다.
/// pdfium에는 압축된 이미지 스트림을 그대로 넣는 API가 없다.
fn append_ccitt_page(
    pdfium: &Pdfium,
    document: &mut PdfDocument,
    decoder: &mut TiffDecoder,
    page: PageRef,
    size: PageSize,
) -> Result<(), TiffConversionError> {
    let image = ccitt::read_image(decoder, page)?;
    let bytes = ccitt::single_page_pdf(&image, size);
    let source = load_exclusively(|| pdfium.load_pdf_from_byte_vec(bytes, None))
        .map_err(|source| pdfium_error(page.path, source))?;
    document
        .pages_mut()
        .append(&source)
        .map_err(|source| pdfium_error(page.path, source))
}

fn has_reversed_fill_order(
    decoder: &mut TiffDecoder,
    page: PageRef,
) -> Result<bool, TiffConversionError> {
    let fill_order = decoder
        .find_tag_unsigned::<u16>(Tag::FillOrder)
        .map_err(|error| page.tiff(error))?;
    Ok(fill_order == Some(FILL_ORDER_LSB_TO_MSB))
}

/// PDF 페이지 크기(pt). 가로·세로 해상도가 다를 수 있다(팩스 204x98dpi 등).
#[derive(Debug, Clone, Copy)]
struct PageSize {
    width_pt: f32,
    height_pt: f32,
}

fn page_size(decoder: &mut TiffDecoder, width: u32, height: u32) -> PageSize {
    let unit = decoder
        .find_tag_unsigned::<u16>(Tag::ResolutionUnit)
        .ok()
        .flatten()
        .and_then(ResolutionUnit::from_u16)
        .unwrap_or(ResolutionUnit::Inch);
    let mut dots_per_inch = |tag| dots_per_inch(decoder, tag, unit).unwrap_or(DEFAULT_DPI);
    let horizontal_dpi = dots_per_inch(Tag::XResolution);
    let vertical_dpi = dots_per_inch(Tag::YResolution);
    // 1억 화소 상한 아래의 크기는 f32로 바꿔도 페이지 크기 정밀도에 영향이 없다.
    PageSize {
        width_pt: width as f32 * POINTS_PER_INCH / horizontal_dpi,
        height_pt: height as f32 * POINTS_PER_INCH / vertical_dpi,
    }
}

/// 해상도 태그를 인치당 점 수로 바꾼다. 태그가 없거나, 단위가 없거나(1), 0 이하면 `None`.
fn dots_per_inch(decoder: &mut TiffDecoder, tag: Tag, unit: ResolutionUnit) -> Option<f32> {
    let Ok(Some(Value::Rational(numerator, denominator))) = decoder.find_tag(tag) else {
        return None;
    };
    let resolution = f64::from(numerator) / f64::from(denominator);
    let dots_per_inch = match unit {
        ResolutionUnit::Inch => resolution as f32,
        ResolutionUnit::Centimeter => resolution as f32 * CENTIMETERS_PER_INCH,
        _ => return None,
    };
    (dots_per_inch.is_finite() && dots_per_inch > 0.0).then_some(dots_per_inch)
}

/// 원본 이름에서 마지막 확장자만 `.pdf`로 바꾼다(`scan.v2.tif` → `scan.v2.pdf`).
fn display_name_of(tiff_path: &Path) -> String {
    let stem = tiff_path.file_stem().unwrap_or_default().to_string_lossy();
    format!("{stem}.{PDF_EXTENSION}")
}

/// 에러에 붙일 페이지 위치와 크기
#[derive(Debug, Clone, Copy)]
struct PageRef<'a> {
    path: &'a Path,
    index: usize,
    width: u32,
    height: u32,
}

impl PageRef<'_> {
    fn too_large(self) -> TiffConversionError {
        TiffConversionError::ImageTooLarge {
            path: self.path.to_path_buf(),
            page_index: self.index,
            width: self.width,
            height: self.height,
        }
    }

    fn invalid(self, detail: impl Into<String>) -> TiffConversionError {
        TiffConversionError::InvalidTiff {
            path: self.path.to_path_buf(),
            detail: format!("page {}: {}", self.index, detail.into()),
        }
    }

    fn unsupported_format(self, detail: impl Into<String>) -> TiffConversionError {
        TiffConversionError::UnsupportedFormat {
            path: self.path.to_path_buf(),
            page_index: self.index,
            detail: detail.into(),
        }
    }

    /// 크기를 아는 페이지의 디코더 에러. 버퍼 한도 초과는 큰 이미지로 본다.
    fn tiff(self, error: TiffError) -> TiffConversionError {
        match error {
            TiffError::LimitsExceeded => self.too_large(),
            error => tiff_error(self.path, self.index, error),
        }
    }
}

fn tiff_error(path: &Path, page_index: usize, error: TiffError) -> TiffConversionError {
    let path = path.to_path_buf();
    match error {
        TiffError::UnsupportedError(TiffUnsupportedError::UnsupportedCompressionMethod(method)) => {
            TiffConversionError::UnsupportedCompression {
                path,
                page_index,
                compression: method.to_u16(),
            }
        }
        TiffError::UnsupportedError(unsupported) => TiffConversionError::UnsupportedFormat {
            path,
            page_index,
            detail: unsupported.to_string(),
        },
        error => TiffConversionError::InvalidTiff {
            path,
            detail: format!("page {page_index}: {error}"),
        },
    }
}

fn pdfium_error(path: &Path, source: PdfiumError) -> TiffConversionError {
    TiffConversionError::Document(DocumentError::Pdfium {
        path: path.to_path_buf(),
        source,
    })
}

fn ensure_not_cancelled(cancel: &AtomicBool) -> Result<(), TiffConversionError> {
    if cancel.load(Ordering::Relaxed) {
        Err(TiffConversionError::Cancelled)
    } else {
        Ok(())
    }
}
