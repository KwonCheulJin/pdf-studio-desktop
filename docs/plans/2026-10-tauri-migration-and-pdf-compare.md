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
| 처리 계층 | **Rust**(`crates/pdf-core`, pdfium-render 기반)가 병합, 회전 적용, 페이지 정보, TIFF 변환, **비교 엔진**(추출·OCR·diff·페이지 정렬·내보내기)을 맡는다. |
| 비교 범위(이번 버전) | 목적은 **계약서를 정확하게 비교하는 것**이다. 우선순위는 ① **텍스트 비교** ② **스캔 계약서 OCR 비교**(§6.4) 두 가지다. 스타일(글꼴·굵기·색·밑줄)·레이아웃·이미지 비교는 Phase 5(§9)로 둔다. |
| 표시 계층 | **pdf.js(웹뷰)** 가 썸네일, 미리보기, 비교 뷰어 렌더링을 맡는다. Rust가 돌려준 결과(PDF 좌표 박스)를 pdf.js 화면 위에 겹쳐 그린다. |
| 데이터 흐름 | 프론트는 **파일 경로를 넘기고 결과(JSON)만 받는다.** PDF 바이트는 표시용 읽기(`read_pdf`)를 제외하면 IPC를 오가지 않는다. |
| 진행 방식 | **마이그레이션을 먼저 순서대로 끝낸다:** Tauri 셸 먼저(Step 1 → 9 → 8 → 10 → 11 → 2 → 14 → 3 → 4 → 5 → 6 → 13 → 7 → 15, 가이드 0-3 참고). Tauri 스캐폴드(P1-1) → P1-0 pdfium 스파이크(게이트) → pdf-core·커맨드(P1-2~3) → Phase 0 정리(P0-2 등, Tauri 위에서) → Electron 제거. **그 뒤 병렬:** Track B(Rust 비교 엔진)와 Phase 4 일부 → Phase 3(비교 UI)에서 합류 |
| 핵심 원칙 | 플랫폼 의존 코드는 `shared/platform` 어댑터 한 곳에만 둔다. `pdf-core`는 Tauri에 의존하지 않는 순수 라이브러리로 만들어 `cargo test`로 검증한다. 사용자 원본 파일은 **절대 수정하지 않는다.** |

### 처리 계층을 Rust로 두는 이유
- **글자 단위 박스:** pdfium은 글자마다 위치를 준다. 비교 하이라이트가 pdf.js의 run 단위 근사보다 정확하다.
- **성능과 메모리:** PDF 처리가 웹뷰 밖에서 일어난다. WKWebView 메모리 한계와 "파일 전체를 IPC로 반복 전송"하는 현재 병목이 사라진다.
- **운영 단순성:** 사이드카(별도 프로세스, 포트, Python 런타임)가 없다. 추가로 번들할 것은 pdfium 동적 라이브러리와, OCR용 ONNX Runtime 동적 라이브러리·모델 파일(§6.4)뿐이다.
- **일관성:** 병합, 정보, TIFF, 비교가 같은 PDF 엔진을 쓴다.

### 비용 (감수하는 부분)
- 기존 TS 서비스와 테스트를 Rust로 재작성해야 한다.
- pdfium 바이너리를 플랫폼별로 번들하고 서명해야 한다. **가장 먼저 검증한다(P1-0).**
- 표시(pdf.js)와 처리(pdfium) 엔진이 다르다. 좌표계 일치를 Rust golden 테스트와 E2E로 보장한다(§6.2).
- OCR 런타임과 모델 파일을 번들하므로 앱이 커진다. 상한을 OCR 스파이크(P2-2a)의 합격 기준으로 둔다(§6.4).

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
| 유니코드 정규화 | `unicode-normalization` | MIT / Apache-2.0 |
| TIFF 디코드 | `tiff`, `image` | MIT / Apache-2.0 |
| 에러, 직렬화, 타입 생성 | `thiserror`, `serde`, `tauri-specta` | MIT / Apache-2.0 |
| 표시 | `pdfjs-dist` | Apache-2.0 |
| OCR 추론(Rust) | `ort` (ONNX Runtime 바인딩) | MIT / Apache-2.0 |
| OCR 런타임 바이너리 | ONNX Runtime | MIT |
| OCR 모델 | PaddleOCR(PP-OCR) 한국어 검출·인식 모델의 ONNX 변환본 | Apache-2.0 |

**예외(이름 고정, 2026-10-13 사용자 결정, P4-5).** 아래는 허용 목록 밖이지만 이름을 고정해 허용한다. 같은 라이선스라도 목록에 없는 새 패키지가 들어오면 `pnpm licenses:check`가 실패한다. 정본은 `scripts/third-party/policy.mjs`의 `LICENSE_EXCEPTIONS`이고, 바꿀 때는 이 표와 함께 고친다.

| 라이선스 | 대상 | 근거 |
|---|---|---|
| Unicode-3.0 | Rust `icu_collections`, `icu_locale_core`, `icu_normalizer`, `icu_normalizer_data`, `icu_properties`, `icu_properties_data`, `icu_provider`, `litemap`, `potential_utf`, `tinystr`, `unicode-ident`, `writeable`, `yoke`, `yoke-derive`, `zerofrom`, `zerofrom-derive`, `zerotrie`, `zerovec`, `zerovec-derive` | 유니코드 데이터. Tauri 하위 의존성(`tauri > url > idna`, `tauri-utils > urlpattern`의 ICU4X, `serde_derive > proc-macro2 > unicode-ident`) |
| MPL-2.0 | Rust `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, `selectors` | Tauri 하위 의존성(`tauri-utils > dom_query`, `tauri > dirs`). 수정 없이 링크만 한다 |
| 0BSD | npm `tslib` | 저작권 표시 의무도 없는 BSD 계열. firebase 하위 의존성 |
| CC0-1.0 | pdf.js ICC 프로필(`pdfjs-dist/iccs`) | 권리 포기(퍼블릭 도메인). `pdfjs-dist` 배포본에 들어 있다 |

- pdfium 배포본의 하위 구성요소(FreeType, ICU, libjpeg-turbo, libpng, libtiff 등)와 `pdfjs-dist`의 자산(표준 글꼴, wasm 디코더, CMap)은 위 표의 pdfium·`pdfjs-dist` 행 범위로 보고, 라이선스 원문을 고지에 싣는다.
- 이 앱 저작자의 패키지(npm `@kwoncheulJin/error-snapshot`)는 제3자 소프트웨어가 아니므로 고지·검사에서 뺀다.

### 1.3 레포 작업 규칙 (CLAUDE.md 유지)
- 계획 → 확인 → 실행 → 보고
- YAGNI/KISS, 매직 값 금지(Rust도 `const`/enum으로)
- 테스트: Rust는 `crates/pdf-core`의 핵심 동작만(§6.3), 프론트는 새 단위 테스트 없이 Playwright E2E만(§10.2)
- **커밋에 AI co-author 라인을 넣지 않는다.**
- **설치·생성은 키트로 한다.** Tauri 스캐폴드, 플러그인, 권한(capability), 아이콘, 서명 키는 Tauri CLI(`tauri init`, `tauri add`, `tauri permission add`, `tauri capability new`, `tauri icon`, `tauri signer generate`)로 만들고, 생성된 결과를 최소한으로만 고친다. 의존성은 `pnpm add`와 `cargo add`로 넣는다(`package.json`, `Cargo.toml`, `lib.rs` 플러그인 등록, capability JSON을 손으로 쓰지 않는다). 직접 작성은 키트가 없는 경우(`fetch-pdfium.mjs`, `fetch-ocr.mjs`, 앱 고유 커맨드와 `pdf-core` 로직, Electron 제거)로 한정한다.

---

## 2. 현황 진단 (마이그레이션 입력값)

### 2.1 IPC 인벤토리 → Tauri 매핑

| 현재 채널 | 현재 동작 | Tauri 이후 |
|---|---|---|
| `pdf.merge:start` (+progress, complete) | main 스레드에서 pdf-lib 병합 | **`merge_pdfs(request, channel)`** 커맨드. `request`는 `{ job_id, sources: {path, pages: {index, rotation}[]}[], output }`이고 `output`은 `{ kind: temp } | { kind: userPath, path }`이다(`job_id`는 프론트가 만든다). 진행률은 `tauri::ipc::Channel`(페이지 단위). `complete` 이벤트는 제거한다. |
| `pdf.edit:apply`, `pdf.page:rotate` | **원본 파일을 덮어씀** | **제거.** 회전은 스토어 상태로만 들고 있다가 병합 요청에 담는다(P0-3). |
| `file.convert.tiff` | sharp → PNG → pdf-lib | **`open_files`가 처리한다**(별도 커맨드 없음, D14). pdf-core `convert_tiff`(`tiff`/`image` + pdfium)로 바꾼 결과 PDF는 앱 캐시 디렉터리에 고유 이름으로 저장하고, 화면에 보일 이름은 `display_name`(원본 TIFF 이름)으로 따로 돌려준다(결함 B15). |
| `file.meta.get-pdf-info` | pdf-lib 전체 파싱 | **`open_files`가 처리한다**(별도 커맨드 없음, D14). pdfium으로 페이지 수, 페이지별 크기·회전을 읽는다. |
| `file.read:pdf` | 파일 전체를 구조화 복제로 전달 | **`read_pdf(path) -> tauri::ipc::Response`**(raw bytes). **표시용(pdf.js)으로만 사용한다.** |
| `dialog.show-open/save` | Electron dialog | **Rust가 다이얼로그를 여는 커맨드 `pick_files`·`pick_save_path`**(`plugin-dialog`는 Rust 쪽에서 호출). 결과 경로를 허용 경로 목록(`State`)에 기록한다(D13). |
| `file.save.copy` | `fse.copy` | 필요 없음. 병합 출력은 요청의 `output`으로 지정한다: `{ kind: temp }`(미리보기용 앱 임시 파일) 또는 `{ kind: userPath, path }`(사용자가 고른 경로로 바로 쓰기). 임시 결과를 나중에 사용자 경로로 복사할 때만 `copy_file`(검증 포함)을 쓴다. |
| `file.delete` | **임의 경로 `rm -rf`** | **제거.** 앱 임시 디렉터리 정리용 `cleanup_temp`와, 미리보기 결과 하나만 지우는 `discard_temp(path)`(앱 임시 폴더 하위만)를 둔다. |
| `app.log` | console | `@tauri-apps/plugin-log` |
| `theme:changed` | nativeTheme | `matchMedia` + 수동 설정 영속화(`plugin-store`) |
| `getFilePath(File)` | `webUtils` | **`getCurrentWebview().onDragDropEvent`**(paths, position). 드롭 경로도 Rust가 `RunEvent::WindowEvent`의 `DragDrop::Drop`에서 받아 허용 경로 목록에 기록한다(D13). 이 콜백은 같은 메인 스레드에서 웹뷰로 `tauri://drag-drop`을 보내기 전에 불리므로, 프론트가 `open_files`를 부를 때는 이미 기록돼 있다. 기록은 있는 파일이고 파일 추가 확장자일 때만 한다. 프론트가 경로를 허용 목록에 넣는 커맨드는 두지 않는다. |
| (신규) 파일 추가 | 렌더러 3곳에 중복(`use-add-files`, `load-dropped-files`, `use-dropped-files`) | **`open_files(paths) -> 파일별 결과[]`**. 확장자 판별·TIFF 변환·정보 조회를 한 번에 하고, 파일별 성공/오류를 돌려준다(D14). |
| (신규) 비교 | — | **`compare_pdfs(request, channel) -> CompareResult`**, `cancel_job(job_id)`, `export_compare_report(request)`(비교 PDF / 주석 PDF), `preview_compare_report(request, count)` |

### 2.2 버그와 부채: 이관하면서 고칠 것

| # | 문제 | 조치 위치 |
|---|---|---|
| B1 | 회전이 **원본 PDF를 즉시 덮어쓴다**. 배치 회전은 `PDFDocument.create()` + `copyPages`로 북마크, 폼, 메타데이터를 잃는다. 연타하면 경쟁 상태가 생긴다. | P0-3 |
| B2 | 빈 화면에 TIFF를 드롭하면 변환을 건너뛰어 병합이 실패한다(`use-dropped-files.ts`). | P0-6 |
| B3 | TIFF 변환 결과를 `~/Documents/PDF Studio/<basename>.pdf`에 저장해 이름이 충돌하고 정리되지 않는다. | P1-2 (캐시 디렉터리 + 고유 이름) |
| B4 | 병합 임시 파일이 Documents에 남고, 임의 경로를 삭제하는 API로 지운다. | P1-3 |
| B5 | 다운로드 기본 경로를 `lastIndexOf("/")`로 계산해 Windows에서 깨진다. | P0-6 (기본 파일 이름은 Rust `MergeResult.fileName`, 처음 폴더는 `tauri-platform`이 `@tauri-apps/api/path`로. 프론트는 경로 문자열을 나누지 않는다) |
| B6 | `try { return service.x() }`에 `await`가 없어 에러 로깅이 동작하지 않는다(3곳). | Rust 전환 시 자연 해소 |
| B7 | 테마 토글이 `removeAllListeners`로 전역 리스너까지 제거한다. 수동 설정이 영속되지 않는다. | P1-5 |
| B8 | 드롭한 파일의 `pageRotations`가 전달되지 않는다. | P0-6 |
| S1 | `sandbox:false`, 입력 검증이 없다, 외부 스크립트(animatedicons)를 로드한다. | P1-5 |
| P1 | 썸네일을 요청할 때마다 파일 전체를 IPC로 받아 재파싱한다. PNG data URL이 스토어에 무한히 쌓인다. | P0-4 |
| P2 | 모든 PDF 연산이 main 스레드에서 동기로 돈다. | Rust 전환(`spawn_blocking` + 작업 큐) |
| B9 | 툴바 "병합" 버튼은 툴팁("선택한 파일을 병합")과 달리 `mergeOrder` 전체를 병합한다. | P0-6 |
| B10 | 페이지 삭제는 소프트 삭제(`isDeleted`)인데 **복원할 화면이 없다.** 복원 컴포넌트(`page-thumbnail.tsx`)는 렌더되지 않고, `restorePage`는 `mergeOrder`에 되돌려 넣지 않는다. 상태바 전체 페이지 수에 삭제된 페이지가 섞인다. | P0-6 (복원 화면 연동) |
| B11 | 선택 정합성: 카드 자체 버튼으로 지우면 선택 목록에 남는다. shift/⌘ 범위 선택이 없다(`selectRange` 미사용). 카드 본문 클릭으로 선택되지 않는다. | P0-6 |
| B12 | 오류가 거의 보이지 않는다: `errorMessage` 미렌더, 선택 병합에 `catch` 없음, 다운로드 실패 미표시, `setError(null)`이 상태를 되돌리지 않음. 토스트는 파일 추가 실패 하나뿐. | P0-6 (화면) / P1-3 (코드 체계) |
| B13 | 회전은 **절대값**이다. 스토어 `rotation`은 원본 `/Rotate`에서 시작해 사용자 회전을 누적한 최종값이다(`pdf-document.ts`, `merge-store.ts`). Rust 병합이 더하면 이중 회전된다. 원본 `/Rotate`에 -90, 450 같은 비정상 값이 있을 수 있다. | P1-2 (병합은 더하지 않고 그대로 설정, `info.rs`가 0/90/180/270으로 정규화) |
| B14 | `build-merge-request.ts`의 `mergeOrder` 분기가 `isDeleted`를 거르지 않는다. B10으로 삭제 페이지를 `mergeOrder`에 남기면 삭제 페이지가 병합된다. | P0-6 (B10과 같은 커밋에서 수정) |
| B15 | TIFF 표시 이름이 경로에서 나온다. B3로 캐시에 고유 이름을 저장하면 UUID가 화면에 보인다. | P1-2·P1-3 (`convert_tiff`/`open_files`가 `display_name` 반환) |
| B16 | 정보 읽기에 실패하면 1쪽짜리 문서로 추가한다(`load-dropped-files.ts`, `use-dropped-files.ts`). 깨진 파일이 정상 문서처럼 목록에 들어간다. | P1-3 (`open_files`가 파일별 오류를 돌려줌) / P0-6 (토스트) |
| A1 | 키보드·접근성: 단축키 없음, 재정렬 마우스 전용, hover 버튼이 Tab 포커스 때 보이지 않음, 회전·삭제 버튼에 접근 가능한 이름 없음, 진행 오버레이에 live region 없음, 전체 선택이 `role="button"` 안에 체크박스를 중첩 | P0-5 / P0-6 |
| P3 | 파일을 추가하면 모든 페이지 썸네일을 즉시 생성하고, 문서 카드는 첫 페이지를 따로 또 렌더한다. | P0-4 |
| C1 | 병합 취소가 없다. | P1-3 |
| I1 | 파일 개수·크기 상한이 없다. | P1-3 |
| S2 | 에러 스냅샷이 앱 설정 없이 라이브러리 기본 Firebase 프로젝트로 전송된다. 오류 메시지에 파일 경로·이름이 섞일 수 있다. | P1-5 |
| W1 | 최소 창 크기가 없다(비교 화면은 약 1100px 필요). | P1-5 |
| T2 | 상태 스토어(`merge-store`의 `mergeOrder`·페이지 이동·그룹)에 테스트가 0개인데 P0-2에서 이 스토어를 쪼갠다. | P0-2 선행 |
| L1 | `package.json`은 MIT인데 `LICENSE` 파일이 없다. pdfium(BSD)·pdf.js(Apache)·글꼴(OFL)의 제3자 고지도 없다. | P4-5 |
| D1 | `use-add-files` ≈ `load-dropped-files`, 세그먼트 그룹핑 중복, 캔버스 렌더 중복, `ValueOf`/`isTiffFile` 중복 | P0-6 (파일 열기는 `open_files` + `use-add-files` 한 곳, 세그먼트 그룹핑은 `flatten-file-grid`, 캔버스 렌더는 `shared/lib/pdfjs/render-page`, `ValueOf`는 `shared/types/common` 한 곳. TIFF 판별은 Rust가 하므로 프론트 `isTiffFile`은 없다) |
| D2 | 미사용 코드: `@dnd-kit`(P0-5에서 사용 예정), `zod`, `electron-squirrel-startup`, edit delete/reorder, `merge-state.ts`, 스토어 액션 `expandAll`/`collapseAll`/`reorderFiles`(실행 시 페이지 순서 유실)/`reorderPageWithinFile`/`movePage`/`resetZoom`/`reset`, `generatePreview`/`generatePageThumbnail`, `Card`/`Icon`, `useActivePages`, 미사용 AbortController 등. **`selectRange`(B11)와 `restorePage`(B10)는 살려서 쓴다.** | P0-6 / P1-6 (모두 제거. `merge-state.ts`는 쓰는 상수 `MERGE_STATUS`·`MERGE_VIEW`만 남는다. 같이 쓰이지 않던 스토어 `insertFiles`·`setProgress`·`setError`·`progress`·`errorMessage`, `useTotalPages`·`useMergeProgress`·`useIsSelected`, `SELECTION_MODE`, `ACCEPTED_FILE_TYPES`, `flattenFileGrid`의 `mergeOrder` 없는 분기도 제거) |
| F1 | `shared/hooks`, `shared/model`에 도메인 로직이 있다(FSD 위반). renderer가 `@/main/types`를 import한다. | P0-2 |
| T1 | Node 버전 불일치(.tool-versions 25 / CI 22 / README 18). 버전이 이중 bump된다. README와 docs가 낡았다. `.claude` 훅이 Mac 절대경로다. | P0-1, P4 |
| B17 | pdfium 페이지 가져오기는 북마크(`/Outlines`)를 복사하지 않아 병합 결과에서 원본 북마크가 사라진다. 현재 동작은 `tests/merge.rs`의 특성 테스트로 고정. | Phase 5 (고도화 후보) |

---

## 3. 전체 로드맵

```
P1-1     Tauri 스캐폴드 + Cargo workspace (Step 9)
   │
P1-0     pdfium 스파이크 — 실제 앱 안에서 로드 → 렌더 → .app 번들/서명 검증  ★ 게이트 (Step 8)
   │
P1-2~3   pdf-core 기본 처리(병합/정보/TIFF) + Tauri 커맨드 (Step 10, 11)
   │
Phase 0  Tauri 위에서 정리 (어댑터·FSD, Step 2) → Electron 제거 (Step 14) → 비파괴 회전·pdf.js 캐시·DnD·버그 (Step 3~6) → 보안·테마 (Step 13) → 디자인 토큰 (Step 7) → 아이콘·빌드 (Step 15) = 기능 동등성 (마이그레이션 완료)
   │
   ├── Track B: Phase 2  pdf-core/compare (cargo만으로 개발·테스트, OCR 스파이크 P2-2a ★ 게이트 포함)
   │
   └── Phase 4 일부  CI, 릴리스, 서명, 라이선스 (P4-1~P4-3, P4-5)
                       │
Phase 3  비교 UI (Phase 2 합류)
Phase 4  P4-4 자동 업데이트(선택)
Phase 5  고도화
Phase 6  PDF 번역·설정 (가칭, Phase 3 뒤)
```

- Phase 0에서는 **처리 로직을 TS로 다시 다듬지 않는다**(Rust가 대체하므로 YAGNI). 계약과 경계만 정리한다.
- **실행 순서는 Step 1 → 9 → 8 → 10 → 11 → 2 → 14 → 3 → 4 → 5 → 6 → 13 → 7 → 15이다(Step 12는 Step 2에 흡수).** Step 번호는 그대로 두고 순서만 바꿨다. Step 9~2 사이에는 파일 처리 기능이 동작하지 않는다(D12).
- **마이그레이션 구간은 순서대로 진행하고, 그동안 병렬 작업을 두지 않는다.** 비교 기능이 올라갈 FSD 배치, 계약 타입(tauri-specta), `pdf-core` 문서 API가 이 구간에서 정해지므로, 그 전에 나란히 진행하면 다시 고치게 된다.
- Track B는 Tauri 없이 `cargo test`만으로 진행할 수 있으므로, Phase 1이 끝나면 Phase 4 일부(P4-1~P4-3, P4-5)와 나란히 진행한다.
- **이번 버전의 비교 범위는 텍스트 비교와 스캔 계약서 OCR 비교다.** Phase 2는 텍스트 레이어 추출·diff에 OCR 경로(P2-2a 스파이크, P2-4a 연결)를 더해 끝낸다. 스타일·레이아웃·이미지 비교는 Phase 5에서 다룬다.

규모 표기: S = 반나절~1일, M = 2~3일, L = 4일 이상

---

