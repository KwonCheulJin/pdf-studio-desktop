# Tauri 마이그레이션 + PDF 비교 기능 도입 계획

- 작성일: 2026-10-12 (개정: 처리 계층 Rust 전환안 반영)
- 대상 버전: v1.3.1 (Electron 41 / Forge / Vite 8 / React 19 / FSD)
- 저장 위치: `docs/plans/2026-10-tauri-migration-and-pdf-compare.md`
- 실행 환경: **macOS (Apple Silicon)에서 이어서 진행**하는 것을 전제로 한다. Windows와 Linux는 CI로 검증한다.

---

## 0. 요약

| 항목 | 결정 |
|---|---|
| 런타임 | Electron → **Tauri v2** |
| 처리 계층 | **Rust**(`crates/pdf-core`, pdfium-render 기반)가 병합, 회전 적용, 페이지 정보, TIFF 변환, **비교 엔진**(추출·diff·페이지 정렬·내보내기)을 맡는다. |
| 표시 계층 | **pdf.js(웹뷰)** 가 썸네일, 미리보기, 비교 뷰어 렌더링을 맡는다. Rust가 돌려준 결과(PDF 좌표 박스)를 pdf.js 화면 위에 겹쳐 그린다. |
| 데이터 흐름 | 프론트는 **파일 경로를 넘기고 결과(JSON)만 받는다.** PDF 바이트는 표시용 읽기(`read_pdf`)를 제외하면 IPC를 오가지 않는다. |
| 진행 방식 | **Phase 0(Electron 위에서 가볍게 정리)** → **P1-0 pdfium 스파이크(Mac 우선)** → **Track A(Tauri 셸)** 와 **Track B(Rust 비교 엔진)** 병행 → Phase 3(비교 UI)에서 합류 |
| 핵심 원칙 | 플랫폼 의존 코드는 `shared/platform` 어댑터 한 곳에만 둔다. `pdf-core`는 Tauri에 의존하지 않는 순수 라이브러리로 만들어 `cargo test`로 검증한다. 사용자 원본 파일은 **절대 수정하지 않는다.** |

### 처리 계층을 Rust로 두는 이유
- **글자 단위 박스:** pdfium은 글자마다 위치를 준다. 비교 하이라이트가 pdf.js의 run 단위 근사보다 정확하다.
- **성능과 메모리:** PDF 처리가 웹뷰 밖에서 일어난다. WKWebView 메모리 한계와 "파일 전체를 IPC로 반복 전송"하는 현재 병목이 사라진다.
- **운영 단순성:** 사이드카(별도 프로세스, 포트, Python 런타임)가 없다. 추가로 번들할 것은 pdfium 동적 라이브러리 하나뿐이다.
- **일관성:** 병합, 정보, TIFF, 비교가 같은 PDF 엔진을 쓴다.

### 비용 (감수하는 부분)
- 기존 TS 서비스와 테스트를 Rust로 재작성해야 한다.
- pdfium 바이너리를 플랫폼별로 번들하고 서명해야 한다. **가장 먼저 검증한다(P1-0).**
- 표시(pdf.js)와 처리(pdfium) 엔진이 다르다. 좌표계 일치를 테스트로 보장한다(§6.2).

---

## 1. 전제와 제약

### 1.1 클린룸 원칙 (중요)
- 비교 기능은 **개인 프로젝트로 새로 구현**한다. 업무에서 다뤄 본 유사 시스템의 **코드, 상수, UI 문구, 내부 문서, 엔드포인트, 식별자를 복사하지 않는다.**
- 참고는 공개 문서, 오픈소스, 일반적인 알고리즘 지식(LCS/Myers/Patience diff, LIS 등)으로 한정한다.
- 이 레포는 **공개(MIT)** 이므로 계획서, ADR, 커밋 메시지에도 회사 내부 정보를 남기지 않는다.
- 같은 도메인의 사이드 프로젝트에 관한 고용계약상 조항(IP 귀속, 겸업)은 본인이 한 번 확인해 둔다.

### 1.2 라이선스 화이트리스트
- 허용: MIT, BSD, Apache-2.0, ISC, Zlib, OFL(폰트)
- 금지: **AGPL/GPL 계열**(MuPDF 등)

| 용도 | 후보 | 라이선스 |
|---|---|---|
| PDF 처리(Rust) | `pdfium-render` | MIT / Apache-2.0 |
| PDF 엔진 바이너리 | pdfium (bblanchon/pdfium-binaries 배포본) | BSD-3 / Apache-2.0 |
| 시퀀스 diff | `similar` | Apache-2.0 |
| TIFF 디코드 | `tiff`, `image` | MIT / Apache-2.0 |
| 에러, 직렬화, 타입 생성 | `thiserror`, `serde`, `tauri-specta` | MIT / Apache-2.0 |
| 표시 | `pdfjs-dist` | Apache-2.0 |

### 1.3 레포 작업 규칙 (CLAUDE.md 유지)
- 계획 → 확인 → 실행 → 보고
- YAGNI/KISS, 매직 값 금지(Rust도 `const`/enum으로)
- TDD 대상: `shared/lib`, `**/model`, **`crates/pdf-core` 전체**
- **커밋에 AI co-author 라인을 넣지 않는다.**

---

## 2. 현황 진단 (마이그레이션 입력값)

### 2.1 IPC 인벤토리 → Tauri 매핑

