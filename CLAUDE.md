# CLAUDE.md

**응답 언어**: 한글로만 작성
**에이전트 지침 파일은 이 파일 하나다.** `AGENTS.md` 등 다른 지침 파일을 만들지 않는다.

## 프로젝트 개요

PDF Studio Desktop — PDF 병합·편집·TIFF 변환 데스크톱 앱. **Electron → Tauri v2 전환 중**이며 PDF 비교 기능을 새로 넣는다.
- 계획서: `docs/plans/2026-10-tauri-migration-and-pdf-compare.md` / 진행 순서: `docs/plans/2026-10-step-guide.md`
- 지금 코드: Electron Forge + Vite + React 19 + TypeScript + Tailwind CSS 4 + pnpm
- 목표 구조: Tauri v2 셸 + Rust `crates/pdf-core`(pdfium) 처리 + pdf.js(웹뷰) 표시

```bash
pnpm start / pnpm validate          # 개발 서버 / lint + typecheck + test
pnpm lint:fix / format / format:check
# Tauri 전환 이후
pnpm tauri dev / pnpm tauri build
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## 아키텍처

**의존 방향은 바깥 → 안쪽 한 방향이다 (Clean Architecture).**

| 계층 | 위치 | 역할 | 의존해도 되는 것 |
|---|---|---|---|
| 도메인·유스케이스 | `crates/pdf-core`, 프론트의 `**/model`·`shared/lib` 순수 함수 | 병합·회전·TIFF·비교 규칙 | 표준 라이브러리, 순수 crate/패키지만 |
| 어댑터 | `src-tauri`(커맨드·경로 검증·작업 큐), `shared/platform/*-platform.ts` | 바깥 세계 ↔ 도메인 변환 | 도메인 + 프레임워크 API |
| 프레임워크·UI | Tauri 런타임, React 컴포넌트 | 입출력, 화면 | 어댑터 인터페이스 |

- `pdf-core`는 Tauri·웹뷰를 모른다. `cargo test`만으로 검증할 수 있어야 한다.
- 프론트는 `DesktopPlatform` 인터페이스에만 의존한다. `window.api`(Electron)·`@tauri-apps/api`(Tauri) import는 `shared/platform/`의 구현 파일에서만 한다.
- 경계를 넘는 데이터는 계약 타입(지금 `src/shared/contracts`, 전환 후 `tauri-specta` 생성물)만 쓴다. TS 쪽에 같은 타입을 손으로 복제하지 않는다.
- 프론트는 **파일 경로를 넘기고 결과(JSON)를 받는다.** PDF 바이트는 표시용 읽기(`read_pdf`) 말고는 IPC를 오가지 않는다.

**FSD (renderer)**: `app → pages → widgets → features → entities → shared`
- 위 레이어만 아래 레이어를 import한다. 같은 레이어의 다른 슬라이스끼리 import하지 않는다(조합은 상위 레이어에서).
- 슬라이스 밖에서는 슬라이스의 공개 API(`index.ts`)로만 가져온다.
- `entities` = 읽기·표시, `features` = 사용자 행동(생성·수정·삭제), `widgets` = 조합, `pages` = 화면 조립, `app` = 부팅·프로바이더·전역 스타일·모드 스토어.
- `shared`는 도메인을 모른다. 업무 훅·스토어를 `shared`에 두지 않는다(`features/*/model`, `entities/*/model`).
- 세그먼트: `ui/`, `model/`, `lib/`, `api/`, `config/`. 세부 배치는 `docs/06-design-system.md §3`.

## 개발 원칙

### 명시적 작업만 수행 (최우선)
- 사용자 요청 외 작업 금지: 빌드 자동 실행, 기능 추가, 리팩토링, 커밋 금지
- 흐름: **계획 → 사용자 확인 → 실행 → 보고**. 계획과 다르게 가야 하면 코드보다 계획서를 먼저 고친다.
- 진행 가이드의 Step 작업은 아래 "Step 자율 진행" 규칙이 이 흐름보다 우선한다.

### Step 자율 진행 (진행 가이드 `docs/plans/2026-10-step-guide.md`)
- **골격 구간(Step 1~15, Tauri·FSD 마이그레이션 완료까지):** 계획 확인 없이 진행하고, 커밋·PR 생성·병합(`gh pr merge --merge --delete-branch`)까지 승인 없이 한다. 기존 lint·test 실패는 병합을 막지 않는다. 단, 이 Step에서 새로 생긴 lint·typecheck 오류와 새로 깨진 테스트는 고친 뒤 병합한다.
- **Step 16 이후:** `pnpm validate`(+ `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`)가 **모두 통과할 때만** 승인 없이 커밋·PR·병합한다. 하나라도 실패하면 병합하지 않고 보고한다.
- **멈추고 보고하는 경우:** Step 8 pdfium 스파이크 실패(게이트), 계획서와 다르게 가야 하는 설계 결정, 되돌리기 어려운 작업(번들 ID 변경, 사용자 데이터·원격 이력 삭제), 병합 충돌.
- 한 Step = 브랜치 하나 = PR 하나. 끝나면 진행 가이드의 체크박스를 같은 PR에서 체크하고, 다음 Step은 최신 `main`에서 시작한다.

### YAGNI + KISS
- 현재 필요한 것만 구현한다. 미래용 코드, 쓰지 않는 옵션·추상화 금지
- Rule of 3: 3번 이상 반복될 때만 추상화
- 단일 컴포넌트 상태는 `useState`, 전역 확대 금지 / 라우터 없이 모드 스토어로 화면 전환
- 조기 최적화 금지. 측정한 병목만 고친다.

### SOLID (이 프로젝트에서의 의미)
- **S** 모듈 하나는 바뀌는 이유 하나. Tauri 커맨드는 입력 검증 + `pdf-core` 위임만, 컴포넌트는 표시만, 로직은 `model`/`lib`
- **O** 새 플랫폼·새 내보내기 형식은 구현을 **추가**해서 늘린다(`DesktopPlatform` 구현체 추가). 기존 분기를 늘리지 않는다.
- **L** `electron`·`tauri`·`mock` 플랫폼 구현은 같은 계약과 같은 에러 의미(`{ code, message }`)를 지킨다. 테스트에서 바꿔 끼워도 동작이 같아야 한다.
- **I** 인터페이스와 props는 쓰는 쪽이 필요한 만큼만. 거대한 props 객체·만능 훅 금지
- **D** 상위 정책은 추상에 의존한다. UI → `DesktopPlatform`(부팅 시 `app/providers`에서 주입), 커맨드 → `pdf-core` 공개 API

### TDD
- **Red → Green → Refactor.** 실패하는 테스트를 먼저 쓰고, 통과시키는 최소 코드를 쓰고, 그다음 정리한다.
- 대상: `crates/pdf-core` 전체, `src-tauri`의 순수 로직(경로 검증·진행률 계산), `shared/lib`, `**/model` 순수 함수·스토어, (전환 전) `src/main/services`·`workers`
- 제외: React 컴포넌트(`*.tsx`), 스타일, 얇은 커맨드·IPC 래퍼
- 리팩터링 전에는 **특성 테스트**로 지금 동작을 고정한다. 버그는 재현 테스트부터 쓴다.
- 비교 엔진·연결선은 golden JSON 픽스처로 검증하고, TS와 Rust가 같은 픽스처를 쓴다.
- 공개 인터페이스로 테스트한다. 구현 세부(private 함수, 내부 상태)를 테스트하지 않는다.
- 위치: TS는 대상과 같은 폴더의 `__tests__/`(Vitest), Rust 단위 테스트는 같은 파일 `#[cfg(test)] mod tests`, 통합 테스트는 `crates/*/tests/`, 픽스처는 `crates/pdf-core/tests/fixtures/`

