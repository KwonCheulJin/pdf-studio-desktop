# Tauri·Rust 규칙

언제 읽는가: `src-tauri`나 `crates/`를 고칠 때, Tauri 플러그인·권한·설정을 건드릴 때, pdfium·OCR 런타임을 다룰 때.

## Tauri 규칙

- **설치·생성은 키트로 한다.** Tauri CLI(`tauri init`, `tauri add`, `tauri permission add`, `tauri capability new`, `tauri icon`, `tauri signer generate`)와 `pnpm add`/`cargo add`를 쓰고, 생성물은 최소한으로만 고친다. `Cargo.toml`·`package.json` 의존성, `lib.rs` 플러그인 등록, capability JSON을 손으로 쓰지 않는다.
- **최소 권한:** capability는 `main` 창 하나에만 연결하고 쓰는 권한만 둔다. `fs` 플러그인은 쓰지 않는다. 파일 접근은 검증하는 커스텀 커맨드로만 한다.
- **경로 검증:** 커맨드는 받은 경로를 `canonicalize`한 뒤 확장자 화이트리스트·허용 루트(사용자가 고른 경로, 앱 임시·캐시 디렉터리)·크기 상한을 확인한다.
- **사용자 원본 파일은 절대 수정하지 않는다.** 쓰기는 임시 파일에 쓴 뒤 rename하는 원자적 쓰기로 한다.
- **커맨드는 얇게:** `async fn` + 무거운 작업은 pdfium 전용 작업 스레드(또는 `spawn_blocking`)로 넘긴다. UI 스레드를 막지 않는다.
- **에러:** 커맨드는 `Result<T, AppError>`를 돌려준다. `AppError`는 `thiserror` + `Serialize`로 `{ code, message, path }`를 만든다(`src-tauri/src/error.rs`).
  - `code`는 `enum ErrorCode`(specta `Type`, 직렬화 값 `PATH_NOT_ALLOWED` 등)라 바인딩에 문자열 union `ErrorCode`가 생긴다. TS는 코드 목록을 다시 적지 않고 이 타입을 쓴다(문구 표 `shared/config/error-messages.ts`는 빠짐없이 채워야 타입이 맞는다). pdf-core 에러 → `ErrorCode`는 `error.rs` 한 곳에서 변형마다 `match`로 짝지어, pdf-core에 변형이 늘면 컴파일이 멈춘다.
  - `path`는 실패를 일으킨 입력 파일(pdf-core가 열다 실패한 문서·TIFF)이고 모르면 `null`이다. 출력(저장) 실패와 커맨드 자체의 거부(`PATH_NOT_ALLOWED` 등)는 `null`. 병합 실패의 "이 파일 빼기"가 이 경로로 파일을 찾는다.
  - 화면 문구는 프론트가 `code`로 찾고, `message`는 로그용이다. 프론트 전용 코드(`IPC_FAILED`)는 `shared/platform/platform-error.ts`의 `PLATFORM_ERROR_CODE`에 둔다. 커맨드 안에서 `unwrap`/`expect`/`panic!` 금지
