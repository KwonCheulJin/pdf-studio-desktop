# 단계별 진행 가이드 (집 Mac 기준)

- 작성일: 2026-10-12
- 대상 문서
  - 계획: [Tauri 마이그레이션 + PDF 비교 계획](2026-10-tauri-migration-and-pdf-compare.md) (아래에서 "계획서")
  - 디자인: [디자인 시스템 토큰 v2](../06-design-system.md) (아래에서 "토큰 문서")
- 이 가이드는 두 문서를 **실제로 손대는 순서**로 엮은 것이다. 무엇을 왜 하는지는 각 문서에 있고, 여기에는 순서, 완료 기준, 커밋 단위만 둔다.
- **진행 표시는 이 문서의 체크박스로 한다.** 단계를 끝내면 체크하고 같은 PR에 포함한다.

---

## 0. 시작 전 (한 번만)

### 0-1. 이 브랜치를 main에 합친다
- `docs/tauri-migration-plan` 브랜치의 PR을 만들어 main에 병합한다. 이후 모든 단계는 **main에서 새 브랜치를 따서** 진행한다.

### 0-2. Mac 셋업
계획서 §10.1을 따른다. 요약:
```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
corepack enable
echo "//npm.pkg.github.com/:_authToken=<TOKEN>" >> ~/.npmrc   # read:packages 권한
git clone https://github.com/KwonCheulJin/pdf-studio-desktop && cd pdf-studio-desktop
git config user.email "chkftm12@gmail.com"                     # 개인 메일로 커밋
pnpm i && pnpm start                                           # 현재 Electron 앱이 뜨는지 확인
```
- [ ] 앱이 Mac에서 뜬다

### 0-3. 진행 순서
- **Step 1~15(마이그레이션)는 순서대로 하나씩 진행한다.** 병렬 작업은 Step 15 이후 Phase 2(Step 16~23)와 Phase 4 일부(Step 30~32, 34)에서만 한다. Phase 6(Step 35~48)의 병렬 범위는 그 절 머리에 적었다.
- **실행 순서는 Step 번호와 다르다(Tauri 셸 먼저):** 1 → 9 → 8 → 10 → 11 → 2 → 14 → 3 → 4 → 5 → 6 → 13 → 7 → 15 (Step 12는 Step 2에 흡수)
  - Step 2는 2-a(FSD 재배치·스타일)와 2-b(플랫폼 어댑터)로 나눈다. **2-a는 Step 10과 병렬로 먼저 진행**하고, 위 순서의 2는 2-b를 뜻한다.
  - 번호는 계획서·CLAUDE.md가 참조하므로 그대로 두고 순서만 바꿨다. 각 Step 제목 아래 "실행 순서" 줄에 앞뒤 Step을 적었다.
  - 이유: Electron 위에서 Step 2~7을 하면 Electron IPC를 감싼 임시 어댑터와 손으로 쓴 계약 타입을 만들어야 하고, 곧 버려진다. 이를 만들지 않으려고 Tauri 셸을 먼저 세운다.
  - 대가: Step 9부터 Step 2 전까지는 앱의 파일 처리 기능이 동작하지 않는다.

### 0-4. 단계마다 반복하는 흐름

> **키트 우선(계획서 §1.3, D11):** Tauri 설정·플러그인·권한·아이콘·서명 키는 Tauri CLI로, 의존성은 `pnpm add`/`cargo add`로 만든다. 각 Step의 "할 일(키트)"에 적힌 명령을 먼저 실행하고, 생성물은 최소한으로만 고친다.

1. `git switch main && git pull` → `git switch -c <브랜치 이름>`
2. Claude Code 세션을 열고 아래 **세션 프롬프트**를 붙여 넣는다.
3. 계획을 확인한 뒤 실행 → 완료 기준을 직접 확인 → 커밋 → PR → 병합
4. 이 가이드의 체크박스를 체크한다.

세션 프롬프트(단계 번호만 바꿔 쓴다):
> `docs/plans/2026-10-step-guide.md`의 **Step N**을 진행해줘. 거기 적힌 문서 섹션을 읽고, 시작 전에 작업 계획을 먼저 보여 주고 확인을 받아. 완료 기준을 직접 검증한 뒤 보고해.

---

## Phase 0: 앱 구조 정리 (Tauri 위에서)

> Step 1만 Windows 회사 PC에서도 할 수 있다. Step 2~7은 Step 11 이후 Tauri 위에서 진행하므로 Mac에서 한다(Step 1 다음은 Step 9, 8, 10, 11이고 Step 2는 그 뒤다).

### Step 1. 개발 환경 정합 (S)
- 실행 순서: 1번째 (뒤: Step 9)
- 브랜치: `chore/dev-env`
- 읽을 곳: 계획서 §4 P0-1
- 할 일: Node 버전 하나로 통일, `engines`·`packageManager`, `.gitattributes`(eol=lf), `forceConsistentCasingInFileNames`, `.claude` 훅 절대경로 제거, GitHub Actions 워크플로 제거(Phase 4에서 Tauri 기준으로 새로 만든다)
- 완료 기준: Mac과 Windows에서 클론 직후 `pnpm i && pnpm validate` 통과, 줄바꿈 차이로 수정 표시되는 파일 0개
- [x] Step 1

### Step 2. 플랫폼 어댑터, 계약 분리, FSD 정리, 스타일 폴더 이동 (M)
- 두 부분으로 나눠 진행한다. 2-a(FSD 재배치·스타일 이동)는 Tauri와 무관하므로 먼저 하고, 2-b(플랫폼 어댑터·계약 연결)는 Step 11의 커맨드와 tauri-specta 생성물이 있어야 하므로 그 뒤에 한다.
- 읽을 곳: 계획서 §4 P0-2, 토큰 문서 §3과 §4의 1단계

