---
name: no-magic-values
description: 상수 객체, as const, ValueOf<T> 패턴을 강제하는 스킬. 매직 스트링/넘버 제거, 타입 유니온을 상수에서 파생하는 패턴 적용. 트리거: "상수 정의", "매직 스트링", "매직 넘버", "상수 객체", "ValueOf", "as const"
---

# No Magic Values

## 개요

매직 스트링과 매직 넘버를 금지하는 스킬입니다. 모든 리터럴 값은 `as const` 상수 객체로 정의하고, `ValueOf<T>` 유틸리티 타입으로 유니온 타입을 파생합니다.

## 핵심 규칙

### Rule 1: 직접 유니온 타입 금지

```typescript
// ❌ 금지
type MergeStatus = "idle" | "processing" | "complete" | "error";

// ✅ 필수
export const MERGE_STATUS = {
  IDLE: "idle",
  PROCESSING: "processing",
  COMPLETE: "complete",
  ERROR: "error",
} as const;

type ValueOf<T> = T[keyof T];
export type MergeStatus = ValueOf<typeof MERGE_STATUS>;
```

### Rule 2: 코드에서 상수 참조

```typescript
// ❌ 금지
if (status === "processing") { ... }
setStatus("complete");

// ✅ 필수
import { MERGE_STATUS } from "@/renderer/shared/constants/merge";

if (status === MERGE_STATUS.PROCESSING) { ... }
setStatus(MERGE_STATUS.COMPLETE);
```

### Rule 3: TypeScript enum 금지 (const 객체 사용)

```typescript
// ❌ 금지
enum PageRotation { DEG_0 = 0, DEG_90 = 90 }

// ✅ 필수
export const PAGE_ROTATION = {
  DEG_0: 0,
  DEG_90: 90,
  DEG_180: 180,
  DEG_270: 270,
} as const;
```

## 상수 위치 규칙

| 용도 | 위치 |
|------|------|
| IPC 채널/상태 관련 | `src/main/types/ipc-schema.ts` |
| Renderer 공통 상수 | `src/renderer/shared/constants/` |
| Feature 전용 상수 | `src/renderer/features/{domain}/constants.ts` |

## 명명 규칙

```typescript
// 상수 객체: UPPER_SNAKE_CASE
export const MERGE_STATUS = { ... } as const;
export const ROTATION_DEGREES = { ... } as const;

// 파생 타입: PascalCase
export type MergeStatus = ValueOf<typeof MERGE_STATUS>;
export type RotationDegrees = ValueOf<typeof ROTATION_DEGREES>;
```

## 프로젝트 내 실제 패턴

```typescript
// src/main/types/ipc-schema.ts
export const ROTATION_DEGREES = {
  CW_90: 90,
  CW_180: 180,
  CW_270: 270,
} as const;

export type RotationDegrees = ValueOf<typeof ROTATION_DEGREES>;

// src/renderer/shared/constants/page-state.ts
export const PAGE_ROTATION = {
  DEG_0: 0,
  DEG_90: 90,
  DEG_180: 180,
  DEG_270: 270,
} as const;

export const SELECTION_TYPE = {
  PAGE: "page",
  FILE: "file",
} as const;
```

## 체크리스트

- [ ] 모든 유니온 타입이 상수 객체에서 파생됨
- [ ] 상수 객체에 `as const` 사용
- [ ] 타입명에 `ValueOf<typeof CONST>` 사용
- [ ] 코드에서 리터럴 직접 비교 없음
- [ ] 상수가 올바른 위치에 정의됨
