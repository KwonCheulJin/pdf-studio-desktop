# 📁 폴더 구조 템플릿 (Clean FSD 기반)

## 설계 기준

- **Renderer**: FSD (Feature-Sliced Design) 기반
  - `entities` → **READ** (데이터 조회/표현)
  - `features` → **CUD** (Create, Update, Delete)
- **Main Process**: Service 기반 구성

## 전체 구조

```
project-root/
├─ package.json
├─ electron.vite.config.ts (or webpack/electron-builder 설정)
├─ tsconfig.json
└─ src/
   ├─ main/                         # Electron Main Process (Business Logic)
   │  ├─ app/
   │  │  ├─ main.ts                # App Entry, BrowserWindow 생성
   │  │  └─ ipc-handler.ts         # IPC 라우팅 및 Service 연결
   │  ├─ services/
   │  │  ├─ pdf-merge-service.ts   # PDF 병합 로직 (CUD)
   │  │  ├─ pdf-edit-service.ts    # PDF 페이지 편집 로직 (CUD)
   │  │  └─ file-converter-service.ts # TIFF → PDF 변환 로직
   │  ├─ workers/                  # CPU 집약적 작업 처리
   │  │  ├─ merge-worker.ts
   │  │  ├─ edit-worker.ts
   │  │  └─ convert-worker.ts
   │  ├─ utils/
   │  │  ├─ pdf-lib-client.ts      # pdf-lib wrapper
   │  │  ├─ sharp-client.ts        # sharp/libvips wrapper
   │  │  └─ fs-utils.ts
   │  └─ types/
   │     └─ ipc-schema.ts          # IPC payload 타입 정의 (공유)
   │
   ├─ preload/
   │  └─ index.ts                  # ContextBridge 설정 (window.api 노출)
   │
   └─ renderer/                    # React (FSD 구조)
      ├─ app/
      │  ├─ providers/
      │  │  ├─ merge-provider.tsx  # MergeContext Provider
      │  │  └─ theme-provider.tsx
      │  ├─ layout/
      │  │  └─ app-shell.tsx       # 전체 레이아웃
      │  └─ index.tsx              # React entry
      │
      ├─ shared/                   # 공통 유틸리티, UI, 도메인 타입
      │  ├─ ui/                    # 공용 UI 컴포넌트 래핑/정의
      │  ├─ lib/
      │  │  ├─ ipc-client.ts       # window.api 래핑 (사용 편의성)
      │  │  └─ thumbnail-cache.ts
      │  └─ model/
      │     ├─ pdf-document.ts     # 도메인 타입 (PdfDocument, PdfPage)
      │     └─ merge-state.ts      # Merge/Edit 상태 타입
      │
      ├─ entities/                 # READ 중심 (데이터 조회/표현)
      │  ├─ pdf-document/
      │  │  ├─ ui/
      │  │  │  ├─ document-card.tsx   # 단일 문서 카드 뷰
      │  │  └─ model/
      │  │     └─ use-pdf-metadata.ts # 메타데이터 조회 훅
      │  ├─ pdf-page/
      │  │  ├─ ui/
      │  │  │  ├─ page-thumbnail.tsx  # 페이지 썸네일 뷰
      │  │  └─ model/
      │  │     └─ use-page-preview.ts # pdf.js 기반 썸네일 렌더링 훅
      │  └─ tiff-file/
      │     └─ ui/
      │        └─ tiff-preview-card.tsx # TIFF 파일 임시 상태 표시
      │
      ├─ features/                 # CUD 중심 (사용자 행동/로직 처리)
      │  ├─ pdf-merge/
      │  │  ├─ model/
      │  │  │  ├─ use-merge-command.ts      # 병합 실행 로직 (IPC 호출)
      │  │  └─ ui/
      │  │     ├─ merge-toolbar.tsx         # 파일 추가/Combine 버튼
      │  │     └─ merge-file-grid.tsx       # DnD 로직이 포함된 그리드
      │  ├─ pdf-edit/
      │  │  ├─ model/
      │  │  │  └─ use-page-edit-command.ts  # 삭제/재배치 로직
      │  │  └─ ui/
      │  │     └─ page-editor-panel.tsx     # 편집 모드 컨테이너
      │  └─ file-convert/
      │     ├─ model/
      │     │  └─ use-tiff-convert.ts       # TIFF → PDF 변환 커맨드
      │     └─ ui/
      │        └─ convert-dialog.tsx        # 변환 진행 상태 다이얼로그
      │
      ├─ widgets/                  # 조합된 Workspace 영역
      │  ├─ merge-workspace/
      │  │  └─ merge-workspace.tsx          # MergeToolbar + MergeFileGrid 조합
      │  └─ page-edit-workspace/
      │     └─ page-edit-workspace.tsx
      │
      └─ pages/
         └─ main-page.tsx
```

## 레이어별 역할 요약

| 레이어              | 역할                 | 예시                        |
| ------------------- | -------------------- | --------------------------- |
| `main/services`     | 비즈니스 로직 (CUD)  | PDF 병합, 편집, 변환        |
| `main/workers`      | CPU 집약적 작업 분리 | 청크 단위 병합 처리         |
| `renderer/shared`   | 공통 유틸/타입/UI    | IPC 클라이언트, 도메인 타입 |
| `renderer/entities` | READ 전용 뷰/훅      | 썸네일, 메타데이터 조회     |
| `renderer/features` | CUD 로직 + UI        | 병합 실행, 페이지 삭제      |
| `renderer/widgets`  | Feature 조합         | Workspace 컨테이너          |
| `renderer/pages`    | 라우트 진입점        | MainPage                    |
