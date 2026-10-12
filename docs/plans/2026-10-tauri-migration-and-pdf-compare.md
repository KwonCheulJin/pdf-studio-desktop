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
| TIFF 디코드 | `tiff`, `image` | MIT / Apache-2.0 |
| 에러, 직렬화, 타입 생성 | `thiserror`, `serde`, `tauri-specta` | MIT / Apache-2.0 |
| 표시 | `pdfjs-dist` | Apache-2.0 |
| OCR 추론(Rust) | `ort` (ONNX Runtime 바인딩) | MIT / Apache-2.0 |
| OCR 런타임 바이너리 | ONNX Runtime | MIT |
| OCR 모델 | PaddleOCR(PP-OCR) 한국어 검출·인식 모델의 ONNX 변환본 | Apache-2.0 |

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
| `file.convert.tiff` | sharp → PNG → pdf-lib | **`convert_tiff(path) -> { pdf_path, page_count, display_name }`**(`tiff`/`image` + pdfium). 결과 PDF는 앱 캐시 디렉터리에 고유 이름으로 저장하고, 화면에 보일 이름은 `display_name`(원본 TIFF 이름)으로 따로 돌려준다(결함 B15). |
| `file.meta.get-pdf-info` | pdf-lib 전체 파싱 | **`get_pdf_info(path)`**(pdfium: 페이지 수, 페이지별 크기·회전) |
| `file.read:pdf` | 파일 전체를 구조화 복제로 전달 | **`read_pdf(path) -> tauri::ipc::Response`**(raw bytes). **표시용(pdf.js)으로만 사용한다.** |
| `dialog.show-open/save` | Electron dialog | **Rust가 다이얼로그를 여는 커맨드 `pick_files`·`pick_save_path`**(`plugin-dialog`는 Rust 쪽에서 호출). 결과 경로를 허용 경로 목록(`State`)에 기록한다(D13). |
| `file.save.copy` | `fse.copy` | 필요 없음. 병합 출력은 요청의 `output`으로 지정한다: `{ kind: temp }`(미리보기용 앱 임시 파일) 또는 `{ kind: userPath, path }`(사용자가 고른 경로로 바로 쓰기). 임시 결과를 나중에 사용자 경로로 복사할 때만 `copy_file`(검증 포함)을 쓴다. |
| `file.delete` | **임의 경로 `rm -rf`** | **제거.** 앱 임시 디렉터리 정리용 `cleanup_temp`와, 미리보기 결과 하나만 지우는 `discard_temp(path)`(앱 임시 폴더 하위만)를 둔다. |
| `app.log` | console | `@tauri-apps/plugin-log` |
| `theme:changed` | nativeTheme | `matchMedia` + 수동 설정 영속화(`plugin-store`) |
| `getFilePath(File)` | `webUtils` | **`getCurrentWebview().onDragDropEvent`**(paths, position). 드롭 경로도 Rust가 `WindowEvent::DragDrop`(또는 `onDragDropEvent`)에서 받은 경로를 허용 경로 목록에 기록한다(D13). |
| (신규) 파일 추가 | 렌더러 3곳에 중복(`use-add-files`, `load-dropped-files`, `use-dropped-files`) | **`open_files(paths) -> 파일별 결과[]`**. 확장자 판별·TIFF 변환·정보 조회를 한 번에 하고, 파일별 성공/오류를 돌려준다(D14). |
| (신규) 비교 | — | **`compare_pdfs(request, channel) -> CompareResult`**, `cancel_job(job_id)`, `export_compare_report(request)`(비교 PDF / 주석 PDF), `preview_compare_report(request, count)` |

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
| D1 | `use-add-files` ≈ `load-dropped-files`, 세그먼트 그룹핑 중복, 캔버스 렌더 중복, `ValueOf`/`isTiffFile` 중복 | P0-6 |
| D2 | 미사용 코드: `@dnd-kit`(P0-5에서 사용 예정), `zod`, `electron-squirrel-startup`, edit delete/reorder, `merge-state.ts`, 스토어 액션 `expandAll`/`collapseAll`/`reorderFiles`(실행 시 페이지 순서 유실)/`reorderPageWithinFile`/`movePage`/`resetZoom`/`reset`, `generatePreview`/`generatePageThumbnail`, `Card`/`Icon`, `useActivePages`, 미사용 AbortController 등. **`selectRange`(B11)와 `restorePage`(B10)는 살려서 쓴다.** | P0-6 / P1-6 |
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
  - 구현체는 `tauri-platform.ts`와 `mock-platform.ts`(테스트, Playwright) 둘이다. Electron용 임시 어댑터는 만들지 않는다.
  - 어댑터에는 단위 테스트를 따로 두지 않는다. 계약 타입(`tauri-specta` 생성물)과 typecheck로 형태를 맞추고, 동작은 `mock-platform` 기반 E2E로 확인한다.
  - 앱 부팅 시 하나를 주입한다(`app/providers`).
- FSD를 정리한다. `shared/hooks`의 업무 훅을 `features/*/model`로, `shared/model/merge-store`는 `entities/merge-plan` + `features/pdf-merge/model`로 나눈다.
- 진행은 둘로 나눈다. FSD 재배치·스타일 이동(Step 2-a)은 Tauri와 무관하므로 Step 10과 병렬로 먼저 하고, 어댑터·계약 연결(Step 2-b)은 P1-3(Step 11) 뒤에 한다.
- **완료 기준:** `window.api` 참조 0, `@tauri-apps/api` import는 `shared/platform/tauri-platform.ts`에만, `shared`가 상위 레이어나 `@/main`을 import하지 않음, 기존 특성 테스트 통과, typecheck 통과.

