# Tauri 마이그레이션 + PDF 비교 기능 도입 계획

- 작성일: 2026-10-12
- 대상 버전: v1.3.1 (Electron 41 / Forge / Vite 8 / React 19 / FSD)
- 저장 위치: `docs/plans/2026-10-tauri-migration-and-pdf-compare.md`
- 실행 환경: **macOS (Apple Silicon)에서 이어서 진행**하는 것을 전제로 한다. Windows와 Linux는 CI로 검증한다.

---

## 0. 요약

| 항목 | 결정 (제안) |
|---|---|
| 런타임 | Electron → **Tauri v2**. Node 런타임이 없으므로 main 프로세스 로직을 **순수 TS(Web Worker) + 얇은 Rust 커맨드**로 재배치한다. |
| PDF 비교 엔진 | **직접 구현(클린룸)**. pdf.js 텍스트 추출과 토큰 diff를 **Web Worker의 순수 TS**로 만든다. 사이드카, Python, 네이티브 바이너리는 쓰지 않는다. |
| 진행 방식 | **Phase 0(공통 기반 정리)** 을 끝낸 뒤 **Track A(Tauri 전환)** 와 **Track B(비교 엔진)** 를 병행한다. 두 트랙은 Phase 3(비교 UI)에서 합쳐진다. |
| 핵심 원칙 | 플랫폼 의존 코드는 `shared/platform` 어댑터 한 곳에만 둔다. PDF 연산은 `Uint8Array` 입출력을 갖는 순수 함수로 만든다. 사용자 원본 파일은 **절대 수정하지 않는다**. |

엔진을 순수 TS로 두면 다음 이점이 있다.
- 사이드카 번들링, 플랫폼별 바이너리, 코드사인, 고아 프로세스, 포트/토큰 관리 문제가 **원천적으로 사라진다**.
- Mac, Windows, Linux에서 동일한 코드가 동작한다.
- 테스트는 `vitest`(node) 환경에서 돌릴 수 있다.

---

## 1. 전제와 제약

### 1.1 클린룸 원칙 (중요)

- 비교 기능은 **개인 프로젝트로 새로 구현**한다. 업무에서 다뤄 본 유사 시스템의 **코드, 상수, UI 문구, 내부 문서, 엔드포인트, 식별자를 복사하지 않는다.**
- 참고는 공개 문서와 오픈소스(pdf.js, jsdiff, pdf-lib 등), 그리고 일반적인 알고리즘 지식(LCS/Myers diff, LIS 등)으로 한정한다.
- 이 레포는 **공개(MIT)** 이므로 계획서, ADR, 커밋 메시지에도 회사 내부 정보를 남기지 않는다.
- 같은 도메인의 사이드 프로젝트에 관한 고용계약상 조항(IP 귀속, 겸업)은 본인이 한 번 확인해 둔다.

### 1.2 라이선스 화이트리스트

- 허용: MIT, BSD, Apache-2.0, ISC, OFL(폰트)
- 금지: **AGPL/GPL 계열**(MuPDF 등)

| 용도 | 후보 | 라이선스 |
|---|---|---|
| 렌더링, 텍스트 추출 | `pdfjs-dist` | Apache-2.0 |
| 쓰기, 병합, 주석 | `pdf-lib` | MIT |
| 시퀀스 diff | `diff`(jsdiff) 또는 자체 Myers 구현 | BSD-3 |
| Worker RPC | `comlink` | Apache-2.0 |
| TIFF 디코드 | `utif2` | MIT |
| 픽셀 diff (Phase 5) | `pixelmatch` | ISC |

### 1.3 레포 작업 규칙 (CLAUDE.md 유지)

- 계획 → 확인 → 실행 → 보고
- YAGNI/KISS, 매직 값 금지
- TDD 대상: `shared/lib`, `**/model`, 엔진
- **커밋에 AI co-author 라인을 넣지 않는다.**

---

## 2. 현황 진단 (마이그레이션 입력값)

### 2.1 IPC 인벤토리 → Tauri 매핑

