//! 압축을 풀지 않은 CCITT(G3/G4) 스트립을 `/CCITTFaxDecode` 이미지로 담은 한 쪽짜리 PDF를 만든다.
//! TIFF는 스트립마다 따로 부호화하므로 스트립 하나를 이미지 하나로 두고 위에서부터 쌓는다.

use std::io::{Read, Seek, SeekFrom};

use tiff::ColorType;
use tiff::decoder::ChunkType;
use tiff::tags::{CompressionMethod, PhotometricInterpretation, Tag};

use super::{FILL_ORDER_LSB_TO_MSB, PageRef, PageSize, TiffConversionError, TiffDecoder};

/// `T4Options`(G3 옵션) 태그와 2차원 부호화 비트
const T4_OPTIONS_TAG: u16 = 292;
const T4_TWO_DIMENSIONAL: u32 = 1;

/// `/DecodeParms /K`: 음수는 G4, 0은 G3 1차원, 양수는 G3 1·2차원 혼합.
/// 양수일 때 디코더는 각 행 앞의 표시 비트로 1·2차원을 가르므로 값의 크기는 쓰지 않는다.
const K_GROUP_4: i32 = -1;
const K_GROUP_3_ONE_DIMENSIONAL: i32 = 0;
const K_GROUP_3_TWO_DIMENSIONAL: i32 = 1;

/// 두 번째 줄은 파일에 바이너리 데이터가 있음을 알리는 주석이다(PDF 32000-1 §7.5.2).
const PDF_HEADER: &[u8] = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
/// 객체 번호: 1 카탈로그, 2 페이지 트리, 3 페이지, 4 내용 스트림, 5부터 스트립 이미지
const FIRST_IMAGE_OBJECT: usize = 5;
/// 내용 스트림의 좌표 소수 자릿수
const COORDINATE_DECIMALS: usize = 4;

pub(super) struct CcittImage {
    width: u32,
    /// 스트립마다 (행 수, 압축된 데이터). 위에서 아래 순서
    strips: Vec<(u32, Vec<u8>)>,
    k: i32,
    /// 부호화된 "흰색" 런을 검정으로 보여야 하면 true(BlackIsZero)
    black_is_one: bool,
}

/// 디코더가 가리키는 페이지의 스트립을 압축된 그대로 읽는다. 비트 순서가 뒤집혀 있으면 바로잡는다.
pub(super) fn read_image(
    decoder: &mut TiffDecoder,
    page: PageRef,
) -> Result<CcittImage, TiffConversionError> {
    let tiff = |error| page.tiff(error);
    if decoder.get_chunk_type() == ChunkType::Tile {
        return Err(page.unsupported_format("tiled CCITT image"));
    }
    if decoder.colortype().map_err(tiff)? != ColorType::Gray(1) {
        return Err(page.unsupported_format("CCITT image that is not 1-bit gray"));
    }
    let k = k_parameter(decoder, page)?;
    let black_is_one = match decoder
        .find_tag_unsigned::<u16>(Tag::PhotometricInterpretation)
        .map_err(tiff)?
        .and_then(PhotometricInterpretation::from_u16)
    {
        Some(PhotometricInterpretation::WhiteIsZero) => false,
        Some(PhotometricInterpretation::BlackIsZero) => true,
        _ => return Err(page.unsupported_format("CCITT image without gray photometric")),
    };
    let reverse_bits = decoder
        .find_tag_unsigned::<u16>(Tag::FillOrder)
        .map_err(tiff)?
        == Some(FILL_ORDER_LSB_TO_MSB);

    let rows_per_strip = decoder
        .find_tag_unsigned::<u32>(Tag::RowsPerStrip)
        .map_err(tiff)?
        .unwrap_or(page.height)
        .min(page.height);
    if rows_per_strip == 0 {
        return Err(page.invalid("RowsPerStrip is 0"));
    }
    let offsets = decoder.get_tag_u64_vec(Tag::StripOffsets).map_err(tiff)?;
    let byte_counts = decoder
        .get_tag_u64_vec(Tag::StripByteCounts)
        .map_err(tiff)?;
    let strip_rows = strip_rows(page.height, rows_per_strip);
    if offsets.len() < strip_rows.len() || byte_counts.len() < strip_rows.len() {
        return Err(page.invalid("fewer strips than the image height needs"));
    }

    let reader = decoder.inner();
    let strips = strip_rows
        .into_iter()
        .zip(offsets.into_iter().zip(byte_counts))
        .map(|(rows, (offset, byte_count))| {
            let mut data = read_strip(reader, offset, byte_count)
                .ok_or_else(|| page.invalid("strip data is outside the file"))?;
            if reverse_bits {
                data.iter_mut().for_each(|byte| *byte = byte.reverse_bits());
            }
            Ok((rows, data))
        })
        .collect::<Result<Vec<_>, TiffConversionError>>()?;

    Ok(CcittImage {
        width: page.width,
        strips,
        k,
        black_is_one,
    })
}

