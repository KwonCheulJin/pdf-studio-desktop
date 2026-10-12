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

### 0-3. 단계마다 반복하는 흐름

> **키트 우선(계획서 §1.3, D11):** Tauri 설정·플러그인·권한·아이콘·서명 키는 Tauri CLI로, 의존성은 `pnpm add`/`cargo add`로 만든다. 각 Step의 "할 일(키트)"에 적힌 명령을 먼저 실행하고, 생성물은 최소한으로만 고친다.

1. `git switch main && git pull` → `git switch -c <브랜치 이름>`
2. Claude Code 세션을 열고 아래 **세션 프롬프트**를 붙여 넣는다.
3. 계획을 확인한 뒤 실행 → 완료 기준을 직접 확인 → 커밋 → PR → 병합
4. 이 가이드의 체크박스를 체크한다.

세션 프롬프트(단계 번호만 바꿔 쓴다):
> `docs/plans/2026-10-step-guide.md`의 **Step N**을 진행해줘. 거기 적힌 문서 섹션을 읽고, 시작 전에 작업 계획을 먼저 보여 주고 확인을 받아. 완료 기준을 직접 검증한 뒤 보고해.

---

## Phase 0: Electron 위에서 정리

> 이 구간은 Windows 회사 PC에서도 할 수 있다. Mac에서만 해야 하는 건 Step 8부터다.

### Step 1. 개발 환경 정합 (S)
- 브랜치: `chore/dev-env`
- 읽을 곳: 계획서 §4 P0-1
- 할 일: Node 버전 하나로 통일, `engines`·`packageManager`, `.gitattributes`(eol=lf), `forceConsistentCasingInFileNames`, `.claude` 훅 절대경로 제거
- 완료 기준: Mac과 Windows에서 클론 직후 `pnpm i && pnpm validate` 통과, 줄바꿈 차이로 수정 표시되는 파일 0개
- [ ] Step 1

### Step 2. 플랫폼 어댑터, 계약 분리, FSD 정리, 스타일 폴더 이동 (M)
- 브랜치: `refactor/platform-adapter-fsd`
- 읽을 곳: 계획서 §4 P0-2, 토큰 문서 §3과 §4의 1단계
- 할 일
  0. **먼저 특성 테스트**(계획서 T2): `merge-store`·`selection-store`의 지금 동작을 테스트로 고정한다. 이 커밋을 가장 먼저 한다.
  1. `src/shared/contracts/`로 DTO·상수 이동, renderer의 `@/main/*` import 제거
  2. `shared/platform/`에 `DesktopPlatform` 인터페이스와 `electron-platform.ts`, `mock-platform.ts`
  3. `shared/hooks`의 업무 훅 → `features/*/model`, `merge-store` → `entities/merge-plan` + `features/pdf-merge/model`
  4. `src/renderer/styles/` → `src/renderer/app/styles/`로 옮기고 `tokens.css`, `theme.css`, `base.css`로 나눈다. **값은 그대로 둔다.**
  5. `components.json` 경로 수정(`app/styles/index.css`, `components` 별칭)
- 커밋을 다섯으로 나눈다: 특성 테스트 / 계약 / 어댑터 / FSD 이동 / 스타일 이동
- 완료 기준: `window.api` 참조가 `electron-platform.ts` 한 곳, `shared`가 상위 레이어나 `@/main`을 import하지 않음, 스타일 이동 전후 화면이 같음(라이트·다크 스크린샷 비교)
- [ ] Step 2

### Step 3. 비파괴 회전 (S)
- 브랜치: `fix/non-destructive-rotation`
- 읽을 곳: 계획서 §4 P0-3 (버그 B1)
- 완료 기준: 어떤 조작 후에도 원본 파일의 mtime과 해시가 그대로라는 테스트 통과
- [ ] Step 3

### Step 4. pdf.js 로더 단일화와 렌더 캐시 (M)
- 브랜치: `perf/pdfjs-cache`
- 읽을 곳: 계획서 §4 P0-4 (P1)
- 주의: cMap과 standard fonts 자산 복사를 빼먹으면 한글 PDF가 깨진다.
- 완료 기준: 같은 파일을 두 번 읽지 않음, 파일 제거 시 메모리 회수, 한글 PDF 썸네일 정상
- [ ] Step 4