| 현재 채널 | 현재 동작 | Tauri 이후 |
|---|---|---|
| `pdf.merge:start` (+progress, complete) | main 스레드에서 pdf-lib 병합 | **Worker의 `mergePdfs(bytes[], plan)`**. 결과 저장은 `write_output` 커맨드. 진행률은 Worker 콜백(페이지 단위). `complete` 이벤트는 제거한다. |
| `pdf.edit:apply`, `pdf.page:rotate` | **원본 파일을 덮어씀** | **제거.** 회전은 스토어 상태로만 들고 있다가 병합 시 적용한다(§4 P0-4). |
| `file.convert.tiff` | sharp → PNG → pdf-lib | **Worker의 `tiffToPdf(bytes)`**(utif2 + pdf-lib) |
| `file.meta.get-pdf-info` | pdf-lib 전체 파싱 | pdf.js `numPages` / `getPage().rotate` 재사용(문서 캐시) |
| `file.read:pdf` | 파일 전체를 구조화 복제로 전달 | **`read_pdf` 커맨드 → `tauri::ipc::Response`(raw bytes)** |
| `dialog.show-open/save` | Electron dialog | `@tauri-apps/plugin-dialog` |
| `file.save.copy` | `fse.copy` | `copy_file` 커맨드(검증 포함). 또는 병합 결과를 바로 목적지에 `write_output`. |
| `file.delete` | **임의 경로 `rm -rf`** | **제거.** 앱 임시 디렉터리 정리용 `cleanup_temp`만 둔다. |
| `app.log` | console | `@tauri-apps/plugin-log` |
| `theme:changed` | nativeTheme | `matchMedia` + 수동 설정 영속화(`plugin-store`) |
| `getFilePath(File)` | `webUtils` | **`getCurrentWebview().onDragDropEvent`**(paths, position) |

### 2.2 버그와 부채: 이관하면서 고칠 것

| # | 문제 | 조치 위치 |
|---|---|---|
| B1 | 회전이 **원본 PDF를 즉시 덮어쓴다**. 배치 회전은 `PDFDocument.create()` + `copyPages`로 북마크, 폼, 메타데이터를 잃는다. 연타하면 경쟁 상태가 생긴다. | P0-4 |
| B2 | 빈 화면에 TIFF를 드롭하면 변환을 건너뛰어 병합이 실패한다(`use-dropped-files.ts`). | P0-8 |
| B3 | TIFF 변환 결과를 `~/Documents/PDF Studio/<basename>.pdf`에 저장해 이름이 충돌하고 정리되지 않는다. | P0-7 |
| B4 | 병합 임시 파일이 Documents에 남고, 임의 경로를 삭제하는 API로 지운다. | P1-2 |
| B5 | 다운로드 기본 경로를 `lastIndexOf("/")`로 계산해 Windows에서 깨진다. | P0-8 (`@tauri-apps/api/path` 사용) |
| B6 | `try { return service.x() }`에 `await`가 없어 에러 로깅이 동작하지 않는다(3곳). | P0-8 (Rust 전환 시 자연 해소) |
| B7 | 테마 토글이 `removeAllListeners`로 전역 리스너까지 제거한다. 수동 설정이 영속되지 않는다. | P1-4 |
| B8 | 드롭한 파일의 `pageRotations`가 전달되지 않는다. | P0-8 |
| S1 | `sandbox:false`, 입력 검증이 없다(zod 미사용), 외부 스크립트(animatedicons)를 로드한다. | P1-4 |
| P1 | 썸네일을 요청할 때마다 파일 전체를 IPC로 받아 재파싱한다. PNG data URL이 스토어에 무한히 쌓인다. | P0-5 |
| P2 | 모든 PDF 연산이 main 스레드에서 동기로 돈다(문서와 달리 Worker가 없다). | P0-3 |
| D1 | `use-add-files` ≈ `load-dropped-files`, 세그먼트 그룹핑 중복, 캔버스 렌더 중복, `ValueOf`/`isTiffFile` 중복 | P0-8 |
| D2 | 미사용 코드: `@dnd-kit`(P0-6에서 사용 예정), `zod`(P1에서 사용), `electron-squirrel-startup`, edit delete/reorder, `merge-state.ts` 등 | P0-8 / P1-5 |
| F1 | `shared/hooks`, `shared/model`에 도메인 로직이 있다(FSD 위반). renderer가 `@/main/types`를 import한다. | P0-2 |
| T1 | Node 버전 불일치(.tool-versions 25 / CI 22 / README 18). 버전이 이중 bump된다(auto-version + release.mjs). README와 docs가 낡았다. `.claude` 훅이 Mac 절대경로다. | P0-1, P4 |

---

## 3. 전체 로드맵

```
Phase 0  공통 기반 정리 (Electron 위에서)        ── 필수 선행
   │
   ├── Track A: Phase 1  Tauri 전환 (기능 동등성)
   │
   └── Track B: Phase 2  비교 엔진 (순수 TS, Worker)
                       │
Phase 3  비교 UI (A + B 합류)
Phase 4  빌드, 배포, 서명 (CI 매트릭스)
Phase 5  고도화 (그래픽 diff, 내보내기 확장, 일괄 비교 등)
```

Phase 0을 끝내면 Electron main은 **파일 I/O만 하는 얇은 껍데기**가 된다. 그래서 Track A는 어댑터 구현체 하나만 교체하면 되고, Track B는 플랫폼과 무관하게 진행할 수 있다.

규모 표기: S = 반나절~1일, M = 2~3일, L = 4일 이상

