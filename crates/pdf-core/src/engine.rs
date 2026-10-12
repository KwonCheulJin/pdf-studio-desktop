//! pdfium 동적 라이브러리의 경로를 정하고 프로세스에 바인딩한다.
//! 라이브러리 경로 결정은 이 모듈 한 곳에서만 한다.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use pdfium_render::prelude::{Pdfium, PdfiumError};

/// 개발·테스트에서 번들 경로 대신 쓸 라이브러리 파일 경로
const LIBRARY_PATH_ENV: &str = "PDFIUM_LIB_PATH";

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("failed to bind pdfium library at {path}: {source}")]
    Bind {
        path: PathBuf,
        #[source]
        source: PdfiumError,
    },
}

pub struct PdfEngine {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "owns the pdfium instance for the engine's lifetime"
        )
    )]
    pdfium: Pdfium,
    library_path: PathBuf,
    api_version: String,
}

impl PdfEngine {
    /// `PDFIUM_LIB_PATH`가 있으면 그 파일을, 없으면 `bundled_library_dir` 안의
    /// 플랫폼별 라이브러리(`libpdfium.dylib`/`pdfium.dll`/`libpdfium.so`)를 바인딩한다.
    /// pdfium 바인딩은 프로세스당 한 번만 성공한다.
    pub fn bind(bundled_library_dir: &Path) -> Result<Self, EngineError> {
        let library_path =
            resolve_library_path(std::env::var_os(LIBRARY_PATH_ENV), bundled_library_dir);
        let bindings =
            Pdfium::bind_to_library(&library_path).map_err(|source| EngineError::Bind {
                path: library_path.clone(),
                source,
            })?;
        let api_version = format!("{:?}", bindings.version());
        Ok(Self {
            pdfium: Pdfium::new(bindings),
            library_path,
            api_version,
        })
    }

    pub fn library_path(&self) -> &Path {
        &self.library_path
    }

    /// 바인딩이 따르는 pdfium FPDF API 버전 (예: `V7881`)
    pub fn api_version(&self) -> &str {
        &self.api_version
    }
}

fn resolve_library_path(env_value: Option<OsString>, bundled_library_dir: &Path) -> PathBuf {
    match env_value {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => Pdfium::pdfium_platform_library_name_at_path(bundled_library_dir),
    }
}

#[cfg(test)]
mod tests {
    use pdfium_render::prelude::{
        PdfColor, PdfPageObjectsCommon, PdfPagePaperSize, PdfPoints, PdfRect, PdfRenderConfig,
    };

    use super::*;

    const PAGE_WIDTH_POINTS: f32 = 200.0;
    const PAGE_HEIGHT_POINTS: f32 = 100.0;
    // 1pt = 1px 로 렌더해 페이지 좌표와 비트맵 좌표를 맞춘다 (y축만 뒤집힘).
    const RENDER_WIDTH_PIXELS: i32 = 200;
    const RENDER_HEIGHT_PIXELS: i32 = 100;
    const RGBA_CHANNELS: usize = 4;
    const WHITE_CHANNEL: u8 = 255;
    const DARK_CHANNEL_MAX: u8 = 64;

    // 왼쪽 검은 사각형 (bottom, left, top, right)
    const RECT_BOTTOM: f32 = 10.0;
    const RECT_LEFT: f32 = 10.0;
    const RECT_TOP: f32 = 90.0;
    const RECT_RIGHT: f32 = 90.0;
    // 오른쪽 텍스트
    const TEXT: &str = "PDF";
    const TEXT_X: f32 = 110.0;
    const TEXT_Y: f32 = 35.0;
    const TEXT_SIZE: f32 = 40.0;
    const TEXT_REGION_LEFT_PIXEL: usize = 100;
    // 사각형과 텍스트 사이 빈 칸
    const BLANK_PIXEL: (usize, usize) = (98, 5);

    #[cfg(target_os = "macos")]
    const PLATFORM_LIBRARY_FILE: &str = "libpdfium.dylib";
    #[cfg(target_os = "windows")]
    const PLATFORM_LIBRARY_FILE: &str = "pdfium.dll";
    #[cfg(target_os = "linux")]
    const PLATFORM_LIBRARY_FILE: &str = "libpdfium.so";