### Step 5. 내부 드래그 정렬을 @dnd-kit으로 (M)
- 브랜치: `refactor/dnd-kit`
- 읽을 곳: 계획서 §4 P0-5
- 완료 기준: HTML5 DnD 이벤트(`onDragStart` 등) 의존 0, 파일·페이지 재정렬과 외부 파일 드롭이 그대로 동작, **키보드만으로 재정렬 가능**(Space 집기 → 방향키 → Space 놓기)
- [ ] Step 5

### Step 6. 버그 수정과 정리 (M)
- 브랜치: `fix/p0-cleanup`
- 읽을 곳: 계획서 §2.2 버그 표, §4 P0-6 (B2, B5, B8~B12, A1, D1, D2)
- 커밋 단위: 버그마다 하나. B10(페이지 복원)은 스토어 변경 + 화면 연결이라 따로 리뷰한다.
- 화면 시안: 6 "병합: 페이지 삭제·복원", 8 "병합: 실패"(오류 오버레이와 토스트)
- 완료 기준
  - 빈 화면 TIFF 드롭 후 병합 성공, Windows 경로로 기본 저장 경로 계산 테스트 통과
  - 페이지 삭제 → 흐린 카드의 "복원" → 병합 결과가 삭제 전과 같음(스토어 테스트), 상태바·카드 쪽수는 삭제 안 된 페이지만 셈
  - 클릭·⌘·Shift 선택, 삭제 후 선택 목록 정리, 단축키(Delete, ⌘A, Esc)
  - 일부러 실패시킨 파일 읽기·병합·다운로드가 모두 화면에 보임
  - 미사용 코드 제거 후 `pnpm validate` 통과(`selectRange`, `restorePage`는 남김)
- [ ] Step 6

### Step 7. 디자인 토큰 v2 적용 (M)
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
- [ ] Step 7

---

## Phase 1: Tauri 전환 (Track A) — 여기서부터 Mac

### Step 8. ★ pdfium 스파이크 (M) — 게이트
- 브랜치: `spike/pdfium`
- 읽을 곳: 계획서 §5 P1-0, §12 리스크 첫 줄
- 할 일(키트): 빈 앱은 `pnpm create tauri-app`으로 만들고, pdfium은 `cargo add pdfium-render --features thread_safe`로 넣는다. 직접 작성하는 것은 `scripts/fetch-pdfium.mjs`와 렌더 확인 코드뿐이다.
- **이 단계가 실패하면 Step 9 이후를 진행하지 않는다.** 실패하면 원인을 기록하고 계획서 §6.0의 엔진 선택을 다시 검토한다.
- 완료 기준: ad-hoc 서명된 `.app`에서 PDF 1장 렌더, `codesign --verify --deep --strict` 통과, CI Windows 빌드에서 pdfium 로드
- [ ] Step 8

### Step 9. Tauri 스캐폴드 + Cargo workspace (S)
- 브랜치: `feat/tauri-scaffold`
- 읽을 곳: 계획서 §5 P1-1, §11 D5
- 시작 전 결정: **번들 ID `io.github.kwoncheuljin.pdfstudio` 확정**(나중에 바꾸면 데이터 경로가 바뀐다)
- 할 일(키트): `pnpm add -D @tauri-apps/cli` → `pnpm add @tauri-apps/api` → `pnpm tauri init` → `cargo new --lib crates/pdf-core`. 루트 `Cargo.toml`의 `[workspace]`만 직접 쓴다.
- 완료 기준: `pnpm tauri dev`로 빈 셸에 기존 renderer가 뜸, 버전이 `package.json` 하나에서 나옴
- [ ] Step 9

### Step 10. pdf-core 기본 처리 (L)
- 브랜치: `feat/pdf-core-basic`
- 읽을 곳: 계획서 §5 P1-2
- 순서: `document.rs` → `info.rs` → `merge.rs` → `tiff.rs`. 모듈마다 테스트 먼저 이식하고 구현한다.
- 완료 기준: `cargo test -p pdf-core` 통과(회전, 멀티페이지 TIFF, CCITT G4, 북마크 원본 병합 케이스 포함)
- [ ] Step 10

### Step 11. Tauri 커맨드와 작업 큐 (M)
- 브랜치: `feat/tauri-commands`
- 읽을 곳: 계획서 §5 P1-3
- 화면 시안: 7 "병합: 진행·취소", 8 "병합: 실패"
- 할 일(키트): `pnpm tauri add dialog`, `pnpm tauri add log`, `pnpm tauri add opener`. `tauri-specta`는 `cargo add`로 넣는다.
- 완료 기준: 큰 PDF 병합 중에도 UI가 멈추지 않음, 전체 %와 작업별 %(파일 읽기·페이지 합치기·저장) 표시, **병합 취소 후 임시 파일 없음**, 상한(512MB·200개)을 넘는 입력은 이유와 함께 거부, 앱 임시 폴더 밖 경로는 커맨드가 거부
- [ ] Step 11

