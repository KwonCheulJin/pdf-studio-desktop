//! 단위 테스트 공용 도우미: pdfium 엔진, 테스트마다 비우는 폴더, 픽스처 복사, 번역의 가짜 전송·키체인·설정
//! 저장소, 로그 모으기.

use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, Once, OnceLock};

use pdf_core::PdfEngine;
use translate::{ApiKey, HttpResponse, Transport, TransportError};

use crate::access::{AppDirectories, PathAccess};
use crate::error::CommandError;
use crate::secrets::{KeySettings, KeyStore, KeychainError};

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

/// 가짜 전송이 받은 요청
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum FakeCall {
    /// `POST /v1/messages` 본문
    Messages(serde_json::Value),
    /// `GET /v1/models`
    Models,
}

type Respond = dyn Fn(&FakeCall) -> Result<HttpResponse, TransportError> + Send + Sync;

/// 받은 요청을 기록하고 `respond`가 만든 응답을 돌려주는 전송. 실제 API를 부르지 않는다.
pub(crate) struct FakeTransport {
    respond: Box<Respond>,
    calls: Mutex<Vec<FakeCall>>,
}

impl FakeTransport {
    pub(crate) fn new(
        respond: impl Fn(&FakeCall) -> Result<HttpResponse, TransportError> + Send + Sync + 'static,
    ) -> Self {
        Self {
            respond: Box::new(respond),
            calls: Mutex::default(),
        }
    }

    pub(crate) fn calls(&self) -> Vec<FakeCall> {
        self.calls.lock().expect("calls").clone()
    }

    fn answer(&self, call: FakeCall) -> Result<HttpResponse, TransportError> {
        let reply = (self.respond)(&call);
        self.calls.lock().expect("calls").push(call);
        reply
    }
}

impl Transport for FakeTransport {
    fn post_messages(
        &self,
        _key: &ApiKey,
        body: &[u8],
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send {
        let body = serde_json::from_slice(body).expect("request JSON");
        std::future::ready(self.answer(FakeCall::Messages(body)))
    }

    fn get_models(
        &self,
        _key: &ApiKey,
    ) -> impl Future<Output = Result<HttpResponse, TransportError>> + Send {
        std::future::ready(self.answer(FakeCall::Models))
    }
}

/// 상태와 본문으로 만든 응답
pub(crate) fn reply(status: u16, body: &str) -> Result<HttpResponse, TransportError> {
    Ok(HttpResponse {
        status,
        retry_after: None,
        request_id: Some("req_test".to_owned()),
        body: body.as_bytes().to_vec(),
    })
}

/// 메모리 키체인. `failing`이면 모든 동작이 키체인 오류다.
#[derive(Default)]
pub(crate) struct FakeKeyStore {
    key: Mutex<Option<String>>,
    reads: AtomicUsize,
    writes: AtomicUsize,
    failing: bool,
}

impl FakeKeyStore {
    pub(crate) fn failing() -> Self {
        Self {
            failing: true,
            ..Self::default()
        }
    }

    pub(crate) fn with_key(key: &str) -> Self {
        Self {
            key: Mutex::new(Some(key.to_owned())),
            ..Self::default()
        }
    }

    pub(crate) fn stored(&self) -> Option<String> {
        self.key.lock().expect("key").clone()
    }

    pub(crate) fn reads(&self) -> usize {
        self.reads.load(Ordering::Relaxed)
    }

    pub(crate) fn writes(&self) -> usize {
        self.writes.load(Ordering::Relaxed)
    }

    fn available(&self) -> Result<(), KeychainError> {
        if self.failing {
            Err(KeychainError("test keychain unavailable"))
        } else {
            Ok(())
        }
    }
}

impl KeyStore for FakeKeyStore {
    fn read(&self) -> Result<Option<String>, KeychainError> {
        self.reads.fetch_add(1, Ordering::Relaxed);
        self.available()?;
        Ok(self.stored())
    }

    fn write(&self, key: &str) -> Result<(), KeychainError> {
        self.writes.fetch_add(1, Ordering::Relaxed);
        self.available()?;
        *self.key.lock().expect("key") = Some(key.to_owned());
        Ok(())
    }

    fn delete(&self) -> Result<(), KeychainError> {
        self.available()?;
        *self.key.lock().expect("key") = None;
        Ok(())
    }
}

/// 메모리 설정 저장소(키 힌트·전송 확인)
#[derive(Default)]
pub(crate) struct FakeKeySettings {
    hint: Mutex<Option<String>>,
    transfer_confirmed_once: Mutex<Option<bool>>,
}

impl FakeKeySettings {
    /// 앞서 외부 전송 확인을 받은 상태
    pub(crate) fn with_transfer_confirmed() -> Self {
        Self {
            transfer_confirmed_once: Mutex::new(Some(true)),
            ..Self::default()
        }
    }

    pub(crate) fn hint(&self) -> Option<String> {
        self.hint.lock().expect("hint").clone()
    }

    pub(crate) fn transfer_confirmed_once(&self) -> Option<bool> {
        *self.transfer_confirmed_once.lock().expect("transfer")
    }
}

impl KeySettings for FakeKeySettings {
    fn api_key_hint(&self) -> Option<String> {
        self.hint()
    }

    fn set_api_key_hint(&self, hint: Option<&str>) -> Result<(), CommandError> {
        *self.hint.lock().expect("hint") = hint.map(str::to_owned);
        Ok(())
    }

    fn set_transfer_confirmed_once(&self, confirmed: bool) -> Result<(), CommandError> {
        *self.transfer_confirmed_once.lock().expect("transfer") = Some(confirmed);
        Ok(())
    }
}

/// `text`에 비밀(키·문서 글)이 하나도 없다.
pub(crate) fn assert_no_secret(text: &str, secrets: &[&str]) {
    for secret in secrets {
        assert!(!text.contains(secret), "{text:?}에 {secret:?}가 있다");
    }
}

static LOG_LINES: Mutex<Vec<String>> = Mutex::new(Vec::new());
static INIT_LOGGER: Once = Once::new();

/// 프로세스의 모든 로그 줄을 모으는 로거(테스트 바이너리에 하나)
struct CapturingLogger;

impl log::Log for CapturingLogger {
    fn enabled(&self, _metadata: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        LOG_LINES
            .lock()
            .expect("log lines")
            .push(record.args().to_string());
    }

    fn flush(&self) {}
}

/// 모은 로그. 테스트가 병렬로 돌아 다른 테스트의 줄도 섞인다(비밀이 없는지만 본다).
pub(crate) struct CapturedLogs;

impl CapturedLogs {
    pub(crate) fn lines(&self) -> Vec<String> {
        LOG_LINES.lock().expect("log lines").clone()
    }
}

pub(crate) fn captured_logs() -> CapturedLogs {
    INIT_LOGGER.call_once(|| {
        log::set_logger(&CapturingLogger).expect("logger");
        log::set_max_level(log::LevelFilter::Trace);
    });
    CapturedLogs
}