| 현재 채널 | 현재 동작 | Tauri 이후 |
|---|---|---|
| `pdf.merge:start` (+progress, complete) | main 스레드에서 pdf-lib 병합 | **`merge_pdfs(request, channel)`** 커맨드. `request`는 `{ sources: {path, pages: {index, rotation}[]}[], output_path }`. 진행률은 `tauri::ipc::Channel`(페이지 단위). `complete` 이벤트는 제거한다. |
| `pdf.edit:apply`, `pdf.page:rotate` | **원본 파일을 덮어씀** | **제거.** 회전은 스토어 상태로만 들고 있다가 병합 요청에 담는다(P0-3). |
| `file.convert.tiff` | sharp → PNG → pdf-lib | **`convert_tiff(path) -> temp_pdf_path`**(`tiff`/`image` + pdfium). 결과는 앱 캐시 디렉터리에 고유 이름으로 저장한다. |
| `file.meta.get-pdf-info` | pdf-lib 전체 파싱 | **`get_pdf_info(path)`**(pdfium: 페이지 수, 페이지별 크기·회전) |
| `file.read:pdf` | 파일 전체를 구조화 복제로 전달 | **`read_pdf(path) -> tauri::ipc::Response`**(raw bytes). **표시용(pdf.js)으로만 사용한다.** |
| `dialog.show-open/save` | Electron dialog | `@tauri-apps/plugin-dialog` |
| `file.save.copy` | `fse.copy` | 필요 없음. 병합 결과를 사용자가 고른 경로로 바로 쓰거나, 미리보기용 임시 파일을 `copy_file`(검증 포함)로 복사한다. |
| `file.delete` | **임의 경로 `rm -rf`** | **제거.** 앱 임시 디렉터리 정리용 `cleanup_temp`만 둔다. |
| `app.log` | console | `@tauri-apps/plugin-log` |
| `theme:changed` | nativeTheme | `matchMedia` + 수동 설정 영속화(`plugin-store`) |
| `getFilePath(File)` | `webUtils` | **`getCurrentWebview().onDragDropEvent`**(paths, position) |
| (신규) 비교 | — | **`compare_pdfs(request, channel) -> CompareResult`**, `cancel_job(job_id)`, `export_compare_report(...)` |

### 2.2 버그와 부채: 이관하면서 고칠 것

| # | 문제 | 조치 위치 |
|---|---|---|
| B1 | 회전이 **원본 PDF를 즉시 덮어쓴다**. 배치 회전은 `PDFDocument.create()` + `copyPages`로 북마크, 폼, 메타데이터를 잃는다. 연타하면 경쟁 상태가 생긴다. | P0-3 |
| B2 | 빈 화면에 TIFF를 드롭하면 변환을 건너뛰어 병합이 실패한다(`use-dropped-files.ts`). | P0-6 |
| B3 | TIFF 변환 결과를 `~/Documents/PDF Studio/<basename>.pdf`에 저장해 이름이 충돌하고 정리되지 않는다. | P1-2 (캐시 디렉터리 + 고유 이름) |
| B4 | 병합 임시 파일이 Documents에 남고, 임의 경로를 삭제하는 API로 지운다. | P1-3 |
| B5 | 다운로드 기본 경로를 `lastIndexOf("/")`로 계산해 Windows에서 깨진다. | P0-6 (`@tauri-apps/api/path` 사용) |
| B6 | `try { return service.x() }`에 `await`가 없어 에러 로깅이 동작하지 않는다(3곳). | Rust 전환 시 자연 해소 |
| B7 | 테마 토글이 `removeAllListeners`로 전역 리스너까지 제거한다. 수동 설정이 영속되지 않는다. | P1-5 |
| B8 | 드롭한 파일의 `pageRotations`가 전달되지 않는다. | P0-6 |
| S1 | `sandbox:false`, 입력 검증이 없다, 외부 스크립트(animatedicons)를 로드한다. | P1-5 |
| P1 | 썸네일을 요청할 때마다 파일 전체를 IPC로 받아 재파싱한다. PNG data URL이 스토어에 무한히 쌓인다. | P0-4 |
| P2 | 모든 PDF 연산이 main 스레드에서 동기로 돈다. | Rust 전환(`spawn_blocking` + 작업 큐) |
| D1 | `use-add-files` ≈ `load-dropped-files`, 세그먼트 그룹핑 중복, 캔버스 렌더 중복, `ValueOf`/`isTiffFile` 중복 | P0-6 |
| D2 | 미사용 코드: `@dnd-kit`(P0-5에서 사용 예정), `zod`, `electron-squirrel-startup`, edit delete/reorder, `merge-state.ts` 등 | P0-6 / P1-6 |
| F1 | `shared/hooks`, `shared/model`에 도메인 로직이 있다(FSD 위반). renderer가 `@/main/types`를 import한다. | P0-2 |
| T1 | Node 버전 불일치(.tool-versions 25 / CI 22 / README 18). 버전이 이중 bump된다. README와 docs가 낡았다. `.claude` 훅이 Mac 절대경로다. | P0-1, P4 |

---

## 3. 전체 로드맵

```
Phase 0  Electron 위에서 가벼운 정리 (어댑터·계약·비파괴 회전·pdf.js 캐시·DnD)
   │
P1-0     pdfium 스파이크 — Mac에서 로드 → 렌더 → .app 번들/서명 검증  ★ 게이트
   │
   ├── Track A: Phase 1  Tauri 셸 + pdf-core 기본 처리(병합/정보/TIFF) → 기능 동등성
   │
   └── Track B: Phase 2  pdf-core/compare (cargo만으로 개발·테스트)
                       │
Phase 3  비교 UI (A + B 합류)
Phase 4  빌드, 배포, 서명 (CI 매트릭스)
Phase 5  고도화
```

- Phase 0에서는 **처리 로직을 TS로 다시 다듬지 않는다**(곧 Rust로 대체되므로 YAGNI). 계약과 경계만 정리한다.
- Track B는 Tauri 없이 `cargo test`만으로 진행할 수 있다. P1-0만 끝나면 Track A와 독립적이다.

규모 표기: S = 반나절~1일, M = 2~3일, L = 4일 이상

---

## 4. Phase 0: Electron 상태에서 가벼운 정리