---

## 4. Phase 0: 공통 기반 정리 (Electron 상태에서 진행)

### P0-1 개발 환경 정합 (S)
- Node를 **Active LTS 하나로** 맞춘다. `.tool-versions`, CI, README를 동일하게 하고, `package.json`에 `engines`와 `packageManager: "pnpm@x.y.z"`(corepack)를 둔다.
- `.gitattributes`에 `* text=auto eol=lf`를 둔다. Windows와 Mac을 오가므로 줄바꿈 diff를 막는다.
- `tsconfig`에 `forceConsistentCasingInFileNames: true`를 둔다. macOS 기본 파일시스템은 대소문자를 구분하지 않고 Linux CI는 구분하므로 import 대소문자 실수를 잡아야 한다.
- `.claude/settings.json` 훅의 절대경로를 `cd "$CLAUDE_PROJECT_DIR"`로 바꾼다.
- `.npmrc`와 `package.json`의 `onlyBuiltDependencies`를 정리한다.
- **완료 기준:** Mac과 Windows에서 클론 직후 `pnpm i && pnpm validate`가 통과한다.

### P0-2 플랫폼 어댑터 도입과 계약 분리 (M)
- `src/shared/contracts/`(프로세스 중립)로 DTO와 상수를 옮긴다. renderer는 `@/main/*`을 import하지 않는다.
- `src/renderer/shared/platform/`
  ```ts
  export interface DesktopPlatform {
    pickFiles(opts: { filters: FileFilter[]; multiple: boolean }): Promise<string[]>
    pickSavePath(opts: { defaultName: string }): Promise<string | null>
    readFile(path: string): Promise<Uint8Array>
    writeOutput(path: string, data: Uint8Array): Promise<void>
    createTempPath(name: string): Promise<string>
    cleanupTemp(): Promise<void>
    onFileDrop(handler: (e: FileDropEvent) => void): Promise<Unsubscribe> // paths + client 좌표
    log(level: LogLevel, message: string): void
    getAppVersion(): Promise<string>
  }
  ```
  - 구현체는 `electron-platform.ts`(Phase 0), `tauri-platform.ts`(Phase 1), `mock-platform.ts`(테스트, Storybook/Playwright) 세 개다.
  - 앱 부팅 시 하나를 주입한다(`app/providers`).
- FSD를 정리한다.
  - `shared/hooks`의 업무 훅(`use-merge-execution`, `use-selected-merge`, `use-page-rotation` 등)을 `features/*/model`로 옮긴다.
  - `shared/model/merge-store`는 `entities/merge-plan` + `features/pdf-merge/model`로 분리한다.
- **완료 기준:** `window.api` 참조가 `electron-platform.ts` 한 곳에만 남는다.

### P0-3 PDF 연산을 순수 함수로 만들고 Worker로 옮기기 (M)
- `src/renderer/shared/lib/pdf-ops/`
  - `mergePdfs({ sources: {bytes, pages?: {index, rotation}[]}[] , onProgress })`
  - `getPdfInfo(bytes)`
  - `tiffToPdf(bytes)`(P0-7)
  - 모두 `Uint8Array` → `Uint8Array` 형태다. **fs와 Electron을 import하지 않는다.**
- `src/renderer/workers/pdf-ops.worker.ts` + comlink. 큰 버퍼는 `transfer`로 넘긴다.
- 기존 `src/main/services/__tests__`의 케이스를 그대로 이식한다(node 환경, pdf-lib 그대로). 회전 케이스와 멀티페이지 TIFF 케이스를 **추가**한다.
- **완료 기준:** 300페이지 병합 중에도 UI가 멈추지 않는다. 진행률을 페이지 단위로 보고한다.

### P0-4 비파괴 회전 (S, B1)
- 회전은 `PdfPage.rotation`(스토어)으로만 관리하고, 병합 시 `page.setRotation(base + delta)`로 적용한다.
- `pdf.edit:apply`와 `pdf.page:rotate`를 삭제한다.
- **완료 기준:** 어떤 조작을 해도 원본 파일의 mtime과 해시가 변하지 않는다(테스트로 보장).

### P0-5 pdf.js 로더 단일화와 렌더 캐시 (M, P1)
- `shared/lib/pdfjs/`
  - Worker 설정
  - `cMapUrl` + `cMapPacked`, `standardFontDataUrl`: `pdfjs-dist/cmaps`와 `standard_fonts`를 정적 자산으로 복사한다. **한글과 CID 폰트의 텍스트 추출 및 렌더링에 필수이며 비교 엔진도 사용한다.**
  - pdf.js 5.x에서 요구하는 wasm 자산 경로가 있으면 함께 설정한다.
