---
name: check
description: PDF Studio Desktop 빌드 및 린트 검증 스킬. pnpm typecheck + pnpm lint + Rust(cargo fmt·clippy·test) 순차 실행 후 결과 보고. 작업 완료 후 PR 전 최종 검증, 여러 파일 수정 후 전체 영향도 확인, 타입 오류 의심 시 사용. 트리거: "/check", "빌드 확인", "린트 확인", "타입 검사", "typecheck", "lint"
---

# /check — 타입 체크 + 린트 + Rust 검증

현재 프로젝트 상태를 빠르게 검증합니다.

## 실행 절차

1. **타입 체크** (`pnpm typecheck`)
   - TypeScript 컴파일 오류 확인
   - 생성 바인딩(`shared/api/bindings.ts`)과 호출부 타입 불일치 감지

2. **린트 검사** (`pnpm lint`)
   - ESLint 규칙 위반 확인
   - 미사용 import/변수 확인

3. **Rust 검사** (`cargo fmt --check`, `cargo clippy`, `cargo test`)
   - `cargo test`가 TS 바인딩을 다시 만든다. 바인딩이 바뀌면 typecheck를 다시 돌린다

## 실행

```bash
pnpm typecheck && pnpm lint
cargo fmt --check && cargo clippy --all-targets -- -D warnings
PDFIUM_LIB_PATH=$PWD/src-tauri/pdfium/<target-triple>/<라이브러리 파일> cargo test --workspace
```

순차 실행하고 결과를 요약하여 보고합니다.

## 보고 형식

성공 시:
```
✅ typecheck: 오류 없음
✅ lint: 경고/오류 없음
✅ cargo fmt·clippy·test: 통과
```

오류 발생 시:
```
❌ typecheck 오류:
[오류 내용 요약]

❌ lint 오류:
[규칙 위반 목록]
```