#### Step 2-a. FSD 재배치, 스타일 폴더 이동 (M)
- 실행 순서: Step 10과 병렬로 먼저 진행
- 브랜치: `refactor/fsd-structure`
- 할 일
  0. ~~먼저 특성 테스트~~(계획서 T2): `merge-store`·`selection-store`의 지금 동작을 테스트로 고정한다. **완료(PR #8).**
  1. `shared/hooks`의 업무 훅 → `features/*/model`, `merge-store` → `entities/merge-plan`(상태·전이·선택자) + `features/pdf-merge/model`(사용자 행동 훅). 슬라이스마다 `index.ts` 공개 API
  2. `src/renderer/styles/` → `src/renderer/app/styles/`로 옮기고 `tokens.css`, `theme.css`, `base.css`로 나눈다. **값은 그대로 둔다.**
  3. `components.json` 경로 수정(`app/styles/index.css`, `components` 별칭)
- `shared/lib/ipc-client.ts`와 `window.api` 호출은 위치·동작을 그대로 둔다(2-b에서 바꾼다).
- 완료 기준: `shared`가 상위 레이어를 import하지 않음(`@/main`은 2-b 전까지 `ipc-client.ts`만 예외), 같은 레이어 슬라이스끼리 import하지 않음, 기존 특성 테스트가 기대값 변경 없이 통과, 스타일 이동 전후 `vite build`의 CSS 결과가 같음
- [x] Step 2-a

#### Step 2-b. 플랫폼 어댑터, 계약 연결 (M)
- 실행 순서: 6번째 (앞: Step 11, 뒤: Step 14)
- 브랜치: `refactor/platform-adapter`
- 할 일
  1. 손으로 쓴 `src/shared/contracts`를 만들지 않는다. Step 11에서 만든 tauri-specta 생성물을 계약 타입으로 쓴다. renderer의 `@/main/*` import 제거
  2. `shared/platform/`에 `DesktopPlatform` 인터페이스와 `tauri-platform.ts`, `mock-platform.ts`. **Electron용 임시 어댑터는 만들지 않는다.** 어댑터에는 단위 테스트를 따로 두지 않는다. 계약 타입과 typecheck로 형태를 맞추고 동작은 E2E(mock-platform)로 확인한다(구 Step 12)
  3. `ipc-client.ts`·`window.api` 호출을 `DesktopPlatform`으로 바꾼다
- 커밋을 나눈다: 어댑터(+계약 연결) / 호출부 교체
- 완료 기준: `window.api` 참조 0, `@tauri-apps/api` import는 `shared/platform/tauri-platform.ts`에만, `shared`가 `@/main`을 import하지 않음, typecheck와 기존 특성 테스트 통과
- [x] Step 2-b

### Step 3. 비파괴 회전 (S)
- 실행 순서: 8번째 (앞: Step 14, 뒤: Step 4)
- 브랜치: `fix/non-destructive-rotation`
- 읽을 곳: 계획서 §4 P0-3 (버그 B1)
- 할 일: 병합은 Rust(`merge_pdfs`, Step 10·11)가 요청의 페이지별 rotation을 적용한다. 프론트에서 원본을 덮어쓰는 편집·회전 호출(`pdf.edit:apply`, `pdf.page:rotate`에 해당하는 호출)을 없애고, 회전은 스토어 상태로만 들고 있다가 `MergeRequest`에 담는다.
- 완료 기준: 원본 바이트·mtime 불변은 Rust 테스트(`crates/pdf-core/tests/merge.rs`, `src-tauri` 병합·복사 테스트)로, 회전·삭제·병합·저장 후에도 프론트가 원본 경로에 쓰기를 요청하지 않음과 회전이 화면에 보인 최종 절대값으로 병합 요청에 담김은 E2E(`pnpm test:e2e`, mock 플랫폼 호출 기록)로 통과
- [x] Step 3

### Step 4. pdf.js 로더 단일화와 렌더 캐시 (M)
- 실행 순서: 9번째 (앞: Step 3, 뒤: Step 5)
- 브랜치: `perf/pdfjs-cache`
- 읽을 곳: 계획서 §4 P0-4 (P1)
- 주의: cMap과 standard fonts 자산 복사를 빼먹으면 한글 PDF가 깨진다.
- 완료 기준: 같은 파일을 두 번 읽지 않음, 파일 제거 시 메모리 회수, 한글 PDF 썸네일 정상
- [x] Step 4

### Step 5. 내부 드래그 정렬을 @dnd-kit으로 (M)
- 실행 순서: 10번째 (앞: Step 4, 뒤: Step 6)
- 브랜치: `refactor/dnd-kit`
- 읽을 곳: 계획서 §4 P0-5, §5 P1-4
- 할 일: 내부 정렬은 dnd-kit, 외부 파일 드롭은 `platform.onFileDrop`(Tauri `onDragDropEvent`)으로 구현한다. `position`은 타입이 PhysicalPosition이지만 단위가 웹뷰마다 다르다(wry 0.57): WebView2(Windows)는 물리 픽셀이라 `/ window.devicePixelRatio`로 CSS 좌표로 바꾸고, WKWebView(macOS)·WebKitGTK는 이미 CSS 좌표라 그대로 쓴다. `document.elementFromPoint`로 드롭 대상을 판정한다. 드롭 경로는 Rust가 웹뷰보다 먼저 받아 허용 경로 목록에 기록한다(D13).
- 완료 기준: HTML5 DnD 이벤트(`onDragStart` 등) 의존 0, 파일·페이지 재정렬과 외부 파일 드롭이 동작(드롭 위치에 정확히 삽입, 물리 픽셀 좌표의 `devicePixelRatio` 보정은 mock 드롭 E2E(dpr 2)로 확인, 실제 OS 드롭과 Windows 고DPI는 CI로 확인할 수 없어 수동 확인으로 남는다), **키보드만으로 재정렬 가능**(Space 집기 → 방향키 → Space 놓기, Esc 취소), `.claude/quality-gate.json` test 명령의 `layout-calculator.test.ts` 제외 해제
- [x] Step 5

### Step 6. 버그 수정과 정리 (M)
- 실행 순서: 11번째 (앞: Step 5, 뒤: Step 13)
- 브랜치: `fix/p0-cleanup`
- 읽을 곳: 계획서 §2.2 버그 표, §4 P0-6 (B2, B5, B8~B12, A1, D1, D2)
- 커밋 단위: 버그마다 하나. B10(페이지 복원)은 스토어 변경 + 화면 연결이라 따로 리뷰한다. B10 커밋에 `build-merge-request`의 `mergeOrder` 분기에서 `isDeleted` 페이지 제외를 함께 넣는다(B14).
- 파일 추가 경로 처리는 Rust `open_files`(Step 11)가 맡는다(D14). 프론트에는 삽입 위치와 업로드 표시만 남기고, `ingestPaths`로 TS에서 다시 통합하지 않는다.
- 화면 시안: 6 "병합: 페이지 삭제·복원", 8 "병합: 실패"(오류 오버레이와 토스트)
- 완료 기준
  - 빈 화면 TIFF 드롭 후 병합 성공, Windows 경로 입력에서 기본 저장 경로가 맞게 계산되는 E2E 시나리오 통과
  - 페이지 삭제 → 흐린 카드의 "복원" → 병합 결과가 삭제 전과 같음(기존 특성 테스트 유지 + E2E 시나리오), 상태바·카드 쪽수는 삭제 안 된 페이지만 셈
  - 클릭·⌘·Shift 선택, 삭제 후 선택 목록 정리, 단축키(Delete, ⌘A, Esc)
  - 일부러 실패시킨 파일 읽기·병합·다운로드가 모두 화면에 보임
  - 미사용 코드 제거 후 `pnpm validate` 통과(`selectRange`, `restorePage`는 남김)
- [x] Step 6

### Step 7. 디자인 토큰 v2 적용 (M)
- 실행 순서: 13번째 (앞: Step 13, 뒤: Step 15)
- 브랜치: `feat/design-tokens-v2`
- 읽을 곳: 토큰 문서 §2, §3, §4의 2~4단계. 정본 값은 Claude Design 디자인 시스템 "PDF Studio"의 `tokens.json`
- 왜 이 위치인가: Step 4~5가 썸네일·카드 컴포넌트를 크게 고친다. 그 뒤에 하드코딩 색을 걷어내야 같은 파일을 두 번 고치지 않는다.
- 할 일(커밋 셋)
  1. 글꼴: `@fontsource/ibm-plex-sans-kr`(400/500/600), `@fontsource/ibm-plex-mono`(400/500) 추가, `fonts.css` 연결, `body`의 system-ui 덮어쓰기 제거
  2. 값 교체: `tokens.css`/`theme.css`를 v2 값으로, 쓰지 않는 변수(chart, sidebar, popover, serif, shadow 중간값) 삭제, `--spacing: 0.25rem`, 모서리 고정값
  3. 하드코딩 제거: 팔레트 클래스 약 42곳 → 토큰 클래스, `group-colors.ts` → `shared/config/theme.ts`의 `border-group-1~5`
- ⚠️ `--spacing`이 4.32px에서 4px로 바뀌어 **모든 간격이 약 7.4% 줄어든다.** 커밋 2 직후 빈 화면, 썸네일 그리드, 병합 미리보기, 다이얼로그를 라이트·다크로 확인한다.
- 완료 기준
  - `src/renderer`에서 `bg-black/`, `text-white`, `-500` 같은 팔레트 클래스 검색 결과 0
  - 개발자 도구에서 본문 글꼴이 IBM Plex Sans KR로 잡힘
  - 라이트·다크 모두 본문 대비 4.5:1, 포커스 링이 보임
- [x] Step 7

---

## Phase 1: Tauri 전환 (Track A) — 여기서부터 Mac

### Step 8. ★ pdfium 스파이크 (M) — 게이트
- 실행 순서: 3번째 (앞: Step 9, 뒤: Step 10)
- 브랜치: `spike/pdfium`
- 읽을 곳: 계획서 §5 P1-0, §12 리스크 첫 줄
- 할 일(키트): 버리는 빈 앱(`pnpm create tauri-app`)은 만들지 않는다. Step 9에서 만든 실제 `src-tauri`와 `crates/pdf-core` 안에서 스파이크하고, pdfium은 `cargo add -p pdf-core pdfium-render --features thread_safe`로 넣는다. 직접 작성하는 것은 `scripts/fetch-pdfium.mjs`와 렌더 확인 코드뿐이다.
- **이 단계가 실패하면 Step 10 이후를 진행하지 않는다.** 실패하면 원인을 기록하고 계획서 §6.0의 엔진 선택을 다시 검토한다.
- 완료 기준: ad-hoc 서명된 `.app`에서 PDF 1장 렌더, `codesign --verify --deep --strict` 통과, CI Windows 빌드에서 pdfium 로드 (Windows·Linux의 pdfium 로드·`cargo test`는 Step 30 CI에서 확인됨, 설치한 앱 실행은 미확인)
- [x] Step 8

### Step 9. Tauri 스캐폴드 + Cargo workspace (S)
- 실행 순서: 2번째 (앞: Step 1, 뒤: Step 8)
- 브랜치: `feat/tauri-scaffold`
- 읽을 곳: 계획서 §5 P1-1, §11 D5
- 시작 전 결정: **번들 ID `io.github.kwoncheuljin.pdfstudio` 확정**(나중에 바꾸면 데이터 경로가 바뀐다)
- Electron Forge 설정(`forge.config.mts`, `vite.main.config.mts`, `vite.preload.config.mts`, `vite.renderer.config.mts`)은 Step 14까지 그대로 두고, Tauri용 `vite.config.ts`를 새로 만든다.
- 할 일(키트): `pnpm add -D @tauri-apps/cli` → `pnpm add @tauri-apps/api` → `pnpm tauri init` → `cargo new --lib crates/pdf-core`. 루트 `Cargo.toml`의 `[workspace]`만 직접 쓴다.
- 완료 기준: `pnpm tauri dev`로 빈 셸에 기존 renderer가 뜸, 버전이 `package.json` 하나에서 나옴. 파일 처리 기능은 Step 11·2 전까지 동작하지 않아도 된다
- [x] Step 9

### Step 10. pdf-core 기본 처리 (L)
- 실행 순서: 4번째 (앞: Step 8, 뒤: Step 11)
- 브랜치: `feat/pdf-core-basic`
- 읽을 곳: 계획서 §5 P1-2
- 순서: `document.rs` → `info.rs` → `merge.rs` → `tiff.rs`. 모듈마다 테스트 먼저 이식하고 구현한다.
- 완료 기준: `cargo test -p pdf-core` 통과(회전, 멀티페이지 TIFF, CCITT G4, 북마크 원본 병합 케이스 포함). 회전 절대값 설정·정규화(-90, 450 → 0/90/180/270), 병합 요청 검증(빈 소스, 페이지 인덱스 범위), TIFF `display_name` 테스트 포함
- [x] Step 10

### Step 11. Tauri 커맨드와 작업 큐 (M)
- 실행 순서: 5번째 (앞: Step 10, 뒤: Step 2-b)
- 브랜치: `feat/tauri-commands`
- 읽을 곳: 계획서 §5 P1-3
- 화면 시안: 7 "병합: 진행·취소", 8 "병합: 실패"
- 할 일(키트): `pnpm tauri add dialog`, `pnpm tauri add log`, `pnpm tauri add opener`. `tauri-specta`는 `cargo add`로 넣는다.
- 할 일(직접 작성): `pick_files`·`pick_save_path`(Rust가 다이얼로그를 열고 결과 경로를 허용 경로 목록에 기록, D13), `open_files`(D14), `discard_temp`, `merge_pdfs`의 출력 `temp | userPath`와 `job_id`
- 완료 기준: 큰 PDF 병합 중에도 UI가 멈추지 않음, 전체 %와 작업별 %(파일 읽기·페이지 합치기·저장) 표시, **병합 취소 후 임시 파일 없음**, 상한(512MB·200개)을 넘는 입력은 이유와 함께 거부, 앱 임시 폴더 밖 경로는 커맨드가 거부, 허용 경로 목록에 없는 경로는 거부, 출력 경로가 입력 원본과 같으면 거부, `open_files`가 파일별 성공/오류를 돌려줌, `discard_temp`는 앱 임시 폴더 밖 경로를 거부
- [x] Step 11

### Step 12. Tauri 어댑터와 드롭 (M)
- 실행 순서: 없음 (Step 2에 흡수)
- 이 Step은 Step 2-b에 흡수됨. 어댑터(`tauri-platform.ts`)는 Step 2-b에서 한다(어댑터 전용 단위 테스트는 두지 않는다). 외부 파일 드롭(`onDragDropEvent`, `devicePixelRatio` 보정, `elementFromPoint` 판정)은 Step 5에서 한다.
- 체크박스는 Step 2-b와 함께 체크한다.
- [x] Step 12

### Step 13. 보안, 테마, 창 (S)
- 실행 순서: 12번째 (앞: Step 6, 뒤: Step 7)
- 브랜치: `feat/tauri-security-theme`
- 읽을 곳: 계획서 §5 P1-5, 토큰 문서 §3(`app/providers/theme-provider.tsx`)
- 할 일(키트): `pnpm tauri add store`, `pnpm tauri add window-state`. 권한은 `pnpm tauri permission add`/`permission rm`으로 조정하고 `pnpm tauri permission ls`로 확인한다. capability JSON은 손으로 쓰지 않는다.
- 완료 기준: animatedicons 제거, 테마 `system|light|dark` 선택이 재시작 후에도 유지, 창 크기·위치 기억, 최소 창 크기 1120×720, 에러 스냅샷이 앱 전용 설정으로 가고 경로·파일 이름이 지워져 전송되며 설정에서 끌 수 있음
- [x] Step 13

### Step 14. Electron 제거와 문서 갱신 (S)
- 실행 순서: 7번째 (앞: Step 2-b, 뒤: Step 3)
- 브랜치: `chore/remove-electron`
- 읽을 곳: 계획서 §5 P1-6
- 순서: Step 2-b 직후에 한다. Step 2-b 이후 Electron은 동작하지 않으므로 바로 제거한다.
- 함께 할 일: `docs/01-folder-structure.md`를 토큰 문서 §3의 FSD 배치에 맞춰 갱신
- 완료 기준: `electron`, `pdf-lib`, `sharp`, `fs-extra`가 의존성에 없음, 계획서 §5의 "Phase 1 완료 기준" 체크리스트 전부 통과
- [x] Step 14

### Step 15. 아이콘과 로컬 빌드 (S)
- 실행 순서: 14번째 (앞: Step 7)
- 브랜치: `chore/tauri-icons-build`
- 읽을 곳: 계획서 §5 P1-7
- 할 일(키트): 1024px PNG 원본으로 `pnpm tauri icon` → `pnpm tauri build`
  - PNG 원본은 루트 `icon.icns`에서 추출해 루트 `app-icon.png`(1024px)로 두고, `pnpm tauri icon app-icon.png` 뒤 루트 `icon.icns`를 지웠다.
- 완료 기준: Mac에서 `.dmg` 생성 후 설치·실행
- [x] Step 15

---

## Phase 2: Rust 비교 엔진 (Track B)

> Step 15(마이그레이션 완료) 이후 시작한다. Tauri 없이 `cargo test`로만 개발하며, Phase 4의 Step 30~32, 34와 나란히 진행할 수 있다(git worktree와 세션을 따로 둔다).
>
> 이번 버전의 비교 범위는 **① 텍스트 비교 ② 스캔 계약서 OCR 비교**다(계획서 §6.4). 스타일·레이아웃·이미지 비교는 Phase 5다. Step 17-a(OCR 스파이크)는 Rust만 다루므로 Step 15 이후 Phase 2의 다른 Step과 병렬로 진행할 수 있다. **Step 17-a는 게이트다:** 실패하면 Step 19-a를 진행하지 않고 멈추고 보고한다(Step 8과 같다).

| Step | 계획서 | 브랜치 | 완료 기준 | |
|---|---|---|---|---|
| 16 | P2-1 결과 모델 ADR | `docs/adr-compare-result` | `CompareResult` 타입과 좌표 규칙이 ADR로 고정. 페이지별 텍스트 출처(`page_sources`: 텍스트 레이어/OCR), OCR 신뢰도(`min_confidence`), "확인 필요"(`needs_review`) 필드 포함 → [ADR 0001](../adr/0001-compare-result-model.md) | [x] |
| 17 | P2-2 추출 + 좌표 일치 | `feat/compare-extract` | pdfium 박스 Rust golden 테스트 통과 + pdf.js 화면 박스 위치 E2E 통과(CropBox 오프셋, 회전 페이지 포함) | [x] |
| 17-a | ★ P2-2a OCR 스파이크 (게이트) | `spike/ocr` | 계획서 §6.4 합격 기준 표 전부 통과(한국어 CER, 숫자·금액·날짜 토큰 일치율, 숫자 조용한 오인식 0건, 쪽당 처리 시간, 번들 증가량), ad-hoc 서명 `.app`에서 ONNX Runtime 로드·추론, 확정한 모델 이름·버전·ONNX 출처·SHA-256과 측정값을 §6.4에 기록. Mac·Windows 결과 일치는 확인됨(CI, 픽스처 golden — Step 26 PR CI에서 Windows·Linux compare_ocr 통과) | [x] |
| 18 | P2-3 정규화·토큰화 | `feat/compare-tokenize` | 한글 픽스처 토큰화 golden 통과 | [x] |
| 19 | P2-4 정렬과 diff | `feat/compare-diff` | 삽입·삭제·치환·문단 이동 golden 통과 | [x] |
| 19-a | P2-4a OCR 연결 | `feat/compare-ocr` | Step 17-a 통과 후 시작. 텍스트본 ↔ 스캔본 차이 0, 금액·날짜·조항을 바꾼 짝에서 바꾼 곳만 변경 golden 통과, OCR 상자 → PDF pt 되돌리기가 원본 상자와 허용 오차 안(CropBox 오프셋, 회전 페이지 포함), 신뢰도 기준 미만 토큰이 걸린 변경과 OCR 쪽 띄어쓰기만·문장부호만 다른 치환이 `needs_review`로 분류, OCR 쪽이 있으면 NFKC 강제(ADR 0001 §5), 같은 파일 재비교에서 OCR 생략(캐시) → [ADR 0001 §11](../adr/0001-compare-result-model.md) | [x] |
| 20 | P2-5 페이지 짝짓기 | `feat/compare-page-pairs` | 페이지 삽입·삭제 픽스처에서 짝이 맞음 | [x] |
| 21 | P2-6 옵션 | `feat/compare-options` | A·B 따로 페이지 범위(초과 시 `InvalidRange`), 머리말·꼬리말·쪽번호 따로 제외, 대소문자 무시 테스트 통과 | [x] |
| 22 | P2-7 작업 실행기 | `feat/compare-runner` | 6단계 `Progress` 이벤트(단계별 %·전체 %, 1% 단위, 100%는 끝났을 때만), 취소(추출·OCR은 쪽마다 확인), 옵션만 바꾼 재실행에서 추출·OCR 생략(그 단계 즉시 100%), OCR 대상 쪽이 없으면 `ocr` 단계 즉시 100% | [x] |
| 23 | P2-8 리포트 내보내기 | `feat/compare-report` | 비교 PDF(배치 3종, 차이 쪽만, 색 상자)와 주석 PDF 생성, 미리보기 렌더 | [x] |

- 읽을 곳: 계획서 §6 전체. Step 17의 좌표 일치는 이후 모든 하이라이트의 기반이므로 건너뛰지 않는다. Step 17-a·19-a는 §6.4.

---

## Phase 3: 비교 UI (A + B 합류)

> Step 15와 Step 23이 모두 끝난 뒤 시작한다.

| Step | 계획서 | 시안 | 완료 기준 | |
|---|---|---|---|---|
| 24 | P3-1 앱 모드와 홈 | 1, 2 | 홈 카드 2장에서 모드 진입(누르기·드롭), 툴바 `[병합 \| 비교]` 탭 전환 시 각 모드 상태 유지, 병합 화면은 탭 외 변화 없음 | [x] |
| 24-a | P3-1 병합 화면 스타일(D10) | 2, 6, 7, 8 | 브랜치 `feat/merge-design-align`. 토큰 문서 §6.2의 병합 화면 차이 항목을 스타일·배치·문구 기준으로 시안에 맞추고 항목마다 반영/유지(이유)를 적음, 기존 기능(파일 추가·드롭·재정렬·키보드 재정렬·선택·전체 선택·삭제·복원·회전·펼치기·미리보기·확대·테마·병합·선택 병합·진행·취소·실패·다시 시도·결과 미리보기·저장·오픈소스 라이선스)이 그대로 동작(기존 E2E 통과, 문구가 바뀐 곳만 셀렉터 갱신), 헤드리스 캡처를 시안 PNG와 대조 | [x] |
| 25 | P3-2 파일 슬롯 | 3 위 | A/B 빈·채운 상태, 드롭·다이얼로그, A↔B 맞바꾸기 | [x] |
| 26 | P3-3 실행 전 옵션 + P3-3a 진행 화면 | 3 아래, 9 | A·B 페이지 범위 검증 문구, 반복 줄 3종, 대소문자, 실행 불가 이유와 버튼 비활성 / 실행 후 **전체 %와 작업별 %(6단계, 스캔 쪽 글자 읽기 포함)**, 상태 점, 취소, 다른 모드에서도 상태바에 % → 비교 커맨드·OCR 번들은 [ADR 0001 §16](../adr/0001-compare-result-model.md), 시안 대조는 토큰 문서 §6.4 | [x] |
| 27 | P3-4 결과 미리보기 | 4 | 차이 목록(쪽별 묶기, 펼침), 종류 칩 필터, 이전/다음·키보드, 나란히/A만/B만, 페이지 쌍 행 하나의 스크롤, 미니맵, OCR로 읽은 쪽에 "OCR" 배지, `needs_review` 변경은 "확인 필요" 칩으로 차이 개수와 따로 세고 페이지에서 차이와 구별해 표시(E2E) → 결정은 계획서 P3-4 "Step 27에서 정한 것", 시안 대조는 토큰 문서 §6.5 | [x] |
| 28 | P3-4 연결선 | 4 | 계획서 §7.1 완료 기준 → 결정은 계획서 §7.1 "Step 28에서 정한 것", 시안 대조는 토큰 문서 §6.6. 묶기·중립색·행 단위 규칙은 사용자 명세(2026-10-13)로 대체됨 → Step 28-b·28-c | [x] |
| 28-b | P3-4 연결선 재설계 1: 결과 모델·앵커 | 4 | 브랜치 `feat/compare-anchors`. 계획서 §7.1을 사용자 명세로 다시 쓰고, 결과 모델을 `Placement`(상자 \| 앵커)로 바꿔 삽입의 A 쪽·삭제의 B 쪽 앵커를 계산하고(ADR 0001 §4), 같은 줄 상자 병합과 2단 나누기를 고정한다. 앵커(문서 맨 앞·중간·맨 끝·줄 경계·쪽 경계·반대쪽 빈 쪽)와 병합(한 줄·줄바꿈·2단) golden이 변이로 실패를 확인한 채 통과, 바인딩 재생성, 화면·내보내기·주석 PDF가 새 모델로 컴파일되고 기존 E2E 통과(화면 연결선은 Step 28 규칙 그대로) | [x] |
| 28-c | P3-4 연결선 재설계 2: 화면·비교 PDF 연결선 | 4 | 브랜치 `feat/compare-connector-overlay`. 계획서 §7.1: A·B 두 패널 독립 스크롤(+동기 스크롤), 공용 SVG 오버레이, 좌표 변환 파이프라인·대표점·경로 순수 함수, 컬링·클램프·rAF 갱신, 종류 색·수평 stem + 거터 베지어·2줄 초과 띠, hover/click 연동, 비교 PDF 연결선도 같은 규칙, 주석 PDF 삭제 메모는 B 앵커 자리. Step 28 묶기 코드(`connector_stems`·`connector-stems.ts`)와 golden을 걷어낸다. E2E(순수 함수 사례 포함), 연결선 200개 프레임 측정값 기록 → 결정은 계획서 §7.1 "Step 28-c에서 정한 것", 시안 대조는 토큰 문서 §6.6 | [x] |
| 28-d | P3-4 연결선 출발점: 줄 표시 | 4 | 브랜치 `feat/connector-rowband`. 계획서 §7.1 "Step 28-d에서 정한 것": 변경 끝마다 쪽 너비 전체를 덮는 줄 표시(종류 선 색 얇은 테두리 + 옅은 채움)를 A·B에 그리고, 연결선은 그 세로 가운데에서 쪽 끝 → 패널 끝 수평 → 거터 베지어(띠는 위·아래 변)로 나간다. 비교 PDF도 같은 규칙(칸 끝까지 수평 + 칸 사이 베지어). Rust 정본(`ConnectorEnd::row`·`exit_point`)·golden·화면 대응·E2E golden 대조 갱신, 변이로 확인 → 시안 대조는 토큰 문서 §6.6 | [x] |
| 29 | P3-5 내보내기 | 5 | 비교 PDF(배치·차이 쪽만·색 상자)와 주석 PDF, 저장 위치, 미리보기 넘기기 → 결정은 계획서 P3-5 "Step 29에서 정한 것", 커맨드는 [ADR 0001 §17](../adr/0001-compare-result-model.md), pdfium 잠금은 §15, 시안 대조는 토큰 문서 §6.7 | [x] |

- 읽을 곳: 계획서 §7과 §7.1, 토큰 문서 §2.1의 비교 하이라이트
- 시안: 레포 캡처 `docs/resource/design/NN-*.png`(1280×800, 14장). 문구·간격·색 정본은 로컬 `design-files/artboards/NN-*.html`이다(git 제외, 글꼴 포함이라 크다. 없으면 사용자에게 받는다). 원래 Claude Design 캔버스 "PDF Studio 메인 화면"(https://claude.ai/artifact/DypiUsrVJh56yhBuv4tSvV)은 참고용이다. 화면을 만들 때 해당 PNG를 열어 두고 맞춘다.
  - 1 홈(01-home) · 2 병합(02-merge) · 3 비교 옵션(03-compare-options) · 4 비교 결과(04-compare-result) · 5 내보내기(05-compare-export) · 6 병합 삭제·복원(06-merge-restore) · 7 병합 진행·취소(07-merge-progress) · 8 병합 실패(08-merge-error) · 9 비교 진행(09-compare-progress)
  - 10~14(번역 옵션·API 키·진행·결과, 설정)는 Phase 3 범위가 아니다. 계획서 §9.1 Phase 6(아래 Step 35~48)에서 다룬다.
  - 시안 1 홈에는 번역 카드가 있지만 Phase 3에서는 병합·비교 두 장만 만든다.
  - 시안 2·6·7·8(병합)은 이미 구현된 화면과 다를 수 있다. Step 24에서 차이를 목록으로 정리했다(→ 토큰 문서 §6.2, 시안 HTML 값과 토큰의 대조는 §6.1). 사용자 결정(2026-10-13, 계획서 D10)에 따라 **병합 화면은 구조·기능을 유지하고 스타일·배치·문구만 시안에 맞춘다** → Step 24-a.
- 디자인 규칙: 하이라이트는 `diff-insert`(밑줄), `diff-delete`(취소선), `diff-change`(점선)와 각 `-fill`만 쓴다. 범례에는 칩과 낱말을 함께 둔다. 페이지는 `paper` + `radius-paper` + `shadow-paper`, 뒤는 `canvas`.
- Phase 3 완료 기준: 100페이지 문서 쌍(텍스트 레이어)을 Mac에서 5초 안에 비교, 스캔 문서는 쪽당 처리 시간이 Step 17-a 합격 기준 안, 비교 중 스크롤과 취소 가능

---

## Phase 4: 빌드, 배포, 서명

| Step | 계획서 | 완료 기준 | |
|---|---|---|---|
| 30 | P4-1 CI 매트릭스 | PR에서 `pnpm validate` + `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test`, Windows는 NSIS 설치 파일 | [x] |
| 31 | P4-2 릴리스 흐름 | 태그 푸시로 Draft Release(기존 워크플로는 Step 1에서 제거됨). `pnpm release:*`는 커밋·태그까지, 푸시와 실제 태그 빌드·Draft Release 확인은 사용자 몫(병합 후 `workflow_dispatch`로 빌드만 먼저 확인) | [x] |
| 32 | P4-3 서명 | ad-hoc 서명 `.app`과 `libpdfium.dylib`·ONNX Runtime dylib가 같은 identity, `codesign --verify --deep --strict` 통과(`scripts/verify-macos-signature.mjs`, 로컬 `.app`에서 확인. 다운로드한 앱의 Gatekeeper 동작은 사용자 확인) | [x] |
| 33 | P4-4 자동 업데이트(선택) | `pnpm tauri add updater`, 키는 `pnpm tauri signer generate`로 생성(개인 키는 시크릿에만), `latest.json` 생성, 업데이트 동작(E2E mock으로 확인. 실제 업데이트는 이 기능이 든 릴리스와 그다음 릴리스 사이에서 사용자가 확인) | [x] |
| 34 | P4-5 라이선스와 고지 | `LICENSE`, `THIRD_PARTY_NOTICES.md` 번들, 허용 목록 밖 라이선스면 CI 실패, 앱 정보에서 고지 열림. 검사는 `pnpm licenses:check`이고, CI는 macOS 잡에서 `pnpm fetch:pdfium` 뒤 돈다(Step 30 PR에서 연결) | [x] |

---

## Phase 6: PDF 번역·설정

> Phase 3(Step 24~29)이 끝난 뒤 시작한다(계획서 D17). 무엇을 왜 하는지는 계획서 §9.1이다. 이 절은 순서와 완료 기준만 둔다.
>
> - **Step 35가 먼저다.** 계획서 §9.1.9 "결정 필요" 표는 사용자가 2026-10-13에 모두 정했다(Q1 내보내기는 기능 없음, 나머지 권장안 채택). 계획서 §9.1 본문과 이 표는 그 결정대로 고쳤고, Step 35가 [ADR 0002](../adr/0002-translation-model.md)를 썼다. Q13(응답 형식)은 사용자가 C(structured outputs, 두 모델 통일)로 다시 정했다(2026-10-13, ADR 0002 §5).
> - **Step 36은 게이트다.** HTTP·TLS·키체인 의존성이 라이선스 검사나 서명된 앱의 키체인에서 실패하면 Step 39·41을 진행하지 않고 멈추고 보고한다(Step 8·17-a와 같다). Step 37·38은 의존성을 쓰지 않으므로 계속한다.
> - **병렬:** 엔진 줄(36 → 39, 37, 38 → 40 → 41)과 화면 줄의 Step 42는 Step 35 뒤 나란히 간다(git worktree와 `E2E_PORT`를 따로 둔다). Step 43부터는 Step 41의 커맨드가 있어야 하고 차례로 간다.
> - **실제 API:** 자동 테스트와 에이전트 검증은 실제 Anthropic API를 키로 부르지 않는다(가짜 전송·로컬 mock 서버·E2E mock). Step 36의 키 없는 연결 확인(401 응답 모양)만 예외이고, 키를 쓰는 확인은 Step 48에서 사용자가 한다.
> - **시안 대조:** 화면 Step마다 Phase 3처럼 헤드리스 캡처를 시안 PNG와 대조하고 토큰 문서 §6.8 이후에 항목별 반영/유지(이유)를 적는다. 시안 10 옵션 · 11 API 키 · 12 진행 · 13 결과 · 14 설정, 홈 번역 카드는 시안 1. 시안 13 머리의 "내보내기"는 만들지 않는다(사용자 결정 2026-10-13).

| Step | 계획서 | 시안 | 브랜치 | 순서·병렬 | 완료 기준 | |
|---|---|---|---|---|---|---|
| 35 | P6-0 ADR 0002 (S) | — | `docs/adr-translation` | 첫 Step. 뒤 Step 모두의 선행 | 결정 기록은 끝났다(2026-10-13: 계획서 §9.1.9 Q1~Q17 "결정" 칸, §11 D18~D28 채택·기각, §9.1 본문 반영). 남은 것: `docs/adr/0002-translation-model.md`에 문단 키·묶음·요청/응답 형식·이어하기 기록 키와 값·오류 코드·커맨드·진행 단계가 고정됨 | [x] |
| 36 | ★ P6-1 의존성·키체인 스파이크 (게이트, S~M) | — | `spike/translate-deps` | 앞 35. 37·38·42와 병렬 | HTTP·TLS·키체인 크레이트를 `cargo add`로 넣고(Q5·Q6 기능 플래그) `pnpm licenses:generate` 뒤 `pnpm licenses:check`가 예외 추가 없이 통과(예외가 필요하면 멈추고 보고), CI 3개 OS 빌드·`cargo test` 통과, 키 없는 `GET https://api.anthropic.com/v1/models` 한 번으로 TLS 연결과 401 `authentication_error` 응답 모양 확인(자동 테스트로 두지 않는다), macOS ad-hoc 서명 `.app`(창 숨김 빌드)에서 키체인 쓰기·읽기·지우기와 다시 빌드한 뒤 읽기의 허락 창 여부를 기록(사용자 확인), Linux Secret Service 백엔드가 `libdbus`를 쓰지 않음, 고른 값과 측정을 계획서 §9.1.9·§1.2에 기록. 결과(2026-10-13): Q5는 rustls가 `webpki-root-certs`를 끌어와 B(`native-tls`)로 바꿈, keyring 4 기본 기능(zbus), ad-hoc 서명 `.app`의 허락 창은 사용자 확인 남음(계획서 §9.1.9 Q5·Q6) | [x] |
| 37 | P6-2 문단 추출 (M) | — | `feat/translate-paragraphs` | 앞 35. 36·38·42와 병렬 | 가상 중국어(간체·번체)·영어 텍스트 픽스처(OFL 글꼴 임베드, 생성 스크립트 커밋)의 문단 golden 통과(줄 묶기, 간격·글자 크기·들여쓰기·목록 머리로 나누기, 2단, 회전 쪽), 문단 키가 같은 문서에서 재실행해도 같음, 스캔 쪽 판정이 비교 추출의 `needs_ocr`와 같음, 스캔 쪽 그림이 긴 변 `SCAN_IMAGE_MAX_EDGE_PX` 이하 PNG이고 디스크에 쓰지 않음, 쪽 범위 오류는 `INVALID_RANGE`, pdfium 잠금(ADR 0001 §15) 규칙을 따름 | [x] |
| 38 | P6-3 `crates/translate`: 묶음·예상치·언어 감지·용어집 (M) | — | `feat/translate-plan` | 앞 35. 36·37·42와 병렬 | 워크스페이스에 `crates/translate` 추가, Tauri·pdfium 의존 없음(`cargo test -p translate`가 `PDFIUM_LIB_PATH` 없이 통과), 묶음 golden(문단 안 자름·상한·긴 문단 문장 나눔·순서·스캔 쪽 한 묶음), 예상 토큰 golden(이미지 쪽 포함, 상수 근거 주석), 언어 감지(간체·번체·영어·모름 경계), 용어집(묶음에 나온 용어만·문서별 우선·공백·중복) 테스트 통과 | [x] |
| 39 | P6-4 Messages API 클라이언트 (M) | — | `feat/translate-api` | 앞 36(의존성)·38(타입). 37과 병렬 | 요청 JSON golden(모델 ID·`anthropic-version`·thinking·`output_config.format` 스키마·용어집·이미지 블록·`max_tokens`, `tools`·`tool_choice` 없음), 응답 검증(JSON 파싱 실패·스키마 위반, ID 빠짐·남음·순서, `max_tokens` 잘림 → 반으로 나눠 다시, `refusal`)을 손으로 쓴 응답 픽스처로 확인, 재시도(429 `retry-after`·529·5xx 상한, 401·403·404 재시도 없음)를 가짜 전송 + 멈춘 시계로 확인, HTTP 어댑터를 로컬 mock 서버로 확인(헤더·시간 제한·오류 본문 → 코드), 실패 오류의 `message`·로그에 키·문서 글이 없음 테스트, 실제 API 호출 0, 모델 출력 상한 정수·요금표(기준일)를 공식 문서로 확인해 모델 표에 기록(structured outputs 지원·잔액 부족 오류 형식은 Step 35에서 확인, ADR 0002 §15) | [x] |
| 40 | P6-5 실행기: 진행률·취소·이어하기 (M) | — | `feat/translate-runner` | 앞 38·39 | 진행 이벤트 3단계(가중치 10·80·10, 1% 단위, 정수 내림, 100은 끝에만, 사용 토큰·끝난 문단 누적), 묶음 사이·요청 중 취소(요청을 끊음), 취소·실패 뒤 기록에 끝난 묶음만, 이어하기는 남은 묶음만 보냄(가짜 전송 호출 기록), 모델·용어집·원문 언어·스캔 옵션이 다르면 이어하지 않음, 쪽 범위를 바꿔도 겹친 문단은 보내지 않음, 깨진 기록 무시, 기록 원자적 쓰기·`MAX_TRANSLATION_RECORDS` 상한 테스트 통과 | [x] |
| 41 | P6-6 커맨드·키체인 어댑터·계약 (M) | — | `feat/translate-commands` | 앞 37·40 | 계획서 §9.1.3 커맨드 전부와 §5 P1-3 표 갱신, 바인딩 재생성, 새 `ErrorCode`와 `error-messages.ts` 문구, `DesktopPlatform`·tauri·mock 구현, 고르지 않은 파일 거부, `prepare_translation`이 전송을 부르지 않음(가짜 전송 호출 0), 키가 커맨드 응답·로그·`AppError`에 없음(테스트), `tauri.conf.json` CSP `connect-src`가 그대로, `@tauri-apps/api` import 규칙 그대로 | [ ] |
| 42 | P6-7 홈 카드·모드 탭 (S) | 1, 10 머리 | `feat/translate-entry` | 앞 35. 엔진 Step(36~41)과 병렬 | 홈 카드 3장(번역 카드: 누르기·드롭 1개로 번역 모드, 2개 이상·PDF 아님 알림), 모드 탭 `[병합 \| 비교 \| 번역]`과 모드를 오가도 각 세션 유지, 번역 모드의 파일 고르기 빈 화면(파일 카드는 `openFiles` 결과의 이름·크기·쪽수만), 병합·비교 화면은 탭 외 변화 없음(기존 E2E 통과), 시안 대조 토큰 문서 §6.8 | [x] |
| 43 | P6-8 설정 모달 + API 키 모달 (M) | 14, 11 | `feat/settings-dialog` | 앞 41·42 | 홈·번역 머리 톱니와 ⌘,/Ctrl+,로 열기, 탭 일반·번역·오류 보고·정보(Q9 결정대로), 키 등록 안 됨·등록됨·바꾸기·삭제(행 안 확인), 키 모달의 확인 중·성공·실패(코드 문구)·저장, 저장 뒤 DOM에 키 원문 없음(E2E), 기본 모델·외부 전송 확인·공용 용어집 편집이 `page.reload()` 뒤에도 유지, 테마·오류 보고가 기존 설정 키와 같음, Esc·✕ 닫기, 시안 대조 토큰 문서 §6.9 | [ ] |
| 44 | P6-9 번역 옵션 화면 (M) | 10 | `feat/translate-options` | 앞 43 | 파일 카드(썸네일·크기·쪽수·글자층/스캔 쪽·감지 배지·교체), 원문 언어·쪽 범위 검사 문구·모델 카드(기본은 설정)·용어집 표(추가·지우기·빈 칸·중복)·스캔 옵션, 실행 전 확인 값이 계획 응답과 같고 옵션을 바꾸면 다시 받음(늦은 응답 버림, 받는 동안 "…"), 막힘 이유 순서(계획서 §9.1.6 "시안에 없는 상태"), 키 없이 시작하면 키 모달, 동의 체크 없이 시작 막힘(설정에서 끄면 건너뜀·끈 표시, 첫 번역은 늘 확인), 이어하기 가능·이미 번역됨 표시, 요청에 실린 옵션(합친 용어집 포함)을 `__E2E_MOCK_TRANSLATES__`로 확인, 시안 대조 토큰 문서 §6.10 | [ ] |
| 45 | P6-10 진행 화면 (S) | 12 | `feat/translate-progress` | 앞 44 | 3단계 행(상태 점·세부·%·막대), 전체 %·경과·사용 토큰·예상 합계, 취소 → 옵션 화면 + 남은 문단 표시(`cancelJob` 기록), 실패 오버레이(코드 문구·멈춘 단계·"다시 시도(이어서)"·"닫기", 키 오류면 "키 바꾸기"), 다른 모드 상태바 `번역 중 n%`, `role="progressbar"`·`role="status"`, 시안 대조 토큰 문서 §6.11 | [ ] |
| 46 | P6-11 결과 대역 보기 (L) | 13 | `feat/translate-result` | 앞 45 | 머리 정보·"새 번역"(시안 13의 "내보내기" 버튼은 두지 않음 — 계획서 §9.1.9 Q1 기능 없음, 시안 대조에 "시안과 다른 점"으로 적음), 보기 방식 3종, 쪽 이동(‹ ›·←→·쪽 번호 입력)·배율(50~200%), 같은 번호의 원문·번역이 같은 행(행 위치 비교 E2E), 문단 고르기(누르기·↑↓)와 양쪽 강조, 용어집 n 팝오버, 쪽 종류 자리표시(스캔 안 번역·범위 밖·글 없음·이미지에서 읽음), 실패·거절 문단 표시, 상태바 문단 수·사용 토큰, 시안 대조 토큰 문서 §6.12 | [ ] |
| 47 | P6-12 문단 동작 (M) | 13 | `feat/translate-paragraph-actions` | 앞 46 | 다시 번역(진행 표시·결과 교체·사용량 더함·실패 토스트), 직접 고치기(저장·⌘/Ctrl+Enter·취소·Esc, "고침" 배지, `editTranslatedParagraph` 기록), 복사(`__E2E_MOCK_CLIPBOARD__`·토스트), Rust: 다시 번역이 앞뒤 문단을 문맥으로 싣고 기록을 고침·고친 글이 이어하기 뒤에도 남음 테스트 | [ ] |
| 48 | P6-13 실제 API 확인·예상치 보정 (S) | — | `chore/translate-calibration` | 앞 47 | 사용자가 본인 키로 레포의 가상 중국어·영어 픽스처(스캔 쪽 포함 1회)를 번역해 결과·사용량을 확인, 예상치와 실제 차이를 계획서 §9.1.2에 기록하고 비율 상수를 고침, 요금표 기준일 확인, `docs/01-folder-structure.md`·README 기능 목록 갱신, 계획서 §9.1.10 완료 기준 전부 확인 | [ ] |

- 읽을 곳: 계획서 §9.1 전체(2026-10-13 확정한 결정 포함), ADR 0002(Step 35 이후), 엔진 Step은 ADR 0001 §8(추출)·§15(pdfium 잠금)도 읽는다.
- 커밋 단위: Rust Step은 테스트 먼저(Red → Green). 화면 Step은 기능 / 시안 대조 문서 두 커밋으로 나눈다.

---

## 막혔을 때

- **Step 8 실패**: Step 10 이후를 멈추고, 실패 원인(로드, 번들 위치, 서명 중 어디인지)을 계획서 §12에 한 줄로 기록한다.
- **Step 17-a 실패**: Step 19-a를 멈추고, 어느 합격 기준에서 실패했는지와 측정값을 계획서 §6.4에 기록한 뒤 §6.4의 대안 중 무엇을 할지 보고한다. 텍스트 비교 Step(18~23)은 계속 진행한다.
- **Step 36 실패**: Step 39·41을 멈추고, 어느 것(라이선스 검사, 3개 OS 빌드, 서명된 앱의 키체인)에서 실패했는지와 대안(계획서 §9.1.9 Q5·Q6의 다른 선택지)을 계획서 §9.1.9에 기록한 뒤 보고한다. Step 37·38·42는 계속 진행한다.
- **화면이 이상해짐(Step 7)**: 커밋 2(값 교체)만 되돌리면 이전 값으로 돌아간다. 커밋을 셋으로 나누는 이유다.
- **계획과 다르게 가야 할 때**: 코드를 먼저 바꾸지 말고 계획서나 토큰 문서를 먼저 고친 뒤 진행한다.
