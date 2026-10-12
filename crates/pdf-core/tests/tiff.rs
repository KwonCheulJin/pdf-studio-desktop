//! TIFF → PDF 변환 공개 API 검증. 통합 테스트는 파일마다 별도 프로세스라
//! pdfium 바인딩(프로세스당 한 번)이 다른 테스트 파일과 겹치지 않는다.

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::AtomicBool;

use pdf_core::{
    MAX_INPUT_FILE_BYTES, PdfEngine, TiffConversion, TiffConversionError, convert_tiff,
    read_pdf_info,
};
use pdfium_render::prelude::{PdfRenderConfig, Pdfium};

const LIBRARY_PATH_ENV: &str = "PDFIUM_LIB_PATH";
const GEOMETRY_TOLERANCE: f32 = 0.01;
/// 렌더한 픽셀 색의 채널별 허용 오차. JPEG 손실과 렌더 보간을 흡수한다.
const COLOR_TOLERANCE: u8 = 24;
/// 이 값보다 어두우면 검정, 밝으면 흰색으로 본다.
const DARK_LIMIT: u8 = 64;
const LIGHT_LIMIT: u8 = 192;

const RED: [u8; 3] = [255, 0, 0];
const MID_GRAY: [u8; 3] = [128, 128, 128];
const CCITT_FILTER: &[u8] = b"/CCITTFaxDecode";

fn engine() -> &'static PdfEngine {
    static ENGINE: OnceLock<PdfEngine> = OnceLock::new();
    ENGINE.get_or_init(|| {
        assert!(
            std::env::var_os(LIBRARY_PATH_ENV).is_some(),
            "{LIBRARY_PATH_ENV} is required: run `node scripts/fetch-pdfium.mjs` and export it"
        );
        // 번들 폴더는 없는 경로를 준다: 환경변수 경로로 바인딩돼야 통과한다.
        PdfEngine::bind(Path::new("/nonexistent/pdfium")).expect("bind pdfium")
    })
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