- `PdfDocumentCache`: 파일당 `PDFDocumentProxy` 하나를 두고 refcount와 `destroy()`로 관리한다.
- 썸네일과 미리보기는 data URL 대신 **`ImageBitmap` 또는 `blob:` URL + LRU(개수/메모리 상한)** 로 바꾼다. 화면에 보이는 페이지만 렌더한다(virtuoso).
- 캔버스 렌더 코드 3곳을 `renderPageToBitmap({doc, pageIndex, scale})` 하나로 통합한다.
- **완료 기준:** 같은 파일을 여러 번 읽지 않는다. 파일을 제거하면 메모리가 회수된다.

### P0-6 내부 드래그 정렬을 `@dnd-kit`으로 전환 (M)
- **이유:** Tauri v2에서 OS 파일 드롭 경로를 받으려면 `dragDropEnabled: true`(기본값)여야 한다. 이 경우 **Windows WebView2에서 HTML5 DnD가 동작하지 않는다.** 현재 페이지와 파일 재정렬은 HTML5 DnD 기반이므로 pointer 기반 dnd-kit(이미 설치됨)으로 바꿔야 한다.
- 외부 파일 드롭은 `platform.onFileDrop`으로 분리한다. 드롭 위치에 삽입하는 로직(`calculateDropIndex`)은 **좌표 기반 순수 함수**로 만든다.
- **완료 기준:** HTML5 DnD 이벤트(`onDragStart` 등) 의존이 0이다.

### P0-7 sharp 제거와 TIFF 변환 Worker화 (S~M, B3)
- `utif2`로 디코드한 뒤 RGBA를 PNG 인코딩(또는 JPEG)하고 `pdf-lib`로 embed한다. 결과는 **메모리상 bytes**로만 다루고 파일로 저장하지 않는다(병합 입력으로 바로 사용).
- 테스트 픽스처: 멀티페이지, LZW, JPEG, **CCITT G4**(스캔 문서에 흔함), 16bit, CMYK
- 지원하지 않는 압축은 명확한 에러 토스트로 알린다.
- **완료 기준:** `sharp` 의존을 제거한다. 네이티브 모듈이 0개다.

### P0-8 버그 수정과 정리 (S)
- B2, B5, B6, B8, D1, D2를 처리한다.
- `use-add-files`와 `load-dropped-files`를 `ingestPaths(paths, insertAt?)` 하나로 통합한다.

---

## 5. Phase 1 (Track A): Tauri v2 전환

### P1-1 스캐폴드 (S)
- `pnpm tauri init`으로 `src-tauri/`를 만든다(crate 이름 `pdf_studio`).
- **번들 식별자를 확정한다.** 예: `io.github.kwoncheuljin.pdfstudio`. 앱 데이터 경로와 macOS 번들 ID가 되므로 **이후 변경 비용이 크다.**
- Vite 설정 3개를 `vite.config.ts` 하나로 합친다.
  - `server.port` 고정 + `strictPort`, `clearScreen:false`, `envPrefix: ['VITE_','TAURI_ENV_']`
  - `build.target`: 최소 macOS 버전의 Safari와 Windows WebView2 기준으로 정한다. 템플릿 기본값 `safari13`은 pdf.js 5에 맞지 않으므로 상향한다.
- `tauri.conf.json`
  - `version: "../package.json"` (**버전 단일 소스**)
  - `bundle.macOS.minimumSystemVersion`을 명시한다. pdf.js 5와 OffscreenCanvas 요구사항을 실기기에서 확인한 뒤 정한다.

### P1-2 Rust 커맨드 (M, B4/S1)
| 커맨드 | 시그니처 | 비고 |
|---|---|---|
| `read_pdf` | `(path) -> tauri::ipc::Response` | 확장자 화이트리스트(pdf/tif/tiff), `canonicalize`, 크기 상한. **`Vec<u8>`을 그대로 반환하면 JSON 숫자 배열이 되어 매우 느리다.** |
| `write_output` | raw body(`Uint8Array`) + 헤더로 경로 전달 | `tauri::ipc::Request`로 바이트를 수신한다. 임시파일에 쓴 뒤 rename(원자적 쓰기)한다. Windows 공유 위반 시 재시도한다(기존 retry-write 로직 이식). |
| `create_temp_path` / `cleanup_temp` | 앱 캐시 디렉터리 하위만 다룬다 | 시작과 종료 시 정리 |
| (선택) `reveal_in_folder` | `plugin-opener` | "Finder/탐색기에서 보기" |
- 커맨드 타입은 `tauri-specta`로 TS 바인딩을 생성해 `Window.api` 수기 선언을 대체하는 방안을 검토한다.
- 사용할 플러그인: `dialog`, `log`, `store`, `opener`, `window-state`. **`fs` 플러그인은 쓰지 않는다**(커스텀 커맨드로 경로를 검증하므로 권한 표면이 최소화된다).