### P0-3 비파괴 회전 (S, B1)
- 회전은 `PdfPage.rotation`(스토어)으로만 관리하고, `MergeRequest.sources[].pages[].rotation`에 담아 병합 시 적용한다.
- 병합은 Rust(`merge_pdfs`, P1-2~3)가 요청의 페이지별 rotation을 적용한다. 프론트에서 원본을 덮어쓰는 편집·회전 호출(`pdf.edit:apply`, `pdf.page:rotate`에 해당)을 없애고, 회전은 스토어 상태로만 들고 있다가 `MergeRequest`에 담는다.
- **완료 기준:** 어떤 조작을 해도 원본 파일의 mtime과 해시가 변하지 않는다(E2E로 확인).

### P0-4 pdf.js 로더 단일화와 렌더 캐시 (M, P1)
- `shared/lib/pdfjs/`
  - Worker 설정
  - `cMapUrl` + `cMapPacked`, `standardFontDataUrl`: `pdfjs-dist/cmaps`와 `standard_fonts`를 정적 자산으로 복사한다. **한글과 CID 폰트를 제대로 표시하는 데 필수다.**
  - pdf.js 5.x에서 요구하는 wasm 자산 경로가 있으면 함께 설정한다.
- `PdfDocumentCache`: 파일당 `PDFDocumentProxy` 하나를 두고 refcount와 `destroy()`로 관리한다.
- 썸네일과 미리보기는 data URL 대신 **`ImageBitmap` 또는 `blob:` URL + LRU(개수/메모리 상한)** 로 바꾼다. 화면에 보이는 페이지만 렌더한다(virtuoso).
- 캔버스 렌더 코드 3곳을 `renderPageToBitmap({ document, pageIndex, scale })` 하나로 통합한다. 비교 뷰어도 이 함수를 쓴다.
- 파일 추가 시 전체 페이지 썸네일을 즉시 만드는 동작을 없앤다(P3). 문서 카드의 첫 페이지 썸네일도 같은 캐시를 쓴다(따로 렌더하지 않는다).
- **완료 기준:** 같은 파일을 여러 번 읽지 않는다. 파일을 제거하면 메모리가 회수된다.

### P0-5 내부 드래그 정렬을 `@dnd-kit`으로 전환 (M)
- **이유:** Tauri v2에서 OS 파일 드롭 경로를 받으려면 `dragDropEnabled: true`(기본값)여야 한다. 이 경우 **Windows WebView2에서 HTML5 DnD가 동작하지 않는다.** 현재 페이지·파일 재정렬은 HTML5 DnD 기반이므로 pointer 기반 dnd-kit(이미 설치됨)으로 바꾼다.
- 외부 파일 드롭은 `platform.onFileDrop`으로 분리한다. 드롭 위치에 삽입하는 로직(`calculateDropIndex`)은 **좌표 기반 순수 함수**로 만든다.
- `KeyboardSensor`를 함께 등록해 키보드 재정렬을 지원한다(A1): 카드에 포커스 → Space로 집기 → 방향키 이동 → Space로 놓기 / Esc 취소. 이동 결과를 live region으로 알린다.
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
- **완료 기준:** Mac `.app`과 CI의 Windows 빌드에서 pdfium이 로드되고 렌더된다.

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
| `pick_files` | `(options) -> string[]` | Rust가 열기 다이얼로그를 연다. 고른 경로를 허용 경로 목록에 기록한다(D13). |
| `pick_save_path` | `(options) -> string \| null` | Rust가 저장 다이얼로그를 연다. 고른 경로를 허용 경로 목록에 기록한다(D13). |
| `open_files` | `(paths) -> 파일별 결과[]` | 확장자 판별, TIFF 변환, 정보 조회를 한 번에 한다. 파일별 성공/오류를 돌려준다(B16, D14). 허용 경로 목록에 있는 경로만. |
| `read_pdf` | `(path) -> tauri::ipc::Response` | **pdf.js 표시용.** 허용 경로 목록(D13)에 있는 경로만. 확장자 화이트리스트, `canonicalize`, 크기 상한. `Vec<u8>`을 그대로 반환하면 JSON 숫자 배열이 되어 매우 느리다. |
| `get_pdf_info` | `(path) -> PdfInfo` | 허용 경로 목록(D13)에 있는 경로만 |
| `convert_tiff` | `(path) -> { pdf_path, page_count, display_name }` | 허용 경로 목록(D13)에 있는 경로만. `pdf_path`는 캐시의 임시 PDF |
| `merge_pdfs` | `(request, Channel<Progress>) -> MergeResult` | 출력 = `temp` \| `userPath`(사용자 경로는 `pick_save_path`로 받은 것만). 출력 경로가 입력 원본과 같으면(`canonicalize` 비교) 거부. 요청에 프론트가 만든 `job_id` 포함 |
| `copy_file` | `(source, destination)` | 소스는 앱 임시 디렉터리 하위만 허용 |
| `cleanup_temp` | `()` | 시작과 종료 시에도 자동 실행 |
| `discard_temp` | `(path)` | 미리보기 결과 하나만 지운다. 앱 임시 폴더 하위만 허용 |
| `cancel_job` | `(job_id)` | Phase 2부터 사용 |
- 모든 처리 커맨드는 `async` + **pdfium 전용 작업 스레드**로 위임한다. UI 스레드는 막히지 않는다.
- 진행률은 `tauri::ipc::Channel`로 보내고, 취소는 작업별 `Arc<AtomicBool>` 토큰으로 처리한다.
- **병합 진행률(시안 7):** 비교와 같은 `Progress` 모양을 쓴다. 단계 `read_files`(파일, 가중치 20) → `merge_pages`(쪽, 70) → `save`(10). 오버레이에 전체 %와 단계별 %·막대, "취소". 실패하면 같은 자리에 원인·멈춘 단계·오류 코드와 "다시 시도 / 이 파일 빼기 / 닫기"(시안 8).
- 에러는 `{ code, message }` 형태로 직렬화한다. 프론트는 `code`로 P0-6의 `error-messages.ts` 문구를 찾아 토스트나 오버레이로 보여 준다(B12). `message`는 로그용이며 화면에 그대로 내보내지 않는다.
- **병합 취소(C1):** `merge_pdfs`도 작업 ID와 취소 토큰을 갖는다. 진행 오버레이에 "취소" 버튼, 취소되면 임시 파일을 지운다. (`cancel_job`은 Phase 1부터 쓴다.)
- **입력 상한(I1):** `pdf-core`의 상수로 둔다. 시작값: 파일 하나 `MAX_INPUT_FILE_BYTES` = 512MB, 병합 입력 `MAX_MERGE_FILES` = 200개, 비교 문서 `MAX_COMPARE_PAGES` = 2,000쪽(넘으면 `Truncated` 안내). 넘으면 `InputTooLarge` 에러로 거부하고 화면에 이유를 보인다. 측정 후 조정한다.
- 타입은 `tauri-specta`로 TS 바인딩을 생성해 `src/shared/contracts`를 대체한다.
- **Rust가 정본이다:** 회전값·오류 코드는 specta 생성 타입을 쓰고, 허용 확장자·입력 상한은 Rust에서 받아 온다(TS에 숫자·목록을 다시 적지 않는다).
- 사용할 플러그인: `dialog`, `log`, `store`, `opener`, `window-state`. **`fs` 플러그인은 쓰지 않는다**(커스텀 커맨드에서 경로를 검증해 권한 표면을 최소화).
  - 플러그인은 하나씩 `pnpm tauri add <이름>`으로 넣는다. 이 명령이 Cargo 의존성, npm 패키지, `lib.rs`의 `.plugin(...)` 등록, 기본 권한을 함께 처리한다. 이 단계에서는 `dialog`, `log`, `opener`를 넣고, `store`와 `window-state`는 P1-5에서 넣는다.
  - `tauri-specta`는 `cargo add -p <src-tauri 패키지> tauri-specta specta`로 넣는다(버전과 기능 플래그는 tauri-specta README를 따른다).