### P0-1 개발 환경 정합 (S)
- Node를 **Active LTS 하나로** 맞춘다. `.tool-versions`, CI, README를 동일하게 하고, `package.json`에 `engines`와 `packageManager: "pnpm@x.y.z"`(corepack)를 둔다.
- `.gitattributes`에 `* text=auto eol=lf`를 둔다. Windows와 Mac을 오가므로 줄바꿈 diff를 막는다(현재 Windows 클론에서 157개 파일이 줄바꿈 차이로 수정 표시됨).
- `tsconfig`에 `forceConsistentCasingInFileNames: true`를 둔다.
- `.claude/settings.json` 훅의 절대경로를 `cd "$CLAUDE_PROJECT_DIR"`로 바꾼다.
- `.npmrc`와 `package.json`의 `onlyBuiltDependencies`를 정리한다.
- **완료 기준:** Mac과 Windows에서 클론 직후 `pnpm i && pnpm validate`가 통과한다.

### P0-2 플랫폼 어댑터 도입과 계약 분리 (M)
- `src/shared/contracts/`(프로세스 중립)로 DTO와 상수를 옮긴다. renderer는 `@/main/*`을 import하지 않는다. Phase 1 이후에는 이 타입을 `tauri-specta` 생성물로 대체한다.
- `src/renderer/shared/platform/`: **경로 기반의 굵은 단위(coarse-grained) API**로 정의한다. 처리 주체가 Electron main이든 Rust든 같은 시그니처를 유지하기 위해서다.
  ```ts
  export interface DesktopPlatform {
    pickFiles(options: PickFilesOptions): Promise<string[]>
    pickSavePath(options: PickSaveOptions): Promise<string | null>
    readPdfForDisplay(path: string): Promise<Uint8Array>           // pdf.js 전용
    getPdfInfo(path: string): Promise<PdfInfo>
    convertTiff(path: string): Promise<string>                      // 임시 PDF 경로
    mergePdfs(request: MergeRequest, onProgress: ProgressFn): Promise<MergeResult>
    copyFile(request: CopyFileRequest): Promise<void>
    cleanupTemp(): Promise<void>
    onFileDrop(handler: FileDropHandler): Promise<Unsubscribe>      // paths + client 좌표
    log(level: LogLevel, message: string): void
    getAppVersion(): Promise<string>
    // Phase 3: comparePdfs, cancelJob, exportCompareReport
  }
  ```
  - 구현체는 `electron-platform.ts`(Phase 0), `tauri-platform.ts`(Phase 1), `mock-platform.ts`(테스트, Playwright) 세 개다.
  - 앱 부팅 시 하나를 주입한다(`app/providers`).
- FSD를 정리한다. `shared/hooks`의 업무 훅을 `features/*/model`로, `shared/model/merge-store`는 `entities/merge-plan` + `features/pdf-merge/model`로 나눈다.
- **완료 기준:** `window.api` 참조가 `electron-platform.ts` 한 곳에만 남는다.

### P0-3 비파괴 회전 (S, B1)
- 회전은 `PdfPage.rotation`(스토어)으로만 관리하고, `MergeRequest.sources[].pages[].rotation`에 담아 병합 시 적용한다.
- `pdf.edit:apply`와 `pdf.page:rotate`를 삭제한다. Electron main의 병합 서비스는 rotation 필드만 반영하도록 최소 수정한다(곧 Rust로 대체).
- **완료 기준:** 어떤 조작을 해도 원본 파일의 mtime과 해시가 변하지 않는다(테스트로 보장).

### P0-4 pdf.js 로더 단일화와 렌더 캐시 (M, P1)
- `shared/lib/pdfjs/`
  - Worker 설정
  - `cMapUrl` + `cMapPacked`, `standardFontDataUrl`: `pdfjs-dist/cmaps`와 `standard_fonts`를 정적 자산으로 복사한다. **한글과 CID 폰트를 제대로 표시하는 데 필수다.**
  - pdf.js 5.x에서 요구하는 wasm 자산 경로가 있으면 함께 설정한다.
- `PdfDocumentCache`: 파일당 `PDFDocumentProxy` 하나를 두고 refcount와 `destroy()`로 관리한다.
- 썸네일과 미리보기는 data URL 대신 **`ImageBitmap` 또는 `blob:` URL + LRU(개수/메모리 상한)** 로 바꾼다. 화면에 보이는 페이지만 렌더한다(virtuoso).
- 캔버스 렌더 코드 3곳을 `renderPageToBitmap({ document, pageIndex, scale })` 하나로 통합한다. 비교 뷰어도 이 함수를 쓴다.
- **완료 기준:** 같은 파일을 여러 번 읽지 않는다. 파일을 제거하면 메모리가 회수된다.

### P0-5 내부 드래그 정렬을 `@dnd-kit`으로 전환 (M)
- **이유:** Tauri v2에서 OS 파일 드롭 경로를 받으려면 `dragDropEnabled: true`(기본값)여야 한다. 이 경우 **Windows WebView2에서 HTML5 DnD가 동작하지 않는다.** 현재 페이지·파일 재정렬은 HTML5 DnD 기반이므로 pointer 기반 dnd-kit(이미 설치됨)으로 바꾼다.
- 외부 파일 드롭은 `platform.onFileDrop`으로 분리한다. 드롭 위치에 삽입하는 로직(`calculateDropIndex`)은 **좌표 기반 순수 함수**로 만든다.
- **완료 기준:** HTML5 DnD 이벤트(`onDragStart` 등) 의존이 0이다.

### P0-6 버그 수정과 정리 (S)
- B2, B5, B8, D1, D2를 처리한다.
- `use-add-files`와 `load-dropped-files`를 `ingestPaths({ paths, insertAt })` 하나로 통합한다.

---