- **IPC 전송:** 진행률 스트림은 `tauri::ipc::Channel`, 바이너리는 `tauri::ipc::Response`. `Vec<u8>`을 그대로 돌려주지 않는다(JSON 숫자 배열이 된다). 진행 이벤트는 1% 단위 이상으로만 보낸다.
- **취소:** 오래 걸리는 작업은 작업 ID와 `Arc<AtomicBool>` 취소 토큰을 갖고, 취소되면 임시 파일을 지운다.
- **상태:** 공유 상태는 `app.manage()` + `State<'_, T>`로만. 전역 `static mut` 금지
- **CSP:** `tauri.conf.json > app.security.csp` 한 곳에서 관리한다(`index.html`에 meta CSP를 두지 않는다). 외부 스크립트를 로드하지 않는다. `withGlobalTauri`를 켜지 않는다. Tauri는 이 CSP를 빌드 자산의 HTML 응답에만 붙이므로 `tauri dev`(Vite 개발 서버)와 브라우저 E2E에는 적용되지 않는다 — CSP를 바꾸면 창 숨김 release 빌드로 확인한다. 바깥 연결은 오류 보고용 Firestore(`connect-src`) 하나뿐이다.
- **경로·플랫폼:** TS는 `@tauri-apps/api/path`, Rust는 `PathBuf`만. 문자열로 `/`·`\`를 다루지 않는다. 단축키는 `isMac ? metaKey : ctrlKey`
- **버전:** `tauri.conf.json`의 `version`은 `../package.json`을 가리킨다(단일 소스). <!-- docs-path-check: ignore -->
- **Windows 앱 매니페스트:** `src-tauri/build.rs`가 Windows MSVC 타깃에서 `src-tauri/windows-app-manifest.xml`(Common Controls v6)을 링커로 모든 링크 대상(앱 exe·테스트 exe)에 넣고 tauri-build 기본 매니페스트는 끈다. 테스트 exe에 매니페스트가 없으면 `TaskDialogIndirect`를 못 찾아 `STATUS_ENTRYPOINT_NOT_FOUND`(0xc0000139)로 뜨지 않는다(tauri-apps/tauri#13419). 매니페스트를 바꿀 때는 이 파일을 고친다
- **pdfium:** 라이브러리 경로 결정은 `pdf-core` 한 곳에서. 개발·테스트는 `PDFIUM_LIB_PATH` 환경변수를 우선한다.
- **ONNX Runtime·OCR 모델:** 경로 결정은 `pdf-core`(`ocr/runtime.rs`) 한 곳에서. 개발·테스트는 `ONNXRUNTIME_LIB_PATH`·`OCR_MODEL_DIR`을 우선한다.

## pdfium 준비와 Rust 테스트

- `pnpm fetch:pdfium`이 버전을 고정한 pdfium을 받아 SHA-256을 검증하고 `src-tauri/pdfium/<target-triple>/`에 둔다(`scripts/fetch-pdfium.mjs`).
- `PDFIUM_LIB_PATH`는 폴더가 아니라 **라이브러리 파일 경로**다(`crates/pdf-core/src/engine.rs`). 비어 있으면 번들 폴더의 플랫폼별 파일(`libpdfium.dylib`/`pdfium.dll`/`libpdfium.so`)을 쓴다.
- macOS arm64 예: `PDFIUM_LIB_PATH=$PWD/src-tauri/pdfium/aarch64-apple-darwin/libpdfium.dylib cargo test -p pdf-core`
- `src-tauri/pdfium/` 안의 파일은 읽지 않는다(컨텍스트 낭비).

## OCR 런타임·모델 준비 (계획서 §6.4)

- `pnpm fetch:ocr`이 버전을 고정한 ONNX Runtime 동적 라이브러리를 `src-tauri/onnxruntime/<target-triple>/`에, PP-OCRv5 검출·한국어 인식 모델과 사전을 `src-tauri/ocr-models/`에 받고 SHA-256을 검증한다(`scripts/fetch-ocr.mjs`, 둘 다 gitignore). `--target <target-triple>`로 다른 플랫폼 것을 받는다.
- 경로 결정은 `crates/pdf-core/src/ocr/runtime.rs` 한 곳에서 한다. `ONNXRUNTIME_LIB_PATH`는 **라이브러리 파일 경로**, `OCR_MODEL_DIR`은 모델 **폴더**이고, 비어 있으면 번들 폴더를 쓴다.
- OCR 테스트(`crates/pdf-core/tests/ocr.rs`)는 두 환경변수가 없으면 건너뛴다. macOS arm64 예: `ONNXRUNTIME_LIB_PATH=$PWD/src-tauri/onnxruntime/aarch64-apple-darwin/libonnxruntime.dylib OCR_MODEL_DIR=$PWD/src-tauri/ocr-models PDFIUM_LIB_PATH=… cargo test -p pdf-core`
- 측정 하네스: 같은 환경변수로 `cargo run --release -p pdf-core --example ocr_spike`. 픽스처는 `python3 crates/pdf-core/tests/fixtures/generate_ocr_fixtures.py`(fontTools·Pillow·`PDFIUM_LIB_PATH` 필요)로 다시 만든다.
- `src-tauri/onnxruntime/`·`src-tauri/ocr-models/` 안의 파일은 읽지 않는다.

## Rust 규칙

- `cargo fmt`, `cargo clippy -D warnings` 통과가 기본이다.
- 라이브러리 에러는 `thiserror`로 정의한 enum. `unwrap`/`expect`는 테스트와 "불가능함을 증명한 곳"에만, 이유를 주석으로 남긴다.
- 매직 값 금지 → `const`와 enum. 상한·가중치(`MAX_INPUT_FILE_BYTES` 등)는 `pdf-core` 상수로 둔다.
- 공개 API(`pub`)는 최소로 하고 나머지는 `pub(crate)`.
- 명명: 함수·변수 `snake_case`, 타입·트레이트 `PascalCase`, 상수 `UPPER_SNAKE_CASE`. 축약 금지는 TS와 같다.
- 의존성은 계획서 §1.2 라이선스 화이트리스트(MIT/BSD/Apache-2.0/ISC/Zlib) 안에서만 고른다. GPL/AGPL 금지
- 의존성(Rust·npm)이나 번들 바이너리를 바꾸면 `pnpm licenses:generate`로 `THIRD_PARTY_NOTICES.md`를 다시 만들고 `pnpm licenses:check`를 통과시킨다. 둘 다 pdfium 원문을 `src-tauri/pdfium/aarch64-apple-darwin/`에서 읽으므로 다른 OS에서는 `node scripts/fetch-pdfium.mjs --target aarch64-apple-darwin`을 먼저 돌린다. 허용 목록 밖이 나오면 계획서 §1.2 예외 표와 `scripts/third-party/policy.mjs`를 근거와 함께 고친다
- `#[allow(...)]` 남용 금지
