# CLAUDE.md

**응답 언어**: 한글로만 작성

## 프로젝트 개요

PDF Studio Desktop — PDF 조작(병합, 편집, TIFF 변환) Electron 데스크톱 앱
**기술 스택**: Electron Forge + Vite + React 19 + TypeScript + Tailwind CSS 4 + pnpm

```bash
pnpm start          # 개발 서버 (hot reload)
pnpm lint / lint:fix / format / format:check
```

## 아키텍처

**Electron 프로세스**:
- `src/main/` — 비즈니스 로직, 파일 I/O (services/, workers/, types/ipc-schema.ts)
- `src/preload/` — ContextBridge (`window.api`)
- `src/renderer/` — React FSD (app/ shared/ entities/ features/ widgets/ pages/)

**FSD 레이어**: `entities`(READ 표시) → `features`(CUD 액션) → `widgets`(조합)

**IPC 채널 패턴**: `scope.action:detail` (예: `pdf.merge:start`, `pdf.merge:progress`)

**핵심 라이브러리**: `pdf-lib`(Worker), `sharp`(Worker), `pdf.js`(Renderer), `fs-extra`(Worker)

## 필수 개발 원칙

### 명시적 작업만 수행 (최우선)
- 사용자 요청 외 작업 금지: 빌드 자동 실행, 기능 추가, 리팩토링, 커밋 금지
- 흐름: **계획 → 사용자 확인 → 실행 → 보고**

### YAGNI + KISS
- 현재 필요한 것만 구현 (미래 코드 금지)
- Rule of 3: 3번 이상 사용 시만 추상화
- 단일 컴포넌트 상태는 `useState`, 전역 확대 금지
- 조기 최적화 금지 (`useCallback`/`useMemo`는 필요 시만)

## 코딩 표준

**코드 스타일**: 큰따옴표 `"`, 세미콜론 필수, 들여쓰기 2칸, 후행 쉼표 없음, 화살표 함수 괄호 항상, 80자 제한

**명명 규칙**:
- 파일/폴더: `kebab-case` | 컴포넌트/타입: `PascalCase` | 함수/훅/변수: `camelCase`
- 상수: `UPPER_SNAKE_CASE` | 서비스: `PdfMergeService` | Props: `DocumentCardProps`
- Hooks: `use` prefix | 핸들러: `handle` prefix | 콜백: `on` prefix | Boolean: `is`/`has` prefix
- 축약 금지: `col`→`column`, `num`→`number`, `btn`→`button`

**Import 순서**: React/외부 → `@/` alias → 상대 경로 (중복 import 금지)

## TypeScript 규칙

- `any` 금지, 인라인 객체 타입 금지 → 반드시 `interface`/`type` 명시 정의
- 매직 스트링/넘버 금지 → 상수 객체 + `as const` + `ValueOf<T>` 사용
- 유틸리티 함수 매개변수: 위치 기반 금지 → 객체 형식(Named Parameters) 필수
- 상수 위치: `src/renderer/shared/constants/` 또는 feature 내 `constants.ts`

```typescript
export const STATUS = { IDLE: "idle", PENDING: "pending" } as const;
type ValueOf<T> = T[keyof T];
type Status = ValueOf<typeof STATUS>;
```

## React 19 규칙

- `forwardRef` 제거 → `ref`를 일반 prop으로 전달
- `Context.Provider` 제거 → `<ThemeContext value="dark">` 직접 사용
- 새 훅: `use()`(Promise/Context), `useActionState`(폼), `useOptimistic`(낙관적 UI)
- 상태 업데이트는 **이벤트 핸들러**에서 수행
- `useEffect`는 **외부 시스템 동기화**에만 사용 (DOM, 외부 라이브러리, Zustand)
- `useEffect` 내 동기적 `setState` 금지 (cascading renders)
- props → state 초기화: `key prop` 리셋 또는 `useState(() => ...)` 초기값 패턴
- `useCallback`: 자식에 전달되는 함수 | `useMemo`: 데이터 변환/파생 계산
- `key={index}` 금지 → `key={item.id}` 또는 `crypto.randomUUID()`

## 함수형 프로그래밍

- 객체/배열 직접 변경 금지 → 항상 새 객체/배열 생성
- `Object.fromEntries`, `map`, `filter`, `reduce` 사용
- 콜백 인자 축약 금지 (`i` → `item`, `v` → `value`)

## 코드 복잡도

- Cognitive Complexity ≤ 15, 중첩 깊이 ≤ 4단계
- 중첩 삼항 금지 → `if-else` 또는 함수 분리
- `!condition ? A : B` 금지 → `condition ? B : A`
- `replace(/pattern/g)` → `replaceAll()` 사용

## 테스트 (TDD)

**TDD 대상**: `src/main/services/`, `src/main/workers/`, `src/renderer/shared/lib/`, `**/model/` 순수함수
**TDD 제외**: React 컴포넌트(`*.tsx`), 스타일링, IPC 핸들러
**도구**: Vitest | **테스트 위치**: 대상 파일과 동일 폴더 `__tests__/` 디렉토리

## Git & 코드 품질

- 자동 커밋 금지 — 반드시 사용자 검토 후 커밋
- `Co-Authored-By: Claude` 등 **AI 기여자 표시 절대 금지**
- 작업 완료 후 제거: `console.log`, 미사용 변수/import, 주석 처리된 코드
- `eslint-disable` 남용 금지

## 컨텍스트 최적화

- 코드베이스 탐색은 서브 에이전트 사용
- `node_modules/`, `dist/`, `build/`, `coverage/` 파일 로드 금지
- 이미 읽은 파일 재독 금지