## 5. Phase 1 (Track A): Tauri v2 전환 + 기본 처리 Rust화

### P1-0 pdfium 스파이크 ★ (M, **Mac에서 가장 먼저**)
가장 막히기 쉬운 지점이므로 본 작업 전에 끝까지 검증한다.
1. `scripts/fetch-pdfium.mjs`: bblanchon/pdfium-binaries에서 **버전을 고정**해 타깃별 바이너리를 내려받는다. SHA-256으로 검증하고 `src-tauri/pdfium/<target-triple>/`에 둔다(gitignore).
   - macOS: `libpdfium.dylib`(arm64. universal이 필요하면 x64와 `lipo`로 합친다)
   - Windows: `pdfium.dll` / Linux: `libpdfium.so`
2. 번들 설정
   - macOS: `bundle.macOS.frameworks`에 dylib를 넣는다(`Contents/Frameworks/`).
   - Windows/Linux: `bundle.resources`
3. 런타임 로드: `Pdfium::bind_to_library(<경로>)`. 경로는 플랫폼별로 결정한다(macOS `…/Contents/Frameworks/libpdfium.dylib`, 그 외 `resource_dir()`). 테스트와 개발에서는 환경변수 `PDFIUM_LIB_PATH`를 우선한다.
4. 검증: 빈 Tauri 앱에서 PDF 1장 렌더 → `pnpm tauri build` → **ad-hoc 서명된 `.app`에서 실행** → `codesign --verify --deep --strict`가 통과한다.
- `thread_safe` 기능을 켠다. pdfium은 스레드 안전하지 않으므로 모든 호출을 **전용 작업 스레드 하나(큐)** 로 직렬화한다.
- 정적 링크(`static` 기능)는 pdfium을 직접 빌드해야 하므로 이번 범위에서 제외한다.
- **완료 기준:** Mac `.app`과 CI의 Windows 빌드에서 pdfium이 로드되고 렌더된다.

### P1-1 스캐폴드 (S)
- `pnpm tauri init`으로 `src-tauri/`를 만들고, **Cargo workspace**로 구성한다.
  ```
  Cargo.toml              # [workspace] members = ["src-tauri", "crates/pdf-core"]
  crates/pdf-core/        # Tauri 의존 없음. pdfium 래퍼 + 처리 로직 + 비교 엔진
  src-tauri/              # 커맨드, 작업 큐, 경로 검증, 플러그인
  ```
- **번들 식별자를 확정한다.** 예: `io.github.kwoncheuljin.pdfstudio`. 앱 데이터 경로와 macOS 번들 ID가 되므로 **이후 변경 비용이 크다.**
- Vite 설정 3개를 `vite.config.ts` 하나로 합친다.
  - `server.port` 고정 + `strictPort`, `clearScreen:false`, `envPrefix: ['VITE_','TAURI_ENV_']`
  - `build.target`: 최소 macOS 버전의 Safari와 WebView2 기준으로 정한다. 템플릿 기본값 `safari13`은 pdf.js 5에 맞지 않으므로 상향한다.
- `tauri.conf.json`
  - `version: "../package.json"` (**버전 단일 소스**)
  - `bundle.macOS.minimumSystemVersion`을 명시한다(pdf.js 5 요구사항을 실기기에서 확인한 뒤 결정).

### P1-2 `pdf-core` 기본 처리 (L)
- 모듈
  - `document.rs`: pdfium 바인딩 초기화, 문서 열기, 에러 타입(`thiserror`)
  - `info.rs`: 페이지 수, 페이지별 크기(MediaBox/CropBox), 회전
  - `merge.rs`: 새 문서에 소스 페이지를 import하고 페이지별 회전을 적용해 저장한다. **원자적 쓰기**(임시 파일에 쓴 뒤 rename)를 하고, Windows 공유 위반 시 재시도한다(기존 retry-write 로직 이식, `cfg(windows)`).
  - `tiff.rs`: `tiff` 크레이트로 멀티페이지를 디코드하고, 페이지마다 이미지 객체로 PDF 페이지를 만든다. 결과는 앱 캐시 디렉터리에 고유 이름으로 저장한다(B3).
- **CCITT G4(스캔 문서에 흔한 압축)** 를 `tiff` 크레이트가 디코드하지 못하면, 압축을 풀지 않고 원본 스트립 데이터를 `CCITTFaxDecode` 이미지로 PDF에 그대로 넣는 경로를 둔다. 스파이크 때 확인한다.
- 테스트: 기존 `src/main/services/__tests__`의 케이스(병합 6, 편집 11 중 해당분, TIFF 4, 메타데이터 5)를 Rust로 이식한다. **회전**, **멀티페이지 TIFF**, **CCITT G4**, **북마크가 있는 원본 병합** 케이스를 추가한다.
- **완료 기준:** `cargo test -p pdf-core`가 3개 OS CI에서 통과한다.

### P1-3 Tauri 커맨드와 작업 큐 (M, B4/S1)
| 커맨드 | 시그니처 | 비고 |
|---|---|---|
| `read_pdf` | `(path) -> tauri::ipc::Response` | **pdf.js 표시용.** 확장자 화이트리스트, `canonicalize`, 크기 상한. `Vec<u8>`을 그대로 반환하면 JSON 숫자 배열이 되어 매우 느리다. |
| `get_pdf_info` | `(path) -> PdfInfo` | |
| `convert_tiff` | `(path) -> String` | 임시 PDF 경로 |
| `merge_pdfs` | `(request, Channel<Progress>) -> MergeResult` | 출력 경로는 사용자가 저장 다이얼로그에서 고른 경로이거나 앱 임시 경로만 허용 |
| `copy_file` | `(source, destination)` | 소스는 앱 임시 디렉터리 하위만 허용 |
| `cleanup_temp` | `()` | 시작과 종료 시에도 자동 실행 |
| `cancel_job` | `(job_id)` | Phase 2부터 사용 |
- 모든 처리 커맨드는 `async` + **pdfium 전용 작업 스레드**로 위임한다. UI 스레드는 막히지 않는다.
- 진행률은 `tauri::ipc::Channel`로 보내고, 취소는 작업별 `Arc<AtomicBool>` 토큰으로 처리한다.
- 에러는 `{ code, message }` 형태로 직렬화해 프론트에서 토스트로 구분 처리한다.
- 타입은 `tauri-specta`로 TS 바인딩을 생성해 `src/shared/contracts`를 대체한다.
- 사용할 플러그인: `dialog`, `log`, `store`, `opener`, `window-state`. **`fs` 플러그인은 쓰지 않는다**(커스텀 커맨드에서 경로를 검증해 권한 표면을 최소화).

