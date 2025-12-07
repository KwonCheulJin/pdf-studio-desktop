# AGENTS.md

This file provides guidance to CODEX when working with code in this repository.

## 응답 언어 규칙

**응답 언어**: 한글로만 작성

## 프로젝트 개요

PDF Studio Desktop은 PDF 조작(병합, 편집, TIFF 변환)을 위한 Electron 기반 데스크톱 애플리케이션입니다.

**기술 스택**: Electron Forge + Vite + React 19 + TypeScript + Tailwind CSS 4

## 개발 명령어

```bash
pnpm start          # 개발 서버 시작 (hot reload)
pnpm run package    # 배포용 패키징
pnpm run make       # 설치 파일 생성
```

## 아키텍처

### 프로세스 모델 (Electron)

- **Main Process** (`src/main/`): 비즈니스 로직, 파일 I/O, PDF 작업
- **Preload** (`src/preload/`): ContextBridge API 노출 (`window.api`)
- **Renderer** (`src/renderer/`): React UI (FSD 아키텍처)

### 목표 폴더 구조

```
src/
├─ main/
│  ├─ app/
│  │  ├─ main.ts              # 앱 진입점, BrowserWindow
│  │  └─ ipc-handler.ts       # IPC 라우팅
│  ├─ services/
│  │  ├─ pdf-merge-service.ts
│  │  ├─ pdf-edit-service.ts
│  │  └─ file-converter-service.ts
│  ├─ workers/                # CPU 집약적 작업
│  └─ types/
│     └─ ipc-schema.ts        # 공유 IPC 타입
├─ preload/
│  └─ index.ts                # window.api 정의
└─ renderer/                  # React FSD 구조
   ├─ app/
   │  ├─ providers/
   │  └─ layout/
   ├─ shared/                 # 공통 유틸, UI, 타입
   ├─ entities/               # READ 전용 (데이터 표시)
   ├─ features/               # CUD 작업
   ├─ widgets/                # 조합된 워크스페이스
   └─ pages/
```

### FSD 레이어 역할

| 레이어     | 역할                             | IPC 방향 |
| ---------- | -------------------------------- | -------- |
| `entities` | 데이터 표시 (썸네일, 메타데이터) | READ     |
| `features` | 사용자 액션 (병합, 편집, 변환)   | CUD      |
| `widgets`  | Feature 조합                     | -        |

### IPC 채널 패턴

```
scope.action:detail
```

예시:

- `pdf.merge:start` - 병합 시작 (R → M)
- `pdf.merge:progress` - 진행률 이벤트 (M → R)
- `pdf.edit:apply` - 편집 적용 (R → M)
- `file.convert.tiff` - TIFF → PDF 변환 (R → M)

### 핵심 라이브러리

| 작업          | 라이브러리          | 프로세스 |
| ------------- | ------------------- | -------- |
| PDF 조작      | `pdf-lib`           | Worker   |
| TIFF 디코딩   | `sharp` / `libvips` | Worker   |
| 썸네일 렌더링 | `pdf.js`            | Renderer |
| 파일 I/O      | `fs-extra`          | Worker   |

### IPC 타입 참조

```typescript
// 핵심 요청/응답 타입 (src/main/types/ipc-schema.ts)
interface FilePayload {
  path: string;
  pages?: number[]
}

interface MergeRequest {
  files: FilePayload[];
  outputPath?: string;
}
interface MergeResult {
  outputPath: string;
  totalPages: number;
}
interface MergeProgress {
  current: number;
  total: number;
  percentage: number;
}
interface EditPageRequest {
  filePath: string;
  operations: PageOperation[];
}
interface ConvertTiffRequest {
  tiffPath: string;
  outputDir?: string;
}
```

## UI 컴포넌트 구조

shadcn/ui 기반. 메인 레이아웃:

```
AppShell
├─ AppToolbar (Add Files, Combine, Options)
├─ MainWorkspace
│  ├─ MergeWorkspace (DnD 파일 그리드)
│  └─ PageEditWorkspace (페이지 썸네일)
└─ AppStatusBar (파일 수, 페이지 수, 진행률)
```