fn k_parameter(decoder: &mut TiffDecoder, page: PageRef) -> Result<i32, TiffConversionError> {
    let compression = decoder
        .find_tag_unsigned::<u16>(Tag::Compression)
        .map_err(|error| page.tiff(error))?
        .map(CompressionMethod::from_u16_exhaustive);
    match compression {
        Some(CompressionMethod::Fax4) => Ok(K_GROUP_4),
        Some(CompressionMethod::Fax3) => {
            let options = decoder
                .find_tag_unsigned::<u32>(Tag::Unknown(T4_OPTIONS_TAG))
                .map_err(|error| page.tiff(error))?
                .unwrap_or_default();
            if options & T4_TWO_DIMENSIONAL == 0 {
                Ok(K_GROUP_3_ONE_DIMENSIONAL)
            } else {
                Ok(K_GROUP_3_TWO_DIMENSIONAL)
            }
        }
        _ => Err(page.unsupported_format("not a CCITT G3/G4 image")),
    }
}

/// 스트립별 행 수. 마지막 스트립만 짧을 수 있다.
fn strip_rows(height: u32, rows_per_strip: u32) -> Vec<u32> {
    (0..height.div_ceil(rows_per_strip))
        .map(|strip| rows_per_strip.min(height - strip * rows_per_strip))
        .collect()
}

/// 파일 크기보다 큰 길이를 미리 할당하지 않도록 읽은 만큼만 버퍼를 늘린다.
/// 파일 끝을 넘으면 `None`
fn read_strip(reader: &mut (impl Read + Seek), offset: u64, byte_count: u64) -> Option<Vec<u8>> {
    reader.seek(SeekFrom::Start(offset)).ok()?;
    let mut data = Vec::new();
    reader.take(byte_count).read_to_end(&mut data).ok()?;
    (u64::try_from(data.len()).ok()? == byte_count).then_some(data)
}

/// 스트립 이미지를 쌓은 한 쪽짜리 PDF. pdfium이 열어 페이지를 가져갈 용도라 최소 구조만 쓴다.
pub(super) fn single_page_pdf(image: &CcittImage, size: PageSize) -> Vec<u8> {
    let height: u32 = image.strips.iter().map(|(rows, _)| rows).sum();
    let points_per_row = size.height_pt / height as f32;
    let width = format_number(size.width_pt);

    let mut content = String::new();
    let mut resources = String::new();
    let mut rows_above = 0;
    for (index, (rows, _)) in image.strips.iter().enumerate() {
        let strip_height = *rows as f32 * points_per_row;
        let bottom = size.height_pt - (rows_above + rows) as f32 * points_per_row;
        content += &format!(
            "q {width} 0 0 {} 0 {} cm /Im{index} Do Q\n",
            format_number(strip_height),
            format_number(bottom)
        );
        resources += &format!("/Im{index} {} 0 R ", FIRST_IMAGE_OBJECT + index);
        rows_above += rows;
    }

    let mut writer = PdfWriter::new();
    writer.object(b"<< /Type /Catalog /Pages 2 0 R >>");
    writer.object(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    writer.object(
        format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {}] \
             /Resources << /XObject << {resources}>> >> /Contents 4 0 R >>",
            format_number(size.height_pt)
        )
        .as_bytes(),
    );
    writer.stream("", content.as_bytes());
    for (rows, data) in &image.strips {
        writer.stream(
            &format!(
                "/Type /XObject /Subtype /Image /Width {columns} /Height {rows} \
                 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode \
                 /DecodeParms << /K {k} /Columns {columns} /Rows {rows} /BlackIs1 {black_is_one} >>",
                columns = image.width,
                k = image.k,
                black_is_one = image.black_is_one,
            ),
            data,
        );
    }
    writer.finish()
}

fn format_number(value: f32) -> String {
    format!("{value:.COORDINATE_DECIMALS$}")
}

/// 객체를 1번부터 순서대로 쓰고 끝에 상호 참조 표를 붙인다.
struct PdfWriter {
    bytes: Vec<u8>,
    offsets: Vec<usize>,
}

impl PdfWriter {
    fn new() -> Self {
        Self {
            bytes: PDF_HEADER.to_vec(),
            offsets: Vec::new(),
        }
    }

    fn object(&mut self, body: &[u8]) {
        self.offsets.push(self.bytes.len());
        let number = self.offsets.len();
        self.bytes
            .extend_from_slice(format!("{number} 0 obj\n").as_bytes());
        self.bytes.extend_from_slice(body);
        self.bytes.extend_from_slice(b"\nendobj\n");
    }

    fn stream(&mut self, dictionary_entries: &str, data: &[u8]) {
        let mut body = format!(
            "<< {dictionary_entries} /Length {} >>\nstream\n",
            data.len()
        )
        .into_bytes();
        body.extend_from_slice(data);
        body.extend_from_slice(b"\nendstream");
        self.object(&body);
    }

    fn finish(mut self) -> Vec<u8> {
        let xref_offset = self.bytes.len();
        let size = self.offsets.len() + 1;
        let mut xref = format!("xref\n0 {size}\n0000000000 65535 f \n");
        for offset in &self.offsets {
            xref += &format!("{offset:010} 00000 n \n");
        }
        xref +=
            &format!("trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n");
        self.bytes.extend_from_slice(xref.as_bytes());
        self.bytes
    }
}
