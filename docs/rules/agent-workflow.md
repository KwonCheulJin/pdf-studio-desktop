# 에이전트 작업 흐름

언제 읽는가: 진행 가이드의 Step을 시작할 때, 서브에이전트에 작업을 맡길 때, 앱 실행 검증이 필요할 때.

## Step 자율 진행 (진행 가이드 `docs/plans/2026-10-step-guide.md`)

- **골격 구간(Step 1~15, Tauri·FSD 마이그레이션 완료까지):** 계획 확인 없이 진행하고, 커밋·PR 생성·병합(`gh pr merge --merge --delete-branch`)까지 승인 없이 한다. 기존 lint·test 실패는 병합을 막지 않는다. 단, 이 Step에서 새로 생긴 lint·typecheck 오류와 새로 깨진 테스트는 고친 뒤 병합한다.
- **Step 16 이후:** `pnpm validate`(+ `pnpm test:e2e`, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`)가 **모두 통과할 때만** 승인 없이 커밋·PR·병합한다. 하나라도 실패하면 병합하지 않고 보고한다. 프론트(`src/renderer`, `e2e/`, `index.html`, Vite·Playwright 설정)를 건드리지 않은 Rust·문서 전용 Step은 `pnpm test:e2e`를 건너뛸 수 있다.
- **멈추고 보고하는 경우:** Step 8 pdfium 스파이크 실패(게이트), 계획서와 다르게 가야 하는 설계 결정, 되돌리기 어려운 작업(번들 ID 변경, 사용자 데이터·원격 이력 삭제), 병합 충돌.
- 한 Step = 브랜치 하나 = PR 하나. 끝나면 진행 가이드의 체크박스를 같은 PR에서 체크하고, 다음 Step은 최신 `main`에서 시작한다.
- 커밋 단위는 진행 가이드를 따른다.

## 실행 방식 (worktree + 서브에이전트)

- Step마다 `git worktree add ../pdf-studio-desktop.worktrees/<브랜치의 / 를 - 로> -b <브랜치> main` 후 그 안에서 `pnpm i`. 메인 체크아웃은 `main`에 두고 코드를 고치지 않는다.
- 구현·수정·테스트 실행은 `delegated-execution`으로 executor 서브에이전트에 맡긴다. executor는 Jev 라우터(`jev.py route`, 이 프로젝트는 on)가 고른 것을 쓴다. 위임 프롬프트 맨 앞에 `task-spec`(targets는 worktree 절대경로, verify 명령)을 넣는다.
- 메인 세션은 계획, 위임, 게이트 보고서 확인(`gate.py report`), 커밋·PR·병합, worktree 정리(`git worktree remove`)만 한다.

## CI

- `.github/workflows/ci.yml`이 PR과 `main` 푸시마다 macOS·Windows·Linux에서 `pnpm validate`, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`(pdfium 포함)를 돌린다. E2E는 macOS 잡, NSIS 설치 파일(아티팩트 `pdf-studio-windows-nsis`)은 Windows 잡이 만든다.

## 품질 게이트

- 설정은 `.claude/quality-gate.json`이다. 고친 파일의 eslint, 전체 typecheck, 관련 테스트를 돌린다.

## 앱 창(GUI)을 띄우지 않는다

- 에이전트 검증에서 `pnpm tauri dev`와 창이 보이는 앱 실행을 하지 않는다. 위임 프롬프트의 verify·제약에도 "GUI 창을 띄우지 마라"를 넣는다.
- 기본 검증은 GUI 없는 명령이다: `cargo test`, `cargo clippy`, `pnpm tauri build`, `codesign`, `pnpm validate`.
- 실제 앱 프로세스로 확인해야 하면 창을 숨긴 빌드를 쓴다: `pnpm tauri build --config '{"app":{"windows":[{…tauri.conf.json의 기존 창 값…,"visible":false}]}}'` 후 실행 파일을 백그라운드로 돌려 로그를 확인하고 반드시 종료한다.
- 화면 확인은 사용자가 한다. 꼭 필요한 Step만 메인이 마지막에 한 번 띄운다.