### P1-4 Tauri 어댑터와 드롭 (M)
- `tauri-platform.ts`에서 `DesktopPlatform`을 구현한다.
- 드롭 처리
  - `onDragDropEvent`의 `position`은 **PhysicalPosition**이므로 `/ window.devicePixelRatio`로 CSS 좌표로 바꾼다.
  - `document.elementFromPoint`로 드롭 대상(슬롯, 그리드 위치)을 판정한다.
  - enter/over/leave로 드롭 오버레이 UI를 갱신한다.
- 어댑터 동작은 `mock-platform` 기반 E2E로 확인한다(어댑터 전용 단위 테스트는 두지 않는다).

### P1-5 보안, 테마, 창 (S, B7/S1)
- CSP를 `tauri.conf.json > app.security.csp`로 옮긴다.
  - animatedicons를 제거한다.
  - `worker-src 'self' blob:`, `img-src 'self' data: blob:`
  - error-snapshot용 Firebase `connect-src`는 유지한다.
- 앱 origin이 바뀌므로(`tauri://localhost`, `http://tauri.localhost`) Firebase API 키에 HTTP 리퍼러 제한이 있으면 허용 목록을 갱신한다.
- capabilities는 `main` 창 하나에만 연결하고, 필요한 권한만 둔다. 권한은 `pnpm tauri permission add <권한 ID>`로 넣고 `pnpm tauri permission ls`로 확인한다. capability 파일을 새로 만들어야 하면 `pnpm tauri capability new`를 쓴다. `tauri add`가 넣은 기본 권한 중 쓰지 않는 것은 `permission rm`으로 뺀다.
- 플러그인 추가: `pnpm tauri add store`, `pnpm tauri add window-state`
- 테마: `matchMedia` 구독 + 수동 설정(`system|light|dark`)을 `plugin-store`로 영속화한다.
- 메뉴: macOS 기본 메뉴(편집 단축키 포함)를 확인한다. 이후 `파일 > 열기 (⌘O)` 등을 추가한다.
- 창 크기와 위치는 `plugin-window-state`로 기억한다.
- **최소 창 크기(W1):** `tauri.conf.json`의 창에 `minWidth: 1120`, `minHeight: 720`. 비교 화면(목록 340px + 페이지 두 장 + 거터 120px)이 깨지지 않는 크기다.
- **에러 스냅샷 점검(S2):**
  - 라이브러리 기본 Firebase 프로젝트가 아니라 **이 앱 전용 설정**을 넘긴다.
  - 보내는 필드를 확인하고, 파일 경로·파일 이름은 보내기 전에 지운다(예: 홈 디렉터리 → `~`, 파일 이름 → 확장자만).
  - 처음 실행할 때 오류 보고를 안내하고, 설정에서 끌 수 있게 한다(`plugin-store`에 저장).

### P1-6 Electron 제거와 문서 갱신 (S)
- 삭제: `forge.config.mts`, `src/main`, `src/preload`, electron 관련 deps, **`pdf-lib`, `sharp`, `fs-extra`**, `icon.*`(→ `src-tauri/icons`)
- 갱신: `README`, `docs/01~05`(IPC 스펙 → Tauri 커맨드 스펙), `.claude/agents/ipc-architect.md` → Tauri 커맨드/capability/pdf-core 기준, `implement`/`check` 스킬의 검증 명령(`cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` 추가)