## 4. Phase 0: 앱 구조 정리 (Tauri 위에서)

### P0-1 개발 환경 정합 (S)
- Node를 **Active LTS 하나로** 맞춘다. `.tool-versions`, CI, README를 동일하게 하고, `package.json`에 `engines`와 `packageManager: "pnpm@x.y.z"`(corepack)를 둔다.
- `.gitattributes`에 `* text=auto eol=lf`를 둔다. Windows와 Mac을 오가므로 줄바꿈 diff를 막는다(현재 Windows 클론에서 157개 파일이 줄바꿈 차이로 수정 표시됨).
- `tsconfig`에 `forceConsistentCasingInFileNames: true`를 둔다.
- `.claude/settings.json` 훅의 절대경로를 `cd "$CLAUDE_PROJECT_DIR"`로 바꾼다.
- `.npmrc`와 `package.json`의 `onlyBuiltDependencies`를 정리한다.
- **완료 기준:** Mac과 Windows에서 클론 직후 `pnpm i && pnpm validate`가 통과한다.

### P0-2 플랫폼 어댑터 도입과 계약 분리 (M)
- **특성 테스트(T2):** 스토어를 옮기기 전에 지금 동작을 고정한 기존 Vitest(`merge-store`의 파일 추가·삽입 위치, `movePageInMergeOrder`(파일 간 이동 포함), `insertFileAtPosition`, 그룹 접기/펼치기, 페이지 삭제, `selection-store`의 FILE/PAGE 전환)를 유지한다. 리팩터링 중 이 테스트는 그대로 통과해야 한다(B10·B11에서 의도적으로 바꾸는 동작은 그 단계에서 기대값을 갱신). 스토어에 새 단위 테스트는 더하지 않고, 같은 동작을 E2E 시나리오가 확인하게 되면 해당 특성 테스트를 지운다.
- 손으로 쓴 `src/shared/contracts`는 만들지 않는다. 계약 타입은 P1-3에서 만든 `tauri-specta` 생성물을 쓴다. renderer는 `@/main/*`을 import하지 않는다.
- `src/renderer/shared/platform/`: **경로 기반의 굵은 단위(coarse-grained) API**로 정의한다. 처리 주체(Rust)가 바뀌어도 같은 시그니처를 유지하기 위해서다.
  ```ts
  export interface DesktopPlatform {
    pickFiles(): Promise<string[]>
    pickSavePath(options: { fileName: string }): Promise<string | null> // 처음 보일 폴더는 플랫폼이 정한다
    openFiles(paths: string[]): Promise<OpenedFile[]>                  // 확장자 판별·TIFF 변환·정보 조회, 파일별 결과(D14)
    fileStem(path: string): Promise<string>                            // 확장자를 뺀 파일 이름(열기 전 자리표시·열기 실패 알림). 프론트는 경로 문자열을 자르지 않는다
    readPdf(path: string): Promise<Uint8Array>                         // pdf.js 표시 전용
    mergePdfs(params: { request: MergeRequest; onProgress?: (progress: MergeProgress) => void }): Promise<MergeResult>
    cancelJob(jobId: string): Promise<void>
    copyFile(params: { source: string; destination: string }): Promise<void>
    discardTemp(path: string): Promise<void>
    log(params: { level: LogLevel; message: string }): void
    onFileDrop(handler: (event: FileDropEvent) => void): () => void      // enter/over/drop/leave, paths + CSS 좌표(P0-5)
    // Phase 3: comparePdfs, exportCompareReport
  }
  ```
  - 계약 타입(`OpenedFile`, `MergeRequest`, `MergeProgress`, `MergeResult`)은 바인딩에서 `import type`으로 가져온다. 실패는 두 구현 모두 `PlatformError`(`{ code, message, path }`)로 던진다.
  - 구현체는 `tauri-platform.ts`와 `mock-platform.ts`(테스트, Playwright) 둘이다. Electron용 임시 어댑터는 만들지 않는다.
  - 어댑터에는 단위 테스트를 따로 두지 않는다. 계약 타입(`tauri-specta` 생성물)과 typecheck로 형태를 맞추고, 동작은 `mock-platform` 기반 E2E로 확인한다.
  - 앱 부팅 시 하나를 주입한다(`app/providers`). Tauri 웹뷰(`isTauri()`)면 `tauri-platform`, 아니면(브라우저 E2E) `mock-platform`이다. 화면과 훅은 `getPlatform()`으로 가져온다.
- FSD를 정리한다. `shared/hooks`의 업무 훅을 `features/*/model`로, `shared/model/merge-store`는 `entities/merge-plan` + `features/pdf-merge/model`로 나눈다.
- 진행은 둘로 나눈다. FSD 재배치·스타일 이동(Step 2-a)은 Tauri와 무관하므로 Step 10과 병렬로 먼저 하고, 어댑터·계약 연결(Step 2-b)은 P1-3(Step 11) 뒤에 한다.
- **완료 기준:** `window.api` 참조 0, `@tauri-apps/api` import는 `shared/platform/tauri-platform.ts`에만, `shared`가 상위 레이어나 `@/main`을 import하지 않음, 기존 특성 테스트 통과, typecheck 통과.

### P0-3 비파괴 회전 (S, B1)
- 회전은 `PdfPage.rotation`(스토어)으로만 관리하고, `MergeRequest.sources[].pages[].rotation`에 담아 병합 시 적용한다.
- 병합은 Rust(`merge_pdfs`, P1-2~3)가 요청의 페이지별 rotation을 적용한다. 프론트에서 원본을 덮어쓰는 편집·회전 호출(`pdf.edit:apply`, `pdf.page:rotate`에 해당)을 없애고, 회전은 스토어 상태로만 들고 있다가 `MergeRequest`에 담는다.
- **완료 기준:** 어떤 조작을 해도 원본 파일이 바뀌지 않는다. 원본 바이트·mtime 불변은 Rust 테스트(`crates/pdf-core/tests/merge.rs`, `src-tauri` 병합·복사 테스트)가 실제 파일로 확인하고, 프론트가 원본 경로에 쓰기를 요청하지 않음과 회전이 절대값(화면에 보인 최종 각도)으로 병합 요청에 담김은 E2E(`e2e/non-destructive-rotation.spec.ts`, mock 플랫폼 호출 기록)로 확인한다.

### P0-4 pdf.js 로더 단일화와 렌더 캐시 (M, P1)
- `shared/lib/pdfjs/`: pdf.js를 import하는 곳은 이 폴더 하나다.
  - Worker 설정
  - `cMapUrl` + `cMapPacked`, `standardFontDataUrl`, `wasmUrl`, `iccUrl`: `pdfjs-dist`의 `cmaps`·`standard_fonts`·`wasm`·`iccs`를 `vite-plugin-static-copy`로 빌드 결과의 `pdfjs/` 아래에 복사한다(개발 서버는 `node_modules`에서 바로 내준다, 레포에 사본을 두지 않는다). 경로 상수는 `asset-paths.ts` 하나를 `vite.config.ts`와 런타임이 같이 쓴다. 자산 URL은 절대 URL로 넘긴다(Worker 안 fetch가 Worker 스크립트 위치 기준으로 풀리지 않게). **cMap은 한글과 CID 폰트를 제대로 표시하는 데 필수다.**
  - CSP `img-src`에 `blob:`을 넣는다(렌더 결과를 `blob:` URL로 표시).
- `PdfDocumentCache`: 경로당 `PDFDocumentProxy` 하나를 두고 refcount와 `destroy()`로 관리한다. 같은 경로 동시 요청은 같은 Promise를 나눠 쓴다. `retain`은 읽지 않고 참조만 잡고, 실제 읽기(`readPdf`)는 처음 그릴 때 한다. 작업 공간의 파일 목록이 경로마다 참조를 잡아 두어(`usePdfDocumentRetention`, 앱 셸) 펼치기·접기·미리보기·병합 결과 보기를 오가도 다시 읽지 않고, 파일을 빼면 놓아서 문서를 닫는다.
- 캔버스 렌더 코드 3곳을 `renderPageToBitmap({ document, pageIndex, scale, rotation? })` 하나로 통합한다. 결과는 PNG `Blob`이고, 렌더 캐시가 `blob:` URL을 만들고 지운다(`rotation`을 생략하면 PDF `/Rotate`를 따른다). 비교 뷰어도 이 함수를 쓴다.
- 렌더 캐시: 키는 경로·페이지·배율·회전. 화면이 쓰는 항목은 내보내지 않고, 쓰지 않는 항목은 합계가 64 MiB를 넘으면 오래 안 쓴 것부터 `URL.revokeObjectURL`한다. 문서를 닫으면 그 문서의 항목을 모두 지운다. 스토어에는 렌더 결과를 두지 않는다(경로·페이지 메타만).
- 화면에 보이는 페이지만 렌더한다. 미리보기 목록은 virtuoso(보이는 아이템만 마운트), 작업 공간 카드 그리드는 `IntersectionObserver`(여백 200px)로 화면 근처 카드만 그린다. 그리드는 드롭 영역이 붙은 절대 좌표 레이아웃이라 virtuoso로 바꾸려면 레이아웃과 드래그를 다시 써야 하고, 드래그는 P0-5에서 다시 쓴다.
- 파일 추가 시 전체 페이지 썸네일을 즉시 만드는 동작을 없앤다(P3). 문서 카드의 첫 페이지 썸네일도 같은 캐시를 쓴다(따로 렌더하지 않는다).
- **완료 기준:** 같은 파일을 여러 번 읽지 않는다. 파일을 제거하면 메모리가 회수된다. cMap이 필요한 한글 PDF가 그려진다. E2E(`e2e/pdfjs-cache.spec.ts`, mock 플랫폼 `readPdf` 기록과 개발 서버 전용 캐시 조회)로 확인한다.

### P0-5 내부 드래그 정렬을 `@dnd-kit`으로 전환 (M)
- **이유:** Tauri v2에서 OS 파일 드롭 경로를 받으려면 `dragDropEnabled: true`(기본값)여야 한다. 이 경우 **Windows WebView2에서 HTML5 DnD가 동작하지 않는다.** 현재 페이지·파일 재정렬은 HTML5 DnD 기반이므로 pointer 기반 dnd-kit(이미 설치됨)으로 바꾼다.
- 외부 파일 드롭은 `platform.onFileDrop`으로 분리한다. 드롭 위치에 삽입하는 로직(`calculateDropIndex`, `shared/lib/layout-calculator.ts`)은 **좌표 기반 순수 함수**로 만든다: 그리드 컨테이너 기준 좌표와 카드 좌표로 몇 번째 카드 앞인지 계산한다. 드롭한 파일을 여는 동안 그 자리에 업로드 자리표시를 보인다.
- `KeyboardSensor`를 함께 등록해 키보드 재정렬을 지원한다(A1): 카드에 포커스 → Space로 집기 → 방향키 이동 → Space로 놓기 / Esc 취소. 방향키는 그리드 방향으로 움직인다(행 끝에서 오른쪽으로는 넘어가지 않고 아래 방향키로 다음 행에 간다). 이동 결과를 live region(dnd-kit `announcements`, 한국어)으로 알린다.
- dnd-kit은 transform을 뺀 자리로 카드를 재므로 카드 그리드 좌표는 `left/top`으로 두고 transform은 정렬 중 이동량에만 쓴다.
- **완료 기준:** HTML5 DnD 이벤트(`onDragStart` 등) 의존이 0이다. 마우스 없이 파일과 페이지 순서를 바꿀 수 있다.

### P0-6 버그 수정과 정리 (M)
- B2, B5, B8, B9, B10, B11, B12(화면), D1, D2, A1(나머지)을 처리한다.
- 경로 처리(확장자 판별, TIFF 변환, 정보 조회)는 Rust `open_files`(P1-3)가 맡는다(D14). `use-add-files`와 `load-dropped-files`의 중복 분기를 없애고, 프론트에는 삽입 위치(`insertAt`)와 업로드 표시만 남긴다.
- **B9 병합 버튼:** 툴바 "병합"은 전체 병합으로 두고 툴팁을 "모든 파일을 하나의 PDF로 병합"으로 고친다. 선택 병합은 플로팅 바의 "병합하기"가 맡는다.
- **B10 페이지 복원(화면 연동):**
  - 삭제해도 페이지를 `mergeOrder`에서 빼지 않고 `isDeleted`만 켠다. 병합 요청에서는 이미 삭제 페이지를 제외한다(`build-merge-request`).
  - `build-merge-request`의 `mergeOrder` 분기에서 `isDeleted` 페이지 제외를 같은 커밋에서 추가한다(B14). 지금 이 분기는 삭제 페이지를 거르지 않는다.
  - 화면 시안: 캔버스 6번 "병합: 페이지 삭제·복원".
  - 펼친 그룹에서 삭제된 페이지는 **제자리에 흐리게**(점선 테두리) 남기고 "삭제됨" 배지와 "복원" 버튼을 보인다. 지금 렌더되지 않는 `page-thumbnail.tsx`의 복원 UI를 연결한다.
  - 접힌 문서 카드의 쪽 범위와 상태바 페이지 수는 삭제되지 않은 페이지만 센다. 삭제된 페이지가 있으면 카드에 "n쪽 삭제됨" 배지.
  - 플로팅 바: 선택에 삭제된 페이지가 섞이면 "복원" 버튼을 함께 보인다.
  - 파일 단위 삭제(카드의 파일 삭제)는 지금처럼 영구 삭제로 둔다.
  - 완료 기준: 삭제 → 복원 후 병합 결과가 삭제 전과 같다(기존 특성 테스트 유지 + E2E 시나리오).
- **B11 선택:** 카드 본문 클릭 = 단일 선택, ⌘/Ctrl+클릭 = 추가·해제, Shift+클릭 = 범위(`selectRange`). 어떤 경로로든 삭제되면 선택 목록에서도 뺀다.
- **B12 오류 표시(시안 8):** 실패는 모두 사용자에게 보인다. 짧은 실패(파일 하나 읽기 실패, 다운로드 실패)는 토스트, 병합 실패는 진행 오버레이 자리에 원인 + 멈춘 단계 + 오류 코드 + "다시 시도 / 이 파일 빼기 / 닫기". 오류 코드 → 한국어 문구 표는 `shared/config/error-messages.ts` 한 곳에 둔다.
- **A1 나머지:** 단축키(Delete 삭제, ⌘/Ctrl+A 전체 선택, Esc 선택 해제), hover 버튼을 `:focus-within`에서도 보이기, 아이콘 버튼마다 `aria-label`, 진행 오버레이 `role="status"`, 전체 선택을 진짜 `<button>` 또는 `<label>`+체크박스로.

---

## 5. Phase 1 (Track A): Tauri v2 전환 + 기본 처리 Rust화

### P1-0 pdfium 스파이크 ★ (M, **Mac에서 가장 먼저**)
가장 막히기 쉬운 지점이므로 본 작업 전에 끝까지 검증한다.
1. `scripts/fetch-pdfium.mjs`: bblanchon/pdfium-binaries에서 **버전을 고정**해 타깃별 바이너리를 내려받는다. SHA-256으로 검증하고 `src-tauri/pdfium/<target-triple>/`에 둔다(gitignore).
   - macOS: `libpdfium.dylib`(arm64. universal이 필요하면 x64와 `lipo`로 합친다)
   - Windows: `pdfium.dll` / Linux: `libpdfium.so`
2. 번들 설정
   - macOS: `bundle.macOS.frameworks`에 dylib를 넣는다(`Contents/Frameworks/`). hardened runtime은 켜 두고 `Entitlements.plist`의 `com.apple.security.cs.disable-library-validation`으로 라이브러리 검증만 푼다. 라이브러리 검증이 Team ID 없는 ad-hoc 서명(`signingIdentity: "-"`) dylib의 `dlopen`을 막기 때문이다(Step 8에서 확인). Developer ID로 바꿀 때(P4-3) 앱과 dylib를 같은 Team ID로 서명하면 이 entitlement를 뺀다.
   - Windows/Linux: `bundle.resources`
3. 런타임 로드: `Pdfium::bind_to_library(<경로>)`. 경로는 플랫폼별로 결정한다(macOS `…/Contents/Frameworks/libpdfium.dylib`, 그 외 `resource_dir()`). 테스트와 개발에서는 환경변수 `PDFIUM_LIB_PATH`를 우선한다.
4. 검증: Step 9에서 만든 실제 앱(`src-tauri`, `crates/pdf-core`) 안에서(pdfium은 `cargo add -p pdf-core pdfium-render --features thread_safe`) PDF 1장 렌더 → `pnpm tauri build` → **ad-hoc 서명된 `.app`에서 실행** → `codesign --verify --deep --strict`가 통과한다.
- `thread_safe` 기능을 켠다. pdfium은 스레드 안전하지 않으므로 모든 호출을 **전용 작업 스레드 하나(큐)** 로 직렬화한다.
- 정적 링크(`static` 기능)는 pdfium을 직접 빌드해야 하므로 이번 범위에서 제외한다.
- **완료 기준:** Mac `.app`과 CI의 Windows 빌드에서 pdfium이 로드되고 렌더된다. (확인됨(CI): Windows·Linux에서 pdfium 로드 `cargo test` 통과, Windows NSIS 설치 파일 생성. 설치한 앱 실행은 미확인)

### P1-1 스캐폴드 (S)
- 키트로 만든다.
  ```bash
  pnpm add -D @tauri-apps/cli          # CLI가 있어야 아래 명령이 동작한다
  pnpm add @tauri-apps/api
  pnpm tauri init                      # src-tauri/ 생성 (앱 이름, 번들 ID, dev URL, 빌드 명령을 묻는다)
  cargo new --lib crates/pdf-core      # Tauri 의존 없는 처리 crate
  ```
  그 뒤 루트 `Cargo.toml`에 `[workspace]` 몇 줄만 직접 쓴다. `pdf-core` 의존성은 `cargo add -p pdf-core pdfium-render --features thread_safe`처럼 `cargo add`로 넣는다.
- 결과는 **Cargo workspace**로 구성한다.
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
  - `engine.rs`(Step 8): pdfium 라이브러리 경로 결정(`PDFIUM_LIB_PATH` 우선, 없으면 번들 폴더)과 프로세스 바인딩
  - `document.rs`: 문서 열기, 에러 타입(`thiserror`)
  - `info.rs`: 페이지 수, 페이지별 크기(MediaBox/CropBox), 회전. 원본 `/Rotate`의 비정상 값(-90, 450 등)은 0/90/180/270으로 정규화한다(B13).
  - `merge.rs`: 요청을 검증(빈 소스, 페이지 인덱스 범위)한 뒤 새 문서에 소스 페이지를 import하고 페이지별 회전을 **절대값으로 설정**(더하지 않음, B13)해 저장한다. **원자적 쓰기**(임시 파일에 쓴 뒤 rename)를 하고, Windows 공유 위반 시 재시도한다(기존 retry-write 로직 이식, `cfg(windows)`).
  - `tiff.rs`: `tiff` 크레이트로 멀티페이지를 디코드하고, 페이지마다 이미지 객체로 PDF 페이지를 만든다. 결과는 앱 캐시 디렉터리에 고유 이름으로 저장하고 `{ pdf_path, page_count, display_name }`을 돌려준다(B3, B15).
- **CCITT G4(스캔 문서에 흔한 압축)** 를 `tiff` 크레이트가 디코드하지 못하면, 압축을 풀지 않고 원본 스트립 데이터를 `CCITTFaxDecode` 이미지로 PDF에 그대로 넣는 경로를 둔다. 스파이크 때 확인한다.
- 테스트: 기존 `src/main/services/__tests__`의 케이스(병합 6, 편집 11 중 해당분, TIFF 4, 메타데이터 5) 중 핵심 동작만 Rust로 이식한다(상수·getter·중복 확인은 이식하지 않는다). **회전**, **멀티페이지 TIFF**, **CCITT G4**, **북마크가 있는 원본 병합** 케이스를 추가한다.
- **완료 기준:** `cargo test -p pdf-core`가 3개 OS CI에서 통과한다.

