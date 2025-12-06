# Drag & Drop UX 가이드 (Acrobat Combine Files 패턴)

Adobe Acrobat의 "파일 결합" 흐름을 기준으로, PDF Studio Desktop에서 일관된 드래그 앤 드롭 경험을 제공하기 위한 화면 패턴을 정의합니다.

## 핵심 개념
- 항상 드롭 가능: 빈 상태, 파일 추가 후, 드래그 중 언제나 드롭 타겟이 존재해야 함.
- 계층 구조:
  - 글로벌 영역: 페이지 전체(툴바 제외) → 드래그 오버 시 전체 하이라이트.
  - 컨텐츠 영역: 초기 대형 드롭존 또는 카드 그리드.
  - 그리드 내 추가 카드: 파일이 있는 상태에서도 + 드롭 카드 유지.

## 상태별 레이아웃
### 1) 초기 상태 (Empty)
- 중앙 대형 드롭존 (dashed border, 넓은 패딩).
- 요소: PDF 아이콘, "드래그하여 추가" 텍스트, "파일 선택" 버튼.
- 페이지 여백을 넓게 두어 가벼운 느낌 유지.

```
[Toolbar]

┌─────────────────────────────┐
│      [PDF 아이콘]           │
│   드래그하거나 클릭하여 추가 │
│      [파일 선택 버튼]        │
└─────────────────────────────┘
```

### 2) 파일 추가 후 (Grid)
- 카드 그리드가 메인 컨텐츠.
- 마지막 위치에 "+ 추가" 드롭 카드 유지:
  - 드래그 오버 시 하이라이트.
  - 클릭 시 파일 선택 모달.

```
[Toolbar]

[Card][Card][Card][ + 추가 (Drop) ]
```

### 3) 드래그 중 (Global Overlay)
- 포커스 포인트: 화면 전체 오버레이 + 중앙 안내.
- 어두운 투명 배경, 강조된 보더/아이콘.

```
[FULLSCREEN OVERLAY]
     ⬇ 여기에 놓아 추가
```

## 인터랙션 규칙
- 어디서든 드래그 오버 시:
  - 글로벌 오버레이 표시.
  - 드롭 위치는 컨텐츠 영역 우선, 없으면 그리드 최하단에 추가.
- 툴바 CTA:
  - Add Files / Add Folder 항상 표시.
  - Combine은 파일이 있을 때만 활성화.
- 키보드/클릭:
  - "+ 추가" 카드 클릭으로 동일한 파일 선택 흐름 제공.

## 구현 가이드 (React + Electron)
- FSD 배치:
  - `features/upload` 또는 `features/merge` 내 DropZone 컴포넌트.
  - `widgets/merge-workspace`에서 그리드 + 툴바 조합.
  - `shared/ui`에 재사용 가능한 `DropOverlay`/`DropCard` 배치 가능.
- 드래그 감지:
  - 렌더러에서 `window` dragenter/dragover/dragleave/drop`로 글로벌 오버레이 토글.
  - 메인/프리로드 IPC는 파일 경로 처리에만 사용, UI 토글은 클라이언트 상태로 관리.
- 오버레이 렌더:
  - Portal로 루트 상단에 추가 (`createPortal`).
  - 투명한 배경 + 중앙 안내, aria-live로 접근성 메시지 제공.
- Drop 카드:
  - 카드 자체가 드롭 타겟이 되도록 `onDragOver`/`onDrop` 처리.
  - 클릭 시 파일 선택 (Electron `dialog.showOpenDialog` → IPC).
- 스타일 (Tailwind 4 예시 아이디어):
  - 드롭존 기본: `border-2 border-dashed border-slate-300 hover:border-slate-500 bg-slate-50`
  - 드래그 오버: `border-sky-500 bg-sky-50/60 shadow-lg`
  - 오버레이: `fixed inset-0 bg-slate-900/60 border-2 border-sky-400`

## 체크리스트
- [ ] 빈 상태에서 대형 드롭존 노출.
- [ ] 파일 추가 후에도 "+ 추가" 드롭 카드 유지.
- [ ] 페이지 어디서든 드래그 시 글로벌 오버레이 표시.
- [ ] 드롭 시 파일 경로를 IPC로 안전하게 전달.
- [ ] 파일 없을 때 Combine 비활성화, 추가 시 활성화.