### P1-7 아이콘, 로컬 빌드 (S)
- 1024px PNG 원본을 만들고(`icon.icns`에서 추출) `pnpm tauri icon`을 실행한다.
- Mac에서 `pnpm tauri build`로 `.app`/`.dmg`를 만든다. Windows는 CI로 확인한다.

### Phase 1 완료 기준 (기능 동등성 체크리스트)
- [ ] 다이얼로그 및 드롭으로 PDF/TIFF 추가, 위치 지정 삽입
- [ ] 썸네일, 펼치기, 파일 간 페이지 재정렬(마우스·키보드), 페이지 삭제와 화면에서 복원(B10)
- [ ] 클릭·⌘·Shift 선택, 단축키(Delete, ⌘A, Esc)
- [ ] 회전(비파괴), 전체/선택 병합(진행률·UI 비차단·취소), 미리보기, 저장, 임시파일 정리
- [ ] 모든 실패가 토스트나 오버레이로 보인다(B12)
- [ ] 테마(시스템 추종 + 수동), 버전 표시, 에러 스냅샷 전송
- [ ] macOS, Windows, Linux에서 실행 (Windows/Linux는 CI 아티팩트로 확인)

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
```rust
// serde + specta 로 TS 타입 자동 생성
pub enum Side { Before, After }
pub struct TextBox { pub page: u32, pub x: f32, pub y: f32, pub w: f32, pub h: f32 } // PDF pt, 좌하단 원점, /Rotate 적용 전
pub enum ChangeKind { Insert, Delete, Replace }
pub enum TextSource { TextLayer, Ocr }  // 페이지 글자를 어디서 얻었나
pub struct ChangeSide {
    pub text: String,
    pub boxes: Vec<TextBox>,
    pub min_confidence: Option<f32>, // OCR 토큰이 섞이면 그중 가장 낮은 신뢰도(0~1). 텍스트 레이어만이면 None
}
pub struct Change {
    pub id: String,                  // 안정 키: hash(정규화 텍스트 + 문맥) — 재실행해도 동일
    pub kind: ChangeKind,
    pub before: Option<ChangeSide>,
    pub after: Option<ChangeSide>,
    pub page_pair: (Option<u32>, Option<u32>),
    pub needs_review: bool,          // OCR 신뢰도 기준 미만 토큰이 걸린 변경 = "확인 필요"(§6.4). 차이 개수와 따로 센다
}
pub struct CompareResult {
    pub changes: Vec<Change>,
    pub page_pairs: Vec<(Option<u32>, Option<u32>)>, // 삽입/삭제 페이지는 None
    pub page_sizes: PageSizes,                       // 좌우 각 페이지의 크기·회전·CropBox 원점
    pub page_sources: PageSources,                   // 좌우 각 페이지의 TextSource
    pub notices: Vec<Notice>,                        // LowTextConfidence, NoTextLayer(OCR도 못 한 쪽), Truncated
}
```
좌표는 PDF 원본 좌표로 저장한다. 화면 변환은 pdf.js `viewport.convertToViewportRectangle`이 담당한다. 회전이나 확대가 바뀌어도 결과를 다시 계산할 필요가 없다. OCR로 얻은 글자 상자도 같은 좌표 규칙으로 바꿔 넣는다(§6.4).

### 6.2 파이프라인
1. **추출 (P2-2, M)**
   - pdfium 페이지 텍스트에서 글자별 `{ char, bounds, font_size, font_name }`을 얻는다. 박스는 tight bounds를 기본으로 한다.
   - **좌표계 일치 검증(중요):** pdfium 좌표와 pdf.js 화면 좌표가 CropBox/MediaBox 원점 오프셋, `/Rotate` 페이지, `UserUnit`에서 일치하는지 pdfium 박스는 Rust golden 테스트로 고정하고, 화면 박스와의 일치는 E2E로 확인한다. 필요하면 `page_sizes`에 원점 오프셋을 포함해 프론트에서 보정한다.
   - 텍스트 레이어가 없거나 글자 수가 `OCR_MIN_TEXT_CHARS` 미만인 페이지(스캔본)는 OCR 경로(P2-4a, §6.4)로 글자를 얻는다. OCR로도 글자를 얻지 못하면(모델 파일 없음, OCR 실패) `NoTextLayer`로 알린다.
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
   - `overall_percent = Σ(stage_percent × 가중치) / 100`. 가중치는 `pdf-core`의 상수이고, 실제 소요 시간을 측정해 조정한다. 추출 캐시가 맞으면 그 단계는 바로 100%로 보고한다. OCR 대상 쪽이 없거나 모든 쪽이 OCR 캐시에 맞으면 `ocr` 단계도 바로 100%로 보고한다.
   - 이벤트는 단계 안에서 최소 1% 단위로만 보낸다(쪽마다 보내면 큰 문서에서 IPC가 넘친다). `%`는 정수로 내림해 100%는 실제로 끝났을 때만 보인다.
   - **추출 결과 캐시:** (파일 경로, 크기, mtime) 또는 해시를 키로 메모리 LRU에 둔다. 옵션만 바꿔 다시 실행할 때 추출을 건너뛴다. OCR 결과는 파일 해시를 키로 앱 캐시 디렉터리에 따로 저장한다(§6.4).