### P1-3 Tauri 어댑터 구현 (M)
- `tauri-platform.ts`에서 `DesktopPlatform`을 구현한다.
- 드롭 처리
  - `onDragDropEvent`의 `position`은 **PhysicalPosition**이므로 `/ window.devicePixelRatio`로 CSS 좌표로 바꾼다.
  - `document.elementFromPoint`로 드롭 대상(슬롯, 그리드 위치)을 판정한다.
  - enter/over/leave로 드롭 오버레이 UI를 갱신한다.
- `@tauri-apps/api/mocks`의 `mockIPC`로 어댑터 단위 테스트를 작성한다.

### P1-4 보안, 테마, 창 (S, B7/S1)
- CSP를 `tauri.conf.json > app.security.csp`로 옮긴다.
  - animatedicons를 제거한다.
  - `worker-src 'self' blob:`, `img-src 'self' data: blob:`
  - error-snapshot용 Firebase `connect-src`는 유지한다.
- 앱 origin이 바뀌므로(`tauri://localhost`, `http://tauri.localhost`) Firebase API 키에 HTTP 리퍼러 제한이 있으면 허용 목록을 갱신한다.
- capabilities는 `main` 창 하나에만 연결하고, 필요한 권한만 둔다.
- 테마: `matchMedia` 구독 + 수동 설정(`system|light|dark`)을 `plugin-store`로 영속화한다.
- 메뉴: macOS 기본 메뉴(편집 단축키 포함)를 확인한다. 이후 `파일 > 열기 (⌘O)` 등을 추가한다.
- 창 크기와 위치는 `plugin-window-state`로 기억한다.

### P1-5 Electron 제거와 문서 갱신 (S)
- 삭제: `forge.config.mts`, `src/main`, `src/preload`, electron 관련 deps, `icon.*`(→ `src-tauri/icons`)
- 갱신: `README`, `docs/01~05`(IPC 스펙 → Tauri 커맨드 스펙), `.claude/agents/ipc-architect.md` → Tauri 커맨드/capability 기준, `implement`/`check` 스킬의 검증 명령(`cargo clippy`, `cargo test` 추가)

### P1-6 아이콘, 로컬 빌드 (S)
- 1024px PNG 원본을 만들고(`icon.icns`에서 추출) `pnpm tauri icon`을 실행한다.
- Mac에서 `pnpm tauri build`로 `.app`/`.dmg`를 만든다. Windows는 CI로 확인한다.

### Phase 1 완료 기준 (기능 동등성 체크리스트)
- [ ] 다이얼로그 및 드롭으로 PDF/TIFF 추가, 위치 지정 삽입
- [ ] 썸네일, 펼치기, 파일 간 페이지 재정렬, 소프트 삭제/복원
- [ ] 회전(비파괴), 전체/선택 병합, 미리보기, 저장, 임시파일 정리
- [ ] 테마(시스템 추종 + 수동), 버전 표시, 에러 스냅샷 전송
- [ ] macOS, Windows, Linux에서 실행 (Windows/Linux는 CI 아티팩트로 확인)

---

## 6. Phase 2 (Track B): 비교 엔진 (순수 TS, Worker)

> 플랫폼에 의존하지 않는다. Phase 0의 `pdfjs` 로더(cMap 포함)만 있으면 Electron 상태에서도 개발과 테스트가 가능하다.

### 6.1 결과 모델 (P2-1, S): ADR로 고정
```ts
type Side = 'before' | 'after'
interface TextBox { page: number; x: number; y: number; w: number; h: number } // PDF pt, 페이지 좌하단 원점, /Rotate 적용 전 좌표
interface Change {
  id: string                  // 안정 키: hash(정규화 텍스트 + 문맥) — 재실행해도 동일
  kind: 'insert' | 'delete' | 'replace'
  before?: { text: string; boxes: TextBox[] }
  after?:  { text: string; boxes: TextBox[] }
  pagePair: [number | null, number | null]
}
interface CompareResult {
  changes: Change[]
  pagePairs: Array<[number | null, number | null]> // 삽입/삭제 페이지는 null
  pageSizes: Record<Side, { w: number; h: number; rotate: number }[]>
  notices: Array<'LOW_TEXT_CONFIDENCE' | 'NO_TEXT_LAYER' | 'TRUNCATED'>
}
```
좌표계는 PDF 원본 좌표로 저장한다. 화면 변환은 pdf.js `viewport.convertToViewportRectangle`이 담당한다. 이렇게 하면 회전이나 확대가 바뀌어도 결과를 다시 계산할 필요가 없다.