### P1-4 Tauri 어댑터와 드롭 (M)
- `tauri-platform.ts`에서 `DesktopPlatform`을 구현한다.
- 드롭 처리
  - `onDragDropEvent`의 `position`은 **PhysicalPosition**이므로 `/ window.devicePixelRatio`로 CSS 좌표로 바꾼다.
  - `document.elementFromPoint`로 드롭 대상(슬롯, 그리드 위치)을 판정한다.
  - enter/over/leave로 드롭 오버레이 UI를 갱신한다.
- `@tauri-apps/api/mocks`의 `mockIPC`로 어댑터 단위 테스트를 작성한다.

### P1-5 보안, 테마, 창 (S, B7/S1)
- CSP를 `tauri.conf.json > app.security.csp`로 옮긴다.
  - animatedicons를 제거한다.
  - `worker-src 'self' blob:`, `img-src 'self' data: blob:`
  - error-snapshot용 Firebase `connect-src`는 유지한다.
- 앱 origin이 바뀌므로(`tauri://localhost`, `http://tauri.localhost`) Firebase API 키에 HTTP 리퍼러 제한이 있으면 허용 목록을 갱신한다.
- capabilities는 `main` 창 하나에만 연결하고, 필요한 권한만 둔다.
- 테마: `matchMedia` 구독 + 수동 설정(`system|light|dark`)을 `plugin-store`로 영속화한다.
- 메뉴: macOS 기본 메뉴(편집 단축키 포함)를 확인한다. 이후 `파일 > 열기 (⌘O)` 등을 추가한다.
- 창 크기와 위치는 `plugin-window-state`로 기억한다.

### P1-6 Electron 제거와 문서 갱신 (S)
- 삭제: `forge.config.mts`, `src/main`, `src/preload`, electron 관련 deps, **`pdf-lib`, `sharp`, `fs-extra`**, `icon.*`(→ `src-tauri/icons`)
- 갱신: `README`, `docs/01~05`(IPC 스펙 → Tauri 커맨드 스펙), `.claude/agents/ipc-architect.md` → Tauri 커맨드/capability/pdf-core 기준, `implement`/`check` 스킬의 검증 명령(`cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` 추가)

### P1-7 아이콘, 로컬 빌드 (S)
- 1024px PNG 원본을 만들고(`icon.icns`에서 추출) `pnpm tauri icon`을 실행한다.
- Mac에서 `pnpm tauri build`로 `.app`/`.dmg`를 만든다. Windows는 CI로 확인한다.

### Phase 1 완료 기준 (기능 동등성 체크리스트)
- [ ] 다이얼로그 및 드롭으로 PDF/TIFF 추가, 위치 지정 삽입
- [ ] 썸네일, 펼치기, 파일 간 페이지 재정렬, 소프트 삭제/복원
- [ ] 회전(비파괴), 전체/선택 병합(진행률·UI 비차단), 미리보기, 저장, 임시파일 정리
- [ ] 테마(시스템 추종 + 수동), 버전 표시, 에러 스냅샷 전송
- [ ] macOS, Windows, Linux에서 실행 (Windows/Linux는 CI 아티팩트로 확인)

---

## 6. Phase 2 (Track B): Rust 비교 엔진 (`crates/pdf-core/src/compare/`)

> Tauri와 무관하게 `cargo test`로 개발한다. P1-0(pdfium 로드)만 끝나면 시작할 수 있다.

### 6.0 엔진 선택 기록

| | A. TS + pdf.js | **B. Rust + pdfium (채택)** | C. 개인 Python 사이드카 | D. 사내 엔진 재사용 |
|---|---|---|---|---|
| 박스 정밀도 | run 단위, 글자는 근사 | **글자 단위** | 글자 단위 | 글자 단위, 성숙 |
| 배포 부담 | 없음 | pdfium 라이브러리 1개 번들·서명 | 플랫폼별 PyInstaller, 약 50MB, 기동 1~3초, 프로세스 관리 | C와 같음 |
| 공개 레포 | 가능 | 가능 | 가능 | **불가** |

- B를 채택한다. 사이드카 수준의 정밀도를 별도 프로세스 없이 얻는다.
- D는 회사 코드라 이번 범위에서 제외한다. 결과 계약(§6.1)을 안정적으로 유지해 두면, 승인이 나는 경우 비공개 빌드에서 엔진만 교체하는 것도 가능하다.

