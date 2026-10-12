//! 문서 열기·정보 조회의 공개 API 검증. 통합 테스트는 파일마다 별도 프로세스라
//! pdfium 바인딩(프로세스당 한 번)이 `engine.rs`의 단위 테스트와 겹치지 않는다.

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use pdf_core::{
    DocumentError, MAX_INPUT_FILE_BYTES, PageBox, PageRotation, PdfEngine, PdfInfo, read_pdf_info,
};

const LIBRARY_PATH_ENV: &str = "PDFIUM_LIB_PATH";
const GEOMETRY_TOLERANCE: f32 = 0.01;

const LETTER_WIDTH: f32 = 612.0;
const LETTER_HEIGHT: f32 = 792.0;
const A4_WIDTH: f32 = 595.0;
const A4_HEIGHT: f32 = 842.0;

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

fn info_of(name: &str) -> PdfInfo {
    read_pdf_info(engine(), &fixture(name)).expect("read pdf info")
}

fn assert_close(actual: f32, expected: f32) {
    assert!(
        (actual - expected).abs() <= GEOMETRY_TOLERANCE,
        "expected {expected}, got {actual}"
    );
}

fn assert_box(actual: PageBox, expected: PageBox) {
    assert_close(actual.left, expected.left);
    assert_close(actual.bottom, expected.bottom);
    assert_close(actual.right, expected.right);
    assert_close(actual.top, expected.top);
}

fn page_box(left: f32, bottom: f32, right: f32, top: f32) -> PageBox {
    PageBox {
        left,
        bottom,
        right,
        top,
    }
}

#[test]
fn returns_page_count_of_many_page_pdf() {
    let info = info_of("thirty-pages.pdf");

    assert_eq!(info.page_count, 30);
    assert_eq!(info.pages.len(), 30);
}

#[test]
fn returns_document_title() {
    let info = info_of("titled.pdf");

    assert_eq!(info.page_count, 5);
    assert_eq!(info.title.as_deref(), Some("My Document Title"));
}

#[test]
fn title_is_none_when_title_is_empty_string() {
    assert_eq!(info_of("empty-title.pdf").title, None);
}

#[test]
fn reports_rotation_and_displayed_size_of_rotated_pages() {
    let info = info_of("mixed-geometry.pdf");

    let plain = &info.pages[0];
    assert_eq!(plain.rotation, PageRotation::Degrees0);
    assert_close(plain.width_pt, LETTER_WIDTH);
    assert_close(plain.height_pt, LETTER_HEIGHT);

    // /Rotate 90: 화면에 보이는 크기는 가로/세로가 바뀐다. 상자 좌표는 회전 전 그대로다.
    let rotated_90 = &info.pages[1];
    assert_eq!(rotated_90.rotation, PageRotation::Degrees90);
    assert_close(rotated_90.width_pt, LETTER_HEIGHT);
    assert_close(rotated_90.height_pt, LETTER_WIDTH);
    assert_box(
        rotated_90.media_box,
        page_box(0.0, 0.0, LETTER_WIDTH, LETTER_HEIGHT),
    );

    let rotated_270 = &info.pages[2];
    assert_eq!(rotated_270.rotation, PageRotation::Degrees270);
    assert_close(rotated_270.width_pt, A4_HEIGHT);
    assert_close(rotated_270.height_pt, A4_WIDTH);
}

#[test]
fn crop_box_differs_from_media_box_and_sets_displayed_size() {
    let page = &info_of("mixed-geometry.pdf").pages[3];

    assert_box(
        page.media_box,
        page_box(0.0, 0.0, LETTER_WIDTH, LETTER_HEIGHT),
    );
    assert_box(page.crop_box, page_box(50.0, 50.0, 350.0, 450.0));
    assert_close(page.width_pt, 300.0);
    assert_close(page.height_pt, 400.0);
}

#[test]
fn media_box_keeps_non_zero_origin() {
    let page = &info_of("mixed-geometry.pdf").pages[4];

    assert_box(page.media_box, page_box(100.0, 100.0, 400.0, 500.0));
    assert_box(page.crop_box, page.media_box);
    assert_close(page.width_pt, 300.0);
    assert_close(page.height_pt, 400.0);
}

#[test]
fn missing_file_is_not_found() {
    let error = read_pdf_info(engine(), Path::new("/non-existent/file.pdf")).unwrap_err();

    assert!(matches!(error, DocumentError::NotFound { .. }), "{error:?}");
    assert_eq!(error.code(), "NOT_FOUND");
}

#[test]
fn non_pdf_file_is_invalid_pdf() {
    let error = read_pdf_info(engine(), &fixture("not-a-pdf.pdf")).unwrap_err();

    assert!(
        matches!(error, DocumentError::InvalidPdf { .. }),
        "{error:?}"
    );
    assert_eq!(error.code(), "INVALID_PDF");
}

#[test]
fn password_protected_file_is_rejected() {
    let error = read_pdf_info(engine(), &fixture("password-protected.pdf")).unwrap_err();

    assert!(
        matches!(error, DocumentError::PasswordProtected { .. }),
        "{error:?}"
    );
    assert_eq!(error.code(), "PASSWORD_PROTECTED");
}

#[test]
fn file_over_size_limit_is_rejected_before_parsing() {
    // 희소 파일이라 실제 디스크를 거의 쓰지 않는다. 내용은 PDF가 아니므로
    // 크기 검사 없이 열었다면 InvalidPdf가 났을 것이다.
    let path = std::env::temp_dir().join(format!("pdf-core-oversize-{}.pdf", std::process::id()));
    File::create(&path)
        .and_then(|file| file.set_len(MAX_INPUT_FILE_BYTES + 1))
        .expect("create sparse file");

    let result = read_pdf_info(engine(), &path);
    fs::remove_file(&path).expect("remove sparse file");

    match result {
        Err(DocumentError::InputTooLarge {
            size_bytes,
            limit_bytes,
            ..
        }) => {
            assert_eq!(size_bytes, MAX_INPUT_FILE_BYTES + 1);
            assert_eq!(limit_bytes, MAX_INPUT_FILE_BYTES);
        }
        other => panic!("expected InputTooLarge, got {other:?}"),
    }
}
