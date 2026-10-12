# 🧾 네이밍 컨벤션 가이드

일관성 있고 예측 가능한 코드베이스를 위한 네이밍 규칙입니다.

## 요약 테이블

| 요소            | 컨벤션                     | 예시                                        |
| --------------- | -------------------------- | ------------------------------------------- |
| 폴더 & 파일     | **kebab-case**             | `pdf-merge-service.ts`, `document-card.tsx` |
| React 컴포넌트  | **PascalCase**             | `MergeWorkspace`, `DocumentCard`            |
| 함수/훅/변수    | **camelCase**              | `useMergeCommand`, `handleFileDrop`         |
| 타입/인터페이스 | **PascalCase**             | `MergeRequest`, `PdfDocument`               |
| Tauri 커맨드    | **snake_case 동사_목적어** | `merge_pdfs`, `open_files`                  |
| 서비스 클래스   | **PascalCase + Service**   | `PdfMergeService`                           |

---

## 상세 규칙

### 1. 폴더 & 파일

```
✅ 올바른 예시
pdf-merge-service.ts
document-card.tsx
use-merge-command.ts
tauri-platform.ts

❌ 잘못된 예시
PdfMergeService.ts
documentCard.tsx
useMergeCommand.ts
```

**규칙:**

- 모든 폴더와 파일명은 **kebab-case** 사용
- 확장자 앞에 역할 suffix 가능: `-store.ts`, `-platform.ts`, `-provider.tsx`

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

### 5. Tauri 커맨드명

```rust
// ✅ 올바른 예시 (Rust 함수 이름이 곧 커맨드 이름)
merge_pdfs
open_files
pick_save_path
cancel_job

// ❌ 잘못된 예시
mergePdfs
pdf.merge:start
merge
```

**규칙:**

- Rust 함수 명명(`snake_case`)을 그대로 쓰고 `동사_목적어`로 짓는다.
- 프론트는 커맨드를 직접 부르지 않는다. 생성 바인딩의 `commands`는
  `shared/platform/tauri-platform.ts`에서만 호출하고, 나머지는 `DesktopPlatform`
  메서드(camelCase)를 쓴다.
- 커맨드 목록과 시그니처의 정본은 계획서 §5 P1-3 표와
  `src/renderer/shared/api/bindings.ts`(tauri-specta 생성물)다.

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

---

## FSD 레이어별 네이밍

| 레이어     | 폴더 예시                    | 파일 예시                                   |
| ---------- | ---------------------------- | ------------------------------------------- |
| `entities` | `pdf-document/`, `pdf-page/` | `document-card.tsx`, `use-pdf-metadata.ts`  |
| `features` | `pdf-merge/`, `pdf-edit/`    | `use-merge-command.ts`, `merge-toolbar.tsx` |
| `widgets`  | `merge-workspace/`           | `merge-workspace.tsx`                       |
| `shared`   | `ui/`, `lib/`, `platform/`   | `tauri-platform.ts`, `file-utils.ts`        |

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
| `Request` / `Result` | 커맨드 요청·결과     | `MergeRequest`, `MergeResult` |