    fn missing_dir() -> PathBuf {
        PathBuf::from("/nonexistent/pdfium")
    }

    #[test]
    fn env_path_wins_over_bundled_dir() {
        let resolved =
            resolve_library_path(Some(OsString::from("/opt/libpdfium.dylib")), &missing_dir());

        assert_eq!(resolved, PathBuf::from("/opt/libpdfium.dylib"));
    }

    #[test]
    fn falls_back_to_platform_library_in_bundled_dir() {
        let expected = missing_dir().join(PLATFORM_LIBRARY_FILE);

        assert_eq!(resolve_library_path(None, &missing_dir()), expected);
        assert_eq!(
            resolve_library_path(Some(OsString::new()), &missing_dir()),
            expected
        );
    }

    fn pixel(rgba: &[u8], x: usize, y: usize) -> &[u8] {
        let start = (y * RENDER_WIDTH_PIXELS as usize + x) * RGBA_CHANNELS;
        &rgba[start..start + RGBA_CHANNELS]
    }

    fn is_white(color: &[u8]) -> bool {
        color[..3].iter().all(|channel| *channel == WHITE_CHANNEL)
    }

    fn is_dark(color: &[u8]) -> bool {
        color[..3]
            .iter()
            .all(|channel| *channel <= DARK_CHANNEL_MAX)
    }

    /// `PDFIUM_LIB_PATH`가 없으면 실패한다. 건너뛰면 실제 렌더 검증 없이 통과해 버린다.
    #[test]
    fn renders_rect_and_text_on_new_page() {
        assert!(
            std::env::var_os(LIBRARY_PATH_ENV).is_some(),
            "{LIBRARY_PATH_ENV} is required: run `node scripts/fetch-pdfium.mjs` and export it"
        );
        // 번들 폴더는 없는 경로를 준다: 환경변수 경로로 바인딩돼야 통과한다.
        let engine = PdfEngine::bind(&missing_dir()).expect("bind pdfium");
        let mut document = engine.pdfium.create_new_pdf().expect("new document");
        let font = document.fonts_mut().helvetica();
        let mut page = document
            .pages_mut()
            .create_page_at_end(PdfPagePaperSize::from_points(
                PdfPoints::new(PAGE_WIDTH_POINTS),
                PdfPoints::new(PAGE_HEIGHT_POINTS),
            ))
            .expect("new page");
        page.objects_mut()
            .create_path_object_rect(
                PdfRect::new_from_values(RECT_BOTTOM, RECT_LEFT, RECT_TOP, RECT_RIGHT),
                None,
                None,
                Some(PdfColor::BLACK),
            )
            .expect("rect object");
        page.objects_mut()
            .create_text_object(
                PdfPoints::new(TEXT_X),
                PdfPoints::new(TEXT_Y),
                TEXT,
                font,
                PdfPoints::new(TEXT_SIZE),
            )
            .expect("text object");

        let bitmap = page
            .render_with_config(
                &PdfRenderConfig::new().set_target_size(RENDER_WIDTH_PIXELS, RENDER_HEIGHT_PIXELS),
            )
            .expect("render page");
        let rgba = bitmap.as_rgba_bytes();

        assert_eq!(bitmap.width(), RENDER_WIDTH_PIXELS);
        assert_eq!(bitmap.height(), RENDER_HEIGHT_PIXELS);
        let rect_center = (
            ((RECT_LEFT + RECT_RIGHT) / 2.0) as usize,
            (PAGE_HEIGHT_POINTS - (RECT_BOTTOM + RECT_TOP) / 2.0) as usize,
        );
        assert!(is_dark(pixel(&rgba, rect_center.0, rect_center.1)));
        assert!(is_white(pixel(&rgba, BLANK_PIXEL.0, BLANK_PIXEL.1)));
        let text_has_ink = (0..RENDER_HEIGHT_PIXELS as usize).any(|y| {
            (TEXT_REGION_LEFT_PIXEL..RENDER_WIDTH_PIXELS as usize)
                .any(|x| !is_white(pixel(&rgba, x, y)))
        });
        assert!(text_has_ink, "text region rendered blank");
    }
}
