# 🧾 네이밍 컨벤션 가이드

일관성 있고 예측 가능한 코드베이스를 위한 네이밍 규칙입니다.

## 요약 테이블

| 요소            | 컨벤션                     | 예시                                        |
| --------------- | -------------------------- | ------------------------------------------- |
| 폴더 & 파일     | **kebab-case**             | `pdf-merge-service.ts`, `document-card.tsx` |
| React 컴포넌트  | **PascalCase**             | `MergeWorkspace`, `DocumentCard`            |
| 함수/훅/변수    | **camelCase**              | `useMergeCommand`, `handleFileDrop`         |
| 타입/인터페이스 | **PascalCase**             | `MergeRequest`, `PdfDocument`               |
| IPC 채널        | **scope.action:detail**    | `pdf.merge:start`, `file.convert.tiff`      |
| 메인 서비스     | **PascalCase + Service**   | `PdfMergeService`                           |
| 워커 파일       | **kebab-case + worker.ts** | `merge-worker.ts`                           |

---

## 상세 규칙

### 1. 폴더 & 파일

```
✅ 올바른 예시
pdf-merge-service.ts
document-card.tsx
use-merge-command.ts
ipc-schema.ts

❌ 잘못된 예시
PdfMergeService.ts
documentCard.tsx
useMergeCommand.ts
```

**규칙:**

- 모든 폴더와 파일명은 **kebab-case** 사용
- 확장자 앞에 역할 suffix 가능: `-service.ts`, `-worker.ts`, `-provider.tsx`

### 2. React 컴포넌트

```typescript
// ✅ 컴포넌트 정의
export function MergeWorkspace() { ... }
export function DocumentCard() { ... }
export function AppToolbar() { ... }

// ❌ 잘못된 정의
export function mergeWorkspace() { ... }
export function Document_Card() { ... }
```

**규칙:**

- 컴포넌트 함수명은 **PascalCase**
- 파일명은 kebab-case이지만, export되는 컴포넌트는 PascalCase

### 3. 함수 / 훅 / 변수

```typescript
// ✅ 올바른 예시
const useMergeCommand = () => { ... }
const handleFileDrop = (files: File[]) => { ... }
const runConvertJob = async () => { ... }
const totalPageCount = 24;

// ❌ 잘못된 예시
const UseMergeCommand = () => { ... }
const handle_file_drop = () => { ... }
const TotalPageCount = 24;
```

**규칙:**

- **camelCase** 사용
- 훅은 `use` prefix 필수
- 이벤트 핸들러는 `handle` 또는 `on` prefix 권장

### 4. 타입 / 인터페이스

```typescript
// ✅ 올바른 예시
interface MergeRequest { ... }
interface PdfDocument { ... }
type MergeStatus = 'idle' | 'merging' | 'complete';

// ❌ 잘못된 예시
interface mergeRequest { ... }
interface IMergeRequest { ... }  // I prefix 지양
type merge_status = ...
```

**규칙:**

- **PascalCase** 사용
- `I` prefix (헝가리안 표기법) 지양
- Props 타입: `ComponentNameProps` 형식 권장

### 5. IPC 채널명

```typescript
// ✅ 올바른 예시
'pdf.merge:start';
'pdf.merge:progress';
'pdf.merge:complete';
'pdf.edit:apply';
'file.convert.tiff';
'file.meta.get-pdf-info';
'dialog.show-open';
'app.log';

// ❌ 잘못된 예시
'pdfMergeStart';
'PDF_MERGE_START';
'merge-pdf';
```

**규칙:**

- 패턴: `scope.action:detail` 또는 `scope.action.detail`
- scope: 도메인 영역 (`pdf`, `file`, `dialog`, `app`)
- action: 동작 (`merge`, `edit`, `convert`)
- detail: 세부 액션 (`start`, `progress`, `complete`)

### 6. 서비스 클래스

```typescript
// ✅ 올바른 예시
class PdfMergeService { ... }
class PdfEditService { ... }
class FileConverterService { ... }

// ❌ 잘못된 예시
class pdfMergeService { ... }
class PDFMergeService { ... }  // 약어도 PascalCase 규칙 적용
class MergeService { ... }     // 도메인 prefix 누락
```

**규칙:**

- **PascalCase + Service** suffix
- 도메인 prefix 포함 (`Pdf`, `File`)

### 7. 워커 파일

```typescript
// ✅ 올바른 예시
// 파일: merge-worker.ts
export function processMerge() { ... }

// 파일: convert-worker.ts
export function processConvert() { ... }

// 파일: edit-worker.ts
export function processEdit() { ... }
```

**규칙:**

- 파일명: **kebab-case + `-worker.ts`**
- 내부 함수: camelCase

---

## FSD 레이어별 네이밍

| 레이어     | 폴더 예시                    | 파일 예시                                   |
| ---------- | ---------------------------- | ------------------------------------------- |
| `entities` | `pdf-document/`, `pdf-page/` | `document-card.tsx`, `use-pdf-metadata.ts`  |
| `features` | `pdf-merge/`, `pdf-edit/`    | `use-merge-command.ts`, `merge-toolbar.tsx` |
| `widgets`  | `merge-workspace/`           | `merge-workspace.tsx`                       |
| `shared`   | `ui/`, `lib/`, `model/`      | `ipc-client.ts`, `pdf-document.ts`          |

---

## 자주 사용되는 Prefix/Suffix

### Prefix

| Prefix        | 용도          | 예시                        |
| ------------- | ------------- | --------------------------- |
| `use`         | React Hook    | `useMergeCommand`           |
| `handle`      | 이벤트 핸들러 | `handleFileDrop`            |
| `on`          | 콜백 prop     | `onMergeComplete`           |
| `is` / `has`  | Boolean       | `isLoading`, `hasError`     |
| `get` / `set` | Getter/Setter | `getPdfInfo`, `setProgress` |

### Suffix

| Suffix               | 용도                 | 예시                          |
| -------------------- | -------------------- | ----------------------------- |
| `Service`            | 비즈니스 로직 클래스 | `PdfMergeService`             |
| `Provider`           | Context Provider     | `MergeProvider`               |
| `Context`            | React Context        | `MergeContext`                |
| `Props`              | 컴포넌트 Props 타입  | `DocumentCardProps`           |
| `Request` / `Result` | IPC 페이로드         | `MergeRequest`, `MergeResult` |