## Tauri 규칙

- **설치·생성은 키트로 한다.** Tauri CLI(`tauri init`, `tauri add`, `tauri permission add`, `tauri capability new`, `tauri icon`, `tauri signer generate`)와 `pnpm add`/`cargo add`를 쓰고, 생성물은 최소한으로만 고친다. `Cargo.toml`·`package.json` 의존성, `lib.rs` 플러그인 등록, capability JSON을 손으로 쓰지 않는다.
- **최소 권한:** capability는 `main` 창 하나에만 연결하고 쓰는 권한만 둔다. `fs` 플러그인은 쓰지 않는다. 파일 접근은 검증하는 커스텀 커맨드로만 한다.
- **경로 검증:** 커맨드는 받은 경로를 `canonicalize`한 뒤 확장자 화이트리스트·허용 루트(사용자가 고른 경로, 앱 임시·캐시 디렉터리)·크기 상한을 확인한다.
- **사용자 원본 파일은 절대 수정하지 않는다.** 쓰기는 임시 파일에 쓴 뒤 rename하는 원자적 쓰기로 한다.
- **커맨드는 얇게:** `async fn` + 무거운 작업은 pdfium 전용 작업 스레드(또는 `spawn_blocking`)로 넘긴다. UI 스레드를 막지 않는다.
- **에러:** 커맨드는 `Result<T, AppError>`를 돌려준다. `AppError`는 `thiserror` + `Serialize`로 `{ code, message }`를 만든다. 화면 문구는 프론트가 `code`로 찾고, `message`는 로그용이다. 커맨드 안에서 `unwrap`/`expect`/`panic!` 금지
- **IPC 전송:** 진행률 스트림은 `tauri::ipc::Channel`, 바이너리는 `tauri::ipc::Response`. `Vec<u8>`을 그대로 돌려주지 않는다(JSON 숫자 배열이 된다). 진행 이벤트는 1% 단위 이상으로만 보낸다.
- **취소:** 오래 걸리는 작업은 작업 ID와 `Arc<AtomicBool>` 취소 토큰을 갖고, 취소되면 임시 파일을 지운다.
- **상태:** 공유 상태는 `app.manage()` + `State<'_, T>`로만. 전역 `static mut` 금지
- **CSP:** `tauri.conf.json > app.security.csp`로 관리하고 외부 스크립트를 로드하지 않는다. `withGlobalTauri`를 켜지 않는다.
- **경로·플랫폼:** TS는 `@tauri-apps/api/path`, Rust는 `PathBuf`만. 문자열로 `/`·`\`를 다루지 않는다. 단축키는 `isMac ? metaKey : ctrlKey`
- **버전:** `tauri.conf.json`의 `version`은 `../package.json`을 가리킨다(단일 소스). <!-- docs-path-check: ignore -->
- **pdfium:** 라이브러리 경로 결정은 `pdf-core` 한 곳에서. 개발·테스트는 `PDFIUM_LIB_PATH` 환경변수를 우선한다.

## Rust 규칙

- `cargo fmt`, `cargo clippy -D warnings` 통과가 기본이다.
- 라이브러리 에러는 `thiserror`로 정의한 enum. `unwrap`/`expect`는 테스트와 "불가능함을 증명한 곳"에만, 이유를 주석으로 남긴다.
- 매직 값 금지 → `const`와 enum. 상한·가중치(`MAX_INPUT_FILE_BYTES` 등)는 `pdf-core` 상수로 둔다.
- 공개 API(`pub`)는 최소로 하고 나머지는 `pub(crate)`.
- 명명: 함수·변수 `snake_case`, 타입·트레이트 `PascalCase`, 상수 `UPPER_SNAKE_CASE`. 축약 금지는 TS와 같다.
- 의존성은 계획서 §1.2 라이선스 화이트리스트(MIT/BSD/Apache-2.0/ISC/Zlib) 안에서만 고른다. GPL/AGPL 금지

## 코딩 표준 (TS)

**코드 스타일**: 큰따옴표 `"`, 세미콜론 필수, 들여쓰기 2칸, 후행 쉼표 없음, 화살표 함수 괄호 항상, 80자 제한