7. **리포트 내보내기 (P2-8, M)**
   - **비교 PDF:** pdfium으로 새 문서를 만들고 A4 가로 한 장에 좌우 페이지를 배치한다. 옵션: 배치(`side_by_side | a_only | b_only`), 차이 있는 쪽만(`changed_pages_only`), 색 상자 넣기(`draw_boxes`). 화면의 필터(숨긴 종류)를 그대로 받는다.
   - **주석 PDF:** B 문서를 복사해 변경 영역마다 Highlight/Square 주석(색, 내용=변경 전후 텍스트)을 단다. 원본은 건드리지 않는다.
   - 둘 다 원자적 쓰기. 미리보기용으로 첫 N장을 렌더해 돌려주는 `preview_compare_report`를 둔다.

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

| 버린 대안 | 이유 |
|---|---|
| macOS Vision + Windows.Media.Ocr (OS 내장) | Windows의 한국어 품질이 낮고 한국어 언어 팩 설치가 필요하다. 플랫폼마다 엔진이 달라 같은 계약서의 결과가 달라진다. |
| Tesseract | 한국어 정확도가 낮다. |
| 클라우드 OCR | 계약서를 외부로 보낼 수 없다. |

**파이프라인**
1. **OCR 대상 판정:** 추출(P2-2)에서 페이지의 텍스트 레이어 글자 수가 `OCR_MIN_TEXT_CHARS` 미만이면 OCR 대상으로 표시한다. 스캐너가 넣은 숨은 글자층(검색 가능한 PDF)은 텍스트 레이어로 취급한다(품질이 낮으면 `LowTextConfidence`).
2. **렌더:** pdfium으로 페이지를 고정 해상도 `OCR_RENDER_DPI`(시작값 300dpi)로 렌더한다. 렌더만 pdfium 작업 스레드에서 하고 추론은 별도 작업 스레드에서 한다. OCR이 pdfium 큐를 오래 잡아 병합을 막지 않게 하기 위해서다. 렌더 이미지는 메모리에만 두고 디스크에 쓰지 않는다.
3. **기울기 보정(필요 시):** 기울기를 추정해 `OCR_DESKEW_MIN_DEGREES` 이상이면 바로 세우고, 보정 변환을 좌표 되돌리기용으로 기록한다. 방법은 스파이크에서 정한다. 보정 없이 합격 기준을 넘으면 넣지 않는다.
4. **검출 → 인식:** 검출 모델로 줄 상자를 찾고, 인식 모델로 줄마다 글자와 신뢰도를 얻는다. 결과는 단어/글자별 `{ text, bounds, confidence }`다. 글자 위치는 인식 결과의 글자별 위치 정보로 줄 상자를 나눠 얻는다. 글자 단위가 안 되면 단어 단위 상자로 낮춘다(그 경우 하이라이트가 단어 단위가 된다). 어느 쪽인지 스파이크에서 확인한다.
5. **좌표 되돌리기:** 렌더 픽셀 좌표를 텍스트 추출과 같은 좌표 규칙(§6.1: PDF pt, 좌하단 원점, `/Rotate` 적용 전)으로 바꾼다. 순서는 기울기 보정의 역변환 → `× 72 / OCR_RENDER_DPI`와 y 뒤집기(픽셀은 좌상단 원점) → 렌더에 적용된 `/Rotate` 되돌리기 → CropBox 원점 오프셋 더하기다.
6. **이후 단계:** OCR 글자를 텍스트 레이어 글자와 같은 형태로 만들어 기존 정규화·토큰화(P2-3), diff(P2-4), 페이지 짝짓기(P2-5)에 그대로 넣는다. 페이지마다 출처(`TextSource`)를 `page_sources`에 기록한다. 한쪽은 텍스트 레이어, 다른 쪽은 스캔이어도 비교된다.

**신뢰도와 "확인 필요"**
- 토큰 신뢰도는 토큰을 이루는 글자 신뢰도의 최솟값이다. 변경의 각 쪽에는 그중 가장 낮은 값을 `min_confidence`로 담는다.
- 기준은 일반 토큰 `OCR_MIN_CONFIDENCE`(시작값 0.80), 숫자·금액·날짜 토큰 `OCR_MIN_CONFIDENCE_NUMERIC`(시작값 0.95)이다. 계약서에서 중요한 숫자는 더 엄격하게 본다. 숫자가 하나라도 든 토큰을 숫자 토큰으로 본다. 두 값은 스파이크에서 측정 후 확정한다.
- 기준 미만 토큰이 걸린 변경은 `needs_review = true`다. 화면은 이를 차이 개수와 따로 "확인 필요"로 보인다. 오인식이 차이처럼 보이지 않게 하기 위해서다.
- OCR 쪽이 섞인 변경 중 띄어쓰기만 다른 치환도 `needs_review`로 둔다. OCR은 띄어쓰기를 자주 틀린다.
- 신뢰도가 높은데 틀린 글자(조용한 오인식)는 이 장치로 걸러지지 않는다. 그래서 스파이크 합격 기준에 숫자 토큰의 조용한 오인식 0건을 둔다.

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

**P2-4a OCR 연결 (M)**
- 추출 단계에 OCR 경로를 잇는다: OCR 대상 판정, 렌더·검출·인식, 좌표 되돌리기, 신뢰도와 `needs_review`, `page_sources`, OCR 캐시.
- 테스트(핵심 동작만, golden 픽스처):
  - 텍스트본 ↔ 스캔본 비교에서 차이가 0이고, 금액·날짜·조항을 바꾼 짝에서는 바꾼 곳만 변경으로 나온다.
  - OCR 상자를 PDF pt로 되돌린 결과가 원본 텍스트 PDF의 상자와 `OCR_BOX_TOLERANCE_PT` 안에서 맞는다(CropBox 오프셋, 회전 페이지 포함).
  - 신뢰도 기준 미만 토큰이 걸린 변경이 `needs_review`로 분류된다.
  - 같은 파일을 다시 비교하면 OCR을 다시 돌리지 않는다(캐시).

---

