# 🧱 UI 컴포넌트 트리

Adobe Acrobat Pro 스타일의 UI 구조입니다. shadcn/ui 및 커스텀 컴포넌트를 활용합니다.

## 상위 구조 (AppShell)

```
┌─────────────────────────────────────────────┐
│  AppToolbar                                 │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐    │
│  │Add Files│  │ Combine │  │ Options ▼│    │
│  └─────────┘  └─────────┘  └──────────┘    │
├─────────────────────────────────────────────┤
│                                             │
│  MainWorkspace                              │
│  ┌─────────────────────────────────────┐   │
│  │  MergeWorkspace / PageEditWorkspace │   │
│  │                                     │   │
│  │  ┌─────┐  ┌─────┐  ┌─────┐         │   │
│  │  │ Doc │  │ Doc │  │ Doc │  ...    │   │
│  │  └─────┘  └─────┘  └─────┘         │   │
│  │                                     │   │
│  └─────────────────────────────────────┘   │
│                                             │
├─────────────────────────────────────────────┤
│  AppStatusBar                               │
│  📄 3 files  │  📑 24 pages  │  Ready      │
└─────────────────────────────────────────────┘
```

### JSX 구조

```jsx
<AppShell>
  <AppToolbar /> {/* 상단: Add Files / Combine 버튼 영역 */}
  <MainWorkspace /> {/* 중앙: Merge 또는 PageEdit 뷰 */}
  <AppStatusBar /> {/* 하단: 상태 및 진행률 표시 */}
</AppShell>
```

---

## 전체 컴포넌트 트리

```
renderer/
└─ app/
   └─ layout/
      └─ AppShell
         │
         ├─ AppToolbar
         │  ├─ Button (Add Files)
         │  ├─ Button (Combine)
         │  └─ DropdownMenu (Options)
         │
         ├─ MainWorkspace (Conditional View)
         │  │
         │  ├─ MergeWorkspace (Widget) ─────────────────────┐
         │  │  ├─ MergeToolbar                              │
         │  │  │  ├─ Button (Add More)                      │
         │  │  │  └─ Button (Clear All)                     │
         │  │  │                                            │
         │  │  └─ MergeFileGrid (Feature)                   │
         │  │     └─ DocumentCardList                       │
         │  │        └─ DocumentCard (Entity) ─────────┐    │
         │  │           ├─ ThumbnailStrip              │    │
         │  │           │  └─ PageThumbnail (1~3장)    │    │
         │  │           ├─ DocumentInfo                │    │
         │  │           │  ├─ FileName                 │    │
         │  │           │  └─ PageCount                │    │
         │  │           └─ CardActions                 │    │
         │  │              ├─ IconButton (Delete)      │    │
         │  │              └─ IconButton (DragHandle)  │    │
         │  │                                          │    │
         │  │                                          │    │
         │  └─ PageEditWorkspace (Widget) ─────────────┼────┘
         │     ├─ PageEditHeader                       │
         │     │  ├─ BackButton                        │
         │     │  └─ ApplyButton                       │
         │     │                                       │
         │     └─ PageGridPanel                        │
         │        └─ PageThumbnailGrid                 │
         │           └─ PageThumbnailCard (Entity) ────┘
         │              ├─ ThumbnailImage
         │              ├─ PageNumber
         │              └─ CardActions
         │                 ├─ Checkbox (Select)
         │                 └─ IconButton (Delete)
         │
         └─ AppStatusBar
            ├─ Badge (Total Files)
            ├─ Badge (Total Pages)
            ├─ Separator
            └─ StatusText / Progress
```

---

## 컴포넌트 상세

### AppToolbar

| 요소           | shadcn/ui          | 역할                      |
| -------------- | ------------------ | ------------------------- |
| Add Files 버튼 | `Button`           | 파일 선택 다이얼로그 오픈 |
| Combine 버튼   | `Button` (primary) | 병합 실행                 |
| Options 메뉴   | `DropdownMenu`     | 설정/옵션 접근            |

### DocumentCard (Entity)

```tsx
interface DocumentCardProps {
  document: PdfDocument;
  onDelete: () => void;
  onEdit: () => void;
}
```

| 요소           | 설명                   |
| -------------- | ---------------------- |
| ThumbnailStrip | 첫 1~3 페이지 미리보기 |
| DocumentInfo   | 파일명, 페이지 수      |
| CardActions    | 삭제, 드래그 핸들      |

### PageThumbnailCard (Entity)

```tsx
interface PageThumbnailCardProps {
  page: PdfPage;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}
```

| 요소           | 설명                 |
| -------------- | -------------------- |
| ThumbnailImage | 페이지 렌더링 이미지 |
| PageNumber     | 페이지 번호 표시     |
| Checkbox       | 다중 선택용          |

### AppStatusBar

| 요소        | shadcn/ui  | 데이터                    |
| ----------- | ---------- | ------------------------- |
| Files Badge | `Badge`    | `mergeState.files.length` |
| Pages Badge | `Badge`    | `mergeState.totalPages`   |
| Status Text | -          | 현재 상태 메시지          |
| Progress    | `Progress` | 병합 진행률               |

---

## shadcn/ui 활용 컴포넌트

### 구조 (Layout)

- `Card` - 문서/페이지 카드 컨테이너
- `ScrollArea` - 그리드 스크롤 영역
- `Separator` - 섹션 구분선

### 입력/액션 (Input/Action)

- `Button` - 주요 액션 버튼
- `DropdownMenu` - 옵션 메뉴
- `Checkbox` - 페이지 다중 선택

### 피드백 (Feedback)

- `Progress` - 병합 진행률
- `Badge` - 파일/페이지 카운트
- `Tooltip` - 버튼 힌트
- `Toast` - 완료/에러 알림

---

## 상태 관리 연결

```tsx
// MergeContext 구조
interface MergeState {
  files: PdfDocument[];
  totalPages: number;
  status: 'idle' | 'merging' | 'complete' | 'error';
  progress: number;
}

// Widget에서 Context 사용
function MergeWorkspace() {
  const { files, addFiles, removeFile } = useMergeContext();

  return (
    <>
      <MergeToolbar onAddFiles={addFiles} />
      <MergeFileGrid files={files} onRemove={removeFile} />
    </>
  );
}
```