**명명 규칙**:
- 파일/폴더: `kebab-case` | 컴포넌트/타입: `PascalCase` | 함수/훅/변수: `camelCase`
- 상수: `UPPER_SNAKE_CASE` | 서비스: `PdfMergeService` | Props: `DocumentCardProps`
- Hooks: `use` prefix | 핸들러: `handle` prefix | 콜백: `on` prefix | Boolean: `is`/`has` prefix
- 축약 금지: `col`→`column`, `num`→`number`, `btn`→`button`

**Import 순서**: React/외부 → `@/` alias → 상대 경로 (중복 import 금지)

### TypeScript
- `any` 금지, 인라인 객체 타입 금지 → 반드시 `interface`/`type` 명시 정의
- 매직 스트링/넘버 금지 → 상수 객체 + `as const` + `ValueOf<T>` (TS `enum` 금지)
- 유틸리티 함수 매개변수: 위치 기반 금지 → 객체 형식(Named Parameters) 필수
- 상수 위치: `src/renderer/shared/constants/` 또는 feature 내 `constants.ts`. 디자인 토큰 이름은 `shared/config/theme.ts`

```typescript
export const STATUS = { IDLE: "idle", PENDING: "pending" } as const;
type ValueOf<T> = T[keyof T];
type Status = ValueOf<typeof STATUS>;
```