## 필수 개발 규칙

### 0. 명시적 작업만 수행 - 매우 중요

**사용자가 명시적으로 요청하지 않은 작업은 수행하지 마세요.**

항상 다음을 따르세요: **계획 → 사용자 확인 → 실행 → 보고**

- `pnpm build`, `pnpm typecheck`, `pnpm dev` 자동 실행 금지
- 요청된 것 이상의 기능 추가 금지
- 명시적 요청 없이 커밋 금지
- 요청 없이 코드 리팩토링 금지

### 1. YAGNI 원칙 (필수!)

**YAGNI = "You Ain't Gonna Need It"** - 미래를 위해 사용되지 않는 코드를 추가하지 마세요.

**현재 필요한 것만 구현하세요.**

**피해야 할 안티패턴:**

1. **과도한 타입 정의**: 한 곳에서만 사용되는 복잡한 제네릭 → 필요할 때 추가
2. **불필요한 스코프 확대**: 로컬 상태를 전역(Zustand)에 저장 → 단일 컴포넌트는 `useState` 사용
3. **과도한 추상화**: 재사용 불가능한 코드에 훅 생성 → Rule of 3: 3번 이상 사용 시만 추상화
4. **조기 최적화**: 모든 곳에 `useCallback`/`useMemo` 사용 → 필요할 때만 최적화
5. **과도한 에러 처리**: 불가능한 상황에 대한 방어 코드 → 실제 에러만 처리

### KISS 원칙 (필수!)

**Keep It Simple, Stupid** - 단순함을 기본값으로 유지하세요.

- 요구사항에 바로 대응하는 최소 구현을 선택하고 불필요한 옵션/설정을 덜어내세요.
- 네이밍은 역할과 데이터 흐름이 즉시 드러나도록 짧고 명확하게 작성하며 약어 남용을 피하세요.
- 분기와 상태는 최소화하고 동일한 조건 계산을 여러 곳에 중복하지 마세요.
- UI 흐름은 한 번에 한 단계만 집중하도록 구성하고 복잡한 모달/폼은 단계 분리 후 결합하세요.
- 외부 의존성 추가 전 기본 도구와 표준 라이브러리로 해결 가능한지 먼저 검토하세요.

### 2. 빌드 & 타입 검사 규칙

- `yarn build`: 사용자가 "build" 또는 "type check" 명시적 요청 시만 실행
- `yarn dev`: 사용자가 직접 실행 (자동 실행 금지)
- 코드 변경 후 자동 빌드/타입체크 금지

### 3. Hook 명명 규칙

유사한 훅이 있으면 기존 훅을 수정하지 말고 새 훅을 만드세요.

**예:** `useBom()`, `useBomDetail()`, `useBomForm()`

### 4. React 19 핵심 규칙

#### React 19 주요 변경사항

**forwardRef 제거**: React 19에서 `forwardRef` 불필요. `ref`를 일반 prop으로 전달

```typescript
// ❌ React 18 (forwardRef 사용)
const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => (
  <input ref={ref} {...props} />
));

// ✅ React 19 (ref를 일반 prop으로)
interface InputProps {
  ref?: React.Ref<HTMLInputElement>;
  // ... other props
}
function Input({ ref, ...props }: InputProps) {
  return <input ref={ref} {...props} />;
}
```

**use() 훅**: Promise와 Context를 직접 읽기

```typescript
// ✅ React 19: use()로 Promise 읽기 (Suspense 필요)
import { use } from 'react';

function Comments({ commentsPromise }: { commentsPromise: Promise<Comment[]> }) {
  const comments = use(commentsPromise); // Suspense가 처리
  return comments.map(c => <p key={c.id}>{c.text}</p>);
}

// ✅ React 19: use()로 Context 읽기 (조건부 가능)
function ThemeText({ show }: { show: boolean }) {
  if (show) {
    const theme = use(ThemeContext); // 조건부 호출 가능
    return <span className={theme}>{theme}</span>;
  }
  return null;
}
```