### 6.1 결과 모델 (P2-1, S): ADR로 고정
```rust
// serde + specta 로 TS 타입 자동 생성
pub enum Side { Before, After }
pub struct TextBox { pub page: u32, pub x: f32, pub y: f32, pub w: f32, pub h: f32 } // PDF pt, 좌하단 원점, /Rotate 적용 전
pub enum ChangeKind { Insert, Delete, Replace }
pub struct ChangeSide { pub text: String, pub boxes: Vec<TextBox> }
pub struct Change {
    pub id: String,                  // 안정 키: hash(정규화 텍스트 + 문맥) — 재실행해도 동일
    pub kind: ChangeKind,
    pub before: Option<ChangeSide>,
    pub after: Option<ChangeSide>,
    pub page_pair: (Option<u32>, Option<u32>),
}
pub struct CompareResult {
    pub changes: Vec<Change>,
    pub page_pairs: Vec<(Option<u32>, Option<u32>)>, // 삽입/삭제 페이지는 None
    pub page_sizes: PageSizes,                       // 좌우 각 페이지의 크기·회전·CropBox 원점
    pub notices: Vec<Notice>,                        // LowTextConfidence, NoTextLayer, Truncated
}
```
좌표는 PDF 원본 좌표로 저장한다. 화면 변환은 pdf.js `viewport.convertToViewportRectangle`이 담당한다. 회전이나 확대가 바뀌어도 결과를 다시 계산할 필요가 없다.

### 6.2 파이프라인
1. **추출 (P2-2, M)**
   - pdfium 페이지 텍스트에서 글자별 `{ char, bounds, font_size, font_name }`을 얻는다. 박스는 tight bounds를 기본으로 한다.
   - **좌표계 일치 검증(중요):** pdfium 좌표와 pdf.js 화면 좌표가 CropBox/MediaBox 원점 오프셋, `/Rotate` 페이지, `UserUnit`에서 일치하는지 golden 테스트로 고정한다. 필요하면 `page_sizes`에 원점 오프셋을 포함해 프론트에서 보정한다.
   - 텍스트가 없는 페이지(스캔본)는 `NoTextLayer`로 알린다. OCR은 범위 밖이다.
2. **정규화와 토큰화 (P2-3, M)**
   - Unicode 정규화(NFC/NFKC 옵션, `unicode-normalization`), 공백과 줄바꿈 정리, 하이픈 줄바꿈 결합, 대소문자 무시 옵션
   - 토큰 단위는 **단어**(공백 기준, 한글 포함)이고, 각 토큰은 구성 글자의 박스 목록을 가진다. replace 구간 내부는 **글자 단위 2차 diff**로 정밀 하이라이트한다.
   - 대체 문자(U+FFFD)나 PUA 비율이 높으면 `LowTextConfidence`로 표시한다(ToUnicode가 깨진 PDF).
3. **정렬과 diff (P2-4, L)**
   - 문서 전체 토큰열끼리 비교해 페이지 경계를 넘는 이동이나 밀림에 대응한다.
   - 대용량 대응: ① 단락/줄 해시로 **유일 매칭 앵커**를 잡고(Patience) ② 앵커 사이 구간만 Myers diff를 돌린다(`similar`의 `Algorithm::Patience`/`Myers`, 시간 제한(deadline) 설정).
   - 인접한 delete와 insert는 replace로 묶는다. 같은 줄에서 인접한 박스는 병합한다.
4. **페이지 짝짓기 (P2-5, M)**
   - 페이지 쌍별 매칭 토큰 수 행렬을 만들고, 단조 증가 최대 가중 경로(LIS 계열)로 짝을 짓는다. 남는 페이지는 삽입 또는 삭제 페이지가 된다.
5. **옵션 (P2-6, S)**
   - 페이지 범위(`"1,3-5"`), 머리글/바닥글 제외(상단/하단 N pt 밴드), 대소문자 무시. 자동 머리글 감지는 Phase 5로 미룬다.
6. **작업 실행기 (P2-7, S)**
   - 진행 단계(추출 n/N → 정렬 → diff)를 `Channel`로 보고하고, 취소 토큰을 단계마다 확인한다.
   - **추출 결과 캐시:** (파일 경로, 크기, mtime) 또는 해시를 키로 메모리 LRU에 둔다. 옵션만 바꿔 다시 실행할 때 추출을 건너뛴다.
7. **리포트 내보내기 (P2-8, M)**
   - pdfium으로 새 문서를 만들고 좌우 페이지를 한 장에 배치한 뒤, 변경 영역에 하이라이트 주석이나 반투명 사각형을 넣는다. 저장은 원자적 쓰기로 한다.

### 6.3 테스트 전략
- **픽스처:** 작은 PDF를 레포에 커밋하고(`crates/pdf-core/tests/fixtures/`), 생성 스크립트도 함께 둔다. 원본과 변형(단어 삽입/삭제/치환, 문단 이동, 페이지 삽입/삭제, 회전 페이지, CropBox 오프셋)을 만들고 기대 결과 JSON(golden)과 비교한다.
- **한글:** OFL 폰트(예: Noto Sans KR 서브셋)를 임베드한 픽스처로 CID 폰트 경로를 검증한다.
- **좌표 일치:** 같은 픽스처를 pdf.js(vitest)에서 렌더한 박스와 pdfium 박스를 비교하는 교차 테스트를 둔다.
- **성능 회귀:** 500페이지 합성 문서의 처리 시간과 메모리를 기록한다(`cargo test --release`, CI에서는 완화된 기준).

---

## 7. Phase 3: 비교 UI (Track A + B 합류)

### P3-1 앱 모드 (S)
- `app` 레이어에 `mode: 'merge' | 'compare'`(store)를 두고 상단 탭이나 내비로 전환한다.
- 라우터는 도입하지 않는다(YAGNI). 화면이 4개 이상으로 늘어나면 재검토한다.

### FSD 배치
```
entities/comparison        결과 타입(specta 생성물 재수출), 선택자(현재 change, 필터링)
features/pdf-compare
  ├─ model/                compare-session store(files, options, status, jobId, result, activeChangeId)
  └─ ui/                   file-slots, options-panel, change-list
widgets/compare-viewer     좌우 pdf.js 뷰어 + SVG 오버레이 + 동기 스크롤
pages/compare              조립
```

