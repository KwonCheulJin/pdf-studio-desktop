# CLAUDE.md

**응답 언어**: 한글로만 작성
**에이전트 지침 파일은 이 파일 하나다.** `AGENTS.md` 등 다른 지침 파일을 만들지 않는다.

## 프로젝트 개요

PDF Studio Desktop — PDF 병합·편집·TIFF 변환 데스크톱 앱. **Electron → Tauri v2 전환 중**이며 PDF 비교 기능을 새로 넣는다.
- 계획서: `docs/plans/2026-10-tauri-migration-and-pdf-compare.md` / 진행 순서: `docs/plans/2026-10-step-guide.md`
- 지금 코드: Electron Forge + Vite + React 19 + TypeScript + Tailwind CSS 4 + pnpm
- 목표 구조: Tauri v2 셸 + Rust `crates/pdf-core`(pdfium) 처리 + pdf.js(웹뷰) 표시

```bash
pnpm start                          # 개발 서버(Electron, 전환 전)
pnpm validate                       # lint + typecheck + test
pnpm lint:fix / format / format:check
pnpm fetch:pdfium                   # 버전 고정 pdfium을 src-tauri/pdfium/ 에 받는다
PDFIUM_LIB_PATH=<pdfium 라이브러리 파일> cargo test -p pdf-core
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
pnpm tauri build                    # Tauri 빌드
```

## 아키텍처 핵심

- 의존 방향은 바깥 → 안쪽 한 방향이다. `crates/pdf-core`는 Tauri·웹뷰를 모른다.
- 프론트는 `DesktopPlatform` 인터페이스에만 의존한다. `@tauri-apps/api`는 `shared/platform/tauri-platform.ts`에서만 import한다.
- 경계를 넘는 데이터는 계약 타입(`tauri-specta` 생성물)만 쓴다. 프론트는 파일 경로를 넘기고 결과(JSON)를 받는다.
- FSD: `app → pages → widgets → features → entities → shared`. 위 레이어만 아래를 import하고, 같은 레이어의 슬라이스끼리는 import하지 않으며, 슬라이스 밖에서는 `index.ts`로만 가져온다. `shared`는 도메인을 모른다.

## 작업 원칙

- 요청 밖 작업(기능 추가·리팩터링·빌드 자동 실행)은 하지 않는다. 커밋·PR·병합은 Step 작업만 `docs/rules/agent-workflow.md` 규칙대로 승인 없이 하고, 그 밖의 작업은 사용자 확인 후 한다. 계획과 다르게 가야 하면 코드보다 계획서를 먼저 고친다.
- YAGNI + KISS: 지금 필요한 것만 구현한다. 3번 이상 반복될 때만 추상화한다. 측정한 병목만 고친다.
- 매직 값 금지(상수 객체/`const`/enum). `any`·`unwrap`/`expect`(테스트 제외) 금지.
- **앱 창(GUI)을 띄우지 않는다.** `pnpm tauri dev` 금지. 실행 확인은 창 숨김 빌드로 하고, 화면 확인은 사용자가 한다.
- 포맷은 Prettier(`.prettierrc`)가 정한다. `pnpm format`.
- 코드베이스 탐색은 서브에이전트에 맡긴다. `node_modules/`, `dist/`, `build/`, `coverage/`, `out/`, `target/`, `src-tauri/pdfium/` 파일은 로드하지 않는다.

## 도메인 불변식 (근거: 계획서 B13, D13)

- 회전은 절대값이다. 원본 `/Rotate`에서 시작해 사용자 회전을 누적한 최종값을 그대로 설정하고 더하지 않으며, 0/90/180/270으로 정규화한다.
- 사용자 원본 파일은 절대 수정하지 않는다. 쓰기는 임시 파일 + rename이고, 출력 경로가 입력 원본과 같으면 거부한다.
- 진행률은 정수로 내림하고 100은 실제로 끝났을 때만 보인다.
- 파일 접근은 허용 경로 목록(사용자가 고른 경로, 앱 임시·캐시 폴더)만 허용한다.

## 테스트

- Rust는 핵심 동작만 테스트한다(Red → Green → Refactor). 「이 테스트를 실패시킬 production 변경」을 한 줄로 말할 수 없으면 쓰지 않는다.
- 프론트는 새 단위 테스트(Vitest)를 쓰지 않고 Playwright E2E(mock-platform + WebKit 헤드리스)로 검증한다. 기존 Vitest는 리팩터링 중 동작 고정용으로 유지한다.
- E2E 명령은 첫 E2E를 추가하는 Step에서 여기에 적는다.

## Git

- 커밋 메시지는 `feat:`·`fix:`·`refactor:`·`docs:`·`chore:`·`test:` 접두어 + 한국어 요약이다. 병합은 `gh pr merge --merge --delete-branch`(merge commit).
- `Co-Authored-By: Claude` 등 **AI 기여자 표시 절대 금지**
- 공개(MIT) 레포다. 회사 코드·상수·문구·내부 정보를 코드·문서·커밋에 남기지 않는다(계획서 §1.1 클린룸). 의존성은 MIT/BSD/Apache-2.0/ISC/Zlib만, GPL/AGPL 금지.
- 커밋 전 `pnpm validate`(+ `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`)를 통과시킨다.
- 작업 완료 후 제거: `console.log`, `dbg!`, 미사용 변수/import, 주석 처리된 코드. `eslint-disable`·`#[allow(...)]` 남용 금지.

## 문서 지도

작업에 해당하는 문서를 먼저 읽는다.

| 문서 | 언제 읽는가 |
|---|---|
| `docs/rules/agent-workflow.md` | Step 시작, 서브에이전트 위임, 품질 게이트, 앱 실행 검증 |
| `docs/rules/architecture.md` | 새 모듈·슬라이스 추가, 파일 이동, 계층·FSD·SOLID 판단 |
| `docs/rules/tauri-rust.md` | `src-tauri`·`crates/` 수정, 권한·설정, pdfium 준비 |
| `docs/rules/typescript-react.md` | `src/renderer`의 TS/TSX 작성 |
| `docs/rules/testing.md` | 테스트 작성·수정·삭제 |
| `docs/06-design-system.md` | UI 토큰·FSD 세부 배치 |

`docs/01`~`docs/05`는 Electron 기준 문서(`01-folder-structure.md`, `02-ipc-api-spec.md`는 Electron·Main Process 전제)라 Tauri 전환 뒤 기준과 다를 수 있다. 전환 기준은 계획서와 `docs/rules`가 우선한다.