### P1-3 Tauri 커맨드와 작업 큐 (M, B4/S1)
| 커맨드 | 시그니처 | 비고 |
|---|---|---|
| `pick_files` | `() -> string[]` | Rust가 열기 다이얼로그를 연다. 형식 필터는 Rust의 허용 확장자다. 고른 경로를 허용 경로 목록에 기록한다(D13). |
| `pick_save_path` | `(options) -> string \| null` | Rust가 저장 다이얼로그를 연다. 고른 경로를 허용 경로 목록에 기록한다(D13). |
| `open_files` | `(paths) -> 파일별 결과[]` | 확장자 판별, TIFF 변환, 정보 조회를 한 번에 한다. 파일별 성공/오류를 돌려준다(B16, D14). 허용 경로 목록에 있는 경로만. |
| `read_pdf` | `(path) -> tauri::ipc::Response` | **pdf.js 표시용.** 허용 경로 목록(D13)에 있는 경로만. 확장자 화이트리스트, `canonicalize`, 크기 상한. `Vec<u8>`을 그대로 반환하면 JSON 숫자 배열이 되어 매우 느리다. |
| `merge_pdfs` | `(request, Channel<Progress>) -> MergeResult` | 출력 = `temp` \| `userPath`(사용자 경로는 `pick_save_path`로 받은 것만). 출력 경로가 입력 원본과 같으면(`canonicalize` 비교) 거부. 요청에 프론트가 만든 `job_id` 포함 |
| `copy_file` | `(source, destination)` | 소스는 이 실행의 세션 폴더(앱 임시 디렉터리) 하위만, 대상은 `pick_save_path`로 받은 경로만 허용. 대상이 사용자가 연 원본이면 거부. 임시 파일에 쓴 뒤 rename(pdf-core `copy_atomically`) |
| `cleanup_temp` | `()` | 이 실행의 세션 폴더만 비운다. 앱 임시 디렉터리는 `<시스템 임시>/<식별자>/session-<pid>-<시작 시각>/`처럼 실행마다 세션 폴더로 나누고, 병합 미리보기 결과는 자기 세션 폴더에만 쓴다. 종료 시 자기 세션 폴더를 지우고, 시작 시 다른 세션 폴더 중 24시간 넘게 손대지 않은 것만 지운다(여러 실행이 서로의 결과를 지우지 않는다) |
| `discard_temp` | `(path)` | 미리보기 결과 하나만 지운다. 이 실행의 세션 폴더 하위만 허용 |
| `compare_pdfs` | `(request, Channel<CompareProgress>) -> CompareResult` | 두 PDF 비교(P2-7 실행기 연결, Step 26). A·B는 허용 경로 목록 안의 PDF만, canonical 경로로 실행기에 넘긴다. 요청에 프론트가 만든 `job_id`와 옵션(`rangeA`·`rangeB`·줄 제외·`ignoreCase`) 포함. 쪽 범위 오류는 `INVALID_RANGE`. 계약·OCR 엔진 상태는 [ADR 0001](../adr/0001-compare-result-model.md) §16 |
| `cancel_job` | `(job_id)` | 병합·비교 작업 취소 |
- 모든 처리 커맨드는 `async` + **pdfium 전용 작업 스레드**로 위임한다. UI 스레드는 막히지 않는다.
- 진행률은 `tauri::ipc::Channel`로 보내고, 취소는 작업별 `Arc<AtomicBool>` 토큰으로 처리한다.
- **병합 진행률(시안 7):** 비교와 같은 `Progress` 모양을 쓴다. 단계 `readFiles`(파일, 가중치 20) → `mergePages`(쪽, 70) → `save`(10). 오버레이에 전체 %와 단계별 %·막대, "취소". 실패하면 같은 자리에 원인·멈춘 단계·오류 코드와 "다시 시도 / 이 파일 빼기 / 닫기"(시안 8).
- 에러는 `{ code, message, path }` 형태로 직렬화한다. `code`는 Rust `ErrorCode` enum이라 바인딩에 문자열 union으로 나오고, 프론트는 `code`로 P0-6의 `error-messages.ts` 문구를 찾아 토스트나 오버레이로 보여 준다(B12). `path`는 실패를 일으킨 입력 파일(알 때만)이고 병합 실패의 "이 파일 빼기"가 쓴다. `message`는 로그용이며 화면에 그대로 내보내지 않는다.
- **병합 취소(C1):** `merge_pdfs`도 작업 ID와 취소 토큰을 갖는다. 진행 오버레이에 "취소" 버튼, 취소되면 임시 파일을 지운다. (`cancel_job`은 Phase 1부터 쓴다.)
- **입력 상한(I1):** `pdf-core`의 상수로 둔다. 시작값: 파일 하나 `MAX_INPUT_FILE_BYTES` = 512MB, 병합 입력 `MAX_MERGE_FILES` = 200개, 비교 문서 `MAX_COMPARE_PAGES` = 2,000쪽(넘으면 `Truncated` 안내). 넘으면 `InputTooLarge` 에러로 거부하고 화면에 이유를 보인다. 측정 후 조정한다.
- 타입은 `tauri-specta`로 TS 바인딩을 생성해 `src/shared/contracts`를 대체한다. 생성 파일은 `src/renderer/shared/api/bindings.ts`이고 커밋한다. `cargo test`의 `exports_typescript_bindings`가 다시 만들며, 경계 타입에 JS 숫자로 보낼 수 없는 타입(`usize`·`u64`)이 들어오면 실패한다. 경계의 개수·번호는 `u32`다.
- **Rust가 정본이다:** 회전값·오류 코드는 specta 생성 타입을 쓰고, 허용 확장자·입력 상한은 Rust에서 받아 온다(TS에 숫자·목록을 다시 적지 않는다).
- 사용할 플러그인: `dialog`, `log`, `store`, `opener`, `window-state`. **`fs` 플러그인은 쓰지 않는다**(커스텀 커맨드에서 경로를 검증해 권한 표면을 최소화).
  - 플러그인은 하나씩 `pnpm tauri add <이름>`으로 넣는다. 이 명령이 Cargo 의존성, npm 패키지, `lib.rs`의 `.plugin(...)` 등록, 기본 권한을 함께 처리한다. 이 단계에서는 `dialog`, `log`, `opener`를 넣고, `store`와 `window-state`는 P1-5에서 넣는다.
  - `tauri-specta`는 `cargo add -p <src-tauri 패키지> tauri-specta specta`로 넣는다(버전과 기능 플래그는 tauri-specta README를 따른다).

### P1-4 Tauri 어댑터와 드롭 (M)
- `tauri-platform.ts`에서 `DesktopPlatform`을 구현한다.
- 드롭 처리
  - `onDragDropEvent`의 `position`은 타입이 **PhysicalPosition**이지만 실제 단위는 웹뷰마다 다르다(wry 0.57). WebView2(Windows)는 클라이언트 영역 물리 픽셀이므로 `/ window.devicePixelRatio`로 CSS 좌표로 바꾸고, WKWebView(macOS)·WebKitGTK(Linux)는 이미 논리(CSS) 픽셀이라 그대로 쓴다. 변환은 `shared/platform/native-file-drop.ts` 한 곳에서 하고 mock 플랫폼도 같은 함수를 쓴다.
  - `document.elementFromPoint`로 드롭 대상(슬롯, 그리드 위치)을 판정한다.
  - enter/over/leave로 드롭 오버레이 UI를 갱신한다.
- 어댑터 동작은 `mock-platform` 기반 E2E로 확인한다(어댑터 전용 단위 테스트는 두지 않는다).

### P1-5 보안, 테마, 창 (S, B7/S1)
- CSP를 `tauri.conf.json > app.security.csp`로 옮긴다(`index.html`의 meta는 지운다).
  - animatedicons를 제거한다(스크립트만 로드되고 쓰는 곳은 없었다).
  - 실제 값: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost https://firestore.googleapis.com; object-src 'none'; base-uri 'self'`
  - Tauri는 이 CSP를 `tauri://` 자산 중 HTML 응답에만 붙인다. 데스크톱 `tauri dev`는 Vite 개발 서버를 직접 띄우므로 적용되지 않는다(브라우저 E2E도 같다). 빌드 HTML에 인라인 `<style>`이 없어 Tauri가 style nonce를 넣지 않으므로 `'unsafe-inline'`(Radix·sonner가 런타임에 넣는 스타일)이 그대로 효력을 갖는다.
  - error-snapshot용 `connect-src`는 Firestore(`https://firestore.googleapis.com`) 하나다. 화면 캡처를 보내지 않으므로 Storage 주소는 넣지 않는다.
- 앱 origin이 바뀌므로(`tauri://localhost`, `http://tauri.localhost`) Firebase API 키에 HTTP 리퍼러 제한이 있으면 허용 목록을 갱신한다.
- capabilities는 `main` 창 하나에만 연결하고, 필요한 권한만 둔다. 권한은 `pnpm tauri permission add <권한 ID>`로 넣고 `pnpm tauri permission ls`로 확인한다. capability 파일을 새로 만들어야 하면 `pnpm tauri capability new`를 쓴다. `tauri add`가 넣은 기본 권한 중 쓰지 않는 것은 `permission rm`으로 뺀다.
  - 실제: `store:default` 대신 `store:allow-load`·`allow-get`·`allow-set`·`allow-save`(`LazyStore`가 부르는 것만). `window-state`는 Rust에서만 쓰므로 권한(`window-state:default`)과 JS 패키지를 뺐다.
- 플러그인 추가: `pnpm tauri add store`, `pnpm tauri add window-state`
- 테마: `matchMedia` 구독 + 수동 설정(`system|light|dark`)을 `plugin-store`로 영속화한다.
  - 프론트는 `DesktopPlatform.getSetting/setSetting`만 쓴다(`plugin-store` import는 `tauri-platform.ts`에서만, 파일은 앱 데이터 폴더의 `settings.json`). mock은 메모리, 개발 서버(E2E)는 `localStorage`.
  - 설정 키: `theme`(`system|light|dark`), `errorReporting.enabled`(boolean), `errorReporting.noticeShown`(boolean).
  - 상태는 `features/theme-toggle`의 스토어, `.dark` 토글과 `system`일 때의 `matchMedia` 구독·해제는 `app/providers/theme-provider.tsx`. 부팅 때 저장된 테마를 읽어 적용한 뒤 첫 화면을 그린다(읽는 동안은 OS 설정). 토스트도 같은 테마를 따른다.
- 메뉴: macOS 기본 메뉴(편집 단축키 포함)를 확인한다. 이후 `파일 > 열기 (⌘O)` 등을 추가한다.
  - macOS는 Tauri 기본 메뉴(`Menu::default`)를 그대로 쓴다: 앱(정보·서비스·가리기·종료), 파일(창 닫기), 편집(실행 취소·다시 실행·잘라내기·복사·붙여넣기·전체 선택), 보기(전체 화면), 창, 도움말. 편집 단축키는 이 메뉴로 동작한다. `파일 > 열기`는 아직 넣지 않았다.
- 창 크기와 위치는 `plugin-window-state`로 기억한다. 표시 여부(`VISIBLE`)는 기억하지 않는다 — 창 설정(`visible`)을 따른다.
- **최소 창 크기(W1):** `tauri.conf.json`의 창에 `minWidth: 1120`, `minHeight: 720`. 비교 화면(목록 340px + 페이지 두 장 + 거터 120px)이 깨지지 않는 크기다. 처음 크기는 1280×800(최소보다 작게 열리지 않게).
- **에러 스냅샷 점검(S2):**
  - 라이브러리 기본 Firebase 프로젝트가 아니라 **이 앱 전용 설정**을 넘긴다.
  - 보내는 필드를 확인하고, 파일 경로·파일 이름은 보내기 전에 지운다(예: 홈 디렉터리 → `~`, 파일 이름 → 확장자만).
  - 처음 실행할 때 오류 보고를 안내하고, 설정에서 끌 수 있게 한다(`plugin-store`에 저장).
  - 실제 결정
    - 앱 전용 설정은 빌드 환경 변수로만 받는다: `VITE_ERROR_SNAPSHOT_FIREBASE_API_KEY`, `_PROJECT_ID`, `_STORAGE_BUCKET`(필수), `_AUTH_DOMAIN`, `_MESSAGING_SENDER_ID`, `_APP_ID`(선택). 이름은 `.env.example`, 값은 `.env.local`(커밋하지 않음). **필수 값이 없으면 오류 보고 기능 자체가 꺼진다**(버튼·안내도 없음). 공개 레포라 기본값은 꺼짐이다.
    - 라이브러리(와 Firebase)는 처음 보낼 때 동적 import한다. 라이브러리의 React 경계·훅·전역 핸들러는 쓰지 않고 앱의 `reportError`(`shared/lib/error-report`) 한 곳으로 보낸다.
    - 보내는 필드: 메시지, 스택, 추가 필드(meta), 오류 코드, 시각, User-Agent, 앱 URL(`tauri://localhost/`). 화면 캡처는 파일 이름이 보이므로 보내지 않는다(`captureTarget`이 실패해 라이브러리가 캡처 없이 보낸다).
    - 마스킹(`maskSensitiveText`, 순수 함수): 확장자가 있는 경로 → `*.확장자`, 확장자가 없는 경로 → 홈 아래면 `~/…` 아니면 `…`, 경로 없는 문서 이름(`.pdf`·`.tif`·`.tiff`) → `*.확장자`. POSIX·`~`·Windows 드라이브·UNC·`file://`를 찾고 `scheme://host/…` URL은 그대로 둔다. 메시지·스택·meta의 모든 문자열에 적용한다. 공백이 든 경로 없는 파일 이름(`계약 최종.pdf`)은 마지막 단어만 지워진다.
    - 사용자 설정: 기능이 있는 빌드에서 기본은 켜짐. 첫 실행 때 안내 토스트(끄기 버튼 포함)를 한 번 띄우고, 아래 도구 막대의 오류 보고 버튼으로 켜고 끈다. 저장된 설정을 읽기 전에는 보내지 않는다.

### P1-6 Electron 제거와 문서 갱신 (S)
- 삭제: `forge.config.mts`, `src/main`, `src/preload`, electron 관련 deps, **`pdf-lib`, `sharp`, `fs-extra`**, `icon.ico`. 루트 `icon.icns`는 P1-7의 아이콘 원본이라 그때 추출한 뒤 지운다(→ `src-tauri/icons`).
- 갱신: `README`, `docs/01~05`(IPC 스펙 → Tauri 커맨드 스펙), `.claude/agents/ipc-architect.md` → Tauri 커맨드/capability/pdf-core 기준, `implement`/`check` 스킬의 검증 명령(`cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` 추가)

### P1-7 아이콘, 로컬 빌드 (S)
- 1024px PNG 원본을 만들고(`icon.icns`에서 추출) `pnpm tauri icon`을 실행한다.
- Mac에서 `pnpm tauri build`로 `.app`/`.dmg`를 만든다. Windows는 CI로 확인한다.

### Phase 1 완료 기준 (기능 동등성 체크리스트)
- [ ] 다이얼로그 및 드롭으로 PDF/TIFF 추가, 위치 지정 삽입
- [x] 썸네일, 펼치기, 파일 간 페이지 재정렬(마우스·키보드), 페이지 삭제와 화면에서 복원(B10)
- [x] 클릭·⌘·Shift 선택, 단축키(Delete, ⌘A, Esc)
- [ ] 회전(비파괴), 전체/선택 병합(진행률·UI 비차단·취소), 미리보기, 저장, 임시파일 정리
- [x] 모든 실패가 토스트나 오버레이로 보인다(B12)
- [ ] 테마(시스템 추종 + 수동), 버전 표시, 에러 스냅샷 전송
- [ ] macOS, Windows, Linux에서 실행 (Windows/Linux는 CI 아티팩트로 확인. 확인됨(CI): Windows NSIS 설치 파일 생성, Windows·Linux `cargo test`. 설치한 앱 실행은 미확인)

---

## 6. Phase 2 (Track B): Rust 비교 엔진 (`crates/pdf-core/src/compare/`)

> Tauri와 무관하게 `cargo test`로 개발한다. Phase 1(마이그레이션)이 끝난 뒤 시작하고, `pdf-core`의 문서 열기 API(P1-2 `document.rs`)를 그대로 가져다 쓴다.
>
> 비교 기능의 목적은 계약서를 정확하게 비교하는 것이다. 이번 버전은 ① 텍스트 레이어 비교(§6.2) ② 스캔 계약서 OCR 비교(§6.4)를 한다. 한쪽은 텍스트 레이어, 다른 쪽은 스캔이어도 비교된다. 스타일·레이아웃·이미지 비교는 Phase 5(§9)다.

### 6.0 엔진 선택 기록

| | A. TS + pdf.js | **B. Rust + pdfium (채택)** | C. 개인 Python 사이드카 | D. 사내 엔진 재사용 |
|---|---|---|---|---|
| 박스 정밀도 | run 단위, 글자는 근사 | **글자 단위** | 글자 단위 | 글자 단위, 성숙 |
| 배포 부담 | 없음 | pdfium 라이브러리 1개 번들·서명 | 플랫폼별 PyInstaller, 약 50MB, 기동 1~3초, 프로세스 관리 | C와 같음 |
| 공개 레포 | 가능 | 가능 | 가능 | **불가** |

- B를 채택한다. 사이드카 수준의 정밀도를 별도 프로세스 없이 얻는다.
- D는 회사 코드라 이번 범위에서 제외한다. 결과 계약(§6.1)을 안정적으로 유지해 두면, 승인이 나는 경우 비공개 빌드에서 엔진만 교체하는 것도 가능하다.

### 6.1 결과 모델 (P2-1, S): ADR로 고정

> **정본은 [ADR 0001](../adr/0001-compare-result-model.md)이다.** 필드의 의미, 쪽 번호(0부터), `page_pair`, `Change.id` 계산(SHA-256), 정렬, 앵커 계산(§4), `needs_review` 판정, `Notice` 데이터, 계약 JSON 모양은 그 문서를 따른다. 아래는 요약이고, 다르면 ADR이 맞다. Step 28-b에서 변경의 두 쪽을 `Option<ChangeSide>`에서 `Placement`(상자 | 앵커)로 바꿨다(§7.1 사용자 명세).

```rust
// crates/pdf-core/src/compare/model.rs. 계약 타입(serde + specta)은 src-tauri/contract.rs에 같은 모양으로 둔다
pub enum Side { Before, After }
pub struct TextBox { pub page: u32, pub x: f32, pub y: f32, pub w: f32, pub h: f32 } // PDF 사용자 공간 pt, 좌하단 원점, /Rotate 적용 전, CropBox 원점 포함
pub enum ChangeKind { Insert, Delete, Replace }
pub enum TextSource { TextLayer, Ocr }  // 페이지 글자를 어디서 얻었나
pub enum Placement {                    // 변경의 한쪽이 그 문서에 놓이는 곳
    Boxes {                             // 그 쪽에 글자가 있다
        text: String,
        boxes: Vec<TextBox>,            // 비어 있지 않다. 같은 줄 이웃 글자는 줄 단위 사각형 하나
        min_confidence: Option<f32>,    // OCR 토큰이 섞이면 그중 가장 낮은 신뢰도(0~1). 텍스트 레이어만이면 None
    },
    Anchor { page: u32, x: f32, y: f32, h: f32 }, // 글자가 없다(삽입의 before, 삭제의 after): 들어갈 자리
}
pub type PagePair = (Option<u32>, Option<u32>); // (A 쪽, B 쪽), 0부터. 짝이 없으면 None
pub struct Change {
    pub id: String,                  // 안정 키: SHA-256(정규화 토큰 + 앞뒤 공통 토큰 3개) — 재실행해도 동일
    pub kind: ChangeKind,            // Insert = (Anchor, Boxes), Delete = (Boxes, Anchor), Replace = (Boxes, Boxes)
    pub before: Placement,
    pub after: Placement,
    pub page_pair: PagePair,         // 각 쪽 첫 상자의 쪽(앵커 쪽은 None)
    pub needs_review: bool,          // OCR 신뢰도 기준 미만 토큰·OCR 띄어쓰기만/문장부호만 다른 치환 = "확인 필요"(§6.4). 차이 개수와 따로 센다
}
pub struct PageSize { pub view_box: PageBox, pub rotation: PageRotation } // view_box = CropBox ∩ MediaBox(pdf.js page.view)
pub struct PageSizes { pub before: Vec<PageSize>, pub after: Vec<PageSize> }                         // 색인 = 쪽 번호
pub struct PageSources { pub before: Vec<Option<TextSource>>, pub after: Vec<Option<TextSource>> } // 범위 밖 쪽은 None
pub enum NoTextReason { OcrUnavailable, OcrFailed }
pub enum Notice {
    LowTextConfidence { side: Side, pages: Vec<u32> },
    NoTextLayer { side: Side, reason: NoTextReason, pages: Vec<u32> }, // OCR도 못 한 쪽
    Truncated { before_pages: Vec<u32>, after_pages: Vec<u32> },       // diff 시간 제한으로 통째 치환한 구간
}
pub struct CompareResult {
    pub changes: Vec<Change>,                 // diff 순서
    pub page_pairs: Vec<PagePair>,            // 화면 행 순서. 삽입/삭제 페이지는 None
    pub page_sizes: PageSizes,
    pub page_sources: PageSources,
    pub notices: Vec<Notice>,
}
```
좌표는 PDF 원본 좌표(CropBox 원점이 이미 들어간 사용자 공간 좌표)로 저장한다. 화면 변환은 pdf.js `viewport.convertToViewportRectangle`이 담당하고, 프론트는 원점을 보정하지 않는다. 회전이나 확대가 바뀌어도 결과를 다시 계산할 필요가 없다. OCR로 얻은 글자 상자도 같은 좌표 규칙으로 바꿔 넣는다(§6.4).

### 6.2 파이프라인
1. **추출 (P2-2, M)**
   - pdfium 페이지 텍스트에서 글자별 `{ char, bounds, font_size }`을 얻는다. 박스는 tight bounds를 기본으로 한다. `font_name`은 쓰는 곳(Phase 5 스타일 비교)이 생길 때 더한다. 화면 밖(`view_box`와 겹치지 않는) 글자 제외, `/Rotate`와 상관없는 글자 순서, pdfium이 만든 공백·줄바꿈 표시, `OCR_MIN_TEXT_CHARS` 값은 [ADR 0001](../adr/0001-compare-result-model.md) §8이 정본이다.
   - **좌표계 일치 검증(중요):** pdfium 좌표와 pdf.js 화면 좌표가 CropBox/MediaBox 원점 오프셋, `/Rotate` 페이지, `UserUnit`에서 일치하는지 pdfium 박스는 Rust golden 테스트로 고정하고, 화면 박스와의 일치는 E2E로 확인한다. 원점 보정은 Rust가 박스에 이미 넣고 프론트는 보정하지 않는다([ADR 0001](../adr/0001-compare-result-model.md) §2). `page_sizes.view_box`가 pdf.js `page.view`와 같은지도 확인한다.
   - 텍스트 레이어가 없거나 글자 수가 `OCR_MIN_TEXT_CHARS` 미만인 페이지(스캔본)는 OCR 경로(P2-4a, §6.4)로 글자를 얻는다. OCR로도 글자를 얻지 못하면(모델 파일 없음, OCR 실패) `NoTextLayer`로 알린다.
2. **정규화와 토큰화 (P2-3, M)**
   - Unicode 정규화(NFC/NFKC 옵션, `unicode-normalization`), 공백과 줄바꿈 정리, 하이픈 줄바꿈 결합, 대소문자 무시 옵션
   - 토큰 단위는 **단어**(공백 기준, 한글 포함)이고, 각 토큰은 구성 글자의 박스 목록을 가진다. replace 구간 내부는 **글자 단위 2차 diff**로 정밀 하이라이트한다.
   - 대체 문자(U+FFFD)나 PUA 비율이 높으면 `LowTextConfidence`로 표시한다(ToUnicode가 깨진 PDF).
   - 토큰 경계, 하이픈 줄바꿈 결합 규칙, 정규화 뒤 글자별 상자 대응, `LOW_TEXT_CONFIDENCE_RATIO` 값은 [ADR 0001](../adr/0001-compare-result-model.md) §9가 정본이다.
3. **정렬과 diff (P2-4, L)**
   - 문서 전체 토큰열끼리 비교해 페이지 경계를 넘는 이동이나 밀림에 대응한다.
   - 대용량 대응: ① 양쪽에 한 번씩만 나오는 **토큰 키**로 Patience 앵커(LIS)를 잡고 ② 앵커 사이 구간은 앞뒤 공통 토큰을 떼어 낸 뒤 `similar` Myers로 비교한다(시간 제한 `DIFF_TIME_LIMIT`). 띄어쓰기만 다른 묶음은 변경에서 제외한다. 정본은 [ADR 0001](../adr/0001-compare-result-model.md) §10.
   - 인접한 delete와 insert는 replace로 묶는다. 같은 줄에서 인접한 박스는 줄 단위 사각형으로 병합한다(같은 높이의 다른 단은 가로 간격 한도로 나눈다).
   - 한쪽에만 있는 변경(삽입·삭제)의 빈 쪽은 반대쪽 문서의 들어갈 자리(앵커)로 둔다. 반대쪽 토큰열의 이웃 공통 토큰으로 정하고, 반대쪽에 토큰이 없으면 쪽 짝의 여백에 둔다. 정본은 [ADR 0001](../adr/0001-compare-result-model.md) §4(Step 28-b).
