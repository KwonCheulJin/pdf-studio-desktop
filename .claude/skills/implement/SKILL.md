---
name: implement
description: 설계 문서(.claude/plans/) 기반 단계별 구현 진행 스킬. ipc-architect, logic-expert, ui-publisher 에이전트를 작업 유형에 따라 활용. 트리거: "/implement", "구현 시작", "개발 진행", "설계 기반 구현", "단계별 구현"
---

# /implement — 설계 기반 단계별 구현

`.claude/plans/`의 설계 문서를 기반으로 단계별 구현을 진행합니다.

## 목적

- 설계 문서에 정의된 단계를 순차적으로 구현
- 각 단계 완료 후 타입 체크 검증
- 예상치 못한 문제 발생 시 사용자에게 보고 후 대기

## 사용법

```
/implement {기능명}
```

설계 문서 없이 직접 구현:
```
/implement {기능명} --no-plan
```

## 구현 원칙

### 명시적 단계 진행

각 단계 완료 시 보고:
```
✅ 1단계 완료: IPC 타입 정의 (src/main/types/ipc-schema.ts)
→ 2단계 진행: 서비스 구현
```

### 에이전트 활용

| 작업 | 에이전트 |
|------|---------|
| IPC/서비스/스토어 | ipc-architect |
| 비즈니스 로직/훅 | logic-expert |
| UI 컴포넌트 | ui-publisher |

### 단계별 검증

각 주요 단계 후 `pnpm typecheck`로 타입 오류 조기 발견

### 범위 준수

**금지**:
- 요청 범위 외 코드 수정
- 미래를 위한 추상화 추가
- 요청하지 않은 리팩토링

### TDD 준수

`src/main/services/`, `src/renderer/shared/lib/` 구현 시:
1. 테스트 먼저 작성 (`__tests__/` 디렉토리)
2. 테스트 통과하는 최소 구현
3. 리팩토링

## 작업 절차

1. `.claude/plans/{기능명}.md` 확인
2. 설계된 단계 순서대로 구현
3. 단계별 진행 상황 보고
4. 완료 후 `/check`로 최종 검증
5. 변경 사항 요약 보고

## 완료 보고 형식

```
## 구현 완료: {기능명}

### 변경 파일
- src/main/types/ipc-schema.ts (수정)
- src/main/services/... (신규)
- src/preload/index.ts (수정)
- src/renderer/... (신규/수정)

### 검증 결과
- ✅ pnpm typecheck 성공
- ✅ pnpm lint 경고 없음
- ✅ pnpm test 통과

### 사용자 확인 필요
- 앱에서 {기능} 동작 확인
```
