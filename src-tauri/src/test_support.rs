//! 단위 테스트 공용 도우미: pdfium 엔진, 테스트마다 비우는 폴더, 픽스처 복사.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use pdf_core::PdfEngine;

use crate::access::{AppDirectories, PathAccess};

const LIBRARY_PATH_ENV: &str = "PDFIUM_LIB_PATH";

/// 프로세스당 한 번만 바인딩한다(pdfium 제약).
pub(crate) fn engine() -> &'static PdfEngine {
    static ENGINE: OnceLock<PdfEngine> = OnceLock::new();
    ENGINE.get_or_init(|| {
        assert!(
            std::env::var_os(LIBRARY_PATH_ENV).is_some(),
            "{LIBRARY_PATH_ENV} is required: run `pnpm fetch:pdfium` and export it"
        );
        // 번들 폴더는 없는 경로를 준다: 환경변수 경로로 바인딩돼야 통과한다.
        PdfEngine::bind(Path::new("/nonexistent/pdfium")).expect("bind pdfium")
    })
}

/// 테스트 하나가 쓰는 폴더. 앱 폴더(`app-temp`, `converted`)와 사용자 폴더(`user`)를 나눠 둔다.
/// 테스트가 끝나면(실패해도) 지운다.
pub(crate) struct TestDir {
    root: PathBuf,
}

impl TestDir {
    pub(crate) fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("pdf-studio-{}-{name}", std::process::id()));
        if root.exists() {
            fs::remove_dir_all(&root).expect("clear test dir");
        }
        fs::create_dir_all(root.join("user")).expect("create user dir");
        Self { root }
    }

    /// 앱 폴더가 이 테스트 폴더 안에 있는 허용 경로 목록. 처음에는 아무 경로도 기록돼 있지 않다.
    pub(crate) fn access(&self) -> PathAccess {
        let directories =
            AppDirectories::create(&self.root.join("app-temp"), &self.root.join("converted"))
                .expect("create app directories");
        PathAccess::new(directories)
    }

    /// 사용자 폴더 안 경로
    pub(crate) fn user(&self, name: &str) -> PathBuf {
        self.root.join("user").join(name)
    }

    /// pdf-core 픽스처를 사용자 폴더에 복사한다. 원본 픽스처는 출력에 쓰지 않는다.
    pub(crate) fn copy_fixture(&self, fixture_name: &str, name: &str) -> PathBuf {
        let target = self.user(name);
        fs::copy(fixture(fixture_name), &target).expect("copy fixture");
        target
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        // 정리 실패는 테스트 결과와 무관하다(임시 폴더).
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// 폴더 안 파일 이름(숨김 파일 포함), 정렬
pub(crate) fn entries(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(directory)
        .expect("read dir")
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

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("crates")
        .join("pdf-core")
        .join("tests")
        .join("fixtures")
        .join(name)
}