**useActionState**: 폼 액션 상태 관리 (useFormState 대체)

```typescript
// ✅ React 19: useActionState
import { useActionState } from 'react';

function Form() {
  const [state, submitAction, isPending] = useActionState(
    async (prevState, formData) => {
      const result = await saveData(formData);
      return result;
    },
    null
  );

  return (
    <form action={submitAction}>
      <input name="title" disabled={isPending} />
      <button disabled={isPending}>{isPending ? '저장 중...' : '저장'}</button>
      {state?.error && <p>{state.error}</p>}
    </form>
  );
}
```

**useOptimistic**: 낙관적 UI 업데이트

```typescript
// ✅ React 19: useOptimistic
import { useOptimistic } from 'react';

function MessageList({ messages }: { messages: Message[] }) {
  const [optimisticMessages, addOptimistic] = useOptimistic(
    messages,
    (state, newMessage: string) => [
      ...state,
      { id: 'temp', text: newMessage, sending: true }
    ]
  );

  async function sendMessage(formData: FormData) {
    const text = formData.get('text') as string;
    addOptimistic(text); // 즉시 UI 업데이트
    await saveMessage(text); // 서버 저장
  }

  return (
    <form action={sendMessage}>
      {optimisticMessages.map(msg => (
        <div key={msg.id} style={{ opacity: msg.sending ? 0.5 : 1 }}>
          {msg.text}
        </div>
      ))}
      <input name="text" />
    </form>
  );
}
```

**ref 콜백 cleanup**: ref 콜백에서 cleanup 함수 반환 가능

```typescript
// ✅ React 19: ref cleanup
function Component() {
  return (
    <input
      ref={(el) => {
        if (el) {
          el.focus();
        }
        // cleanup 함수 반환
        return () => {
          console.log('element removed');
        };
      }}
    />
  );
}
```

**Context as Provider**: `Context.Provider` 대신 `Context` 직접 사용

```typescript
// ❌ React 18
const ThemeContext = createContext('light');
<ThemeContext.Provider value="dark">...</ThemeContext.Provider>

// ✅ React 19
const ThemeContext = createContext('light');
<ThemeContext value="dark">...</ThemeContext>
```

#### 기존 Hook 규칙 (여전히 유효)

**useCallback**:

- 이벤트 핸들러 및 자식 컴포넌트에 전달되는 함수에 사용
- 함수 참조를 안정화시키는 목적

**useMemo**:

- 데이터 변환 (`filter`, `map`, `sort`)
- 파생 데이터 계산에 사용

**상태 업데이트**:

- ❌ 금지: 직접 변경 (`obj.key = val`)
- ✅ 필수: 새 객체/Set 생성 (`setSelected(prev => new Set(prev))`)

**useEffect 규칙**:

- 이펙트에서 사용되는 모든 변수/함수 의존성 배열에 나열 필수
- ⚠️ 렌더링 중 상태 업데이트 금지 (에러 발생)
- ⚠️ **useEffect 내에서 동기적 setState 호출 금지** (cascading renders 발생)

**useEffect 용도** (React 공식 문서 기준):

1. 외부 시스템과 React 상태 동기화 (DOM 수동 조작, 외부 라이브러리 등)
2. 외부 시스템 구독 후 콜백에서 setState 호출

```typescript
// ❌ 금지: 렌더링 중 상태 업데이트
export const usePresetList = () => {
  const { setPresets } = usePresetStore();
  const query = useQuery({...});

  if (query.data) {
    setPresets(query.data);  // "Cannot update a component while rendering" 에러
  }
};

// ✅ 허용: useEffect로 외부 스토어 동기화 (외부 시스템 동기화 목적)
export const usePresetList = () => {
  const { setPresets } = usePresetStore();
  const query = useQuery({...});

  useEffect(() => {
    if (query.data) {
      setPresets(query.data);
    }
  }, [query.data, setPresets]);
};
```

**props → 로컬 상태 초기화 패턴**:

```typescript
// ❌ 금지: useEffect에서 props로 setState (cascading renders)
const [form, setForm] = useState({ name: '' });
useEffect(() => {
  if (entity) {
    setForm({ name: entity.name }); // ESLint 에러: set-state-in-effect
  }
}, [entity]);

// ✅ 방법 1: useState 초기값으로 설정 (권장)
const [form, setForm] = useState(() => ({
  name: entity?.name ?? '',
}));

// ✅ 방법 2: key prop으로 컴포넌트 리셋 (권장)
<MyModal key={entity?.id} entity={entity} />; // entity 변경 시 컴포넌트 재생성

// ✅ 방법 3: 파생 상태 (상태 없이 props에서 직접 계산)
const formValue = useMemo(
  () => ({
    name: entity?.name ?? '',
  }),
  [entity]
);

// ✅ 방법 4: 렌더링 중 상태 조정 (React 공식 패턴)
const [prevEntityId, setPrevEntityId] = useState<number | null>(null);
const [form, setForm] = useState({ name: '' });

if (entity && entity.id !== prevEntityId) {
  setPrevEntityId(entity.id);
  setForm({ name: entity.name }); // 렌더링 중 조건부 setState (허용)
}
```

**규칙 요약**:

- React 19: `forwardRef` 제거, `ref`를 일반 prop으로 전달
- React 19: `use()`, `useActionState`, `useOptimistic` 새 훅 활용
- React 19: `Context`를 Provider 없이 직접 사용
- 상태 업데이트는 **이벤트 핸들러**에서 수행
- useEffect는 **외부 시스템 동기화**에만 사용 (DOM, 외부 라이브러리, Zustand 스토어 등)
- props → state 초기화는 **key prop** 또는 **렌더링 중 조정** 패턴 사용

### 5. 함수형 프로그래밍 원칙 (필수!)

**`const`는 재할당만 방지, 객체 변경은 방지하지 않습니다** → 항상 새 객체/배열 생성

```typescript
// ❌ 금지: const + forEach + 변경
const map = {};
items.forEach(i => (map[i.id] = i.name));

// ✅ 필수: 함수형 패턴
const map = Object.fromEntries(items.map(item => [item.id, item.name]));
const filtered = items.filter(item => item.active);
const sorted = [...array].sort((a, b) => a.sort - b.sort);
```

- 함수형 패턴 내의 콜백 arg 축약 금지

## 개발 패턴 & 규칙

### 코딩 표준

**아키텍처**: Feature-Sliced Design (FSD)

**코드 스타일 (Prettier + ESLint)**:

| 규칙 | 설정 | 예시 |
|------|------|------|
| 따옴표 | 큰따옴표 (`"`) | `"hello"`, `import { foo } from "bar"` |
| 세미콜론 | 필수 | `const x = 1;` |
| 들여쓰기 | 2칸 스페이스 | - |
| 후행 쉼표 | 없음 | `{ a: 1, b: 2 }` (마지막에 쉼표 없음) |
| 화살표 함수 괄호 | 항상 | `(x) => x * 2` |
| 줄 길이 | 80자 | - |

```typescript
// ✅ 올바른 스타일
import { useState } from "react";

const handleClick = (event) => {
  console.log("clicked");
};

// ❌ 잘못된 스타일
import { useState } from 'react';  // 작은따옴표 금지

const handleClick = event => {     // 괄호 필수
  console.log('clicked')           // 세미콜론 필수
};
```

**린트/포맷 명령어**:
```bash
pnpm lint          # ESLint 검사
pnpm lint:fix      # ESLint 자동 수정
pnpm format        # Prettier 포맷팅
pnpm format:check  # Prettier 검사만
```

**언어 & 스크립트**:

- TypeScript ^5 필수 (프로젝트 설정 파일 제외)
- 앱 코드는 JavaScript 금지

**명명 규칙**:

| 요소            | 컨벤션               | 예시                                        |
| --------------- | -------------------- | ------------------------------------------- |
| 폴더 & 파일     | kebab-case           | `pdf-merge-service.ts`, `document-card.tsx` |
| React 컴포넌트  | PascalCase           | `MergeWorkspace`, `DocumentCard`            |
| 함수/훅/변수    | camelCase            | `useMergeCommand`, `handleFileDrop`         |
| 타입/인터페이스 | PascalCase           | `MergeRequest`, `PdfDocument`               |
| IPC 채널        | scope.action:detail  | `pdf.merge:start`, `file.convert.tiff`      |
| 서비스 클래스   | PascalCase + Service | `PdfMergeService`                           |
| 워커 파일       | kebab-case + worker  | `merge-worker.ts`                           |
| 상수            | UPPER_SNAKE_CASE     | `MAX_RETRY_COUNT`                           |

**Prefix/Suffix 컨벤션**:

- Hooks: `use` prefix (`useMergeCommand`)
- 이벤트 핸들러: `handle` prefix (`handleFileDrop`)
- 콜백: `on` prefix (`onMergeComplete`)
- Boolean: `is`/`has` prefix (`isLoading`)
- Services: `Service` suffix (`PdfMergeService`)
- Props 타입: `Props` suffix (`DocumentCardProps`)

### 타입 정의 규칙 (필수!)

**인라인 객체 타입 금지** - 항상 명시적 타입/인터페이스 정의 후 사용:

```typescript
// ❌ 금지: 인라인 객체 타입
function process(data: { id: string; name: string; status: 'active' | 'inactive' }) {}

// ✅ 필수: 명시적 타입 정의
interface ProcessData {
  id: string;
  name: string;
  status: 'active' | 'inactive';
}
function process(data: ProcessData) {}
```

**매직 스트링/넘버 금지** - 상수 객체 + `ValueOf<T>` 유틸리티 타입 사용:

```typescript
// ❌ 금지: 매직 스트링/넘버
const status = 'pending';
const maxRetry = 3;

// ✅ 필수: 상수 객체 정의
export const MERGE_STATUS = {
  IDLE: 'idle',
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETE: 'complete',
  ERROR: 'error',
} as const;

export const CONFIG = {
  MAX_RETRY_COUNT: 3,
  CHUNK_SIZE: 1024,
  TIMEOUT_MS: 5000,
} as const;

// ValueOf 유틸리티 타입으로 유니온 타입 생성
type ValueOf<T> = T[keyof T];
type MergeStatus = ValueOf<typeof MERGE_STATUS>; // 'idle' | 'pending' | 'processing' | 'complete' | 'error'

// 사용 예시
const status: MergeStatus = MERGE_STATUS.PENDING;
```

**상수 객체 위치**: `src/renderer/shared/constants/` 또는 해당 feature 폴더 내 `constants.ts`

### 유틸리티 함수 매개변수 규칙 (필수!)

**위치 기반 매개변수 금지** - 항상 객체 형식(Named Parameters)으로 받기:

```typescript
// ❌ 금지: 위치 기반 매개변수
function calculatePosition(x: number, y: number, offset: number): Position;

// ✅ 필수: 객체 형식 매개변수
interface CalculatePositionParams {
  x: number;
  y: number;
  offset: number;
}
function calculatePosition({ x, y, offset }: CalculatePositionParams): Position;
```

**장점**:
- 호출 시 매개변수 의미가 명확함
- 매개변수 순서 변경에 안전
- 선택적 매개변수 추가가 용이

### 컴포넌트 & 스타일링

**UI 기반**:

- Radix UI (접근 가능한 컴포넌트 프리미티브)
- TailwindCSS 4 (유틸리티 우선 접근)
- Lucide React (아이콘)
- Sonner (토스트 알림)

**Tailwind 클래스 순서**: 레이아웃 → 크기 → 간격 → 배경 → 테두리 → 타이포그래피 → 효과

예: `className="flex items-center w-full px-4 bg-white border rounded-lg text-sm hover:shadow-lg"`

**반응형 & 다크 모드**:

- 모바일 우선 접근
- 반응형 지점: `sm(640px)`, `md(768px)`, `lg(1024px)`, `xl(1280px)`, `2xl(1536px)`
- 다크 모드: `dark:` 접두사 필수

