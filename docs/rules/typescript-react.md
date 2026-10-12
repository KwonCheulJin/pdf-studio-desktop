# TypeScript·React 규칙

언제 읽는가: `src/renderer` 아래 TS/TSX를 쓰거나 고칠 때.

포맷(따옴표·세미콜론·들여쓰기·후행 쉼표·괄호·줄 길이)은 Prettier(`.prettierrc`)가 정한다. `pnpm format`.

## 명명 규칙

- 파일/폴더: `kebab-case` | 컴포넌트/타입: `PascalCase` | 함수/훅/변수: `camelCase`
- 상수: `UPPER_SNAKE_CASE` | 서비스: `PdfMergeService` | Props: `DocumentCardProps`
- Hooks: `use` prefix | 핸들러: `handle` prefix | 콜백: `on` prefix | Boolean: `is`/`has` prefix
- 축약 금지: `col`→`column`, `num`→`number`, `btn`→`button`

**Import 순서**: React/외부 → `@/` alias → 상대 경로 (중복 import 금지)

## TypeScript

- `any` 금지, 인라인 객체 타입 금지 → 반드시 `interface`/`type` 명시 정의
- 매직 스트링/넘버 금지 → 상수 객체 + `as const` + `ValueOf<T>` (TS `enum` 금지)
- 유틸리티 함수 매개변수: 위치 기반 금지 → 객체 형식(Named Parameters) 필수
- 상수 위치: 도메인 상수는 슬라이스의 `config/`, 도메인과 무관한 상수만 `shared/config`. 디자인 토큰 이름은 `shared/config/theme.ts`

```typescript
export const STATUS = { IDLE: "idle", PENDING: "pending" } as const;
type ValueOf<T> = T[keyof T];
type Status = ValueOf<typeof STATUS>;
```

## React 19

- `forwardRef` 제거 → `ref`를 일반 prop으로 전달 / `Context.Provider` 제거 → `<ThemeContext value="dark">`
- 새 훅: `use()`(Promise/Context), `useActionState`(폼), `useOptimistic`(낙관적 UI)
- 상태 업데이트는 **이벤트 핸들러**에서 수행. `useEffect`는 **외부 시스템 동기화**에만 사용(DOM, 외부 라이브러리, Zustand, Tauri 이벤트 구독과 해제)
- `useEffect` 내 동기적 `setState` 금지 (cascading renders)
- props → state 초기화: `key prop` 리셋 또는 `useState(() => ...)` 초기값 패턴
- `useCallback`: 자식에 전달되는 함수 | `useMemo`: 데이터 변환/파생 계산
- `key={index}` 금지 → `key={item.id}` 또는 `crypto.randomUUID()`
- UI는 토큰 클래스만 쓴다. 팔레트 클래스(`bg-black/50`, `text-white`, `-500`)·임의값 금지

## 함수형 프로그래밍

- 객체/배열 직접 변경 금지 → 항상 새 객체/배열 생성
- `Object.fromEntries`, `map`, `filter`, `reduce` 사용
- 콜백 인자 축약 금지 (`i` → `item`, `v` → `value`)

## 코드 복잡도

ESLint로 강제하지 않으므로 리뷰에서 확인한다.

- Cognitive Complexity ≤ 15, 중첩 깊이 ≤ 4단계
- 중첩 삼항 금지 → `if-else` 또는 함수 분리
- `!condition ? A : B` 금지 → `condition ? B : A`
- `replace(/pattern/g)` → `replaceAll()` 사용

## 린트

- `eslint-disable` 남용 금지