### Step 12. Tauri 어댑터와 드롭 (M)
- 브랜치: `feat/tauri-platform`
- 읽을 곳: 계획서 §5 P1-4
- 완료 기준: `mockIPC` 단위 테스트 통과, 드롭 위치에 정확히 삽입(Retina에서 `devicePixelRatio` 보정 확인)
- [ ] Step 12

### Step 13. 보안, 테마, 창 (S)
- 브랜치: `feat/tauri-security-theme`
- 읽을 곳: 계획서 §5 P1-5, 토큰 문서 §3(`app/providers/theme-provider.tsx`)
- 할 일(키트): `pnpm tauri add store`, `pnpm tauri add window-state`. 권한은 `pnpm tauri permission add`/`permission rm`으로 조정하고 `pnpm tauri permission ls`로 확인한다. capability JSON은 손으로 쓰지 않는다.
- 완료 기준: animatedicons 제거, 테마 `system|light|dark` 선택이 재시작 후에도 유지, 창 크기·위치 기억, 최소 창 크기 1120×720, 에러 스냅샷이 앱 전용 설정으로 가고 경로·파일 이름이 지워져 전송되며 설정에서 끌 수 있음
- [ ] Step 13

### Step 14. Electron 제거와 문서 갱신 (S)
- 브랜치: `chore/remove-electron`
- 읽을 곳: 계획서 §5 P1-6
- 함께 할 일: `docs/01-folder-structure.md`를 토큰 문서 §3의 FSD 배치에 맞춰 갱신
- 완료 기준: `electron`, `pdf-lib`, `sharp`, `fs-extra`가 의존성에 없음, 계획서 §5의 "Phase 1 완료 기준" 체크리스트 전부 통과
- [ ] Step 14

### Step 15. 아이콘과 로컬 빌드 (S)
- 브랜치: `chore/tauri-icons-build`
- 읽을 곳: 계획서 §5 P1-7
- 할 일(키트): 1024px PNG 원본으로 `pnpm tauri icon` → `pnpm tauri build`
- 완료 기준: Mac에서 `.dmg` 생성 후 설치·실행
- [ ] Step 15

---

## Phase 2: Rust 비교 엔진 (Track B)

> Step 8만 끝나면 Phase 1과 나란히 진행할 수 있다. Tauri 없이 `cargo test`로만 개발한다.

| Step | 계획서 | 브랜치 | 완료 기준 | |
|---|---|---|---|---|
| 16 | P2-1 결과 모델 ADR | `docs/adr-compare-result` | `CompareResult` 타입과 좌표 규칙이 ADR로 고정 | [ ] |
| 17 | P2-2 추출 + 좌표 일치 | `feat/compare-extract` | pdfium 박스와 pdf.js 박스 교차 테스트 통과(CropBox 오프셋, 회전 페이지 포함) | [ ] |
| 18 | P2-3 정규화·토큰화 | `feat/compare-tokenize` | 한글 픽스처 토큰화 golden 통과 | [ ] |
| 19 | P2-4 정렬과 diff | `feat/compare-diff` | 삽입·삭제·치환·문단 이동 golden 통과 | [ ] |
| 20 | P2-5 페이지 짝짓기 | `feat/compare-page-pairs` | 페이지 삽입·삭제 픽스처에서 짝이 맞음 | [ ] |
| 21 | P2-6 옵션 | `feat/compare-options` | A·B 따로 페이지 범위(초과 시 `InvalidRange`), 머리말·꼬리말·쪽번호 따로 제외, 대소문자 무시 테스트 통과 | [ ] |
| 22 | P2-7 작업 실행기 | `feat/compare-runner` | 5단계 `Progress` 이벤트(단계별 %·전체 %, 1% 단위, 100%는 끝났을 때만), 취소, 옵션만 바꾼 재실행에서 추출 생략(그 단계 즉시 100%) | [ ] |
| 23 | P2-8 리포트 내보내기 | `feat/compare-report` | 비교 PDF(배치 3종, 차이 쪽만, 색 상자)와 주석 PDF 생성, 미리보기 렌더 | [ ] |

- 읽을 곳: 계획서 §6 전체. Step 17의 좌표 일치는 이후 모든 하이라이트의 기반이므로 건너뛰지 않는다.

