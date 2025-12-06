# FSD Layers 상세 가이드

## 레이어 개요

Feature-Sliced Design (FSD)은 프론트엔드 애플리케이션을 위한 아키텍처 방법론입니다.

## 레이어 계층

```
pages/      → 라우트 진입점
widgets/    → 독립적인 복합 블록
features/   → 사용자 시나리오 (CUD)
entities/   → 비즈니스 엔티티 (READ)
shared/     → 재사용 가능한 인프라
```

### 상위 레이어 → 하위 레이어 의존성 규칙

- `pages` → `widgets`, `features`, `entities`, `shared`
- `widgets` → `features`, `entities`, `shared`
- `features` → `entities`, `shared`
- `entities` → `shared`
- `shared` → 외부 라이브러리만

## entities (READ 전용)

**목적**: 데이터 표시를 위한 컴포넌트와 훅

**구조**:
```
entities/pdf-document/
├─ ui/
│  ├─ document-card.tsx       # 문서 카드 뷰
│  └─ document-list.tsx       # 문서 목록
├─ model/
│  ├─ use-pdf-metadata.ts     # 메타데이터 조회 훅
│  └─ types.ts                # 도메인 타입
└─ index.ts                   # Public API
```

**규칙**:
- ❌ 데이터 변경 (mutation) 금지
- ❌ IPC CUD 호출 금지
- ✅ 데이터 조회 (READ) 허용
- ✅ props/context로 데이터 수신
- ✅ 표시 전용 로직

**예시**:
```typescript
// entities/pdf-document/ui/document-card.tsx
interface DocumentCardProps {
  document: PdfDocument;
  onSelect?: () => void;  // 선택 콜백 (mutation 아님)
}

export function DocumentCard({ document, onSelect }: DocumentCardProps) {
  return (
    <Card onClick={onSelect}>
      <PageThumbnail page={document.pages[0]} />
      <span>{document.name}</span>
      <span>{document.pageCount} pages</span>
    </Card>
  );
}
```

## features (CUD 작업)

**목적**: 사용자 액션 처리 및 비즈니스 로직

**구조**:
```
features/pdf-merge/
├─ ui/
│  ├─ merge-toolbar.tsx       # 액션 버튼
│  └─ merge-file-grid.tsx     # DnD 그리드
├─ model/
│  ├─ use-merge-command.ts    # IPC 호출 훅
│  ├─ use-merge-state.ts      # 상태 관리
│  └─ types.ts
└─ index.ts
```

**규칙**:
- ✅ IPC CUD 호출 허용
- ✅ 사용자 인터랙션 처리
- ✅ entities 컴포넌트 조합
- ✅ 로컬 상태 관리

**예시**:
```typescript
// features/pdf-merge/model/use-merge-command.ts
export function useMergeCommand() {
  const [status, setStatus] = useState<MergeStatus>(MERGE_STATUS.IDLE);

  const executeMerge = useCallback(async (files: PdfDocument[]) => {
    setStatus(MERGE_STATUS.PROCESSING);

    const request: MergeRequest = {
      files: files.map(f => ({ path: f.path })),
    };

    try {
      await ipcClient.merge.start(request);
      setStatus(MERGE_STATUS.COMPLETE);
    } catch {
      setStatus(MERGE_STATUS.ERROR);
    }
  }, []);

  return { status, executeMerge };
}
```

## widgets (조합)

**목적**: features와 entities를 조합한 독립적인 UI 블록

**구조**:
```
widgets/merge-workspace/
├─ merge-workspace.tsx
└─ index.ts
```

**규칙**:
- ✅ features + entities 조합
- ✅ 레이아웃 로직
- ❌ 직접적인 비즈니스 로직

**예시**:
```typescript
// widgets/merge-workspace/merge-workspace.tsx
export function MergeWorkspace() {
  const { files, addFiles, removeFile } = useMergeContext();
  const { executeMerge, status } = useMergeCommand();

  return (
    <div className="flex flex-col h-full">
      <MergeToolbar
        onAddFiles={addFiles}
        onMerge={() => executeMerge(files)}
        disabled={status === MERGE_STATUS.PROCESSING}
      />
      <MergeFileGrid files={files} onRemove={removeFile} />
    </div>
  );
}
```

## shared (공용 인프라)

**목적**: 전역적으로 재사용되는 코드

**구조**:
```
shared/
├─ ui/                # 공용 UI 컴포넌트
│  ├─ button.tsx
│  └─ card.tsx
├─ lib/               # 유틸리티
│  ├─ ipc-client.ts
│  └─ thumbnail-cache.ts
├─ model/             # 공용 타입/상수
│  ├─ types.ts
│  └─ constants.ts
└─ api/               # API 클라이언트
```

## Slice 구조

각 레이어 내의 폴더를 "slice"라고 부릅니다.

```
entities/
├─ pdf-document/      ← slice
├─ pdf-page/          ← slice
└─ tiff-file/         ← slice
```

**Slice 내부 구조 (Segments)**:
- `ui/` - UI 컴포넌트
- `model/` - 비즈니스 로직, 훅, 타입
- `api/` - API 호출 (해당 slice 전용)
- `lib/` - 유틸리티 (해당 slice 전용)
- `config/` - 설정

## Public API 패턴

각 slice는 `index.ts`를 통해 public API를 노출합니다:

```typescript
// entities/pdf-document/index.ts
export { DocumentCard } from './ui/document-card';
export { usePdfMetadata } from './model/use-pdf-metadata';
export type { PdfDocument } from './model/types';
```

**Import 규칙**:
```typescript
// ✅ 올바른 import (public API)
import { DocumentCard } from '@/entities/pdf-document';

// ❌ 금지 (내부 모듈 직접 import)
import { DocumentCard } from '@/entities/pdf-document/ui/document-card';
```