## 테스트

### TDD 필수 규칙 (핵심 로직)

**핵심 로직 함수는 반드시 TDD로 개발**:
1. 테스트 먼저 작성 (Red)
2. 테스트 통과하는 최소 구현 (Green)
3. 리팩토링 (Refactor)

**TDD 대상 (필수)**:
- `src/main/services/` - PDF 병합, 편집, 변환 서비스
- `src/main/workers/` - CPU 집약적 작업 로직
- `src/renderer/shared/lib/` - 유틸리티 함수
- `src/renderer/**/model/` - 비즈니스 로직 훅 내 순수 함수

**TDD 제외 (UI 테스트 불필요)**:
- React 컴포넌트 (`*.tsx`)
- 스타일링 관련 코드
- IPC 핸들러 (통합 테스트로 대체 가능)

### TDD 워크플로우

```typescript
// 1. 테스트 먼저 작성 (src/main/services/__tests__/pdf-merge-service.test.ts)
import { describe, it, expect } from 'vitest';
import { mergePdfBuffers } from '../pdf-merge-service';

describe('mergePdfBuffers', () => {
  it('두 PDF 버퍼를 병합하여 하나의 버퍼 반환', async () => {
    const pdf1 = await loadTestPdf('sample1.pdf');
    const pdf2 = await loadTestPdf('sample2.pdf');

    const result = await mergePdfBuffers([pdf1, pdf2]);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('빈 배열 입력 시 에러 발생', async () => {
    await expect(mergePdfBuffers([])).rejects.toThrow('No PDF files provided');
  });
});

// 2. 테스트 실행 → 실패 확인 (Red)
// pnpm test

// 3. 최소 구현 작성 (src/main/services/pdf-merge-service.ts)
export async function mergePdfBuffers(buffers: Uint8Array[]): Promise<Uint8Array> {
  if (buffers.length === 0) {
    throw new Error('No PDF files provided');
  }
  // 구현...
}

// 4. 테스트 실행 → 통과 확인 (Green)
// 5. 리팩토링 (Refactor)
```

### 테스트 파일 위치

```
src/
├─ main/
│  └─ services/
│     ├─ pdf-merge-service.ts
│     └─ __tests__/
│        └─ pdf-merge-service.test.ts
├─ renderer/
│  └─ shared/
│     └─ lib/
│        ├─ utils.ts
│        └─ __tests__/
│           └─ utils.test.ts
```

### 테스트 도구

- **Vitest** - 단위 테스트 프레임워크

## 빠른 참조

⚠️ **YAGNI** - 사용되지 않는 코드 금지 | **명시적 작업** - 사용자 요청만 | **빌드** - 요청 시만

⚠️ **KISS** - 요구사항 직결 최소 구현, 단순한 흐름 유지

⚠️ **코드 스타일** - 큰따옴표(`"`), 세미콜론 필수, 후행 쉼표 없음, 화살표 함수 괄호 필수

⚠️ **Import** - `@/` 별칭, `import type { }` | **TypeScript** - `any` 금지, 인라인 객체 타입 금지, 명시적 타입

⚠️ **상수** - 매직 스트링/넘버 금지, 상수 객체 + `as const` + `ValueOf<T>` 사용

⚠️ **유틸리티 함수** - 위치 기반 매개변수 금지, 객체 형식(Named Parameters) 필수

⚠️ **React 19** - `forwardRef` 제거 (ref는 일반 prop) | `use()` (Promise/Context) | `useActionState` (폼) | `useOptimistic` (낙관적 UI)

⚠️ **React Hooks** - `useCallback` (함수 props) | `useMemo` (데이터 변환) | `useEffect` (외부 시스템 동기화만)

⚠️ **함수형** - `const` 객체 변경 금지, `Object.fromEntries/map/reduce` 사용

⚠️ **패키지 매니저** - `pnpm` 필수 (npm/yarn 금지)

⚠️ **TDD** - 핵심 로직(services, workers, lib, model 순수함수)은 테스트 먼저 작성 | UI 테스트 불필요