## 7. Phase 3: 비교 UI (Track A + B 합류)

> 화면 시안: Claude Design 캔버스 "PDF Studio 메인 화면"(https://claude.ai/artifact/DypiUsrVJh56yhBuv4tSvV, 비공개) 의 1~5번 아트보드. 색·글꼴·간격은 [디자인 시스템 토큰](../06-design-system.md)을 따른다.

### P3-1 앱 모드와 홈 (S)
- `app` 레이어에 `mode: 'home' | 'merge' | 'compare'`(store)를 둔다. 라우터는 도입하지 않는다(YAGNI).
- **홈(시안 1):** 파일이 없을 때 보이는 첫 화면. "PDF 병합", "PDF 비교" 카드 두 장. 카드를 누르거나 카드 위에 파일을 놓으면 그 모드로 들어간다(병합은 여러 개, 비교는 2개).
- **모드 전환:** 병합·비교 화면 툴바 맨 왼쪽에 `[병합 | 비교]` 세그먼트 탭. 모드를 바꿔도 각 모드의 작업 상태(병합 파일 목록, 비교 세션)는 유지한다.
- **병합 화면(시안 2)은 지금 화면 구조를 그대로 둔다.** 툴바(전체 선택·전체 삭제 / 파일 추가 / 병합), 문서 카드 그리드, 하단 플로팅 바, 상태바. 추가되는 것은 모드 탭뿐이다.
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
  - **스크롤 컨테이너는 하나다.** `page_pairs`의 한 쌍이 한 행(`A 페이지 | 거터 | B 페이지`)이 되고, virtuoso가 행 단위로 가상화한다. 좌우가 따로 스크롤하지 않으므로 동기 스크롤 코드가 필요 없다. 짝이 없는 페이지는 반대편에 자리표시자를 둔다. A만/B만 보기에서는 거터와 반대편을 숨긴다.
  - 보이는 행만 pdf.js로 렌더(P0-4 캐시 재사용), SVG 오버레이 하이라이트(Rust가 준 PDF 좌표 → viewport 변환).
  - 빈 상태: 차이 없음(초록 체크) / 필터로 모두 숨김("필터 초기화") / 로딩(스켈레톤).
  - 연결선 상세는 아래 §7.1.
- **P3-5 내보내기 (M, 시안 5):** 모달(최대 1040px), `1fr | 360px`.
  - 받을 파일(둘 중 하나 이상): **비교 PDF**(A·B를 A4 가로 한 장에 나란히. 하위 옵션: `A·B 나란히 | A만 | B만`, 차이 있는 쪽만 넣기(쪽수 변화 표시), 색 상자 넣기) / **주석 PDF**(B 위에 차이를 PDF 주석으로).
  - 저장 위치: 경로 표시 + "바꾸기"(저장 다이얼로그), 만들 파일 이름 미리 표시.
  - 오른쪽 미리보기: 첫 장부터 넘겨 보기. 지금 필터를 그대로 따른다.
  - 바닥: 이유 문구 / 취소 / 내보내기(이유가 있으면 비활성). 끝나면 토스트.

### 7.1 연결선 (P3-4의 일부, M)

A의 변경 상자와 B의 대응 상자를 거터를 가로지르는 곡선으로 잇는다. 같은 행 안에서만 그린다.

**무엇을 잇나**
- 양쪽이 모두 있는 변경만 잇는다: `Replace`(Phase 5에서 `Moved` 추가). `Insert`·`Delete`는 잇지 않는다.
- 같은 행 조건: 변경의 `before.page`가 이 행의 A 페이지이고 `after.page`가 이 행의 B 페이지일 것. 대응이 다른 행에 있으면 잇지 않는다.
- 필터로 숨긴 변경은 **입력에서 아예 뺀다.** 남겨 두면 빈 공간을 가로질러 묶음이 생긴다.

**묶기(stem): 가까운 변경 여러 개를 선 하나로**
- 모든 계산은 **PDF pt 단위**로 한다(px로 하면 확대 배율에 따라 결과가 바뀐다).
- 변경마다 쪽별로 상자들의 합집합 하나를 만든다(줄바꿈으로 상자가 여럿일 수 있다).
- 읽는 순서로 정렬한다: 위쪽 모서리 내림차순 → x 오름차순 → 원래 순번. **순번 동률 처리를 빼면 실행할 때마다 묶음 경계가 흔들린다.**
- A 쪽 순서대로 훑으면서, 다음 두 조건을 **모두** 만족할 때만 앞 묶음에 붙인다.
  - 양쪽 모두 앞 변경과의 세로 간격이 `CONNECTOR_GAP_PT`(20pt) 이하(겹치면 음수, 붙인다).
  - B 쪽 읽는 순서에서의 순위가 앞 변경의 순위 + 1.
- 묶음의 끝점 상자 = 묶음 안 변경들의 합집합. 간격 규칙이 없으면 한쪽만 있는 변경을 걸러낸 뒤 페이지 위·아래가 이웃처럼 보여 문서 전체가 몇 개의 거대한 묶음으로 뭉친다.
- 20pt는 시작값이다. 픽스처로 조정하고 상수로 둔다.

**좌표와 모양**
- 끝점 y = 묶음 상자의 세로 중앙. `y_px = (pageHeightPt − (y0 + y1) / 2) × (96 / 72) × zoom` (페이지 좌하단 원점 기준. §6.1 좌표가 회전 적용 전이면 같은 viewport 변환을 먼저 거친다).
- x 변환은 없다. SVG를 거터에 정확히 맞춰 두고(왼쪽 = A 페이지 오른쪽 끝, 너비 = 거터) x는 0과 W.
- 거터 너비는 확대와 무관하게 고정: 세로 페이지 `CONNECTOR_GUTTER_PX`(120px), 한쪽이라도 가로 페이지면 72px. SVG 높이 = 두 페이지 중 큰 쪽.
- 곡선: 3차 베지어 `(0, aY) → (W, bY)`, 제어점 `(0.5W, aY)`, `(0.5W, bY)`(양끝에서 수평으로 나가는 대칭 S). `|aY − bY| ≤ 3px`이면 직선.
- 좌표는 소수 둘째 자리로 반올림한다. 부동소수점 잡음으로 path 문자열이 바뀌어 다시 렌더되는 것을 막는다.

**그리기와 상호작용**
- 행마다 `<svg>` 하나, `pointer-events: none`. 묶음마다 `<g>`에 path 두 개: 마우스를 받는 투명한 14px 선 + 보이는 2px 선(round cap).
- 평상시: 중립 마커색 45% 불투명도. 선택·호버: 그 종류의 `diff-*` 색, 3px. 종류가 섞인 묶음은 중립색 유지.
- 묶음 안 변경 하나라도 선택되면 묶음 전체가 선택 상태. 호버하면 묶음의 모든 변경을 페이지와 목록에서 함께 강조(`data-change-ids`).

**성능**
- 스크롤 중에는 컨테이너에 `data-scrolling` 속성을 달고 CSS로 연결선을 140ms에 걸쳐 숨긴다. 마지막 스크롤 이벤트 후 140ms가 지나면 속성을 지운다. 스크롤 중에는 React가 일하지 않는다.
- 스크롤 처리는 rAF로 프레임당 한 번, 크기 변화는 컨테이너의 ResizeObserver 하나로 본다.
- 묶음 계산은 `(행, 페이지 쌍, zoom, 페이지 높이)`를 키로 메모이즈한다. 페이지 높이 객체도 메모이즈해야 캐시가 맞는다.
- 가상화 창 밖 행에는 연결선을 마운트하지 않는다.

**끄는 조건**
- A만/B만 보기, 사용자 토글 `연결선 표시` 끔(하이라이트와 별개), 행이 가상화 창 밖, 한쪽이 자리표시자, 자격 있는 변경 없음.

**구현 위치(FSD)와 테스트**
- 묶기·끝점·path 계산은 순수 함수로 `entities/comparison/model/connector-stems.ts`, `connectors.ts`에 둔다(새 단위 테스트는 쓰지 않는다). 그리는 컴포넌트는 `widgets/compare-viewer/ui/connector-layer.tsx`.
- 비교 PDF 내보내기(P2-8)에서도 같은 선을 그리므로 Rust에도 같은 묶기 규칙이 필요하다. 묶기 규칙의 정본 검증은 Rust golden JSON 픽스처 테스트로 하고, 화면 쪽은 E2E에서 SVG 연결선 끝점이 같은 golden 기대값과 맞는지 확인해 화면과 내보내기 결과를 맞춘다. 내보내기는 한 장에 묶음이 40개를 넘으면 연결선을 생략한다.
- 끝점은 화면 띠의 보정값(최소 높이 등)이 아니라 pt 중앙을 쓴다. 짧은 변경에서 최대 2px 어긋날 수 있지만 화면과 내보내기가 같아진다.

**알려진 한계**
- 페이지 짝짓기(P2-5)가 틀리면 대응 상자가 다른 행에 놓여 연결선이 거의 안 보인다. 고칠 곳은 묶기 규칙이 아니라 페이지 짝짓기다.

**완료 기준**
- golden 픽스처(여러 줄 변경, 인접 변경 3개, 20pt 경계 양쪽, 순서가 뒤바뀐 변경, 가로 페이지)에서 Rust 묶음 결과가 golden과 같고, 화면의 SVG 연결선 끝점이 같은 golden 기대값과 맞는다(E2E).
- 확대·축소와 창 크기 변경 후에도 끝점이 상자 중앙에 붙어 있다. 스크롤 중 연결선이 사라졌다가 멈추면 다시 나타난다.

### 완료 기준
- 100페이지 문서 쌍을 Mac(M 시리즈)에서 5초 안에 비교한다(텍스트 레이어 문서 기준, 목표치이며 Phase 2 측정 후 확정). 스캔 문서는 쪽당 처리 시간이 P2-2a 합격 기준 안이다.
- 비교 중에도 스크롤과 취소가 가능하다.

---

## 8. Phase 4: 빌드, 배포, 서명

### P4-1 CI
- `tauri-apps/tauri-action` 매트릭스
  - `macos-latest`(aarch64-apple-darwin, 필요하면 `universal-apple-darwin`)
  - `windows-latest`
  - `ubuntu-22.04`(`libwebkit2gtk-4.1-dev` 등)
- 각 잡에서 `scripts/fetch-pdfium.mjs`와 `scripts/fetch-ocr.mjs`(P2-2a 이후)를 실행한다(버전 고정, 캐시).
- `Swatinem/rust-cache`, pnpm 캐시, `NODE_AUTH_TOKEN`(GitHub Packages)을 유지한다.
- PR에서는 `pnpm validate` + `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test`를 실행한다.
- Windows 설치 파일은 **NSIS**(`bundle.targets`에 `nsis`) 하나로 한다. 사용자 단위 설치라 관리자 권한이 필요 없다.

### P4-2 릴리스 흐름 정리 (T1)
- 기존 Electron용 워크플로(`build.yml`, `release.yml`, `auto-version.yml`)는 Step 1에서 모두 제거했다. 여기서 새로 만든다: `pnpm release:*` → 태그 푸시 → `release.yml`이 tauri-action으로 Draft Release를 만들고 아티팩트를 업로드한다.

### P4-3 서명
| 옵션 | 비용 | 사용자 경험 |
|---|---|---|
| macOS ad-hoc (`signingIdentity: "-"`) | 무료 | 다운로드한 앱은 Gatekeeper 경고가 뜬다(우클릭 → 열기 또는 `xattr -dr com.apple.quarantine`). **개인용 1차 권장.** |
| Developer ID + 공증 | Apple Developer 연 $99 | 경고가 없다. tauri-action에 `APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` 시크릿을 넣는다. |
| Windows | 미서명 | SmartScreen 경고가 뜬다. 개인용으로는 허용한다. |
- 어느 옵션이든 **`Frameworks/libpdfium.dylib`와 ONNX Runtime dylib(§6.4)도 앱과 같은 identity로 서명**돼야 한다. `codesign --verify --deep --strict`로 확인한다.

### P4-4 (선택) 자동 업데이트
- `pnpm tauri add updater`로 플러그인을 넣고, 서명 키는 `pnpm tauri signer generate -w ~/.tauri/pdfstudio.key`로 만든다(개인 키는 레포에 넣지 않고 GitHub 시크릿 `TAURI_SIGNING_PRIVATE_KEY`로만 둔다). tauri-action이 GitHub Releases에 `latest.json`을 생성한다.

### P4-5 라이선스와 고지 (S, L1)
- 루트에 `LICENSE`(MIT) 파일을 둔다.
- `THIRD_PARTY_NOTICES.md`를 만들어 앱과 함께 번들한다: pdfium(BSD-3/Apache-2.0), pdf.js(Apache-2.0), IBM Plex(OFL), ONNX Runtime(MIT), PaddleOCR 모델(Apache-2.0), Rust·npm 의존성. `cargo-about`과 `license-checker`류로 생성하고 CI에서 §1.2 허용 목록 밖 라이선스가 들어오면 실패시킨다.
- 앱 정보 화면(또는 메뉴 "PDF Studio 정보")에서 고지를 열 수 있게 한다.

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
| D10 | 병합 화면은 지금 구조 유지, 모드 탭만 추가 | 병합 화면 재설계 | 익숙한 화면 유지, 변경 범위 최소화 |
| D11 | 설치·생성은 Tauri CLI 키트와 `pnpm add`/`cargo add`로 (§1.3) | 설정 파일·등록 코드를 직접 작성 | 공식 생성물이 버전에 맞는 형식을 보장하고, 손으로 쓸 때 생기는 누락(권한, 플러그인 등록, 버전 불일치)을 막는다. |
| D12 | Tauri 셸을 먼저(실행 순서 1 → 9 → 8 → 10 → 11 → 2 → 14 → 3 → 4 → 5 → 6 → 13 → 7 → 15) | Electron 위에서 Phase 0 정리 + 임시 `electron-platform.ts` | 버려질 임시 어댑터·계약 코드를 만들지 않는다. 대가로 Step 9~2 사이에는 파일 처리 기능이 동작하지 않는다. |
| D13 | 허용 경로 목록: 파일 열기·저장 다이얼로그를 Rust 커맨드로 열고, 다이얼로그·드롭으로 받은 경로를 `State`에 기록해 파일 커맨드는 목록에 있는 경로(와 앱 임시 폴더)만 허용 | 프론트가 `plugin-dialog`를 직접 열고 경로를 넘김 | Rust가 "사용자가 고른 경로"를 알 수단이 없으면 경로 검증이 형식만 남는다 |
| D14 | 파일 추가 처리 = Rust `open_files` | TS `ingestPaths` 통합 | 같은 분기가 3벌 중복(B2의 원인)이고, 확장자 화이트리스트는 어차피 Rust가 검사한다 |
| D15 | 스캔 계약서 OCR = PaddleOCR(PP-OCR) 한국어 모델 ONNX 변환본 + ONNX Runtime(`ort`) (§6.4) | macOS Vision + Windows.Media.Ocr, Tesseract, 클라우드 OCR | Mac·Windows가 같은 결과, 한국어 정확도, 라이선스 화이트리스트 안, 계약서가 기기 밖으로 나가지 않음 |

## 12. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| pdfium 번들·서명 실패(특히 Mac) | 전체 일정 지연 | **P1-0을 게이트로** 두고 가장 먼저 검증 |
| pdfium과 pdf.js 좌표 불일치(CropBox, 회전) | 하이라이트 위치 어긋남 | §6.3 Rust golden 테스트 + E2E 박스 위치 확인, `page_sizes`에 원점 오프셋 포함 |
| `tiff` 크레이트의 압축 방식 미지원(CCITT G4 등) | 일부 TIFF 변환 실패 | 원본 스트림 그대로 넣는 경로, 미지원 시 명확한 에러 |
| pdfium 직렬화로 인한 처리 대기 | 병합과 비교를 동시에 하면 대기 | 작업 큐 + 진행률 표시. 측정 후 필요하면 Phase 5 병렬화 |
| ToUnicode가 깨진 PDF | 비교 품질 저하 | `LowTextConfidence` 안내. 그래픽 diff는 Phase 5 |
| 스캔 PDF의 OCR 오인식(특히 숫자·금액·날짜) | 오인식이 차이로 보이거나, 실제 차이를 놓침 | 신뢰도 기준 미만은 "확인 필요"로 분리(숫자는 더 엄격), P2-2a 게이트에서 CER·숫자 일치율·조용한 오인식 0건 확인 (§6.4) |
| OCR 띄어쓰기 오류 | 단어 토큰이 갈라져 거짓 차이 | OCR 쪽이 섞인 띄어쓰기만 다른 치환은 "확인 필요"로 분리 |
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