4. **페이지 짝짓기 (P2-5, M)**
   - 페이지 쌍별 매칭 토큰 수 행렬을 만들고, 단조 증가 최대 가중 경로(LIS 계열)로 짝을 짓는다. 남는 페이지는 삽입 또는 삭제 페이지가 된다.
   - 입력(diff의 공통 토큰 짝 `TokenDiff.matches`), 동률 처리, 짝 없는 쪽(빈 쪽 → 개수가 같으면 차례로 → 아니면 A만 있는 행 먼저) 규칙은 [ADR 0001](../adr/0001-compare-result-model.md) §12가 정본이다.
5. **옵션 (P2-6, S)**
   - 페이지 범위는 **A·B 따로**(`range_a`, `range_b`, 각각 `"1,3-5"`, 비우면 전체). 쪽수를 넘으면 `InvalidRange` 에러.
   - 반복 줄 제외는 **머리말, 꼬리말, 쪽번호를 따로** 켠다(상단/하단 N pt 밴드, 쪽번호는 하단 밴드 안의 숫자만 있는 줄). 양쪽 문서에 같이 적용한다. 자동 머리글 감지는 Phase 5로 미룬다.
   - 대소문자 무시.
6. **작업 실행기 (P2-7, S)**
   - 진행 단계를 `Channel`로 보고하고, 취소 토큰을 단계마다(추출과 OCR은 쪽마다) 확인한다.
   - **진행률 이벤트(작업별 %):** `Progress { job_id, stage, done, total, stage_percent, overall_percent, detail }`. 화면(시안 9)은 단계마다 %와 막대, 위에 전체 %를 보인다. 단계는 6개다.
     | 단계 `stage` | 화면 이름 | `done / total` 단위 | 전체 가중치 |
     |---|---|---|---|
     | `extract_a` | A 문서 읽기 | 쪽 | 20 |
     | `extract_b` | B 문서 읽기 | 쪽 | 20 |
     | `ocr` | 스캔 쪽 글자 읽기 | OCR 대상 쪽(A·B 합) | 30 |
     | `normalize` | 글자 정리 | 쪽 | 5 |
     | `diff` | 차이 찾기 | 앵커 사이 구간 | 15 |
     | `align_pages` | 쪽 맞추기 | 페이지 쌍 행 | 10 |
   - 경계 계약(`CompareProgress.stage`)의 직렬화 값은 병합 단계(`readFiles`)와 ADR 0001 §7처럼 camelCase다: `extractA`·`extractB`·`ocr`·`normalize`·`diff`·`alignPages`(위 표의 snake_case는 단계 이름일 뿐이다, Step 26).
   - `overall_percent = Σ(stage_percent × 가중치) / 100`. 가중치는 `pdf-core`의 상수이고, 실제 소요 시간을 측정해 조정한다. 추출 캐시가 맞으면 그 단계는 바로 100%로 보고한다. OCR 대상 쪽이 없거나 모든 쪽이 OCR 캐시에 맞으면 `ocr` 단계도 바로 100%로 보고한다.
   - 이벤트는 단계 안에서 최소 1% 단위로만 보낸다(쪽마다 보내면 큰 문서에서 IPC가 넘친다). `%`는 정수로 내림해 100%는 실제로 끝났을 때만 보인다.
   - **추출 결과 캐시:** (파일 경로, 크기, mtime) 또는 해시를 키로 메모리 LRU에 둔다. 옵션만 바꿔 다시 실행할 때 추출을 건너뛴다. OCR 결과는 파일 해시를 키로 앱 캐시 디렉터리에 따로 저장한다(§6.4).
   - 단계 단위·`detail`·바로 100%·취소 지점·캐시 키와 값·OCR 범위·측정값(100쪽 텍스트 짝 167 ms, 스캔 쪽당 약 0.6~1초)·렌더/추론 스레드 판단은 [ADR 0001](../adr/0001-compare-result-model.md) §15가 정본이다.
7. **리포트 내보내기 (P2-8, M)**
   - **비교 PDF:** pdfium으로 새 문서를 만들고 A4 가로 한 장에 좌우 페이지를 배치한다. 옵션: 배치(`side_by_side | a_only | b_only`), 차이 있는 쪽만(`changed_pages_only`), 색 상자 넣기(`draw_boxes`). 화면의 필터(숨긴 종류)를 그대로 받는다.
   - **주석 PDF:** B 문서를 복사해 변경 영역마다 Highlight/Square 주석(색, 내용=변경 전후 텍스트)을 단다. 원본은 건드리지 않는다.
   - 둘 다 원자적 쓰기. 미리보기용으로 첫 N장을 렌더해 돌려주는 `preview_compare_report`를 둔다.
   - 배치·빈 칸·상자 모양(확인 필요 구별)·삭제 주석 위치·저장·취소·미리보기 규칙은 [ADR 0001](../adr/0001-compare-result-model.md) §14가 정본이다.

### 6.3 테스트 전략
- **픽스처:** 작은 PDF를 레포에 커밋하고(`crates/pdf-core/tests/fixtures/`), 생성 스크립트도 함께 둔다. 원본과 변형(단어 삽입/삭제/치환, 문단 이동, 페이지 삽입/삭제, 회전 페이지, CropBox 오프셋)을 만들고 기대 결과 JSON(golden)과 비교한다.
- **한글:** OFL 폰트(예: Noto Sans KR 서브셋)를 임베드한 픽스처로 CID 폰트 경로를 검증한다.
- **스캔본:** 가상 계약서 텍스트 PDF를 렌더해 만든 스캔 픽스처로 OCR 경로를 검증한다(§6.4).
- **좌표 일치:** pdfium 박스는 Rust golden 테스트로 고정한다. pdf.js 화면 박스와의 일치는 E2E로 확인한다(같은 픽스처를 띄워 하이라이트 박스 위치를 확인, CropBox 오프셋·회전 페이지 포함).
- **쓰지 않는 테스트:** 상수 값 확인, 단순 getter, 자명한 enum↔문자열 매핑, 라이브러리 자체 동작, 중복 확인. 「이 테스트를 실패시킬 production 변경」을 한 줄로 말할 수 없으면 쓰지 않는다.
- **프론트:** 새 단위 테스트(Vitest)를 쓰지 않는다. 검증은 Playwright E2E로 한다(§10.2).
- **성능 회귀:** 500페이지 합성 문서의 처리 시간과 메모리를 기록한다(`cargo test --release`, CI에서는 완화된 기준).

### 6.4 스캔 계약서 OCR (P2-2a 스파이크 ★, P2-4a 연결)

텍스트 레이어가 없는 스캔 계약서도 텍스트 비교와 같은 결과(`CompareResult`)로 비교한다. OCR은 추출 단계의 한 경로다. 그 뒤의 정규화·토큰화·diff·페이지 짝짓기는 텍스트 레이어와 같은 코드를 쓴다.

**엔진 선택**
- **채택: PaddleOCR(PP-OCR) 한국어 검출+인식 모델을 ONNX로 변환한 것 + ONNX Runtime(Rust `ort` 크레이트).**
  - Mac과 Windows가 같은 모델·같은 런타임을 쓰므로 같은 입력에 같은 결과가 나온다. 계약서 비교는 정확도가 중요해서 플랫폼마다 결과가 달라지면 안 된다.
  - 한국어 인식 모델이 따로 있어 한국어 정확도가 높다.
  - 라이선스가 화이트리스트 안이다(모델 Apache-2.0, ONNX Runtime MIT, `ort` MIT/Apache-2.0, §1.2).
  - 처리가 기기 안에서 끝난다. 계약서가 밖으로 나가지 않는다.
- 실제 모델 이름·버전, ONNX 변환 방식(공개된 변환본을 받을지, 변환 도구로 미리 변환해 둘지), `ort`의 버전과 기능 플래그는 스파이크(P2-2a)에서 확정해 이 절에 기록한다. 변환은 앱 빌드 때 하지 않고, 변환된 ONNX 파일의 출처·버전·SHA-256을 고정한다.
  - 스파이크에서 고른 값은 아래 「P2-2a 스파이크 결과」에 있다(공개 변환본 사용, PP-OCRv5).

| 버린 대안 | 이유 |
|---|---|
| macOS Vision + Windows.Media.Ocr (OS 내장) | Windows의 한국어 품질이 낮고 한국어 언어 팩 설치가 필요하다. 플랫폼마다 엔진이 달라 같은 계약서의 결과가 달라진다. |
| Tesseract | 한국어 정확도가 낮다. |
| 클라우드 OCR | 계약서를 외부로 보낼 수 없다. |

**파이프라인**
1. **OCR 대상 판정:** 추출(P2-2)에서 페이지의 텍스트 레이어 글자 수가 `OCR_MIN_TEXT_CHARS` 미만이면 OCR 대상으로 표시한다. 스캐너가 넣은 숨은 글자층(검색 가능한 PDF)은 텍스트 레이어로 취급한다(품질이 낮으면 `LowTextConfidence`).
2. **렌더:** pdfium으로 페이지를 고정 해상도 `OCR_RENDER_DPI`(400dpi. 시작값 300에서 P2-2a 측정으로 올렸다)로 렌더한다. 렌더만 pdfium 작업 스레드에서 하고 추론은 별도 작업 스레드에서 한다. OCR이 pdfium 큐를 오래 잡아 병합을 막지 않게 하기 위해서다. 렌더 이미지는 메모리에만 두고 디스크에 쓰지 않는다.
3. **기울기 보정(필요 시):** 기울기를 추정해 `OCR_DESKEW_MIN_DEGREES` 이상이면 바로 세우고, 보정 변환을 좌표 되돌리기용으로 기록한다. 방법은 스파이크에서 정한다. 보정 없이 합격 기준을 넘으면 넣지 않는다.
4. **검출 → 인식:** 검출 모델로 줄 상자를 찾고, 인식 모델로 줄마다 글자와 신뢰도를 얻는다. 결과는 단어/글자별 `{ text, bounds, confidence }`다. 글자 위치는 인식 결과의 글자별 위치 정보로 줄 상자를 나눠 얻는다. 글자 단위가 안 되면 단어 단위 상자로 낮춘다(그 경우 하이라이트가 단어 단위가 된다). 어느 쪽인지 스파이크에서 확인한다.
5. **좌표 되돌리기:** 렌더 픽셀 좌표를 텍스트 추출과 같은 좌표 규칙(§6.1: PDF pt, 좌하단 원점, `/Rotate` 적용 전)으로 바꾼다. 순서는 기울기 보정의 역변환 → `× 72 / OCR_RENDER_DPI`와 y 뒤집기(픽셀은 좌상단 원점) → 렌더에 적용된 `/Rotate` 되돌리기 → CropBox 원점 오프셋 더하기다.
6. **이후 단계:** OCR 글자를 텍스트 레이어 글자와 같은 형태로 만들어 기존 정규화·토큰화(P2-3), diff(P2-4), 페이지 짝짓기(P2-5)에 그대로 넣는다. 페이지마다 출처(`TextSource`)를 `page_sources`에 기록한다. 한쪽은 텍스트 레이어, 다른 쪽은 스캔이어도 비교된다.

**신뢰도와 "확인 필요"** (정본은 [ADR 0001](../adr/0001-compare-result-model.md) §5·§9)
- 토큰 신뢰도는 토큰을 이루는 글자 신뢰도의 최솟값이다. 변경의 각 쪽에는 그중 가장 낮은 값을 `min_confidence`로 담는다.
- 기준은 일반 토큰 `OCR_MIN_CONFIDENCE` 0.80, 숫자·금액·날짜 토큰 `OCR_MIN_CONFIDENCE_NUMERIC` 0.95다(P2-2a에서 시작값 그대로 확정). 계약서에서 중요한 숫자는 더 엄격하게 본다. 숫자가 하나라도 든 토큰을 숫자 토큰으로 본다.
- 기준 미만 토큰이 걸린 변경은 `needs_review = true`다. 화면은 이를 차이 개수와 따로 "확인 필요"로 보인다. 오인식이 차이처럼 보이지 않게 하기 위해서다.
- OCR 쪽이 섞인 변경 중 띄어쓰기만 다른 치환도 `needs_review`로 둔다. OCR은 띄어쓰기를 자주 틀린다.
- OCR 쪽이 섞인 변경 중 **문장부호만(유니코드 일반 범주 P\*) 다른 치환**도 `needs_review`로 둔다(2026-10-13 사용자 결정). OCR은 문장 끝 마침표·쉼표를 높은 신뢰도로 빠뜨리거나 곧은/굽은 따옴표·괄호 모양을 바꿔 읽는다(P2-2a 측정). 빠진 글자에는 신뢰도가 없어 신뢰도 기준으로는 잡히지 않는다.
- **OCR 쪽이 있는 비교는 NFKC로 정규화한다.** 어느 쪽이든 OCR 쪽이 하나라도 있으면 두 문서 모두 `NormalizeOptions.form = Nfkc`(P2-3)를 사용자 옵션과 상관없이 강제한다. OCR은 원문자 번호(①)·전각 문자를 일반 문자로 읽기 때문이다(P2-2a 로컬 측정에서 NFKC 없이 조용한 오인식 43건 → NFKC로 0건). 연결은 P2-4a에서 한다.
- 신뢰도가 높은데 틀린 글자(조용한 오인식)는 이 장치로 걸러지지 않는다. 그래서 스파이크 합격 기준에 숫자 토큰의 조용한 오인식 0건을 둔다. 숫자 토큰의 일치·조용한 오인식은 토큰 끝 `.`·`,`를 뺀 부분으로 판정한다(위 문장부호 규칙으로 그 차이는 확인 필요가 되므로).

**성능, 취소, 캐시**
- OCR은 비교 작업 실행기(P2-7)의 `ocr` 단계다. OCR 대상 쪽이 없으면 그 단계는 즉시 100%다.
- 쪽마다(렌더 뒤, 추론 뒤) 취소 토큰을 확인한다. 렌더 이미지는 메모리에만 있으므로 취소해도 남는 임시 파일이 없다.
- **OCR 캐시:** 쪽별 OCR 결과를 `(파일 SHA-256, 쪽 번호, 모델 버전, OCR_RENDER_DPI)`를 키로 앱 캐시 디렉터리에 저장한다. 옵션만 바꾼 재실행과 같은 파일의 다음 비교에서 다시 OCR하지 않는다. 모델이나 DPI가 바뀌면 키가 달라져 다시 읽는다. 캐시 디렉터리 경로는 `src-tauri`가 넘긴다(`pdf-core`는 Tauri 경로 API를 모른다). 용량 상한 `MAX_OCR_CACHE_BYTES`를 넘으면 오래된 것부터 지운다.
- 추론 스레드 수는 측정 후 조정한다. 쪽당 처리 시간 상한은 스파이크 합격 기준으로 둔다.

**배포**
- `scripts/fetch-ocr.mjs`: `fetch-pdfium.mjs`처럼 **버전을 고정**해 타깃별 ONNX Runtime 동적 라이브러리와 OCR 모델 파일을 내려받고 SHA-256으로 검증한다. 라이브러리는 `src-tauri/onnxruntime/<target-triple>/`, 모델은 `src-tauri/ocr-models/`에 둔다(gitignore).
- 번들: macOS는 ONNX Runtime dylib를 `bundle.macOS.frameworks`(`Contents/Frameworks/`)에, 모델은 `bundle.resources`에 넣는다. Windows/Linux는 둘 다 `bundle.resources`다.
- 런타임 로드: `ort`의 동적 로드 방식으로 라이브러리 경로를 지정한다. 경로 결정은 pdfium처럼 `pdf-core` 한 곳에서 하고, 개발·테스트는 환경변수 `ONNXRUNTIME_LIB_PATH`, `OCR_MODEL_DIR`을 우선한다. 런타임이나 모델이 없으면 OCR 대상 쪽은 `NoTextLayer`로 알리고 비교는 계속한다.
- macOS 서명은 pdfium과 같다. hardened runtime을 켜 두고 기존 `com.apple.security.cs.disable-library-validation` entitlement를 그대로 쓴다. ONNX Runtime dylib도 앱과 같은 identity로 서명한다(P4-3).
- 제3자 고지(L1, P4-5)에 PaddleOCR 모델(Apache-2.0)과 ONNX Runtime(MIT)을 넣는다.
- 앱 크기가 커진다. 증가량 상한을 스파이크 합격 기준에 둔다(§12).

**픽스처(클린룸)**
- 공개 레포이므로 실제 계약서를 쓰지 않는다. 직접 쓴 **가상 계약서** 문구(조항 번호, 금액, 날짜, 당사자 이름 자리)로 텍스트 PDF를 만들고(OFL 한글 폰트 임베드), 이를 렌더해 스캔본처럼 만든다.
- 변형: 300dpi와 200dpi, 약간의 기울기(0.5°~2°), 노이즈, 도장 같은 붉은 원 겹침. 이미지를 페이지에 넣어 텍스트 레이어 없는 PDF로 저장한다.
- 원본 텍스트 PDF가 정답이다. 정답 글자열(CER 계산)과 정답 상자(좌표 되돌리기 검증)를 원본에서 얻는다.
- 비교용 짝: 같은 계약서의 텍스트본 ↔ 스캔본(차이 0), 금액·날짜·조항 문구를 바꾼 텍스트본 ↔ 스캔본, 스캔본 ↔ 스캔본.
- 생성 스크립트를 픽스처와 함께 커밋한다. 레포 크기를 줄이려고 쪽 수를 적게 두고 이미지는 압축한다.

**P2-2a OCR 스파이크 ★ (M, 게이트)**

pdfium 스파이크(P1-0)처럼 연결 작업(P2-4a) 전에 끝까지 검증한다. Rust(`crates/pdf-core`)만 다루므로 Phase 2의 다른 작업과 병렬로 할 수 있다.
1. `scripts/fetch-ocr.mjs`로 ONNX Runtime과 모델을 받고, `ort`는 `cargo add -p pdf-core ort`로 넣는다(기능 플래그는 스파이크에서 정한다).
2. 픽스처 생성 스크립트로 스캔 픽스처를 만든다.
3. 렌더 → (기울기 보정) → 검출 → 인식을 돌려 아래 기준을 측정한다.
4. ad-hoc 서명된 `.app`에서 ONNX Runtime이 로드되고 추론이 도는지 확인한다.
5. 확정한 모델 이름·버전·ONNX 출처·SHA-256과 측정값을 이 절에 기록한다.

합격 기준(수치는 시작값이다. 스파이크에서 측정 후 확정한다):

| 항목 | 기준 | 측정 조건 |
|---|---|---|
| 한국어 글자 오류율(CER) | 300dpi ≤ 1.5%, 200dpi ≤ 3% | 가상 계약서 픽스처 전체, 기울기·노이즈 포함, 공백 제외 |
| 도장 겹친 줄 CER | ≤ 5% | 붉은 원이 겹친 줄만 |
| 숫자·금액·날짜 토큰 완전 일치율 | 300dpi ≥ 99.5%, 200dpi ≥ 99% | 숫자가 든 토큰 전체 |
| 숫자 토큰 조용한 오인식 | 0건 | 틀린 숫자 토큰 중 신뢰도가 `OCR_MIN_CONFIDENCE_NUMERIC` 이상인 것 |
| 쪽당 처리 시간 | ≤ 2초 | A4 1쪽, 300dpi, Mac M 시리즈, release 빌드, 렌더 + 추론 |
| 번들 증가량 | 플랫폼별 ≤ 60MB | ONNX Runtime 라이브러리 + 모델 파일 |
| 플랫폼 간 결과 | 같은 픽스처의 OCR 글자열이 Mac·Windows에서 같다 | Windows는 CI(P4-1)에서 확인 |
| 서명된 `.app`에서 로드 | `codesign --verify --deep --strict` 통과 후 추론 성공 | ad-hoc 서명 |

**실패하면 P2-4a를 진행하지 않고 멈추고 보고한다.** 기준별 대안:
- CER·숫자 기준 미달: 더 큰(서버용) 인식 모델로 바꾼다, `OCR_RENDER_DPI`를 올린다, 이진화·기울기 보정 같은 전처리를 더한다, 숫자 토큰 신뢰도 기준을 올려 확인 필요로 더 많이 돌린다.
- 처리 시간 초과: 더 작은(모바일용) 모델로 바꾼다, 검출 입력 해상도를 낮춘다, 추론 스레드 수를 조정한다.
- 번들 증가량 초과: 더 작은 모델로 바꾼다. 또는 모델을 첫 사용 때 버전 고정 주소에서 받아 SHA-256으로 검증하는 방식으로 바꾼다(계약서는 보내지 않는다. 오프라인 첫 사용에서는 OCR을 못 한다).
- Mac에서만 한국어 품질이 모자람: macOS는 Vision을 병행하는 안을 검토한다. 플랫폼 간 결과 일치를 포기하는 설계 결정이므로 사용자 확인 뒤에만 간다.
- 서명·로드 실패: ONNX Runtime 링크 방식(동적/정적)과 번들 위치를 다시 검토한다.
- 대안으로도 통과하지 못하면 OCR 비교를 이번 버전에서 뺄지 사용자가 정한다. 그때까지 스캔 쪽은 `NoTextLayer`로 알린다.

**P2-2a 스파이크 결과 (2026-10-13, Mac M3 Pro, 최종 판정: 게이트 통과)**

- 1차 측정(아래 「1차 측정」 이하, 이전 판정 정의·`OCR_RENDER_DPI` 300): 실패.
- 2차 판정(바로 아래, 2026-10-13 사용자 결정 반영): **게이트 통과**. P2-4a를 진행한다.

**2차 판정: 사용자 결정(2026-10-13)에 따른 판정 정의 변경 후 재측정**

기준 수치(CER·일치율·0건·시간·크기)는 그대로다. 바뀐 것은 1차 측정 뒤 사용자가 채택한 세 가지다. 판정 정의 변경은 기준 완화가 아니라 사용자 결정이고, 근거는 1차 측정이다: 실패한 숫자 토큰은 모두 끝 `.`·`,`가 빠진 경우였고(숫자 자체를 높은 신뢰도로 틀린 경우 0건), 비교에서 그 차이는 새 문장부호 규칙으로 「확인 필요」가 되어 차이로 보이지 않는다.
1. 숫자 토큰은 토큰 끝 `.`·`,`를 뺀 부분으로 판정한다. OCR 쪽이 섞인 문장부호(P\*)만 다른 치환은 `needs_review`다(위 「신뢰도와 "확인 필요"」, ADR 0001 §5).
2. `OCR_RENDER_DPI` = 400.
3. OCR 쪽이 있는 비교는 NFKC. 측정도 정답·OCR 양쪽에 NFKC를 걸었다.