### 화면 구성
- **P3-2 파일 슬롯 (S):** 이전과 이후 슬롯, 다이얼로그 또는 드롭(`platform.onFileDrop` + 좌표 판정), 좌우 교체 버튼
- **P3-3 뷰어 (L)**
  - 좌우 virtuoso 리스트, 보이는 페이지만 pdf.js로 렌더(P0-4 캐시 재사용), SVG 오버레이 하이라이트(Rust가 준 PDF 좌표 → viewport 변환)
  - `page_pairs` 기반 **동기 스크롤**: 짝 페이지 기준으로 정렬하고, 삽입/삭제 페이지는 반대편에 자리표시자를 둔다.
- **P3-4 변경 목록 (M):** 종류별 필터, 텍스트 미리보기(글자 단위 강조), 클릭하면 양쪽 스크롤과 포커스, 키보드 탐색(다음/이전, Mac은 ⌘ 기준)
- **P3-5 옵션과 실행 (S):** 페이지 범위, 머리글/바닥글 제외, 대소문자 무시. 진행률 표시, 취소 버튼, 옵션 변경 시 재실행(추출 캐시 활용)
- **P3-6 내보내기 (S):** 저장 다이얼로그 → `export_compare_report`

### 완료 기준
- 100페이지 문서 쌍을 Mac(M 시리즈)에서 5초 안에 비교한다(목표치이며 Phase 2 측정 후 확정).
- 비교 중에도 스크롤과 취소가 가능하다.

---

## 8. Phase 4: 빌드, 배포, 서명

### P4-1 CI
- `tauri-apps/tauri-action` 매트릭스
  - `macos-latest`(aarch64-apple-darwin, 필요하면 `universal-apple-darwin`)
  - `windows-latest`
  - `ubuntu-22.04`(`libwebkit2gtk-4.1-dev` 등)
- 각 잡에서 `scripts/fetch-pdfium.mjs`를 실행한다(버전 고정, 캐시).
- `Swatinem/rust-cache`, pnpm 캐시, `NODE_AUTH_TOKEN`(GitHub Packages)을 유지한다.
- PR에서는 `pnpm validate` + `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test`를 실행한다.

### P4-2 릴리스 흐름 정리 (T1)
- **`auto-version.yml`을 제거한다.** `pnpm release:*` → 태그 푸시 → `release.yml`이 tauri-action으로 Draft Release를 만들고 아티팩트를 업로드한다.

### P4-3 서명
| 옵션 | 비용 | 사용자 경험 |
|---|---|---|
| macOS ad-hoc (`signingIdentity: "-"`) | 무료 | 다운로드한 앱은 Gatekeeper 경고가 뜬다(우클릭 → 열기 또는 `xattr -dr com.apple.quarantine`). **개인용 1차 권장.** |
| Developer ID + 공증 | Apple Developer 연 $99 | 경고가 없다. tauri-action에 `APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` 시크릿을 넣는다. |
| Windows | 미서명 | SmartScreen 경고가 뜬다. 개인용으로는 허용한다. |
- 어느 옵션이든 **`Frameworks/libpdfium.dylib`도 앱과 같은 identity로 서명**돼야 한다. `codesign --verify --deep --strict`로 확인한다.

### P4-4 (선택) 자동 업데이트
- `plugin-updater` + minisign 키(`TAURI_SIGNING_PRIVATE_KEY`)를 쓴다. tauri-action이 GitHub Releases에 `latest.json`을 생성한다.

---

## 9. Phase 5: 고도화 후보 (필요할 때)
- **그래픽 diff 레이어:** pdfium으로 짝 페이지를 같은 스케일로 렌더해 픽셀 비교 후 연결 요소로 영역 박스를 만든다. 페이지 크기가 같을 때만 수행한다. 또는 페이지 객체(path/image)를 직접 비교한다.
- **이동 감지:** 같은 텍스트의 delete/insert 쌍을 `Moved`로 접는다.
- **머리글/바닥글 자동 감지:** 여러 페이지에서 같은 위치에 반복되는 텍스트를 찾는다.
- **폴더 일괄 비교:** 파일명 유사도로 짝을 짓고, 사용자가 수정한 뒤 순차 실행해 리포트 ZIP을 만든다.
- **비교 이력 영속화:** `plugin-store` 또는 `plugin-sql`(SQLite)
- **미니맵**, 변경 밀도 표시
- **병렬화:** pdfium 직렬화가 병목이면 추출만 별도 프로세스로 나누는 방안을 검토한다(측정 후).

---

## 10. macOS에서 이어서 작업하기

### 10.1 최초 셋업
```bash
xcode-select --install                       # Xcode CLT (clang, codesign, lipo)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin   # universal 빌드 시
# Node: .tool-versions 기준 (asdf/mise)
corepack enable                              # packageManager 필드의 pnpm 사용
# GitHub Packages 토큰(read:packages) — @kwoncheulJin/error-snapshot
echo "//npm.pkg.github.com/:_authToken=<TOKEN>" >> ~/.npmrc
git clone https://github.com/KwonCheulJin/pdf-studio-desktop && cd pdf-studio-desktop
pnpm i && pnpm validate
node scripts/fetch-pdfium.mjs            # P1-0 이후
export PDFIUM_LIB_PATH=$PWD/src-tauri/pdfium/aarch64-apple-darwin/libpdfium.dylib
cargo test -p pdf-core                   # P1-2 이후
pnpm tauri dev                           # P1-1 이후
```

