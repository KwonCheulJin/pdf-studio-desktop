---
name: code-review
description: code-reviewer 에이전트를 통해 코드 품질과 아키텍처를 검사하는 스킬. FSD 레이어 경계 검증, IPC 패턴 검사, 코드 품질 이슈 식별. 특정 파일/디렉토리 경로를 지정하거나 인자 없이 현재 브랜치 변경 파일 자동 감지. 트리거: "/code-review", "/review", "코드 리뷰", "PR 전 검토", "코드 품질 검사"
---

# /code-review — 코드 리뷰

code-reviewer 에이전트를 통해 코드 품질과 아키텍처를 검사합니다.

## 목적

- PR 전 코드 품질 사전 검증
- FSD 레이어 경계 위반 감지
- IPC 패턴 준수 검증
- 타입 안전성 이슈 식별

## 사용법

```
/code-review {파일 또는 디렉토리 경로}
```

예시:
```
/code-review src/renderer/features/pdf-merge/
/code-review src/main/services/pdf-merge-service.ts
/code-review src/renderer/shared/hooks/
```

인자 없이 실행 시 현재 브랜치 변경 파일 자동 감지:
```
/code-review
```

## 분석 항목

### 아키텍처 검사
- FSD 레이어 경계 (entities/features/widgets/pages 역할 분리)
- IPC 패턴 준수 (Renderer → window.api → Preload → Main)
- 서비스/훅 레이어 분리 여부

### 코드 품질
- 매직 스트링/넘버 사용 여부
- 인라인 객체 타입 사용 여부
- 위치 기반 매개변수 사용 여부
- 미사용 변수/import
- `console.log` 잔존 여부

### TypeScript
- `any` 타입 남용
- 직접 변이(mutation) 패턴

## 보고서 형식

```
🔴 Critical (즉시 수정)
🟡 Important (수정 권장)
🟢 Enhancement (선택적)
```

## 작업 절차

1. 대상 파일/디렉토리 탐색
2. code-reviewer 에이전트로 분석 위임
3. 우선순위별 이슈 보고
4. 수정 필요 시 → `/implement` 또는 logic-expert 에이전트 안내
