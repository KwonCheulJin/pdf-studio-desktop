---
name: check
description: PDF Studio Desktop 빌드 및 린트 검증 스킬. pnpm typecheck + pnpm lint 순차 실행 후 결과 보고. 작업 완료 후 PR 전 최종 검증, 여러 파일 수정 후 전체 영향도 확인, 타입 오류 의심 시 사용. 트리거: "/check", "빌드 확인", "린트 확인", "타입 검사", "typecheck", "lint"
---

# /check — 타입 체크 + 린트 검증

현재 프로젝트 상태를 빠르게 검증합니다.

## 실행 절차

1. **타입 체크** (`pnpm typecheck`)
   - TypeScript 컴파일 오류 확인
   - IPC 타입 불일치 감지

2. **린트 검사** (`pnpm lint`)
   - ESLint 규칙 위반 확인
   - 미사용 import/변수 확인

## 실행

```bash
pnpm typecheck && pnpm lint
```

두 명령을 순차 실행하고 결과를 요약하여 보고합니다.

## 보고 형식

성공 시:
```
✅ typecheck: 오류 없음
✅ lint: 경고/오류 없음
```

오류 발생 시:
```
❌ typecheck 오류:
[오류 내용 요약]

❌ lint 오류:
[규칙 위반 목록]
```