### 6.2 파이프라인
1. **추출 (P2-2, M)**
   - `page.getTextContent()`의 item(`str`, `transform`, `width`, `height`, `fontName`, `hasEOL`)을 run 단위 박스로 만든다.
   - 글자 단위 박스는 run 폭을 비례 분할해 근사한다. 1차로는 이 정도면 충분하고, 정밀도가 문제 되면 Phase 5에서 개선한다.
   - 텍스트가 없는 페이지(스캔본)는 `NO_TEXT_LAYER`로 알린다. OCR은 범위 밖이다.
2. **정규화와 토큰화 (P2-3, M)**
   - Unicode 정규화(NFC/NFKC 옵션), 공백과 줄바꿈 정리, 하이픈 줄바꿈 결합, 대소문자 무시 옵션
   - 토큰 단위는 **단어**(공백 기준, 한글 포함)다. replace 구간 내부는 **글자 단위 2차 diff**로 정밀 하이라이트한다.
   - 대체 문자(U+FFFD)나 PUA 비율이 높으면 `LOW_TEXT_CONFIDENCE`로 표시한다(ToUnicode가 깨진 PDF).
3. **정렬과 diff (P2-4, L)**
   - 문서 전체 토큰열끼리 비교해 페이지 경계를 넘는 이동이나 밀림에 대응한다.
   - 대용량 대응: ① 단락/줄 해시로 **유일 매칭 앵커**를 잡고(patience 방식) ② 앵커 사이 구간만 Myers diff를 돌린다. Myers는 최악의 경우 O(ND)이므로 차이가 큰 문서도 시간 상한을 지킨다.
   - 인접한 delete와 insert는 replace로 묶는다. 같은 줄에서 인접한 박스는 병합한다.
4. **페이지 짝짓기 (P2-5, M)**
   - 페이지 쌍별 매칭 토큰 수 행렬을 만들고, 단조 증가 최대 가중 경로(LIS 계열)로 짝을 짓는다. 남는 페이지는 삽입 또는 삭제 페이지가 된다.
5. **옵션 (P2-6, S)**
   - 페이지 범위(`"1,3-5"` 파서는 기존 `page-range-format` 재사용)
   - 머리글과 바닥글 제외(상단/하단 N pt 밴드). 자동 감지(여러 페이지에 반복되는 텍스트)는 Phase 5로 미룬다.
6. **Worker 래핑 (P2-7, S)**
   - `compare(beforeBytes, afterBytes, options, { onProgress, signal })`
   - 진행 단계(추출 n/N → 정렬 → diff)를 보고하고, `AbortSignal`로 취소한다.
   - 파일 해시(`crypto.subtle.digest`)를 키로 추출 결과를 메모리에 캐시한다. 옵션만 바꿔 다시 실행할 때 빨라진다.

### 6.3 테스트 전략
- 픽스처는 **코드로 생성**한다. pdf-lib로 원본과 변형(단어 삽입/삭제/치환, 문단 이동, 페이지 삽입/삭제, 회전 페이지)을 만든 뒤 기대 결과 JSON(golden)과 비교한다.
- 한글: OFL 폰트(예: Noto Sans KR 서브셋)를 임베드한 픽스처로 CID 폰트 경로를 검증한다.
- 성능 회귀: 500페이지 합성 문서의 처리 시간과 메모리 상한을 테스트로 기록한다(CI에서는 완화된 기준).

---

## 7. Phase 3: 비교 UI (Track A + B 합류)

### P3-1 앱 모드 (S)
- `app` 레이어에 `mode: 'merge' | 'compare'`(store)를 두고 상단 탭이나 내비로 전환한다.
- 라우터는 도입하지 않는다(YAGNI). 화면이 4개 이상으로 늘어나면 재검토한다.

### FSD 배치
```
entities/comparison        결과 타입, 선택자(현재 change, 필터링)
features/pdf-compare
  ├─ engine/               (Phase 2 산출물: 순수 TS + worker)
  ├─ model/                compare-session store(files, options, status, result, activeChangeId)
  └─ ui/                   file-slots, options-panel, change-list
widgets/compare-viewer     좌우 뷰어 + 오버레이 + 동기 스크롤
pages/compare              조립
```

### 화면 구성
- **P3-2 파일 슬롯 (S):** 이전과 이후 슬롯, 다이얼로그 또는 드롭(`platform.onFileDrop` + 좌표 판정), 좌우 교체 버튼
- **P3-3 뷰어 (L)**
  - 좌우 virtuoso 리스트, 보이는 페이지만 pdf.js로 렌더(P0-5 캐시 재사용), SVG 오버레이 하이라이트
  - `pagePairs` 기반 **동기 스크롤**: 짝 페이지 기준으로 정렬하고, 삽입/삭제 페이지는 반대편에 자리표시자를 둔다.