### React 19
- `forwardRef` 제거 → `ref`를 일반 prop으로 전달 / `Context.Provider` 제거 → `<ThemeContext value="dark">`
- 새 훅: `use()`(Promise/Context), `useActionState`(폼), `useOptimistic`(낙관적 UI)
- 상태 업데이트는 **이벤트 핸들러**에서 수행. `useEffect`는 **외부 시스템 동기화**에만 사용(DOM, 외부 라이브러리, Zustand, Tauri 이벤트 구독과 해제)
- `useEffect` 내 동기적 `setState` 금지 (cascading renders)
- props → state 초기화: `key prop` 리셋 또는 `useState(() => ...)` 초기값 패턴
- `useCallback`: 자식에 전달되는 함수 | `useMemo`: 데이터 변환/파생 계산
- `key={index}` 금지 → `key={item.id}` 또는 `crypto.randomUUID()`
- UI는 토큰 클래스만 쓴다. 팔레트 클래스(`bg-black/50`, `text-white`, `-500`)·임의값 금지

### 함수형 프로그래밍
- 객체/배열 직접 변경 금지 → 항상 새 객체/배열 생성
- `Object.fromEntries`, `map`, `filter`, `reduce` 사용
- 콜백 인자 축약 금지 (`i` → `item`, `v` → `value`)

### 코드 복잡도
- Cognitive Complexity ≤ 15, 중첩 깊이 ≤ 4단계
- 중첩 삼항 금지 → `if-else` 또는 함수 분리
- `!condition ? A : B` 금지 → `condition ? B : A`
- `replace(/pattern/g)` → `replaceAll()` 사용

## Git & 코드 품질

- 자동 커밋 금지 — 반드시 사용자 검토 후 커밋. 예외: 진행 가이드 Step 작업은 "Step 자율 진행" 규칙을 따른다. 커밋 단위는 진행 가이드를 따른다.
- `Co-Authored-By: Claude` 등 **AI 기여자 표시 절대 금지**
- 공개(MIT) 레포다. 회사 코드·상수·문구·내부 정보를 코드·문서·커밋에 남기지 않는다(계획서 §1.1 클린룸).
- 커밋 전 검증: `pnpm validate`(+ 전환 후 `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`)
- 작업 완료 후 제거: `console.log`, `dbg!`, 미사용 변수/import, 주석 처리된 코드
- `eslint-disable`·`#[allow(...)]` 남용 금지

## 컨텍스트 최적화

- 코드베이스 탐색은 서브 에이전트 사용
- `node_modules/`, `dist/`, `build/`, `coverage/`, `out/`, `target/`, `src-tauri/pdfium/` 파일 로드 금지
- 이미 읽은 파일 재독 금지