/// 테스트마다 쓰는 빈 폴더. 테스트가 끝나면(실패해도) 지운다.
struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("pdf-core-tiff-{}-{name}", std::process::id()));
        if path.exists() {
            fs::remove_dir_all(&path).expect("clear test dir");
        }
        fs::create_dir_all(&path).expect("create test dir");
        Self { path }
    }

    fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }

    /// 폴더 안 파일 이름(숨김 파일 포함), 정렬
    fn entries(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.path)
            .expect("read test dir")
            .map(|entry| {
                entry
                    .expect("dir entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    /// 픽스처를 이 폴더에 `name`으로 복사한다. 저장소의 픽스처는 입력으로만 쓴다.
    fn copy_fixture(&self, fixture_name: &str, name: &str) -> PathBuf {
        let copy = self.join(name);
        fs::copy(fixture(fixture_name), &copy).expect("copy fixture");
        copy
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        // 정리 실패는 테스트 결과와 무관하다(임시 폴더).
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn convert(tiff_path: &Path, output: &TestDir) -> Result<TiffConversion, TiffConversionError> {
    convert_tiff(engine(), tiff_path, &output.path, &AtomicBool::new(false))
}

/// 페이지를 1pt = 1px로 렌더한 RGBA 픽셀
struct RenderedPage {
    width: usize,
    height: usize,
    rgba: Vec<u8>,
}

impl RenderedPage {
    fn rgb(&self, x: usize, y: usize) -> [u8; 3] {
        let start = (y * self.width + x) * 4;
        [self.rgba[start], self.rgba[start + 1], self.rgba[start + 2]]
    }
}

fn render(pdf_path: &Path, page_index: i32) -> RenderedPage {
    // `PdfEngine`이 먼저 바인딩해 두면 `Pdfium::default()`는 그 바인딩을 다시 쓴다.
    engine();
    let pdfium = Pdfium::default();
    let document = pdfium
        .load_pdf_from_file(pdf_path, None)
        .expect("open converted pdf");
    let page = document.pages().get(page_index).expect("page");
    let bitmap = page
        .render_with_config(&PdfRenderConfig::new().scale_page_by_factor(1.0))
        .expect("render page");
    RenderedPage {
        width: usize::try_from(bitmap.width()).expect("width"),
        height: usize::try_from(bitmap.height()).expect("height"),
        rgba: bitmap.as_rgba_bytes(),
    }
}

fn assert_close(actual: f32, expected: f32) {
    assert!(
        (actual - expected).abs() <= GEOMETRY_TOLERANCE,
        "expected {expected}, got {actual}"
    );
}

fn assert_color(actual: [u8; 3], expected: [u8; 3], context: &str) {
    let close = actual
        .iter()
        .zip(expected)
        .all(|(actual, expected)| actual.abs_diff(expected) <= COLOR_TOLERANCE);
    assert!(close, "{context}: expected {expected:?}, got {actual:?}");
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

#[test]
fn every_tiff_page_becomes_a_pdf_page_sized_by_its_resolution() {
    let output = TestDir::new("pages");

    let result = convert(&fixture("multipage.tif"), &output).expect("convert");

    assert_eq!(result.page_count, 3);
    let info = read_pdf_info(engine(), &result.pdf_path).expect("read converted pdf");
    assert_eq!(info.page_count, 3);
    // 60x30px @72dpi, 60x30px @144dpi, 40x80px @20px/cm (= 2x4cm)
    let expected = [(60.0, 30.0), (30.0, 15.0), (56.693, 113.386)];
    for (page, (width, height)) in info.pages.iter().zip(expected) {
        assert_close(page.width_pt, width);
        assert_close(page.height_pt, height);
    }
}

#[test]
fn rgb_gray_and_jpeg_pages_keep_their_colors() {
    let output = TestDir::new("colors");

    let result = convert(&fixture("multipage.tif"), &output).expect("convert");

    // 0쪽 RGB(LZW) 빨강, 1쪽 그레이(Deflate) 128, 2쪽 YCbCr JPEG 빨강
    for (page_index, expected) in [(0, RED), (1, MID_GRAY), (2, RED)] {
        let page = render(&result.pdf_path, page_index);
        let center = page.rgb(page.width / 2, page.height / 2);
        assert_color(center, expected, &format!("page {page_index}"));
    }
}

#[test]
fn ccitt_scans_are_black_only_in_their_top_left_quadrant() {
    // (픽스처, 압축을 풀지 않고 CCITT 스트림 그대로 넣어야 하는지)
    // G4는 디코드한다. 비트 순서가 뒤집힌 G4와 `tiff` 크레이트가 풀지 못하는 G3는 그대로 넣는다.
    let cases = [
        ("ccitt-g4.tif", false),
        ("ccitt-g4-lsb-first.tif", true),
        ("ccitt-g3-2d.tif", true),
    ];

    for (name, embeds_ccitt_stream) in cases {
        let output = TestDir::new(name);

        let result = convert(&fixture(name), &output).expect(name);

        assert_eq!(result.page_count, 1, "{name}");
        // 64x48px, 해상도 없음(72dpi로 본다) → 64x48pt
        let page = render(&result.pdf_path, 0);
        assert_eq!((page.width, page.height), (64, 48), "{name}");
        let top_left = page.rgb(16, 12);
        assert!(
            top_left.iter().all(|value| *value < DARK_LIMIT),
            "{name}: {top_left:?}"
        );
        for (x, y) in [(48, 12), (16, 36), (48, 36)] {
            let pixel = page.rgb(x, y);
            assert!(
                pixel.iter().all(|value| *value > LIGHT_LIMIT),
                "{name} at ({x}, {y}): {pixel:?}"
            );
        }
        if embeds_ccitt_stream {
            let bytes = fs::read(&result.pdf_path).expect("read converted pdf");
            assert!(
                contains(&bytes, CCITT_FILTER),
                "{name} was not embedded as CCITT"
            );
        }
    }
}

#[test]
fn unsupported_compression_is_rejected_and_nothing_is_written() {
    const JPEG_2000_COMPRESSION: u16 = 34712;
    let output = TestDir::new("unsupported-compression");

    let error = convert(&fixture("unsupported-compression.tif"), &output).unwrap_err();

    assert_eq!(error.code(), "UNSUPPORTED_TIFF_COMPRESSION", "{error:?}");
    match error {
        TiffConversionError::UnsupportedCompression {
            page_index,
            compression,
            ..
        } => assert_eq!((page_index, compression), (0, JPEG_2000_COMPRESSION)),
        other => panic!("expected UnsupportedCompression, got {other:?}"),
    }
    assert!(output.entries().is_empty(), "{:?}", output.entries());
}

#[test]
fn image_over_pixel_limit_is_rejected_before_decoding() {
    // 20000x20000 1비트. 픽셀 데이터가 없으므로 디코드를 시도했다면 INVALID_TIFF가 났을 것이다.
    let output = TestDir::new("oversized-image");

    let error = convert(&fixture("oversized-image.tif"), &output).unwrap_err();

    assert_eq!(error.code(), "IMAGE_TOO_LARGE", "{error:?}");
    assert!(output.entries().is_empty(), "{:?}", output.entries());
}

#[test]
fn file_over_size_limit_is_rejected_before_parsing() {
    // 희소 파일이라 실제 디스크를 거의 쓰지 않는다. 내용은 TIFF가 아니므로
    // 크기 검사 없이 열었다면 INVALID_TIFF가 났을 것이다.
    let input = TestDir::new("oversize-input");
    let output = TestDir::new("oversize-output");
    let path = input.join("huge.tif");
    File::create(&path)
        .and_then(|file| file.set_len(MAX_INPUT_FILE_BYTES + 1))
        .expect("create sparse file");

    let error = convert(&path, &output).unwrap_err();

    assert_eq!(error.code(), "INPUT_TOO_LARGE", "{error:?}");
    assert!(output.entries().is_empty(), "{:?}", output.entries());
}

#[test]
fn converting_twice_keeps_both_results_under_the_original_display_name() {
    let input = TestDir::new("twice-input");
    let output = TestDir::new("twice-output");
    let tiff_path = input.copy_fixture("ccitt-g4.tif", "Quarterly scan.tiff");

    let first = convert(&tiff_path, &output).expect("first convert");
    let second = convert(&tiff_path, &output).expect("second convert");

    assert_ne!(first.pdf_path, second.pdf_path);
    for result in [&first, &second] {
        assert_eq!(result.display_name, "Quarterly scan.pdf");
        assert_eq!(result.pdf_path.parent(), Some(output.path.as_path()));
        assert_eq!(
            read_pdf_info(engine(), &result.pdf_path)
                .expect("read converted pdf")
                .page_count,
            1
        );
    }
    assert_eq!(output.entries().len(), 2, "{:?}", output.entries());
}

#[test]
fn source_tiff_keeps_its_bytes_and_modified_time() {
    let input = TestDir::new("source-input");
    let output = TestDir::new("source-output");
    let tiff_path = input.copy_fixture("multipage.tif", "source.tif");
    let snapshot = |path: &Path| {
        let bytes = fs::read(path).expect("read source");
        let modified = fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .expect("source mtime");
        (bytes, modified)
    };
    let before = snapshot(&tiff_path);

    convert(&tiff_path, &output).expect("convert");

    assert!(before == snapshot(&tiff_path), "source tiff changed");
}

#[test]
fn cancelled_conversion_writes_nothing() {
    let output = TestDir::new("cancelled");
    let cancel = AtomicBool::new(true);

    let result = convert_tiff(engine(), &fixture("multipage.tif"), &output.path, &cancel);

    let error = result.unwrap_err();
    assert!(matches!(error, TiffConversionError::Cancelled), "{error:?}");
    assert_eq!(error.code(), "CANCELLED");
    assert!(output.entries().is_empty(), "{:?}", output.entries());
}