- **P3-4 변경 목록 (M):** 종류별 필터, 텍스트 미리보기(글자 단위 강조), 클릭하면 양쪽 스크롤과 포커스, 키보드 탐색(다음/이전, Mac은 ⌘ 기준)
- **P3-5 옵션 (S):** 페이지 범위, 머리글/바닥글 제외, 대소문자 무시. 변경하면 캐시된 추출 결과로 재계산한다.
- **P3-6 내보내기 (M):** Worker에서 pdf-lib로 변경 영역에 하이라이트 주석이나 사각형을 넣은 비교 리포트 PDF를 만든다(좌우 페이지를 `embedPage`로 한 장에 배치). 저장 다이얼로그 후 `write_output`.

### 완료 기준
- 100페이지 문서 쌍을 Mac(M 시리즈)에서 10초 안에 비교한다(목표치이며 Phase 2 측정 후 확정).
- 비교 중에도 스크롤과 취소가 가능하다.

---

## 8. Phase 4: 빌드, 배포, 서명

### P4-1 CI
- `tauri-apps/tauri-action` 매트릭스
  - `macos-latest`(aarch64-apple-darwin, 필요하면 `universal-apple-darwin`)
  - `windows-latest`
  - `ubuntu-22.04`(`libwebkit2gtk-4.1-dev` 등)
- `Swatinem/rust-cache`, pnpm 캐시, `NODE_AUTH_TOKEN`(GitHub Packages)을 유지한다.
- PR에서는 `pnpm validate` + `cargo clippy -D warnings` + `cargo test`를 실행한다.

### P4-2 릴리스 흐름 정리 (T1)
- **`auto-version.yml`을 제거한다.** `pnpm release:*` → 태그 푸시 → `release.yml`이 tauri-action으로 Draft Release를 만들고 아티팩트를 업로드한다.

### P4-3 서명
| 옵션 | 비용 | 사용자 경험 |
|---|---|---|
| macOS ad-hoc (`signingIdentity: "-"`) | 무료 | 다운로드한 앱은 Gatekeeper 경고가 뜬다(우클릭 → 열기 또는 `xattr -dr com.apple.quarantine`). **개인용 1차 권장.** |
| Developer ID + 공증 | Apple Developer 연 $99 | 경고가 없다. tauri-action에 `APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` 시크릿을 넣는다. |
| Windows | 미서명 | SmartScreen 경고가 뜬다. 개인용으로는 허용한다. |

### P4-4 (선택) 자동 업데이트
- `plugin-updater` + minisign 키(`TAURI_SIGNING_PRIVATE_KEY`)를 쓴다. tauri-action이 GitHub Releases에 `latest.json`을 생성한다.

---

## 9. Phase 5: 고도화 후보 (필요할 때)
- **그래픽 diff 레이어:** 짝 페이지를 같은 스케일로 렌더한 뒤 `pixelmatch`로 비교하고, 연결 요소 분석으로 영역 박스를 만든다. 페이지 크기가 같을 때만 수행한다.
- **이동 감지:** 같은 텍스트의 delete/insert 쌍을 `moved`로 접는다.
- **머리글/바닥글 자동 감지:** 여러 페이지에서 같은 위치에 반복되는 텍스트를 찾는다.
- **폴더 일괄 비교:** 파일명 유사도로 짝을 짓고, 사용자가 수정한 뒤 순차 실행해 리포트 ZIP을 만든다.
- **비교 이력 영속화:** `plugin-store` 또는 `plugin-sql`(SQLite)
- **미니맵**, 변경 밀도 표시
- **Rust 엔진 옵션:** pdf.js 추출 품질이나 성능이 한계에 닿으면 `pdfium-render` + pdfium 바이너리(BSD/Apache)를 검토한다. 이 경우 플랫폼별 dylib/dll 번들과 서명이 추가로 필요하다.

---

## 10. macOS에서 이어서 작업하기

### 10.1 최초 셋업
```bash
xcode-select --install                       # Xcode CLT (clang, codesign)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin   # universal 빌드 시
# Node: .tool-versions 기준 (asdf/mise)
corepack enable                              # packageManager 필드의 pnpm 사용
# GitHub Packages 토큰(read:packages) — @kwoncheulJin/error-snapshot
echo "//npm.pkg.github.com/:_authToken=<TOKEN>" >> ~/.npmrc
git clone https://github.com/KwonCheulJin/pdf-studio-desktop && cd pdf-studio-desktop
pnpm i && pnpm validate
pnpm tauri dev          # Phase 1 이후
```