측정: `cargo run --release -p pdf-core --example ocr_spike -- --fixtures <폴더>`. 커밋본과 노이즈 시드·기울기만 바꾼 2벌(레포 밖, 생성 스크립트에서 시드·각도만 바꿈), 세 벌 모두 300·200dpi 스캔. 쪽당 시간은 다른 worktree 빌드가 돌던 부하(load average 약 5) 상태 값이다.

| 항목 | 기준 | 커밋본 | 시드 2 | 시드 3 | 판정 |
|---|---|---|---|---|---|
| CER 300dpi | ≤ 1.5% | 0.63% (20/3,165) | 0.85% | 0.70% | 통과 |
| CER 200dpi | ≤ 3% | 0.85% (9/1,054) | 0.66% | 0.76% | 통과 |
| 도장 겹친 줄 CER | ≤ 5% | 3.87% (6/155) | 3.87% | 3.87% | 통과 |
| 숫자 토큰 완전 일치 300dpi | ≥ 99.5% | 100% (198/198) | 100% | 100% | 통과 |
| 숫자 토큰 완전 일치 200dpi | ≥ 99% | 100% (66/66) | 100% | 100% | 통과 |
| 숫자 토큰 조용한 오인식 | 0건 | 0 / 0 | 0 / 0 | 0 / 0 | 통과 |
| 쪽당 처리 시간 | ≤ 2초 | 평균 0.89초·최대 1.16초 | 최대 1.20초 | 최대 1.22초 | 통과 |
| 번들 증가량 | ≤ 60MB | macOS 57.5MB, Windows 34.2MB, Linux 42.7MB(1차와 같다) | | | 통과 |
| 플랫폼 간 결과 | Mac·Windows 같음 | 픽스처 golden(`ocr-edit.changes.json`) | | | 확인됨(CI, 픽스처 golden — Step 26 PR CI에서 Windows·Linux compare_ocr 통과) |
| 서명된 `.app`에서 로드 | codesign 통과 후 추론 | 1차 측정의 확인(아래). 그 뒤 바뀐 것은 렌더 해상도 상수뿐이라 로드·서명 경로는 같다 | | | 통과 |

- 참고(이전 정의로 센 값): 시드 3의 200dpi는 토큰 전체 기준으로 98.48%(65/66)·조용한 오인식 1건이다(끝 마침표 누락). 새 정의에서는 끝 `.`을 빼고 보며, 비교에서는 확인 필요로 분류된다.
- 일반 토큰(숫자 없음, 같은 판정 방법, 기준 0.80): 세 벌 모두 300dpi 99.74%(764/766, 틀린 2건은 신뢰도 0.80 미만), 200dpi 100%, 조용한 오인식 0건.
- 신뢰도 기준 확정: `OCR_MIN_CONFIDENCE_NUMERIC` 0.95 — 틀린 숫자 토큰이 모두 0.95 미만이었다(로컬 실제 스캔 포함). 맞은 숫자 토큰의 약 13%(26~28/198)를 확인 필요로 보낸다. `OCR_MIN_CONFIDENCE` 0.80 — 픽스처의 일반 토큰 조용한 오인식 0건. 로컬 실제 스캔에서는 0.10%(21/20,792)가 남는다(아래). 두 값 모두 시작값 그대로 확정하고 P2-4a golden에서 다시 본다.

로컬 스캔본 재측정(레포 밖, 집계만, NFKC·새 정의, 400dpi)
- 가상 계약서 20쪽: CER 0.48%, 숫자 토큰 100%(550/550), 조용한 오인식 0건. 일반 토큰 99.04%, 조용한 오인식 7건, 문장부호만 다른 것 22건(확인 필요).
- 실제 스캔본 96쪽(쪽 단위 정렬 근사): CER 0.27%, 숫자 토큰 99.21%(1,639/1,652), 조용한 오인식 0건. 틀린 13건은 모두 확인 필요로 걸러진다(신뢰도 0.80 미만 5, 0.80~0.95 4, 문장부호만 다름 4). 이 값은 합격 기준 측정 조건(가상 계약서 픽스처) 밖이지만 300dpi 기준 99.5%에는 못 미친다. 일반 토큰은 99.29%, 조용한 오인식 21건(0.10%: 한글 글자 오인식, 한글 아래아 `ㆍ`를 가운뎃점 `·`으로 읽음), 문장부호만 다른 것 120건(굽은 따옴표 `“”`→`"`, `「」`→`[]` 등, 확인 필요).
- 쪽당 시간: 실제 스캔 평균 1.23초·최대 1.65초(부하 상태).

**1차 측정 (이전 판정 정의, `OCR_RENDER_DPI` 300, 판정: 실패)**

200dpi 숫자 토큰 기준 두 개(완전 일치율, 조용한 오인식 0건)를 넘지 못했다. 나머지 기준은 통과했다. 실패한 토큰은 모두 숫자가 든 토큰 끝의 문장부호(`.`·`,`)가 높은 신뢰도로 빠진 경우이고, 숫자 자체를 높은 신뢰도로 틀린 경우는 없었다. 어떻게 할지는 아래 「제안」을 보고 사용자가 정한다.

확정한 구성(재현: `pnpm fetch:ocr`, `crates/pdf-core/src/ocr/`, 측정 `cargo run --release -p pdf-core --example ocr_spike`)

| 항목 | 값 |
|---|---|
| 검출 모델 | PaddleOCR PP-OCRv5 mobile 검출 `ch_PP-OCRv5_det_mobile.onnx` (4,819,576 B), SHA-256 `4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae` |
| 인식 모델 | PaddleOCR PP-OCRv5 한국어 mobile 인식 `korean_PP-OCRv5_rec_mobile.onnx` (13,488,748 B), SHA-256 `cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b` |
| 사전 | `ppocrv5_korean_dict.txt` (11,945줄, 47,451 B), SHA-256 `a88071c68c01707489baa79ebe0405b7beb5cca229f4fc94cc3ef992328802d7`. CTC 클래스 = 빈칸 + 사전 + 공백 = 11,947 |
| ONNX 출처 | RapidOCR가 변환해 ModelScope `RapidAI/RapidOCR`(Apache-2.0) 태그 `v3.10.0`에 올린 공개 변환본. `https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv5/det/…`, `…/onnx/PP-OCRv5/rec/…`, 사전은 `…/paddle/PP-OCRv5/rec/korean_PP-OCRv5_rec_mobile/…`. 원 모델은 PaddleOCR(Apache-2.0). SHA-256은 RapidOCR `default_models.yaml` 값과 같음을 확인했다 |
| ONNX Runtime | 1.28.3 공식 릴리스(MIT). macOS arm64 `onnxruntime-osx-arm64-1.28.3.tgz`, Windows x64 `…-win-x64-1.28.3.zip`, Linux x64 `…-linux-x64-1.28.3.tgz`. 아카이브·라이브러리 SHA-256은 `scripts/fetch-ocr.mjs`. macOS x64 릴리스는 없다 |
| `ort` | `=2.0.0-rc.13`(ONNX Runtime 1.28 대상), `default-features = false`, 기능 `std`, `load-dynamic`만(`download-binaries`·`copy-dylibs`·`ndarray`·`tracing` 끔). `ort::init_from(<라이브러리 경로>)`로 붙인다 |
| 이미지 처리 | `image` 0.25, `imageproc` 0.27(둘 다 기본 기능 끔, MIT/Apache-2.0). 새로 들어온 하위 크레이트도 모두 화이트리스트 안이다 |
| 파이프라인 값 | `OCR_RENDER_DPI` 400(1차 측정은 300, 2차 판정에서 400으로 정함), 검출 입력 긴 변 `OCR_DET_MAX_SIDE` 2048, 이진화 0.3, 상자 점수 0.6, unclip 1.5, 인식 높이 48, 배치 8 |
| 전처리 | 빨강 채널 회색화(붉은 도장을 거의 흰색으로). 기울기 보정은 넣지 않는다 — 최소 넓이 회전 사각형으로 줄을 잘라 ±2°에서 기준을 넘었다 |
| 글자 상자 | 글자 단위로 간다. CTC 글자 구간 중심 사이의 가운데에서 줄 상자를 나눈다. 일치한 글자 4,161/4,180(99.55%)의 OCR 중심이 정답 글자 칸 ±1pt 안, 평균 가로 오차 1.03pt |

합격 기준 측정값(커밋한 픽스처 `crates/pdf-core/tests/fixtures/ocr/`, 가상 계약서 A·B 2쪽, 스캔 4종 8쪽, 기울기 0.5°~2°·흐림·노이즈 포함, `OCR_RENDER_DPI` 300)

| 항목 | 기준 | 측정 | 판정 |
|---|---|---|---|
| CER 300dpi | ≤ 1.5% | 0.98% (31/3,165). 도장 스캔 제외 0.81% | 통과 |
| CER 200dpi | ≤ 3% | 1.14% (12/1,054) | 통과 |
| 도장 겹친 줄 CER | ≤ 5% | 3.87% (6/155). 빨강 채널 전처리 없이는 17.42% | 통과 |
| 숫자 토큰 완전 일치 300dpi | ≥ 99.5% | 100% (198/198) | 통과 |
| 숫자 토큰 완전 일치 200dpi | ≥ 99% | 98.48% (65/66) | **실패** |
| 숫자 토큰 조용한 오인식 | 0건 | 300dpi 0건, 200dpi 1건(`8,900원이다.`의 끝 마침표 누락, 최소 신뢰도 0.987) | **실패** |
| 쪽당 처리 시간 | ≤ 2초 | 픽스처 평균 0.76초·최대 0.98초. 로컬 실제 스캔 96쪽 평균 1.10초·최대 1.47초(다른 빌드가 돌던 부하 상태) | 통과 |
| 번들 증가량 | ≤ 60MB | macOS 57.5MB(서명 후 dylib 39.14MB + 모델 18.36MB, 실제 `.app` 86.05MiB), Windows 34.2MB(dll 15.83MB), Linux 42.7MB(so 24.30MB) | 통과(macOS 여유 2.5MB) |
| 플랫폼 간 결과 | Mac·Windows 같은 글자열 | 픽스처 golden(`ocr-edit.changes.json`) | 확인됨(CI, 픽스처 golden — Step 26 PR CI에서 Windows·Linux compare_ocr 통과) |
| 서명된 `.app`에서 로드 | codesign 통과 후 추론 | `codesign --verify --deep --strict` valid. 창 숨김 실행 로그: `ONNX Runtime loaded from …/Contents/Frameworks/libonnxruntime.dylib (models …/Contents/Resources/ocr-models)`, `45 lines in 997 ms` | 통과 |

같은 문서를 노이즈 시드·기울기만 바꿔 다시 만든 픽스처(레포 밖) 3벌 × 렌더 해상도 2개로 흔들림을 쟀다. 「핵심」은 토큰 끝 `.`·`,`를 뺀 숫자 토큰 기준(참고값)이다.

| 픽스처 | `OCR_RENDER_DPI` | CER 300/200 | 도장 줄 CER | 숫자 일치 300/200 | 조용한 오인식 300/200 | 핵심 기준 조용한 오인식 |
|---|---|---|---|---|---|---|
| 커밋본 | 300 | 0.98% / 1.14% | 3.87% | 100% / 98.48% | 0 / 1 | 0 |
| 시드 2 | 300 | 1.23% / 0.66% | 5.16% | 97.98% / 100% | 3 / 0 | 0 |
| 시드 3 | 300 | 0.92% / 0.76% | 4.52% | 99.49% / 98.48% | 1 / 1 | 0 |
| 커밋본 | 400 | 0.63% / 0.85% | 3.87% | 100% / 100% | 0 / 0 | 0 |
| 시드 2 | 400 | 0.85% / 0.66% | 3.87% | 100% / 100% | 0 / 0 | 0 |
| 시드 3 | 400 | 0.70% / 0.76% | 3.87% | 100% / 98.48% | 0 / 1 | 0 |

400dpi 렌더의 쪽당 시간은 평균 0.81초·최대 1.05초다.

시도한 대안(모두 300dpi 렌더 기준)
- 검출 server 모델(`ch_PP-OCRv5_det_server`, 88MB): CER 개선 없음, 쪽당 3.9초, 번들 상한 초과 → 버림.
- 인식 PP-OCRv4 한국어 모델: CER 9.32%, 조용한 오인식 54건 → 버림. PP-OCRv5에는 한국어 server 인식 모델이 없고, PP-OCRv6 다국어 모델은 한국어를 지원하지 않는다.
- 검출 입력 긴 변 1536/2560/3584, unclip 2.0/2.5, 인식 줄 양끝 여백: 끝 문장부호 누락이 1~3건 사이에서 흔들릴 뿐 없어지지 않았다.
- `OCR_RENDER_DPI` 350/400: 400이 가장 나았지만(위 표) 시드 3의 200dpi에서 같은 실패 1건.

추가 측정(레포 밖 로컬 스캔본, 집계만 기록)
- 로컬 가상 계약서 스캔 10종 20쪽(다른 서체, 흑백 이진화본 포함): CER 0.73%, 숫자 토큰 100%(470/470), 조용한 오인식 0건.
- 로컬 실제 스캔본 96쪽(쪽 단위 정렬이라 근사값): CER 0.88%, 숫자 토큰 93.98%(1,139/1,212), 조용한 오인식 43건. 43건 모두 원문자 번호(①~⑥)를 일반 숫자로 읽은 것이다. 양쪽에 NFKC 정규화를 걸면 CER 0.27%, 숫자 토큰 99.21%(1,639/1,652), 조용한 오인식 0건이고, 남은 오류(원화 기호 `￦`)는 신뢰도 0.95 미만이라 확인 필요로 걸러진다.

신뢰도 시작값(1차 시점): 신뢰도 0.95 미만으로 틀린 숫자 토큰은 커밋본 0건, 시드 2의 도장 아래 1건(0.264)뿐이었다. `OCR_MIN_CONFIDENCE_NUMERIC`(0.95)는 맞은 숫자 토큰의 16%(32/198)를 확인 필요로 보낸다. 끝 문장부호 누락은 빠진 글자에 신뢰도가 없어 이 기준으로 잡히지 않는다. 1차 시점에는 게이트가 실패해 두 값을 확정하지 않았다(2차 판정에서 확정).

제안(1차 시점. 1~3은 2026-10-13 사용자가 모두 채택해 2차 판정에 반영했다)
1. 숫자 토큰 판정 정의: 비교에서 OCR 쪽이 섞인 「문장부호만 다른 치환」을 띄어쓰기처럼 `needs_review`로 분류하고(P2-3/P2-4a), 스파이크 기준의 숫자 토큰은 끝 `.`·`,`를 뺀 핵심으로 본다. 이 정의로는 측정 6회 모두 조용한 오인식 0건, 일치율 300dpi 99.49~100%·200dpi 100%다.
2. `OCR_RENDER_DPI`를 400으로 올린다(쪽당 +약 60ms, 도장 줄 CER이 시드에 상관없이 3.87%).
3. OCR 쪽이 있는 비교는 P2-3 정규화에서 NFKC를 켠다(원문자 번호).
4. 위험: 빨강 채널 전처리는 붉은 글자(빨간 수정 표시 등)도 지운다. 붉은 글자가 비교 대상이면 다른 도장 제거 방법이 필요하다. macOS x64(Intel·universal) 빌드에 쓸 ONNX Runtime 1.28 공식 바이너리가 없다.

앱 번들 설정(스파이크에서 확인한 값. 확인 뒤 앱 코드·설정은 되돌렸고 P2-4a에서 넣는다): `bundle.macOS.frameworks`에 `onnxruntime/aarch64-apple-darwin/libonnxruntime.dylib`, `bundle.resources`에 `ocr-models/<파일>` → `ocr-models/<파일>` 세 개. 런타임 폴더는 pdfium과 같은 `Contents/Frameworks`, 모델 폴더는 `resource_dir()/ocr-models`. 기존 `com.apple.security.cs.disable-library-validation`으로 ad-hoc 서명 dylib가 로드된다.

앱 번들 연결(Step 26, 2026-10-13): 위 값을 `src-tauri/tauri.conf.json`에 넣었다 — `bundle.macOS.frameworks`에 `onnxruntime/aarch64-apple-darwin/libonnxruntime.dylib`(pdfium과 같은 `Contents/Frameworks`), `bundle.resources`에 `ocr-models/` 세 파일. 앱은 OCR 엔진을 첫 비교에서 로드하고 실패하면 OCR 없이 비교한다([ADR 0001](../adr/0001-compare-result-model.md) §16).
- 런타임·모델이 없는 환경: tauri-build가 `cargo build`·`clippy`·`test` 때도 리소스·프레임워크 파일을 복사하므로 파일이 없으면 빌드가 멈춘다(`pnpm tauri build`도 같다). 그래서 **CI의 모든 잡은 `pnpm fetch:pdfium` 옆에 `pnpm fetch:ocr`을 돌린다**(`.github/workflows/ci.yml`, 캐시 키는 OS·아키텍처 + `scripts/fetch-ocr.mjs` 해시, 러너에 맞는 타깃은 스크립트가 고른다). OCR 없이 출시되는 일을 막는 장치로 둔다(파일이 없어도 빌드되게 하는 별도 설정 파일은 출시 빌드에서 빠뜨릴 수 있어 버렸다). Windows·Linux는 ONNX Runtime 라이브러리를 리소스 폴더 바로 아래(`onnxruntime.dll`/`libonnxruntime.so`)에 두어야 앱이 찾는다(`pdf_engine::bundled_library_dir`) — pdfium처럼 CI의 `--config`로 `bundle.resources`에 더한다. Windows NSIS 잡은 `"onnxruntime/x86_64-pc-windows-msvc/onnxruntime.dll": "onnxruntime.dll"`을 넣는다. Linux 번들은 CI가 아직 만들지 않는다(만들 때 `libonnxruntime.so`를 같은 방식으로).
- CI OCR 테스트: 세 OS 잡이 `ONNXRUNTIME_LIB_PATH`·`OCR_MODEL_DIR`을 넣어 OCR 테스트(`tests/ocr.rs`, `compare_ocr.rs`, `compare_runner.rs`의 스캔 쪽)를 돌린다. 로컬 debug(M3 Pro)에서 세 파일 약 74초(`compare_ocr` 49초, `compare_runner` 16초, `ocr` 9초)라 CI 러너에서는 몇 분 늘 것으로 본다. x86(AVX) 커널은 ARM과 부동소수 결과가 조금 달라 신뢰도 기준(0.80·0.95) 근처 토큰의 확인 필요나 글자가 바뀌면 golden이 깨질 수 있다 — 그러면 그것이 플랫폼 간 차이의 첫 측정이다.
- 측정(`pnpm tauri build --bundles app`, aarch64-apple-darwin, ad-hoc 서명, `codesign --verify --deep --strict` 통과): `.app` 87.70 MiB 중 OCR 몫은 `libonnxruntime.dylib` 37.3 MiB + `ocr-models/` 17.5 MiB = 54.8 MiB(57.5 MB, 스파이크 측정과 같다). 실행 파일 23.2 MiB, `libpdfium.dylib` 7.4 MiB.

**P2-4a OCR 연결 (M)**
- 추출 단계에 OCR 경로를 잇는다: OCR 대상 판정, 렌더·검출·인식, 좌표 되돌리기, 신뢰도와 `needs_review`, `page_sources`, OCR 캐시.
- 테스트(핵심 동작만, golden 픽스처):
  - 텍스트본 ↔ 스캔본 비교에서 차이가 0이고, 금액·날짜·조항을 바꾼 짝에서는 바꾼 곳만 변경으로 나온다.
  - OCR 상자를 PDF pt로 되돌린 결과가 원본 텍스트 PDF의 상자와 `OCR_BOX_TOLERANCE_PT` 안에서 맞는다(CropBox 오프셋, 회전 페이지 포함).
  - 신뢰도 기준 미만 토큰이 걸린 변경이 `needs_review`로 분류된다.
  - 같은 파일을 다시 비교하면 OCR을 다시 돌리지 않는다(캐시).
- **결과(2026-10-13, 규칙 정본은 [ADR 0001](../adr/0001-compare-result-model.md) §11):** 연결 API는 `read_document_text`(추출 + OCR + 캐시)와 `compare_texts`(NFKC 강제, 토큰화, diff, 안내)다. pdfium 렌더 영역은 `view_box`(CropBox ∩ MediaBox)이고 `/Rotate`를 적용한 화면 방향임을 확인했다. 연결하면서 PP-OCRv5 한국어 인식 모델이 단어 사이 공백을 거의 내지 않음(정답 공백 169개 중 22개)을 발견했다. 그대로면 줄 전체가 토큰 하나가 되어 텍스트본 ↔ 스캔본 비교 대부분이 확인 필요가 되고 실제 변경도 숨으므로, 인식 뒤 글자 사이 잉크 간격으로 공백을 넣는다(`WORD_GAP_MIN_RATIO` 0.30). 그 뒤 텍스트본 ↔ 같은 계약서 스캔본 3종은 차이 0, 바꾼 짝은 차이 6개가 모두 바꾼 곳이고 금액 변경 하나는 OCR 숫자 토큰 신뢰도 0.912 < 0.95라 확인 필요다. OCR 상자 되돌리기는 tight 상자 중심이 OCR 상자 밖으로 최대 0.85pt(허용 1.0pt)다.

---

## 7. Phase 3: 비교 UI (Track A + B 합류)

