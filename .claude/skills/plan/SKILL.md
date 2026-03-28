---
name: plan
description: 복잡한 기능 구현 전 아키텍처 설계 문서 작성 스킬. .claude/plans/에 저장하고 사용자 확인 후 구현 진행. 구현 시작 전 영향 범위 파악, IPC 채널 설계, 위험 요소 사전 식별이 필요할 때 사용. 트리거: "/plan", "설계 문서", "구현 계획", "아키텍처 설계", "기능 설계"
---

# /plan — 설계 문서 작성

구현 전 설계 문서를 작성하고 `.claude/plans/`에 저장합니다.

## 목적

- 복잡한 기능 구현 전 아키텍처 설계
- IPC 채널 및 서비스 레이어 사전 설계
- 영향 범위 파악 및 위험 요소 사전 식별
- 사용자 확인 후 구현 진행 (명시적 작업 원칙)

## 설계 문서 형식

다음 형식으로 `.claude/plans/{feature-name}.md` 파일을 생성합니다:

```markdown
# {기능명} 구현 계획

## 개요
- 목적:
- 영향 범위:
- 예상 복잡도: (낮음/중간/높음)

## 파일 변경 목록
| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| src/main/types/ipc-schema.ts | 수정 | IPC 타입 추가 |
| src/main/services/... | 신규 | 서비스 구현 |
| src/preload/index.ts | 수정 | API 노출 |
| src/renderer/... | 신규/수정 | UI/훅 구현 |

## IPC 채널 설계
| 채널명 | 방향 | 요청 타입 | 응답 타입 |
|--------|------|-----------|-----------|
| pdf.merge:start | R→M | MergeRequest | MergeResult |

## 구현 단계
1. IPC 타입 정의 (`src/main/types/ipc-schema.ts`)
2. 서비스 구현 + 테스트 (`src/main/services/`)
3. IPC 핸들러 등록 (`src/main/app/ipc-handler.ts`)
4. Preload API 노출 (`src/preload/index.ts`)
5. Zustand 스토어 (`src/renderer/shared/model/`)
6. 커스텀 훅 (`src/renderer/shared/hooks/` or `features/*/model/`)
7. UI 컴포넌트 (`src/renderer/features/` or `widgets/`)

## 위험 요소 및 의존성
- 기존 코드 영향:
- 주의 사항:

## 검증 방법
- [ ] pnpm typecheck 성공
- [ ] pnpm lint 경고/오류 없음
- [ ] pnpm test 통과
- [ ] 앱 동작 확인
```

## 사용법

```
/plan {기능명}
```

예시:
```
/plan pdf-병합-진행률-표시
/plan tiff-파일-변환
/plan 페이지-회전-기능
```

## 작업 절차

1. 요청 기능 분석 (관련 파일 탐색)
2. IPC 채널 및 서비스 레이어 설계
3. FSD 레이어별 구현 위치 결정
4. 단계별 구현 계획 수립
5. `.claude/plans/{feature-name}.md` 저장
6. 계획 요약 보고 → **사용자 확인 대기**
7. 승인 후 `/implement`로 구현 진행