---

## Phase 3: 비교 UI (A + B 합류)

> Step 15와 Step 23이 모두 끝난 뒤 시작한다.

| Step | 계획서 | 시안 | 완료 기준 | |
|---|---|---|---|---|
| 24 | P3-1 앱 모드와 홈 | 1, 2 | 홈 카드 2장에서 모드 진입(누르기·드롭), 툴바 `[병합 \| 비교]` 탭 전환 시 각 모드 상태 유지, 병합 화면은 탭 외 변화 없음 | [ ] |
| 25 | P3-2 파일 슬롯 | 3 위 | A/B 빈·채운 상태, 드롭·다이얼로그, A↔B 맞바꾸기 | [ ] |
| 26 | P3-3 실행 전 옵션 + P3-3a 진행 화면 | 3 아래, 9 | A·B 페이지 범위 검증 문구, 반복 줄 3종, 대소문자, 실행 불가 이유와 버튼 비활성 / 실행 후 **전체 %와 작업별 %(5단계)**, 상태 점, 취소, 다른 모드에서도 상태바에 % | [ ] |
| 27 | P3-4 결과 미리보기 | 4 | 차이 목록(쪽별 묶기, 펼침), 종류 칩 필터, 이전/다음·키보드, 나란히/A만/B만, 페이지 쌍 행 하나의 스크롤, 미니맵 | [ ] |
| 28 | P3-4 연결선 | 4 | 계획서 §7.1 완료 기준 | [ ] |
| 29 | P3-5 내보내기 | 5 | 비교 PDF(배치·차이 쪽만·색 상자)와 주석 PDF, 저장 위치, 미리보기 넘기기 | [ ] |

- 읽을 곳: 계획서 §7과 §7.1, 토큰 문서 §2.1의 비교 하이라이트
- 시안: Claude Design 캔버스 "PDF Studio 메인 화면"(https://claude.ai/artifact/DypiUsrVJh56yhBuv4tSvV). 같은 claude.ai 계정으로 Mac 브라우저에서 열 수 있다. 화면을 만들 때 해당 아트보드를 열어 두고 맞춘다.
  - 1 홈 · 2 병합 · 3 비교 옵션 · 4 비교 결과 · 5 내보내기 · 6 병합 삭제·복원 · 7 병합 진행·취소 · 8 병합 실패 · 9 비교 진행
- 디자인 규칙: 하이라이트는 `diff-insert`(밑줄), `diff-delete`(취소선), `diff-change`(점선)와 각 `-fill`만 쓴다. 범례에는 칩과 낱말을 함께 둔다. 페이지는 `paper` + `radius-paper` + `shadow-paper`, 뒤는 `canvas`.
- Phase 3 완료 기준: 100페이지 문서 쌍을 Mac에서 5초 안에 비교, 비교 중 스크롤과 취소 가능

---

## Phase 4: 빌드, 배포, 서명

| Step | 계획서 | 완료 기준 | |
|---|---|---|---|
| 30 | P4-1 CI 매트릭스 | PR에서 `pnpm validate` + `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test`, Windows는 NSIS 설치 파일 | [ ] |
| 31 | P4-2 릴리스 흐름 | `auto-version.yml` 제거, 태그 푸시로 Draft Release | [ ] |
| 32 | P4-3 서명 | ad-hoc 서명 `.app`과 `libpdfium.dylib`가 같은 identity, `codesign --verify --deep --strict` 통과 | [ ] |
| 33 | P4-4 자동 업데이트(선택) | `pnpm tauri add updater`, 키는 `pnpm tauri signer generate`로 생성(개인 키는 시크릿에만), `latest.json` 생성, 업데이트 동작 | [ ] |
| 34 | P4-5 라이선스와 고지 | `LICENSE`, `THIRD_PARTY_NOTICES.md` 번들, 허용 목록 밖 라이선스면 CI 실패, 앱 정보에서 고지 열림 | [ ] |

---

## 막혔을 때

- **Step 8 실패**: Step 9 이후를 멈추고, 실패 원인(로드, 번들 위치, 서명 중 어디인지)을 계획서 §12에 한 줄로 기록한다.
- **화면이 이상해짐(Step 7)**: 커밋 2(값 교체)만 되돌리면 이전 값으로 돌아간다. 커밋을 셋으로 나누는 이유다.
- **계획과 다르게 가야 할 때**: 코드를 먼저 바꾸지 말고 계획서나 토큰 문서를 먼저 고친 뒤 진행한다.