### 10.2 크로스플랫폼 주의사항
- **경로:** 문자열로 `/`나 `\`를 직접 다루지 않는다. `@tauri-apps/api/path`(`basename`, `join`, `documentDir`, `appCacheDir`)를 사용한다.
- **WebView 차이:** macOS는 WKWebView(Safari), Windows는 WebView2(Chromium), Linux는 WebKitGTK다. CSS, 캔버스, Worker 기능은 Safari 기준으로 확인한다. Safari는 캔버스 메모리 상한이 낮으므로 LRU 상한을 보수적으로 잡는다.
- **파일 잠금:** Windows 공유 위반 재시도는 Rust `write_output`에서 `cfg(windows)`로만 수행한다.
- **단축키:** `⌘`/`Ctrl`을 추상화한다(`isMac ? metaKey : ctrlKey`).
- **E2E:** `tauri-driver`(WebDriver)는 **macOS를 지원하지 않는다.** Mac 로컬 E2E는 Vite dev + `mock-platform`(또는 `mockIPC`) + Playwright로 하고, 실제 바이너리 E2E는 필요하면 Windows/Linux CI에서만 돌린다.

### 10.3 Claude Code 세션 시작 프롬프트 예시
> `docs/plans/2026-10-tauri-migration-and-pdf-compare.md`를 읽고, 체크리스트에서 다음 미완료 작업(Pxx-x)을 진행해줘. 시작 전에 해당 작업의 계획을 먼저 보여주고 확인을 받아.

---

## 11. 의사결정 기록 (ADR 후보)

| ID | 결정 | 대안 | 근거 |
|---|---|---|---|
| D1 | 비교 엔진 = pdf.js + TS diff (Worker) | Rust+pdfium, Python 사이드카 | 네이티브 번들/서명/프로세스 관리가 필요 없다. 3개 OS에서 동일하게 동작한다. 기존 pdf.js 자산을 재사용한다. |
| D2 | pdf-lib는 Worker에서 실행 | Rust `lopdf`로 재작성 | 기존 테스트와 코드를 재사용할 수 있다. 성능 병목이 확인되면 재검토한다. |
| D3 | 파일 I/O는 검증된 커스텀 커맨드로 | `plugin-fs` + 스코프 | 권한 표면을 최소화하고 Response로 바이너리를 효율적으로 전송한다. |
| D4 | 번들 ID `io.github.kwoncheuljin.pdfstudio` | — | Phase 1 시작 전에 확정한다. 변경하면 데이터 경로가 바뀐다. |
| D5 | macOS ad-hoc 서명으로 시작 | Developer ID 공증 | 개인용, 비용 0. 배포 대상이 늘어나면 전환한다. |
| D6 | 내부 DnD = @dnd-kit | HTML5 DnD 유지 + `dragDropEnabled:false` | 후자는 파일 경로를 받을 수 없다. |
| D7 | 라우터 미도입 (모드 스토어) | TanStack Router | 화면 수가 적다(YAGNI). |

## 12. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| ToUnicode가 깨진 PDF, 스캔 PDF | 비교 품질 저하 | `LOW_TEXT_CONFIDENCE`/`NO_TEXT_LAYER` 안내. 그래픽 diff는 Phase 5. |
| 대용량(500p 이상) 메모리 | WKWebView 크래시 | Worker로 처리, 페이지 스트리밍 추출, 렌더 LRU 상한, 결과만 메인 스레드로 전달 |
| pdf.js 5 최소 브라우저 요구 | 구형 macOS에서 동작 불가 | `minimumSystemVersion`을 명시하고 실기기에서 검증 |
| Windows HTML5 DnD 차단 | 재정렬 불가 | P0-6 선행 |
| 계정/토큰 의존(error-snapshot) | Mac 신규 환경에서 설치 실패 | 10.1 절차에 토큰 설정 포함 |

---

## 13. 진행 체크리스트

- [ ] P0-1 개발 환경 정합
- [ ] P0-2 플랫폼 어댑터와 계약 분리
- [ ] P0-3 PDF 연산 순수 함수화 + Worker
- [ ] P0-4 비파괴 회전
- [ ] P0-5 pdf.js 로더 단일화와 렌더 캐시
- [ ] P0-6 @dnd-kit 전환
- [ ] P0-7 TIFF 변환 Worker화 (sharp 제거)
- [ ] P0-8 버그 수정과 정리
- [ ] P1-1 Tauri 스캐폴드 (D4 확정)
- [ ] P1-2 Rust 커맨드
- [ ] P1-3 Tauri 어댑터와 드롭
- [ ] P1-4 보안, 테마, 창
- [ ] P1-5 Electron 제거와 문서 갱신
- [ ] P1-6 아이콘과 로컬 빌드
- [ ] P2-1 결과 모델 ADR
- [ ] P2-2 추출
- [ ] P2-3 정규화와 토큰화
- [ ] P2-4 정렬과 diff
- [ ] P2-5 페이지 짝짓기
- [ ] P2-6 옵션
- [ ] P2-7 Worker 래핑
- [ ] P3-1 ~ P3-6 비교 UI
- [ ] P4-1 ~ P4-4 빌드, 배포, 서명