### 10.2 크로스플랫폼 주의사항
- **경로:** TS에서는 문자열로 `/`나 `\`를 직접 다루지 않고 `@tauri-apps/api/path`를 쓴다. Rust에서는 `PathBuf`만 쓴다.
- **WebView 차이:** macOS는 WKWebView(Safari), Windows는 WebView2(Chromium), Linux는 WebKitGTK다. pdf.js 렌더와 캔버스는 Safari 기준으로 확인하고, Safari 캔버스 메모리 상한에 맞춰 LRU 상한을 보수적으로 잡는다.
- **파일 잠금:** Windows 공유 위반 재시도는 Rust에서 `cfg(windows)`로만 수행한다.
- **pdfium 라이브러리 경로:** 개발(`PDFIUM_LIB_PATH`), 테스트, 번들(`Frameworks`/resources)마다 다르다. 결정 로직을 `pdf-core` 한 곳에 둔다.
- **단축키:** `⌘`/`Ctrl`을 추상화한다(`isMac ? metaKey : ctrlKey`).
- **E2E:** `tauri-driver`(WebDriver)는 **macOS를 지원하지 않는다.** Mac 로컬 E2E는 Vite dev + `mock-platform`(또는 `mockIPC`) + Playwright로 하고, 처리 로직은 `cargo test`로 검증한다.

### 10.3 Claude Code 세션 시작 프롬프트 예시
> `docs/plans/2026-10-tauri-migration-and-pdf-compare.md`를 읽고, 체크리스트에서 다음 미완료 작업(Pxx-x)을 진행해줘. 시작 전에 해당 작업의 계획을 먼저 보여주고 확인을 받아.

---

## 11. 의사결정 기록 (ADR 후보)

| ID | 결정 | 대안 | 근거 |
|---|---|---|---|
| D1 | 처리 계층 = Rust(`pdf-core`, pdfium-render) | TS(pdf-lib/pdf.js in Worker), Python 사이드카 | 글자 단위 박스, 웹뷰 밖 처리로 성능·메모리 유리, 별도 프로세스 없음 |
| D2 | 표시 계층 = pdf.js 유지 | Rust 렌더 + 커스텀 URI 프로토콜 | 기존 자산 재사용, 확대·축소 반응성, 렌더 캐시 설계 부담 회피 |
| D3 | pdfium은 동적 라이브러리(버전 고정) 번들 | 정적 링크 | 정적 링크는 pdfium 직접 빌드가 필요 |
| D4 | 파일 I/O는 검증된 커스텀 커맨드로 | `plugin-fs` + 스코프 | 권한 표면 최소화, Response로 효율적인 바이너리 전송 |
| D5 | 번들 ID `io.github.kwoncheuljin.pdfstudio` | — | Phase 1 시작 전에 확정. 변경하면 데이터 경로가 바뀐다. |
| D6 | macOS ad-hoc 서명으로 시작 | Developer ID 공증 | 개인용, 비용 0. 배포 대상이 늘면 전환 |
| D7 | 내부 DnD = @dnd-kit | HTML5 DnD 유지 + `dragDropEnabled:false` | 후자는 파일 경로를 받을 수 없다. |
| D8 | 라우터 미도입 (모드 스토어) | TanStack Router | 화면 수가 적다(YAGNI). |

## 12. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| pdfium 번들·서명 실패(특히 Mac) | 전체 일정 지연 | **P1-0을 게이트로** 두고 가장 먼저 검증 |
| pdfium과 pdf.js 좌표 불일치(CropBox, 회전) | 하이라이트 위치 어긋남 | §6.3 교차 테스트, `page_sizes`에 원점 오프셋 포함 |
| `tiff` 크레이트의 압축 방식 미지원(CCITT G4 등) | 일부 TIFF 변환 실패 | 원본 스트림 그대로 넣는 경로, 미지원 시 명확한 에러 |
| pdfium 직렬화로 인한 처리 대기 | 병합과 비교를 동시에 하면 대기 | 작업 큐 + 진행률 표시. 측정 후 필요하면 Phase 5 병렬화 |
| ToUnicode가 깨진 PDF, 스캔 PDF | 비교 품질 저하 | `LowTextConfidence`/`NoTextLayer` 안내. 그래픽 diff는 Phase 5 |
| Rust 학습 비용 | 진행 속도 | `pdf-core`를 작은 모듈로 나누고 테스트 우선. 기존 TS 테스트 케이스를 명세로 사용 |
| pdf.js 5 최소 브라우저 요구 | 구형 macOS에서 동작 불가 | `minimumSystemVersion`을 명시하고 실기기에서 검증 |
| Windows HTML5 DnD 차단 | 재정렬 불가 | P0-5 선행 |

---

## 13. 진행 체크리스트

- [ ] P0-1 개발 환경 정합
- [ ] P0-2 플랫폼 어댑터와 계약 분리
- [ ] P0-3 비파괴 회전
- [ ] P0-4 pdf.js 로더 단일화와 렌더 캐시
- [ ] P0-5 @dnd-kit 전환
- [ ] P0-6 버그 수정과 정리
- [ ] **P1-0 pdfium 스파이크 (Mac 로드·렌더·번들·서명)**
- [ ] P1-1 Tauri 스캐폴드 + Cargo workspace (D5 확정)
- [ ] P1-2 pdf-core 기본 처리 (info, merge, tiff) + 테스트 이식
- [ ] P1-3 Tauri 커맨드와 작업 큐
- [ ] P1-4 Tauri 어댑터와 드롭
- [ ] P1-5 보안, 테마, 창
- [ ] P1-6 Electron 제거와 문서 갱신
- [ ] P1-7 아이콘과 로컬 빌드
- [ ] P2-1 결과 모델 ADR
- [ ] P2-2 추출 (+ 좌표 일치 검증)
- [ ] P2-3 정규화와 토큰화
- [ ] P2-4 정렬과 diff
- [ ] P2-5 페이지 짝짓기
- [ ] P2-6 옵션
- [ ] P2-7 작업 실행기 (진행률·취소·캐시)
- [ ] P2-8 리포트 내보내기
- [ ] P3-1 ~ P3-6 비교 UI
- [ ] P4-1 ~ P4-4 빌드, 배포, 서명