> 화면 시안: Claude Design 캔버스 "PDF Studio 메인 화면"(https://claude.ai/artifact/DypiUsrVJh56yhBuv4tSvV, 비공개) 의 1~5번 아트보드. 색·글꼴·간격은 [디자인 시스템 토큰](../06-design-system.md)을 따른다.

### P3-1 앱 모드와 홈 (S)
- `app` 레이어에 `mode: 'home' | 'merge' | 'compare'`(store)를 둔다. 라우터는 도입하지 않는다(YAGNI).
- **홈(시안 1):** 파일이 없을 때 보이는 첫 화면. "PDF 병합", "PDF 비교" 카드 두 장. 카드를 누르거나 카드 위에 파일을 놓으면 그 모드로 들어간다(병합은 여러 개, 비교는 2개).
- **모드 전환:** 병합·비교 화면 툴바 맨 왼쪽에 `[병합 | 비교]` 세그먼트 탭. 모드를 바꿔도 각 모드의 작업 상태(병합 파일 목록, 비교 세션)는 유지한다.
- **병합 화면(시안 2·6·7·8)은 지금 화면 구조와 기능을 그대로 둔다.** 툴바(전체 선택·전체 삭제 / 파일 추가 / 병합), 문서 카드 그리드, 하단 플로팅 바, 상태바, 진행·실패 오버레이. 구조에 더하는 것은 모드 탭뿐이다. 크기·간격·색·문구·배치(카드 그리드, 플로팅 바 순서 등)는 시안에 맞춘다(D10, Step 24-a). 시안 항목별 반영/유지는 [토큰 문서 §6.2](../06-design-system.md#62-병합-화면-시안-2678과-지금-화면).
- **병합 모드의 하위 화면:** 지금의 `view: 'workspace' | 'preview'`(전체 병합 후 결과 미리보기 화면)는 병합 모드 안에 그대로 둔다. 선택 병합은 지금처럼 모달. 결과 미리보기 화면에 있는 동안 모드 탭은 보이되, 비교로 넘어갈 때 임시 결과 파일이 남아 있으면 "저장하지 않은 병합 결과가 있어요"를 확인한다.

### FSD 배치
```
app/                       mode store('home' | 'merge' | 'compare'), mode-tabs
pages/home                 작업 고르기 카드 2장
entities/comparison        결과 타입(specta 생성물 재수출), 선택자(현재 change, 필터링, 쪽별 묶기)
features/pdf-compare
  ├─ model/                compare-session store(files, options, status, jobId, result, activeChangeId, hiddenKinds, viewMode)
  └─ ui/                   file-slots, options-card, change-list, kind-filter-chips
features/compare-export    export-dialog(받을 파일, 저장 위치, 미리보기)
widgets/compare-viewer     좌우 pdf.js 뷰어 + SVG 오버레이 + 연결선 + 미니맵 + 동기 스크롤
pages/compare              옵션 화면 / 결과 화면 조립
```

### 화면 구성
- **P3-2 파일 슬롯 (S, 시안 3 위쪽):** A(이전)·B(이후) 슬롯. 각 슬롯은 빈 상태(점선 드롭 영역) / 채운 상태(썸네일, 이름, 크기·쪽수, "교체") 두 가지. 슬롯 사이에 A↔B 맞바꾸기 버튼. 다이얼로그 또는 드롭(`platform.onFileDrop` + 좌표 판정).
  - **받는 규칙(Step 25):** 어느 슬롯에 넣을지는 `features/pdf-compare/lib/plan-slot-placement.ts` 한 곳에서 정한다. 다이얼로그(슬롯 누르기·"교체", 홈 "두 파일 선택")와 드롭(놓은 곳은 `document.elementFromPoint`로 판정, 좌표의 물리 픽셀 보정은 병합과 같은 `native-file-drop.ts`)이 같은 규칙을 쓴다.
    - 1개: 누른/놓은 슬롯에 넣는다(차 있으면 바꾼다). 슬롯 밖(비교 화면의 다른 곳, 홈 비교 카드)이면 빈 슬롯을 A → B 순서로 채우고, 둘 다 차 있으면 넣지 않고 "두 슬롯이 모두 차 있어요"를 알린다.
    - 2개: 어디에 놓았든(어느 슬롯을 눌렀든) 받은 순서대로 A·B에 넣는다(새 비교 한 쌍).
    - 3개 이상: 넣지 않고 "비교할 파일은 2개까지"를 알린다.
  - **PDF만 받는다.** TIFF 등 PDF가 아닌 파일은 열지 않고(TIFF 변환 비용을 쓰지 않는다) `"<이름>" 파일은 비교할 수 없어요` + "PDF만 비교할 수 있어요. TIFF는 병합에서 PDF로 저장한 뒤 넣어 주세요."를 알린다. 홈 비교 카드가 받는 형식을 "PDF"로 적었고, TIFF를 PDF로 저장하는 일은 병합이 이미 하므로 비교에 변환 경로를 따로 두지 않는다.
  - 열지 못한 파일(암호·손상 등)은 병합과 같은 방식으로 `"<이름>" 파일을 열 수 없어요` + 오류 코드 문구(`error-messages.ts`)를 알린다. 받지 못한 파일의 슬롯은 그대로 둔다(2개 중 하나만 받으면 받은 쪽 슬롯만 바뀐다).
  - 크기는 `open_files` 결과의 `sizeBytes`(요청한 원본 파일의 바이트 수, `u32`)로 보인다. 슬롯 문서는 병합 파일처럼 `usePdfDocumentRetention`으로 잡아 모드를 오가도 다시 읽지 않는다.
- **P3-3 실행 전 옵션 (M, 시안 3 아래쪽):** 접을 수 있는 "실행 전 옵션" 카드.
  - 머리: 요약 배지(켠 비교 대상, 뺀 줄 수, 전체/범위 지정), "기본값으로"(이미 기본값이면 비활성).
  - **페이지 범위는 A·B 따로** 입력한다(`"1,3-5"`, 비우면 전체). 입력칸 끝에 `/ N쪽`. 쪽수를 넘으면 빨간 테두리와 이유 문구.
  - **비교 대상 표:** 글자(기본, 켬) + 하위 옵션 대소문자 무시. 글자층이 없는 쪽은 자동으로 OCR한다(따로 켜는 옵션은 두지 않는다). 스타일·레이아웃·그림은 Phase 5라 "준비 중"으로 꺼 둔 채 보여 준다.
  - **반복 줄 제외 표:** 머리말, 꼬리말, 쪽번호를 따로 고른다. 옆에 작은 페이지 그림으로 빠지는 줄을 표시. 양쪽 문서에 같이 적용.
  - 바닥: 실행할 수 없는 이유(또는 "A 18쪽 · B 19쪽을 비교해요") / 취소 / ▶ 비교 실행(이유가 있으면 비활성).
- **P3-3a 비교 진행 화면 (S, 시안 9):** 실행하면 옵션 화면 자리에 진행 카드가 뜬다.
  - 위: A → B 파일 이름, **전체 진행률 %**(큰 숫자)와 막대, 경과 시간.
  - 가운데: **작업별 행**(A 문서 읽기 / B 문서 읽기 / 스캔 쪽 글자 읽기 / 글자 정리 / 차이 찾기 / 쪽 맞추기). OCR 대상 쪽이 없으면 "스캔 쪽 글자 읽기"는 바로 완료로 보인다. 행마다 상태 점(완료 ✓ · 진행 중 회전 · 대기 번호), 이름, 세부(`12 / 19쪽` 등), **작업별 %**, 얇은 막대. 완료 막대는 `success`, 진행 중은 `primary`.
  - 아래: 취소(옵션 화면으로 돌아감). 다른 모드로 가도 작업은 계속되고, 상태바에 `비교 중 49%`를 보인다.
  - 모든 막대에 `role="progressbar"`와 `aria-valuenow`, 상태바는 `role="status"`.
- **P3-4 결과 미리보기 (L, 시안 4)**
  - 머리: 뒤로(옵션으로), 제목(A → B), A/B 파일 이름·쪽수·소요 시간, "새 비교", "내보내기", ⋯(다시 실행).
  - 툴바: 종류 칩(추가·삭제·변경, 개수 표시, 끈 칩은 회색+취소선, "n개 숨김"), 이전/다음 이동(`3 / 17`, 키보드 ↑↓·j/k), 보기 방식 `나란히 | A만 | B만`, 확대·축소·맞춤, 현재 쪽.
  - 안내 띠: `notices`(머리말 제외, 글자층 없는 쪽 등)와 OCR로 읽은 쪽 수를 한 줄로, "자세히"로 펼침.
  - **OCR 표시:** `page_sources`가 `Ocr`인 쪽은 페이지 캡션과 차이 목록의 쪽 머리에 "OCR" 배지를 단다.
  - **확인 필요 표시:** `needs_review` 변경은 종류 칩 옆 "확인 필요" 칩으로 따로 세고(차이 개수에 넣지 않는다), 페이지에서는 차이 하이라이트와 구별되는 모양으로 표시한다. 색은 토큰 문서에 있는 것만 쓴다.
  - 본문: 왼쪽 **차이 목록**(340px, 쪽별 묶기, 고른 항목은 변경 전/후 상자로 펼침, 접으면 좁은 레일) / 가운데 **페이지 영역**(A·B 캡션 행 + `A 페이지 | 거터 | B 페이지` 행, 변경 상자에 번호 태그, 거터에 **연결선**) / 오른쪽 **미니맵**(34px, 변경 위치 눈금 + 현재 화면 틀).
  - **A·B 두 패널이 따로 스크롤한다(Step 28-c, 사용자 결정 2026-10-13).** 패널마다 virtuoso가 행 단위로 가상화하고, 두 패널은 같은 행 배치(`page_pairs`의 한 쌍 = 두 패널의 같은 색인 행, 높이 = 두 쪽 중 큰 쪽)를 쓴다. 짝이 없는 페이지는 반대편 패널의 그 행에 자리표시자를 둔다. 두 패널 사이 거터(120px)를 연결선이 건너고, 연결선은 비교 영역 전체를 덮는 SVG 오버레이 한 장에 그린다. 툴바 "동기 스크롤"(기본 켬)이 켜져 있으면 두 패널이 함께 움직인다(§7.1 "Step 28-c에서 정한 것"). A만/B만 보기는 패널 하나이고 거터·연결선이 없다. Step 27은 스크롤 컨테이너 하나에 `A 페이지 | 거터 | B 페이지` 행을 두었다(대체됨).
  - 보이는 행만 pdf.js로 렌더(P0-4 캐시 재사용), SVG 오버레이 하이라이트(Rust가 준 PDF 좌표 → viewport 변환).
  - 빈 상태: 차이 없음(초록 체크) / 필터로 모두 숨김("필터 초기화") / 로딩(스켈레톤).
  - 연결선 상세는 아래 §7.1.
  - **Step 27에서 정한 것:**
    - 결과는 실행할 때의 두 문서·옵션·걸린 시간·작업 ID와 함께 세션에 둔다(`CompletedComparison`). **슬롯 문서를 바꾸거나 맞바꾸면 결과를 지운다**("결과가 이전 파일 기준" 표시를 두지 않는다 — 결과는 그 두 문서의 것이라 다른 문서 옆에 둘 수 없고, 같은 파일을 다시 비교하면 추출·OCR 캐시로 빠르다). 같은 파일을 다시 고르면 지우지 않는다. 옵션만 바꾸면 결과는 남고, 옵션 화면 머리의 "최근 결과"로 돌아간다.
    - 뒤로(‹) = 옵션 화면(문서·옵션·결과 유지). **"새 비교" = 문서·결과·옵션을 모두 비운 옵션 화면**(뒤로와 달리 처음부터 다시). ⋯ = 메뉴 "다시 실행"(같은 문서·지금 옵션). "내보내기"는 P3-5(Step 29)까지 막힌 버튼.
    - "확인 필요" 칩은 종류 칩처럼 켜고 끄는 필터다. 종류 칩 개수 = 그 종류의 차이(확인 필요 제외), 확인 필요 칩 개수 = 숨기지 않은 종류의 확인 필요(ADR 0001 §5). 페이지에서는 종류 상자 바깥에 `warning-foreground` 점 고리와 `warning` 번호 태그로 구별한다(토큰 문서 §6.5).
    - 처음 연 결과는 첫 변경을 고르지만 스크롤하지 않는다(맨 위에서 시작). 목록·이전/다음·키보드로 고를 때만 그 변경의 첫 상자가 페이지 영역 가운데 오게 스크롤한다(상자의 세로 위치는 그 쪽의 pdf.js viewport 변환으로 구한다). Step 28-c부터는 보이는 패널마다 그 변경의 연결선 끝(앵커 포함)을 가운데에 두고, 동기 스크롤이면 두 끝의 가운데를 둔다(§7.1).
    - 행 크기는 `page_sizes`(회전 90·270이면 너비·높이를 바꾼다) × 배율로 미리 정해 virtuoso에 높이를 알려 준다(`UserUnit` 쪽은 pdf.js 크기의 1/UserUnit로 보이고, 하이라이트는 같은 쪽 그림에 비율로 맞춘다). 배율 100% = 1pt가 96/72 CSS px, 기본은 "맞춤"(가장 넓은 쪽이 칸에 양옆 24px을 두고 들어가는 배율). 배율·보기 방식을 바꾸면 보던 행에서 다시 시작한다.
    - 빠르게 스크롤하는 동안은 virtuoso scroll seek로 행 자리만 두고 쪽을 그리지 않는다.
    - 연결선 체크박스는 Step 28에서 넣는다(이번엔 거터 폭과 자리만).
- **P3-5 내보내기 (M, 시안 5):** 모달(최대 1040px), `1fr | 360px`.
  - 받을 파일(둘 중 하나 이상): **비교 PDF**(A·B를 A4 가로 한 장에 나란히. 하위 옵션: `A·B 나란히 | A만 | B만`, 차이 있는 쪽만 넣기(쪽수 변화 표시), 색 상자 넣기) / **주석 PDF**(B 위에 차이를 PDF 주석으로).
  - 저장 위치: 경로 표시 + "바꾸기"(저장 다이얼로그), 만들 파일 이름 미리 표시.
  - 오른쪽 미리보기: 첫 장부터 넘겨 보기. 지금 필터를 그대로 따른다.
  - 바닥: 이유 문구 / 취소 / 내보내기(이유가 있으면 비활성). 끝나면 토스트.
  - **Step 29에서 정한 것:**
    - **연결선은 따로 고르지 않는다.** 비교 PDF는 ADR 0001 §14대로 나란히 + 색 상자일 때만 연결선을 그리고, 결과 화면 툴바의 "연결선" 체크박스와 잇지 않는다(체크박스는 화면 보기 설정이고, 내보내기 모달에 연결선 옵션을 더하지 않는다).
    - **지금 필터:** 결과 화면에서 끈 종류(`hiddenKinds`)를 비교 PDF·주석 PDF·미리보기 요청에 그대로 싣는다. "확인 필요" 칩은 종류가 아니라 싣지 않으므로(ADR 0001 §14), 그 칩을 껐으면 미리보기 아래에 "확인 필요 표시는 숨겨도 넣어요."를 덧붙인다. 아래 안내는 "변경 표시는 지금 필터를 따라요(삭제 숨김)."처럼 숨긴 종류를 적는다.
    - **열 때마다 시안의 기본값:** 비교 PDF 켬 · A·B 나란히 · 차이 있는 쪽만 · 색 상자, 주석 PDF 끔. 비교 PDF를 끄면 하위 옵션을 막고 미리보기 자리에 "미리보기는 비교 PDF만 보여요."를 둔다.
    - **저장 위치는 폴더다(폴더 다이얼로그).** 한 번에 두 파일을 만들므로 파일 하나를 고르는 저장 다이얼로그로는 둘째 파일을 허용 목록에 넣을 수 없다. 고른 폴더는 이 실행 동안 기억하고(앱을 다시 켜면 허용 목록이 비므로 다시 고른다), 처음에는 "아직 고르지 않았어요" + "고르기"다. 다이얼로그는 고른 폴더(없으면 문서 폴더)에서 연다. 그 폴더 바로 안에만 새 파일을 만들고, 같은 이름이 있으면 덮지 않고 `이름 (2).pdf`처럼 번호를 붙인다(ADR 0001 §17). 시안의 "~/Documents/PDF Studio/비교 결과" 같은 기본 폴더는 두지 않는다(허용 경로 목록 D13 밖이다).
    - **만들 파일 이름:** 두 문서 이름(확장자 뺀 것)의 같은 앞부분 중 마지막 구분자(`_` `-` 공백 `.`)까지를 머리로 한 번만 쓰고 나머지를 `-`로 잇는다 + `_비교.pdf` / `_주석.pdf`(`공급계약서_v1` + `공급계약서_v2` → `공급계약서_v1-v2_비교.pdf`, 머리가 없으면 `A-B`, 같은 이름이면 하나). 실제 이름은 번호가 붙을 수 있어 토스트에 Rust가 돌려준 이름을 보인다.
    - **미리보기:** Rust가 앞 8장을 720px PNG로 그려 base64로 준다. 넘기기는 받은 장 안에서만 하고(전체가 더 많으면 "미리보기는 앞 8장까지 보여요."), 옵션이 바뀌면 다시 받아 첫 장부터 보인다. 요청마다 번호를 매겨 마지막 요청의 응답만 쓴다(늦게 온 앞 응답이 새 미리보기를 덮지 않는다). 받는 동안은 종이 자리에 맥박 스켈레톤(`aria-busy`)이다.
    - **"차이가 있는 쪽만 넣기 (19쪽 → 6쪽)":** 앞 수는 배치에 들어가는 행 수(한쪽 배치는 그쪽 쪽이 없는 행을 뺀다), 뒤 수는 미리보기가 알려 준 장 수(`EMPTY_REPORT`면 0, 받는 중이면 "…")다. 차이 있는 행을 고르는 규칙은 Rust 한 곳에만 둔다.
    - **바닥 줄 이유(위에서부터 하나):** 받을 파일 없음 "받을 파일을 하나 이상 골라 주세요." → 폴더 없음 "저장할 폴더를 골라 주세요." → 비교 PDF에 넣을 장 없음 "지금 필터로는 비교 PDF에 넣을 쪽이 없어요." → 아니면 "파일 N개를 만들어요". 이유가 있으면 `destructive` 글자 + 내보내기 막힘.
    - **내보내기:** 비교 PDF → 주석 PDF 차례로 파일마다 작업 ID를 새로 만들어 부른다. 끝나면 만든 파일 수와 이름을 토스트("PDF 2개를 만들었어요")로 알리고 모달을 닫는다. 하나가 실패하면 거기서 멈추고 그 파일의 실패 토스트(코드 문구)를 띄우고 모달은 남긴다. 내보내는 중 취소·✕·Esc는 그 작업을 `cancel_job`으로 멈추고 모달을 닫으며, 취소는 실패로 알리지 않는다(취소 전에 만든 파일은 알린다).

### 7.1 연결선 (P3-4의 일부, M)

> 2026-10-13 사용자가 전달한 명세(공개 문서와 일반 알고리즘만으로 새로 설계한 클린룸 명세)로 다시 썼다. Step 28이 정한 20pt 묶기(stem)·중립색·행 단위 그리기는 **대체됨**이다(아래 "Step 28에서 정한 것 (대체됨)"). 결과 모델·앵커는 Step 28-b, 화면·비교 PDF 연결선은 Step 28-c가 만들었다(아래 "Step 28-c에서 정한 것").

좌우 비교 뷰에서 변경마다 왼쪽(A, 이전) 상자와 오른쪽(B, 이후) 상자를 가운데 거터를 가로지르는 선이나 띠로 잇는다. 한쪽에만 있는 변경(삽입·삭제)은 반대편의 "들어갈 자리"(앵커)에 잇는다.

```
 ┌── before pane ──┐ gutter ┌── after pane ───┐
 │   [ old text ]──┼──╮     │                 │
 │                 │   ╰────┼──[ new text ]   │   replace: 상자 ↔ 상자
 │   ...│ (anchor)─┼────────┼──[ inserted ]   │   insert : 앵커 ↔ 상자
 └─────────────────┘        └─────────────────┘
```

**무엇을 잇나**
- 모든 변경을 잇는다: `Replace`는 상자 ↔ 상자, `Insert`는 A 앵커 ↔ B 상자, `Delete`는 A 상자 ↔ B 앵커.
- 필터로 숨긴 종류는 잇지 않는다(상자처럼 입력에서 뺀다).

**결과 모델과 앵커 (BE, Step 28-b)**
- FE가 기하만 계산하면 되도록 양쪽 끝점의 PDF 좌표를 모두 결과에 담는다. `Change.before`·`after`는 `Placement`다: `Boxes { text, boxes, min_confidence }`(그 쪽에 글자가 있다) 또는 `Anchor { page, x, y, h }`(글자가 없다. 반대쪽 글자가 들어갈 자리, 사용자 공간 pt·좌하단 원점, (`x`, `y`)–(`x`, `y + h`) 세로 막대). `needs_review`·`page_pair`(각 쪽 첫 상자의 쪽, 앵커 쪽은 `None`)는 그대로다. §6.1.
- 앵커 규칙(정본 [ADR 0001](../adr/0001-compare-result-model.md) §4): diff 결과 토큰열에서 한쪽에만 있는 변경에 대해 반대쪽 문서의 이웃 공통(Equal) 토큰으로 정한다.

  | 경우 | 앵커 |
  |---|---|
  | 직전 공통 토큰이 있음 | 그 토큰 마지막 줄 상자의 오른쪽 끝(x = 오른쪽, y = 줄 상자 아래 모서리(기준선 근사), h = 줄 상자 높이) |
  | 직전 토큰이 없음(문서 맨 앞) | 다음 공통 토큰 첫 줄 상자의 왼쪽 끝 |
  | 둘 다 없음(반대쪽 비교 범위가 빈 쪽뿐) | 짝 쪽(`page_pairs`)의 위 여백. 짝이 없으면 가장 가까운 앞 쪽의 아래 여백, 앞 쪽도 없으면 가장 가까운 뒤 쪽의 위 여백(여백 72pt, 화면 방향) |
  | 직전 토큰이 줄(쪽) 끝이고 다음 토큰이 다음 줄(쪽) 시작 | 직전 토큰 쪽 우선 |

- 상자 정리: 같은 줄의 인접 글자 상자는 줄 단위 사각형 하나로 합친다. 같은 높이라도 가로 간격이 글자 높이를 넘으면(2단의 다른 단, 표의 먼 칸) 합치지 않는다(ADR 0001 §10 `SAME_LINE_MAX_GAP`). 여러 쪽에 걸친 변경은 상자에 쪽이 섞이고, 끝점은 FE가 정한다.
- BE 테스트(Step 28-b): 앵커(문서 맨 앞·중간·맨 끝·줄 경계·쪽 경계 삽입, 삭제의 B 앵커, 반대쪽 빈 쪽 세 갈래)와 병합(한 줄 연속, 줄바꿈, 같은 높이 2단)을 픽스처 golden(`placement.changes.json`)과 추출 글자로 따로 세운 기대 상자로 고정한다(`compare_placement.rs`).

**화면 구조 (FE, Step 28-c)**
- A·B 두 패널이 따로 스크롤한다(동기 스크롤 켜기·끄기). Step 27의 "스크롤 컨테이너 하나 + 페이지 쌍 행" 구조를 대체한다.
- 비교 영역 전체(A 패널 + 거터 + B 패널)를 덮는 SVG 오버레이 한 장(`position: absolute; inset: 0; pointer-events: none`)에 연결선만 그린다. 변경 상자 하이라이트는 지금처럼 각 쪽 위 오버레이에 둔다.

**좌표 변환 파이프라인 (순수 함수)**
```
PDF pt (상자·앵커)
  → pageViewport.convertToViewportRectangle()   // 회전·확대(CropBox 원점·UserUnit 포함, ADR 0001 §2)
  → + pageOffsetTop(page) / pageOffsetLeft       // 가상 리스트 콘텐츠 좌표
  → − pane.scrollTop                             // 스크롤
  → + (paneRect − overlayRect)                   // 오버레이 기준
```
- 쪽 기준 좌표(앞 두 단계)는 결과·확대·배치가 바뀔 때만 다시 계산해 캐시한다(useMemo). 프레임마다 바뀌는 것은 스크롤 오프셋뿐이다.
- 손으로 쓴 공식(`pageHeight − y` 등)으로 화면 좌표를 구하지 않는다(ADR 0001 §2).

**대표점(끝점)**
- A 끝점 = 변경 상자 합집합의 오른쪽 변 가운데, B 끝점 = 왼쪽 변 가운데(거터를 향한 변).
- 여러 쪽에 걸치면 첫 쪽 상자만 쓴다.
- 앵커 끝점은 막대 가운데 (`x`, `y + h/2`)(사용자 공간)를 viewport로 바꾼 점이다. 명세의 (x, y − h/2)는 회전 0 쪽의 화면 좌표(y가 아래로 커진다)에서 같은 점이고, 사용자 공간 가운데를 바꾸면 회전 쪽에서도 맞다. 앵커의 쪽이 `page_sizes`에 없으면(쪽이 0개인 PDF) 잇지 않는다.

**경로**
```ts
// 거터 폭 g, 왼쪽 끝점 (x1, y1), 오른쪽 끝점 (x2, y2)
// 1) 상자 → 패널 가장자리까지 수평 stem
// 2) 거터 구간 3차 베지어: C (x1 + g/2, y1) (x2 − g/2, y2) (x2, y2)
// 3) 패널 가장자리 → 상자까지 수평 stem
export function connectorPath(params: ConnectorPathParams): string
```
- 줄 단위 변경은 선, 여러 줄 블록 변경은 띠(band): 왼쪽 [top, bottom]과 오른쪽 [top, bottom]을 위·아래 두 베지어로 이은 닫힌 경로. 기준은 "합집합 높이 > 2줄"이고, 끝 쪽(첫 쪽) 상자들이 걸친 **줄 수**로 잰다(아래 "Step 28-c에서 정한 것").
- 색은 종류별 토큰(`diff-insert`·`diff-delete`·`diff-change`), 라이트·다크 CSS 변수다.

**가시성 컬링**
- 변경마다 양쪽 끝점의 쪽 기준 y를 미리 계산해 y로 정렬한다.
- 프레임마다 각 패널의 보이는 범위(scrollTop ± 여유분)를 이분 탐색해 후보를 추린다.
- 양쪽 모두 화면 밖이면 그리지 않는다. 한쪽만 밖이면 그 끝점을 패널 위·아래 경계로 클램프하고 흐린 점선과 방향 표시로 그린다. 누르면 반대쪽 패널을 그 변경 위치로 스크롤한다.

**갱신 전략**
- 두 패널의 scroll 이벤트를 rAF로 묶어 프레임당 한 번 계산한다.
- 스크롤마다 React 상태를 갱신하지 않는다. 보이는 path의 `d`를 ref로 직접 갱신하거나 rAF 단위 외부 스토어(useSyncExternalStore)를 쓴다. 둘 중 무엇을 쓸지는 측정해서 정한다.
- 목표: 연결선 200개에서 60fps 근처.

**상호작용**
- hover: `hoveredChangeId`(store) → 연결선 굵게 + 양쪽 상자 강조.
- click: `activeChangeId`를 정하고 변경 목록과 양쪽 스크롤을 맞춘다.
- 동기 스크롤이 켜져 있으면 연결선은 대부분 수평이고, 꺼져 있으면 기울기로 위치 차이를 보인다.

**비교 PDF 내보내기 (Step 28-c)**
- 화면과 결과 파일이 같도록 비교 PDF의 연결선도 같은 규칙(앵커·종류 색·2줄 초과 띠)으로 그린다(오케스트레이터 결정, 2026-10-13). 장 위에서는 쪽 놓기 변환(ADR 0001 §14 `to_display` → 배율 → 칸 위치)으로 끝점을 옮긴다.

**테스트**
- BE는 위 "결과 모델과 앵커"의 golden(Step 28-b)과 연결선 끝·모양 golden(Step 28-c, `tests/compare_connectors.rs`: 한 줄·한 줄 상자 여럿·두 줄 = 선, 세 줄 치환·세 줄 삽입 = 띠, 앵커 끝, 쪽을 넘는 치환은 첫 쪽 끝, 숨긴 종류 제외), 규칙 단위 테스트(`connectors.rs`: 첫 쪽 상자만 합친 끝, 줄 수 경계, 쪽이 없는 끝), 비교 PDF 연결선(`report/tests.rs`: 장마다 변경 하나에 하나·끝점·종류 색·띠 채움·장 한도)과 삭제 메모 자리(B 앵커).
- FE 순수 함수는 프로젝트 정책(새 Vitest 금지)대로 E2E가 개발 서버 모듈(`widgets/compare-viewer/lib/connector-geometry.ts`)을 불러 확인한다(Step 28-c): 좌표 변환 파이프라인 `toContentRect` → `toOverlayRect`(회전 0/90/180/270, 배율 0.5/1/2, CropBox 오프셋·MediaBox 원점을 그 배율 pdf.js viewport와 맞댐), `connectorPath`·`bandPath`(손으로 적은 경로 문자열), `cullConnector`(정확히 화면 끝에 닿은 끝은 보임, 0.01px 넘으면 밖, 띠가 위에서 걸쳐도 보임, 한쪽만 밖). 대표점(한 줄·두 줄·여러 쪽·앵커·띠)은 화면에서 golden 끝을 pdf.js로 옮긴 자리와 1px 안으로 확인한다.

**구현 순서**
1. BE: `Placement` 모델 + 앵커 계산 + 테스트 → **Step 28-b**
2. FE: 좌표 변환·대표점·경로 순수 함수
3. FE: 두 패널 + SVG 오버레이 + 컬링 + rAF 갱신
4. FE: hover/click 상호작용, 변경 목록 연동, 비교 PDF 연결선 → 2~4는 **Step 28-c**

**Step 28-c에서 정한 것**
- **정본과 거울:** 끝·모양 규칙의 정본은 Rust `crates/pdf-core/src/compare/connectors.rs`(`connectors(result, hidden_kinds) -> Vec<Connector>`, `Connector { change_id, kind, shape: Line | Band, before, after }`, 끝 `ConnectorEnd { bounds, is_anchor }`)이고, 화면은 `entities/comparison/model/connector-ends.ts`(`connectorOf`)가 같은 규칙을 따른다. golden은 `crates/pdf-core/tests/golden/connector-geometry.connectors.json`(픽스처 `connector-geometry-a.pdf`·`-b.pdf`, 회전 0·90·180·270·CropBox 오프셋·MediaBox 원점 4쪽)이고 E2E가 같은 golden으로 화면 끝점·모양을 맞댄다.
  - 끝 사각형: 글자 쪽은 첫 상자의 쪽에 있는 상자들의 합집합(여러 쪽 변경도 첫 쪽만), 앵커 쪽은 앵커 막대(너비 0). 끝점은 이 사각형을 화면·장 좌표로 옮긴 뒤 정한다: 상자 = 거터를 향한 변(A 오른쪽, B 왼쪽)의 세로 가운데, 앵커 = 막대 가운데.
  - 끝의 쪽이 그 문서의 `page_sizes`에 없으면(쪽이 0개인 문서의 앵커) 그 변경은 잇지 않고 상태바 개수에서도 뺀다.
- **띠 기준(오케스트레이터 결정을 데이터로 고친 것):** "끝 쪽 줄 상자가 2개 초과"로 정했지만 BE 상자는 줄마다 하나가 아니다. `Replace`는 글자 diff로 다른 글자만 덮어 한 줄에 상자가 여럿이고(`diff-edit` #1 `2026년 12월 31` 한 줄 상자 3개, `connector-geometry` #2 한 줄 상자 5개), 2단은 같은 높이에 상자가 둘이다. 그래서 상자 수가 아니라 **줄 수**를 센다: 첫 쪽 상자를 텍스트 순서로 훑으며 앞 상자와 세로 겹침이 낮은 쪽 높이의 0.5(ADR 0001 §10 `SAME_LINE_MIN_OVERLAP`)보다 작으면 새 줄이다(가로 간격은 보지 않는다). 글자가 있는 쪽 끝 중 하나라도 2줄을 넘으면 띠(삽입·삭제는 글자 쪽만 센다). 띠의 앵커 쪽 변은 앵커 막대다(90·270도 쪽은 막대가 화면에서 가로라 높이 0인 변). 화면 줄 세기는 Rust와 같은 `f32` 값을 내도록 `Math.fround`로 셈한다. 한계: 글자를 돌려 그린 쪽(사용자 공간 세로 흐름)은 글자마다 상자가 따로라 줄을 많게 센다(§10 같은 줄 병합 한계와 같은 원인).
- **화면 배치:** 페이지 영역 = `A 패널 | 거터 120px | B 패널`(Step 27의 가로 쪽 행 72px 거터는 행마다 폭을 바꿀 수 없어 없앴다). 바깥 여백 16px은 영역 바깥쪽(A 왼쪽, B 오른쪽)에만 두고, 쪽은 여백 안 칸의 가로 가운데(칸보다 넓으면 왼쪽에 붙고 가로 스크롤)다. 연결선 끝점 x도 같은 규칙(`widgets/compare-viewer/lib/pane-layout.ts`)으로 구한다. "맞춤"은 패널 안쪽 너비(세로 스크롤바 제외) − 바깥 여백 − 양옆 24px로 잰다.
- **동기 스크롤:** 두 패널은 같은 행 배치(행 `i` = `page_pairs[i]`, 높이 = 캡션 + 두 쪽 중 큰 쪽 + 아래 여백)라 콘텐츠 높이가 같다. 켜져 있으면 한 패널의 `scrollTop`·`scrollLeft`를 다른 패널에 그대로 둔다(같은 행의 같은 높이). 맞추면서 생긴 상대 패널의 scroll 이벤트(메아리, 1px 안)는 되돌려 보내지 않는다. 켜는 순간 B를 A에 맞춘다. 끄면 따로 스크롤하고 연결선 기울기가 위치 차이를 보인다. A만·B만 보기에서는 막는다. 배율·보기 방식을 바꿔 패널을 새로 만들면 두 패널 모두 현재 쪽 행(아래)에서 시작한다.
- **변경으로 이동(목록·이전/다음·키보드·연결선 누르기):** 보이는 패널마다 그 변경의 끝(연결선 끝과 같다, 앵커 포함)의 세로 가운데를 화면 가운데에 둔다. 나란히 + 동기 스크롤이면 두 패널을 같은 위치로 두고 두 끝의 가운데를 화면 가운데에 둔다(같은 행·같은 높이 변경은 둘 다 가운데, 다른 행에 걸친 변경도 화면 높이 안이면 둘 다 보인다). 끝의 쪽 변환을 받지 못하면 그 행 맨 위로 간다. 이동은 virtuoso `scrollToIndex`(행 + 행 안 거리)로 한다: 위치만 주는 `scrollTo`는 패널을 막 새로 만든 직후(배율을 바꾸고 바로 고를 때) virtuoso의 첫 행 맞추기에 덮였다(E2E로 재현).
- **좌표·컬링:** 쪽 기준 좌표(끝점 x, 띠 변 위·아래, 패널 콘텐츠 px)는 결과·배율·패널 너비·쪽 변환이 바뀔 때만 계산한다(`use-connector-layout.ts`). 끝이 놓인 쪽의 pdf.js 변환은 화면에 놓이지 않은 쪽도 결과마다 한 번 받는다(`usePageGeometries`, 한쪽만 보이는 선의 반대 끝 자리를 알아야 한다). 프레임마다: 패널마다 끝을 위 끝으로 정렬한 색인에서 보이는 범위 `[scrollTop − 여유분, scrollTop + 높이]`를 이분 탐색해 후보를 추리고(여유분 = 끝 세로 길이의 최댓값: 띠 끝이 위에서 걸쳐 내려와도 후보가 된다), 끝마다 "끝의 세로 범위가 패널의 보이는 범위와 닿는가(경계에 정확히 닿아도 보인다)"로 판정한다. 둘 다 보이면 모양대로, 둘 다 밖이면 그리지 않고, 한쪽만 밖이면 그 끝을 패널 위·아래 경계에서 8px 들여놓은 자리로 끌어와 **흐린 점선**(불투명도 0.45, `2 4`, 띠도 선으로)과 그 끝 x의 **V자 방향 표시**(반 폭·높이 4px, 밖인 쪽을 가리킨다)로 그린다. 상자가 가로 스크롤로 패널 밖에 있으면 끝점 x를 패널 경계로 자른다.
- **갱신 전략 = ref로 DOM 직접 갱신(측정으로 정함):** 두 패널의 scroll 이벤트를 rAF로 묶어 프레임당 한 번 계산하고, 변경마다 미리 마운트한 `<g>`의 path `d`·`data-state`를 DOM에 바로 쓴다(값이 바뀐 것만). 스크롤 중 React 상태는 바꾸지 않는다(미니맵 틀은 미니맵 컴포넌트만 다시 그린다). 측정: Playwright WebKit 헤드리스, 1280×800, 기기 픽셀 비율 2, Apple M 계열, rAF마다 6px 왕복 스크롤 300프레임.

  | 경우 | 화면에 그린 연결선 | ref 직접 갱신: 프레임 간격 중앙/p95, 갱신 계산 중앙 | useSyncExternalStore: 프레임 간격 중앙/p95 |
  |---|---|---|---|
  | 20쪽 × 10개 = 200개 | 13~15 | 17 / 31ms, 1ms 미만 | 17 / 31~32ms |
  | 2쪽 × 100개 = 200개 | 135 | 17 / 27~28ms, 1ms | 17 / 27~28ms |
  | 2쪽 × 500개 = 1000개(부하) | 674 | 30 / 52ms, 3ms | 37 / 47~48ms |

  200개(문서 전체 기준과 한 화면 135개 모두)에서는 두 방법 모두 60fps(17ms)이고, 화면 674개 부하에서 ref 직접 갱신의 프레임 간격 중앙값이 더 짧아(30ms 대 37ms, 외부 스토어 쪽은 React가 `<path>` 674개를 다시 맞추고 붙인다) ref를 골랐다. WebKit `performance.now()`는 1ms 단위라 계산 시간은 어림이다. E2E(`compare-connectors.spec.ts` "연결선 200개")가 같은 방식으로 20쪽 × 10개를 12px씩 240프레임 내리며 재고(중앙 17ms, p95 27~30ms, 최대 30~34ms) 거의 모든 프레임에서 연결선이 다시 그려지는지 확인한다.
- **모양·색(토큰 문서 §6.6):** 종류 선 색 `diff-insert`·`diff-delete`·`diff-change` 1.5px 둥근 끝, 띠는 종류 `-fill` 채움 + 같은 색 1px 테두리. 가리키거나 고르면 선 3px·띠 테두리 2px. `Replace`도 실선이다(점선은 화면 밖 끝 표시에 쓴다. 변경 상자 자체는 점선 그대로).
- **상호작용:** 마우스는 거터 구간의 투명한 경로(선 14px, 띠는 면)만 받는다(쪽 위·스크롤바 위 조작을 가리지 않는다). 가리키면 `hoveredChangeId`(단일 id로 바꿨다, 묶음이 없어졌다)로 그 선이 굵어지고 양쪽 상자(옅은 primary 고리)·목록 항목이 함께 강조된다. 누르면 그 변경을 고른다(목록 펼침·두 패널 이동, 한쪽이 밖인 점선을 누르면 그 끝 패널이 그 변경으로 돌아온다). 가리킨 선이 화면에서 사라지거나 연결선이 바뀌면 호버를 푼다.
- **Step 28 화면 요소:** 툴바 "연결선" 체크박스는 남긴다(보기 설정, A만·B만에서 막음). 옆에 "동기 스크롤" 체크박스를 더했다. 상태바 "연결선 N개"의 N은 지금 필터로 그릴 연결선 수(= 이을 수 있는 보이는 변경 수, 문서 전체)다. 번호 태그 겹침 규칙(토큰 문서 §6.6)은 그대로다. 미니맵 틀·현재 쪽은 기준 패널(나란히·B만은 B, A만은 A)의 스크롤로 정한다(동기 스크롤을 끄면 A 패널 위치는 틀에 보이지 않는다).
- **비교 PDF 내보내기:** 나란히 + 색 상자일 때만, 장 안에서 두 끝이 그 장의 두 쪽에 있는 변경만 같은 규칙으로 그린다(다른 장에 걸친 변경은 그릴 곳이 없다). 장 좌표에서 끝 사각형을 쪽 놓기 변환(ADR 0001 §14 `to_display` → 배율 → 칸 위치)으로 옮긴 뒤 끝점을 정하고, A 끝점 → A 쪽 오른쪽 끝(수평) → 두 쪽 사이 3차 베지어(제어점 = 각 끝에서 간격 반만큼) → B 쪽 왼쪽 끝 → B 끝점, 띠는 위·아래 변을 같은 식으로 이은 닫힌 경로다. 색은 종류 선 색 1pt, 띠는 종류 `-fill`(알파 그대로) 채움 + 0.5pt 테두리. 장 한도 `MAX_SHEET_CONNECTORS`(40)는 그대로 두고 단위가 변경 하나가 됐다(넘으면 그 장은 연결선을 그리지 않는다).
- **주석 PDF 삭제 메모:** B 앵커 자리로 옮겼다(쪽 비율 근사를 없앴다). 메모 아이콘(20pt) 왼쪽 끝이 앵커 막대 x, 세로 가운데가 막대 가운데이고, 보이는 영역 안으로 민다. 앵커의 쪽이 B에 없으면 메모를 달지 않는다(ADR 0001 §14).

**Step 28에서 정한 것 (대체됨)**

Step 28(PR #47)은 행(페이지 쌍) 안에서 `Replace`만 잇고 가까운 변경을 묶는 규칙으로 만들었다. 사용자 명세(2026-10-13)가 아래를 대체했고, Step 28-c가 코드(`connector_stems`, `connector-stems.ts`, `connectors.ts`, `use-connector-stems.ts`, `connector-layer.tsx`)와 golden(`connectors.changes.json`·`connectors.stems.json`), 토큰 `connector`를 걷어냈다.
- ~~묶기(stem): 가까운 변경 여러 개를 선 하나로~~ — 양쪽 세로 간격 `CONNECTOR_GAP_PT`(20pt) 이하 + B 순위가 앞 변경 + 1이면 앞 묶음에 붙였다. 정본은 Rust `crates/pdf-core/src/compare/connectors.rs`(`connector_stems`), 화면은 `entities/comparison/model/connector-stems.ts`(`Math.fround`로 같은 `f32` 결과), golden `connectors.changes.json`·`connectors.stems.json`. → 변경마다 선(또는 띠) 하나로 대체.
- ~~`Insert`·`Delete`는 잇지 않는다~~ → 앵커에 잇는다.
- ~~행 단위 그리기~~ — 같은 행(변경의 `page_pair`가 그 행의 두 쪽)일 때만, 행마다 `<svg>` 하나(거터 칸에 맞춘 너비, 세로 120px·가로 72px 고정 거터), 가상화 창 밖 행은 마운트하지 않았다. → 두 패널 + 공용 SVG 오버레이 + 컬링으로 대체.
- ~~중립색~~ — 평상시 `connector` 마커색 45%, 선택·호버만 종류 색 3px, 종류가 섞인 묶음은 중립색. → 종류별 색으로 대체.
- ~~대칭 S 곡선~~ — 거터 칸 양끝(0, W)에서 제어점 (0.5W, aY)·(0.5W, bY), 높이 차이 3px 이하면 직선. → 수평 stem + 거터 베지어로 대체.
- ~~스크롤 중 숨김~~ — 스크롤 컨테이너 `data-scrolling` + CSS로 140ms 동안 연결선을 숨겼다. → rAF 갱신으로 스크롤 중에도 그린다.
- 끝점·읽는 순서를 화면 방향(`/Rotate` 적용) pt로 본 것, 끝점을 pdf.js viewport 변환으로만 구한 것은 새 규칙에서도 같다(좌표 변환 파이프라인).
- 비교 PDF(ADR 0001 §14): 나란히 + 색 상자일 때만 묶음을 1pt `connector` 45%로 그리고 장의 묶음이 40개를 넘으면 그 장은 생략했다. → 위 "비교 PDF 내보내기"로 대체.

**알려진 한계**
- 앵커는 사용자 공간에서 정한다(ADR 0001 §4). 글자를 돌려 그리고 `/Rotate`로 세운 쪽(돌린 스캔 포함)은 글 흐름이 사용자 공간 세로라 앵커가 마지막 글자의 화면 아래(또는 위) 변에 놓인다(글자 하나 크기 안).
- 빈 쪽 앵커는 내용이 아니라 쪽 여백에 놓이는 근사다.
- 한쪽 끝이 화면 밖인 점선들은 같은 패널 경계로 모여 그 쪽 거터 끝에서 겹친다. 누를 곳은 보이는 끝 쪽(거터의 반대 끝)에서 갈린다.
- 미니맵 틀·현재 쪽은 기준 패널(나란히는 B) 하나로 보인다. 동기 스크롤을 끄고 A 패널만 옮기면 미니맵에 A의 자리는 보이지 않는다.

**완료 기준**
- Step 28-b: 결과 모델이 `Placement`이고, 앵커·병합 golden이 통과하며 변이로 실패가 확인된다. 계약·바인딩·화면·내보내기가 새 모델로 컴파일되고 기존 E2E가 통과한다(화면 연결선은 Step 28 규칙 그대로).
- Step 28-c: 두 패널·공용 오버레이·컬링·rAF·종류 색·stem + 베지어·띠가 위 규칙대로 그려지고(E2E), 연결선 200개에서 60fps 근처(측정값 기록), 비교 PDF 연결선이 같은 규칙이다.

### 완료 기준
- 100페이지 문서 쌍을 Mac(M 시리즈)에서 5초 안에 비교한다(텍스트 레이어 문서 기준, 목표치이며 Phase 2 측정 후 확정). 스캔 문서는 쪽당 처리 시간이 P2-2a 합격 기준 안이다.
- 비교 중에도 스크롤과 취소가 가능하다.

---

## 8. Phase 4: 빌드, 배포, 서명

### P4-1 CI
- `.github/workflows/ci.yml` 매트릭스(PR·`main` 푸시). 릴리스용 `tauri-apps/tauri-action`은 P4-2에서 쓴다.
  - `macos-latest`(aarch64-apple-darwin, 필요하면 `universal-apple-darwin`)
  - `windows-latest`
  - `ubuntu-22.04`(`libwebkit2gtk-4.1-dev` 등)
- 각 잡에서 `scripts/fetch-pdfium.mjs`와 `scripts/fetch-ocr.mjs`를 실행한다(버전 고정, 캐시). `fetch:ocr`은 Step 26부터 필수다(tauri-build가 OCR 모델·macOS ONNX Runtime dylib를 복사한다, §6.4 배포). 잡마다 `ONNXRUNTIME_LIB_PATH`·`OCR_MODEL_DIR`을 넣어 OCR 테스트도 돈다.
- `Swatinem/rust-cache`, pnpm 캐시, `NODE_AUTH_TOKEN`(GitHub Packages)을 유지한다.
- PR에서는 `pnpm validate` + `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test`를 실행한다.
- E2E(`pnpm test:e2e`)는 macOS 잡에서만 돈다. Tauri macOS 웹뷰와 엔진이 같고, 한글 CID 픽스처가 쓰는 시스템 한글 글꼴이 이미 있다.
- Windows 설치 파일은 **NSIS**(`bundle.targets`에 `nsis`) 하나로 한다. 사용자 단위 설치라 관리자 권한이 필요 없다. CI의 Windows 잡이 `pnpm tauri build`로 만들어 아티팩트로 올린다. `pdfium.dll`·`onnxruntime.dll`은 `--config`로 `bundle.resources`에 넣어 설치 폴더(`resource_dir`)에 둔다. macOS `.dmg`는 PR마다 만들지 않는다(P4-2 릴리스에서).

### P4-2 릴리스 흐름 정리 (T1)
- 기존 Electron용 워크플로(`build.yml`, `release.yml`, `auto-version.yml`)는 Step 1에서 모두 제거했다. 여기서 새로 만든다: `pnpm release:*` → 태그 푸시 → `release.yml`이 tauri-action으로 Draft Release를 만들고 아티팩트를 업로드한다.

정한 것(Step 31, 2026-10-13):
- `pnpm release:patch|minor|major`(`scripts/release.mjs`)는 `main`·깨끗한 작업 트리에서만 돈다. `pnpm version <단계> --no-git-tag-version`으로 `package.json`을 올리고(앱 버전의 단일 소스) `chore: release v<버전>` 커밋과 annotated 태그 `v<버전>`을 만든 뒤 멈춘다. **푸시는 사용자가 한다**(`git push origin main --follow-tags`. `--follow-tags`가 annotated 태그만 올리므로 `-a`로 만든다). 이전 스크립트는 경량 태그라 태그가 올라가지 않았다.
- `.github/workflows/release.yml`: `v*` 태그 푸시와 `workflow_dispatch`(입력 없음)로 돈다. 매트릭스는 `macos-latest`(aarch64, `--bundles app,dmg`)와 `windows-latest`(`--bundles nsis`, `pdfium.dll`·`onnxruntime.dll`은 ci.yml과 같은 `--config` 파일). 설치·캐시·`fetch:pdfium`·`fetch:ocr`·`NODE_AUTH_TOKEN`은 ci.yml과 같고, lint·테스트는 CI 몫이라 돌지 않는다.
- `tauri-apps/tauri-action`은 v1.0.0 커밋 SHA로 고정한다. 태그 푸시면 그 태그의 Draft Release(`releaseDraft: true`)를 만들거나 찾아 올리고, `workflow_dispatch`면 `tagName`이 비어 릴리스를 건너뛰고 `uploadWorkflowArtifacts`로 워크플로 아티팩트만 올린다. 자동 업데이트(P4-4)가 없으므로 `uploadUpdaterJson: false`.
- 태그 푸시면 먼저 태그와 `package.json` 버전이 같은지 보고 다르면 실패한다.
- macOS 잡은 빌드 뒤 `node scripts/verify-macos-signature.mjs`로 서명을 검사한다(P4-3). tauri-action은 빌드와 업로드가 한 단계라 태그 빌드에서는 이 검사가 업로드 뒤에 돈다. 실패하면 Draft를 공개하지 않고 지운다.

### P4-3 서명
| 옵션 | 비용 | 사용자 경험 |
|---|---|---|
| macOS ad-hoc (`signingIdentity: "-"`) | 무료 | 다운로드한 앱은 Gatekeeper 경고가 뜬다(우클릭 → 열기 또는 `xattr -dr com.apple.quarantine`). **개인용 1차 권장.** |
| Developer ID + 공증 | Apple Developer 연 $99 | 경고가 없다. tauri-action에 `APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` 시크릿을 넣는다. |
| Windows | 미서명 | SmartScreen 경고가 뜬다. 개인용으로는 허용한다. |
- 어느 옵션이든 **`Frameworks/libpdfium.dylib`와 ONNX Runtime dylib(§6.4)도 앱과 같은 identity로 서명**돼야 한다. `codesign --verify --deep --strict`로 확인한다.

정한 것(Step 32, 2026-10-13):
- macOS는 ad-hoc으로 간다. `tauri.conf.json`의 `bundle.macOS.signingIdentity: "-"`, `entitlements: ./Entitlements.plist`(`disable-library-validation`), hardened runtime은 Tauri 기본값(켜짐)을 그대로 쓴다. Windows는 미서명.
- 후처리 서명은 두지 않는다. Tauri 번들러가 `bundle.macOS.frameworks`의 dylib를 먼저, 실행 파일, 앱 순서로 같은 identity로 서명한다(`pnpm tauri build --bundles app` 로그와 `codesign -dv`로 확인: 앱 `flags=0x10002(adhoc,runtime)`, 두 dylib `Signature=adhoc`·`TeamIdentifier=not set`, `--verify --deep --strict` valid).
- 검사는 `scripts/verify-macos-signature.mjs` 한 곳이다(release 워크플로와 로컬이 같은 기준). `--verify --deep --strict`, 앱의 hardened runtime 플래그, `disable-library-validation` entitlement, `libpdfium.dylib`·`libonnxruntime.dylib`의 서명 주체(`Signature=adhoc` 또는 첫 `Authority`)와 Team ID가 앱과 같은지 본다.
- Developer ID로 바꿀 때: 리포 시크릿 `APPLE_CERTIFICATE`(p12 base64)·`APPLE_CERTIFICATE_PASSWORD`·`APPLE_SIGNING_IDENTITY`·`APPLE_ID`·`APPLE_PASSWORD`(앱 전용 암호)·`APPLE_TEAM_ID`를 release.yml의 tauri-action `env`로 넘기고, `signingIdentity: "-"`를 지우거나 `APPLE_SIGNING_IDENTITY`로 덮는다. 앱과 dylib가 같은 Team ID가 되면 `disable-library-validation`을 빼고(§5 P1-0) 검사 스크립트의 entitlement 확인도 함께 고친다. 인증서·암호는 레포에 넣지 않는다.

### P4-4 (선택) 자동 업데이트
- `pnpm tauri add updater`로 플러그인을 넣고, 서명 키는 `pnpm tauri signer generate -w ~/.tauri/pdfstudio.key`로 만든다(개인 키는 레포에 넣지 않고 GitHub 시크릿 `TAURI_SIGNING_PRIVATE_KEY`로만 둔다). tauri-action이 GitHub Releases에 `latest.json`을 생성한다.

### P4-5 라이선스와 고지 (S, L1)
- 루트에 `LICENSE`(MIT) 파일을 둔다.
- `THIRD_PARTY_NOTICES.md`를 만들어 앱과 함께 번들한다: pdfium(BSD-3/Apache-2.0), pdf.js(Apache-2.0), IBM Plex(OFL), ONNX Runtime(MIT), PaddleOCR 모델(Apache-2.0), Rust·npm 의존성. CI에서 §1.2 허용 목록 밖 라이선스가 들어오면 실패시킨다.
- 생성 도구는 새로 설치하지 않고 기본 명령으로 한다(2026-10-13 변경, 원래 `cargo-about`·`license-checker`류): `pnpm licenses:generate`(`scripts/generate-notices.mjs`)가 Rust는 `cargo metadata`(워크스페이스 멤버의 normal 의존성만, dev·build 의존성 제외, 모든 타깃), npm은 `pnpm licenses list --json --prod`로 모으고 패키지 폴더의 LICENSE·NOTICE 원문을 싣는다. 번들 바이너리·자산(pdfium, ONNX Runtime, OCR 모델, 글꼴, pdf.js 자산)은 `scripts/third-party/bundled.mjs`의 고정 목록이다. pdfium 원문은 `src-tauri/pdfium/aarch64-apple-darwin/`에서 읽으므로 그 타깃을 받아 둔다.
- `pnpm licenses:check`(`scripts/check-licenses.mjs`)는 허용 목록·예외(§1.2) 밖 라이선스가 있거나 커밋한 고지가 지금 의존성으로 만든 것과 다르면 0이 아닌 코드로 끝난다. CI는 arm64 macOS 잡에서 `pnpm fetch:pdfium`(aarch64-apple-darwin을 받는다) 뒤 `pnpm licenses:check`를 돈다(Step 30 PR에서 연결).
- 앱 정보: 상태 바 버전 옆 "오픈소스 라이선스"가 번들한 고지(`bundle.resources`)를 Rust 커맨드 `read_third_party_notices`로 읽어 대화상자로 보여 준다. 저장소 `LICENSE`도 함께 번들한다.

---

## 9. Phase 5: 고도화 후보 (필요할 때)
- **스타일 비교:** 글꼴·굵기·색·밑줄 차이. 텍스트 레이어 쪽에서만 할 수 있다(OCR 쪽에는 글꼴 정보가 없다).
- **레이아웃 비교:** 같은 글자의 위치·줄바꿈·정렬 변화.
- **그래픽(이미지) diff 레이어:** pdfium으로 짝 페이지를 같은 스케일로 렌더해 픽셀 비교 후 연결 요소로 영역 박스를 만든다. 페이지 크기가 같을 때만 수행한다. 또는 페이지 객체(path/image)를 직접 비교한다.
- **이동 감지:** 같은 텍스트의 delete/insert 쌍을 `Moved`로 접는다.
- **머리글/바닥글 자동 감지:** 여러 페이지에서 같은 위치에 반복되는 텍스트를 찾는다.
- **폴더 일괄 비교:** 파일명 유사도로 짝을 짓고, 사용자가 수정한 뒤 순차 실행해 리포트 ZIP을 만든다.
- **비교 이력 영속화:** `plugin-store` 또는 `plugin-sql`(SQLite)
- **미니맵**, 변경 밀도 표시
- **병렬화:** pdfium 직렬화가 병목이면 추출만 별도 프로세스로 나누는 방안을 검토한다(측정 후).

---

## 9.1 Phase 6(가칭): PDF 번역·설정

비교 UI(Phase 3)를 시안 1~9대로 먼저 끝낸 뒤 진행한다(D17). 시안은 `docs/resource/design/10~14`.

- **번역(시안 10~13):** 중국어·영어 PDF를 한국어로 옮긴다. 사용자 본인의 Claude API 키를 쓴다. 모델은 Sonnet/Haiku 중 고른다. 용어집을 적용하고, 스캔 쪽은 이미지를 보낼지 옵션으로 고른다. 실행 전 예상 토큰·요금을 보여 주고, 결과는 원문·번역 대역 보기로 확인한다.
- **설정(시안 14):** API 키(OS 키체인), 기본 모델, 외부 전송 확인, 공용 용어집, 오류 보고, 정보.
- **설계 쟁점**
  - 문서 내용이 외부(Anthropic API)로 나간다. 비교·OCR의 "기기 밖으로 안 나감" 원칙과 분리해 화면·문구에서 구분한다.
  - 외부 전송은 매번 동의를 받는다.
  - 키는 OS 키체인에 저장한다. 평문 저장 금지.
  - 키·요청 로그에 문서 내용을 남기지 않는다.
  - 실패·재시도·취소·비용(예상치와 실제치 차이)을 다룬다.
- 상세 Step은 Phase 3이 끝난 뒤 계획한다.

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
node scripts/fetch-ocr.mjs               # P2-2a 이후 (ONNX Runtime, OCR 모델)
export ONNXRUNTIME_LIB_PATH=$PWD/src-tauri/onnxruntime/aarch64-apple-darwin/<라이브러리 파일>
export OCR_MODEL_DIR=$PWD/src-tauri/ocr-models
cargo test -p pdf-core                   # P1-2 이후
pnpm tauri dev                           # P1-1 이후
```

### 10.2 크로스플랫폼 주의사항
- **경로:** TS에서는 문자열로 `/`나 `\`를 직접 다루지 않고 `@tauri-apps/api/path`를 쓴다. Rust에서는 `PathBuf`만 쓴다.
- **WebView 차이:** macOS는 WKWebView(Safari), Windows는 WebView2(Chromium), Linux는 WebKitGTK다. pdf.js 렌더와 캔버스는 Safari 기준으로 확인하고, Safari 캔버스 메모리 상한에 맞춰 LRU 상한을 보수적으로 잡는다.
- **파일 잠금:** Windows 공유 위반 재시도는 Rust에서 `cfg(windows)`로만 수행한다.
- **pdfium·OCR 라이브러리 경로:** 개발(`PDFIUM_LIB_PATH`, `ONNXRUNTIME_LIB_PATH`, `OCR_MODEL_DIR`), 테스트, 번들(`Frameworks`/resources)마다 다르다. 결정 로직을 `pdf-core` 한 곳에 둔다.
- **단축키:** `⌘`/`Ctrl`을 추상화한다(`isMac ? metaKey : ctrlKey`).
- **E2E:** `tauri-driver`(WebDriver)는 **macOS를 지원하지 않는다.** 프론트 검증은 Playwright E2E만 쓴다: Vite dev + `mock-platform` + WebKit 엔진 헤드리스(창이 뜨지 않고 Mac WKWebView와 엔진을 맞춘다). 처리 로직은 핵심 동작만 `cargo test`로 검증한다.

### 10.3 Claude Code 세션 시작 프롬프트 예시
> `docs/plans/2026-10-step-guide.md`의 **Step N**을 진행해줘. 거기 적힌 문서 섹션을 읽고, 시작 전에 작업 계획을 먼저 보여 주고 확인을 받아. 완료 기준을 직접 검증한 뒤 보고해.

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
| D8 | 라우터 미도입 (모드 스토어 `home/merge/compare`) | TanStack Router | 화면 수가 적다(YAGNI). |
| D9 | 첫 화면 = 홈(작업 고르기), 이후 툴바 탭으로 전환 | 탭만 두기 | 기능이 둘이 되면서 처음 쓰는 사람이 무엇을 할 수 있는지 바로 보이게 |
| D10 | 병합 화면은 지금 구조·기능 유지(모드 탭 추가), 스타일·배치·문구는 시안 2·6·7·8에 맞춘다(2026-10-13 수정, Step 24-a) | 병합 화면 재설계 / 스타일도 그대로 두기 | 익숙한 동작과 기능 진입점은 그대로 두면서 다른 화면(홈·비교)과 같은 시각 언어로 맞춘다. 새 데이터가 필요하거나 동작이 바뀌는 시안 항목은 하지 않는다 |
| D11 | 설치·생성은 Tauri CLI 키트와 `pnpm add`/`cargo add`로 (§1.3) | 설정 파일·등록 코드를 직접 작성 | 공식 생성물이 버전에 맞는 형식을 보장하고, 손으로 쓸 때 생기는 누락(권한, 플러그인 등록, 버전 불일치)을 막는다. |
| D12 | Tauri 셸을 먼저(실행 순서 1 → 9 → 8 → 10 → 11 → 2 → 14 → 3 → 4 → 5 → 6 → 13 → 7 → 15) | Electron 위에서 Phase 0 정리 + 임시 `electron-platform.ts` | 버려질 임시 어댑터·계약 코드를 만들지 않는다. 대가로 Step 9~2 사이에는 파일 처리 기능이 동작하지 않는다. |
| D13 | 허용 경로 목록: 파일 열기·저장 다이얼로그를 Rust 커맨드로 열고, 다이얼로그·드롭으로 받은 경로를 `State`에 기록해 파일 커맨드는 목록에 있는 경로(와 앱 임시 폴더)만 허용 | 프론트가 `plugin-dialog`를 직접 열고 경로를 넘김 | Rust가 "사용자가 고른 경로"를 알 수단이 없으면 경로 검증이 형식만 남는다 |
| D14 | 파일 추가 처리 = Rust `open_files` | TS `ingestPaths` 통합 | 같은 분기가 3벌 중복(B2의 원인)이고, 확장자 화이트리스트는 어차피 Rust가 검사한다 |
| D15 | 스캔 계약서 OCR = PaddleOCR(PP-OCR) 한국어 모델 ONNX 변환본 + ONNX Runtime(`ort`) (§6.4) | macOS Vision + Windows.Media.Ocr, Tesseract, 클라우드 OCR | Mac·Windows가 같은 결과, 한국어 정확도, 라이선스 화이트리스트 안, 계약서가 기기 밖으로 나가지 않음 |
| D16 | 비교 결과 모델과 좌표 규칙 = [ADR 0001](../adr/0001-compare-result-model.md): 박스는 CropBox 원점이 들어간 사용자 공간 좌표(회전 전, `UserUnit` 미적용), 쪽 번호 0부터, `Change.id` = SHA-256 안정 키, `needs_review`로 변경을 둘로 나눠 셈, 계약 타입은 `src-tauri` 미러 | 박스를 CropBox 상대 좌표로 두고 프론트가 보정, 순번 id, 쪽마다 안내 | 화면 변환을 pdf.js viewport 하나에 맡겨 보정 지점을 Rust 한 곳으로, 재실행해도 선택 유지, `pdf-core`는 specta를 모른다 |
| D17 | PDF 번역·설정(시안 10~14)은 별도 Phase 6(가칭)으로 두고 비교 UI(Phase 3)를 먼저 끝낸다 (§9.1) | 번역을 Phase 3에 함께 구현 | 번역은 외부 전송·키 보관·비용이라는 별도 설계 쟁점이 있고, 비교 UI는 기기 밖으로 안 나가는 범위로 먼저 완결한다 |

## 12. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| pdfium 번들·서명 실패(특히 Mac) | 전체 일정 지연 | **P1-0을 게이트로** 두고 가장 먼저 검증 |
| pdfium과 pdf.js 좌표 불일치(CropBox, 회전) | 하이라이트 위치 어긋남 | §6.3 Rust golden 테스트 + E2E 박스 위치 확인, `page_sizes`에 원점 오프셋 포함 |
| `tiff` 크레이트의 압축 방식 미지원(CCITT G4 등) | 일부 TIFF 변환 실패 | 원본 스트림 그대로 넣는 경로, 미지원 시 명확한 에러 |
| pdfium 직렬화로 인한 처리 대기 | 병합과 비교를 동시에 하면 대기 | 작업 큐 + 진행률 표시. 측정 후 필요하면 Phase 5 병렬화 |
| ToUnicode가 깨진 PDF | 비교 품질 저하 | `LowTextConfidence` 안내. 그래픽 diff는 Phase 5 |
| 스캔 PDF의 OCR 오인식(특히 숫자·금액·날짜) | 오인식이 차이로 보이거나, 실제 차이를 놓침 | 신뢰도 기준 미만은 "확인 필요"로 분리(숫자는 더 엄격), P2-2a 게이트에서 CER·숫자 일치율·조용한 오인식 0건 확인 (§6.4) |
| OCR 띄어쓰기·문장부호 오류 | 단어 토큰이 갈라지거나 끝 마침표가 빠져 거짓 차이 | OCR 쪽이 섞인 띄어쓰기만·문장부호만 다른 치환은 "확인 필요"로 분리(ADR 0001 §5) |
| OCR 런타임·모델 번들·서명 실패 | 스캔본 비교 불가 | **P2-2a를 게이트로** 두고 서명된 `.app`에서 로드 확인. 런타임·모델이 없으면 `NoTextLayer`로 알리고 비교는 계속 |
| OCR 런타임·모델로 앱 크기 증가 | 다운로드·설치 크기 증가 | P2-2a 합격 기준에 증가량 상한. 넘으면 작은 모델 또는 첫 사용 때 모델 받기 |
| OCR 처리 시간 | 스캔본 비교가 느림 | 쪽당 시간 상한(P2-2a), 진행률 `ocr` 단계, 쪽마다 취소, 파일 해시 기준 OCR 캐시 |
| 스캐너가 넣은 저품질 숨은 글자층 | 텍스트 레이어로 취급되어 품질 저하 | `LowTextConfidence` 안내. 글자층을 무시하고 OCR하는 옵션은 필요해지면 Phase 5 |
| Rust 학습 비용 | 진행 속도 | `pdf-core`를 작은 모듈로 나누고 테스트 우선. 기존 TS 테스트 케이스를 명세로 사용 |
| pdf.js 5 최소 브라우저 요구 | 구형 macOS에서 동작 불가 | `minimumSystemVersion`을 명시하고 실기기에서 검증 |
| Windows HTML5 DnD 차단 | 재정렬 불가 | P0-5 선행 |

---

## 13. 진행 체크리스트

> 실제 진행 순서와 체크는 [단계별 진행 가이드](2026-10-step-guide.md)에서 한다. 새 실행 순서(1 → 9 → 8 → 10 → 11 → 2 → 14 → 3 → 4 → 5 → 6 → 13 → 7 → 15)는 가이드를 따른다. 아래는 작업 목록 요약이다.

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
- [ ] **P2-2a OCR 스파이크 (CER·숫자 일치율·쪽당 시간·번들 증가·서명된 `.app` 로드)**
- [ ] P2-3 정규화와 토큰화
- [ ] P2-4 정렬과 diff
- [ ] P2-4a OCR 연결 (신뢰도·좌표 되돌리기·캐시)
- [ ] P2-5 페이지 짝짓기
- [ ] P2-6 옵션
- [ ] P2-7 작업 실행기 (진행률·취소·캐시)
- [ ] P2-8 리포트 내보내기
- [ ] P3-1 ~ P3-5 홈·모드 전환, 비교 UI
- [ ] P4-1 ~ P4-5 빌드, 배포, 서명, 라이선스 고지
