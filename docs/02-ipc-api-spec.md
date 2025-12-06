# 🔌 IPC API 명세서

Renderer와 Main Process 간의 통신 규약입니다.

## 채널 네이밍 패턴

```
scope.action:detail
```

- **Renderer → Main**: 명령(Command) 스타일
- **Main → Renderer**: 이벤트(Event) 스타일

## 공통 타입

```typescript
// src/main/types/ipc-schema.ts (Main/Preload/Renderer 공유)

export interface MergeRequest {
  files: {
    path: string;
    pages?: number[]; // 특정 페이지만 병합할 때
  }[];
  outputPath?: string;
}

export interface MergeResult {
  outputPath: string;
  totalPages: number;
}

export interface MergeProgress {
  current: number;
  total: number;
  percentage: number;
}

export interface EditPageRequest {
  filePath: string;
  operations: PageOperation[];
}

export interface PageOperation {
  type: 'delete' | 'reorder';
  pageIndices: number[];
  newOrder?: number[]; // reorder 시 사용
}

export interface ConvertTiffRequest {
  tiffPath: string;
  outputDir?: string;
}

export interface ConvertResult {
  outputPdfPath: string;
  pageCount: number;
}
```

## IPC 채널 리스트

### PDF 병합 (Merge)

| 채널 이름            | 방향  | Payload         | 응답            | 설명           |
| -------------------- | ----- | --------------- | --------------- | -------------- |
| `pdf.merge:start`    | R → M | `MergeRequest`  | `void` (비동기) | 병합 시작 요청 |
| `pdf.merge:progress` | M → R | `MergeProgress` | -               | 실시간 진행률  |
| `pdf.merge:complete` | M → R | `MergeResult`   | -               | 완료 알림      |

### PDF 편집 (Edit)

| 채널 이름        | 방향  | Payload           | 응답            | 설명           |
| ---------------- | ----- | ----------------- | --------------- | -------------- |
| `pdf.edit:apply` | R → M | `EditPageRequest` | `Promise<void>` | 편집 적용 요청 |

### 파일 변환 (Convert)

| 채널 이름           | 방향  | Payload              | 응답                     | 설명            |
| ------------------- | ----- | -------------------- | ------------------------ | --------------- |
| `file.convert.tiff` | R → M | `ConvertTiffRequest` | `Promise<ConvertResult>` | TIFF → PDF 변환 |

### 메타데이터 조회

| 채널 이름                | 방향  | Payload              | 응답                                    | 설명               |
| ------------------------ | ----- | -------------------- | --------------------------------------- | ------------------ |
| `file.meta.get-pdf-info` | R → M | `string` (파일 경로) | `{ pageCount: number; title?: string }` | PDF 메타 정보 조회 |

### 시스템 다이얼로그

| 채널 이름          | 방향  | Payload                      | 응답                           | 설명                 |
| ------------------ | ----- | ---------------------------- | ------------------------------ | -------------------- |
| `dialog.show-open` | R → M | `{ filters?: FileFilter[] }` | `Promise<string[]>`            | 파일 열기 다이얼로그 |
| `dialog.show-save` | R → M | `{ defaultPath?: string }`   | `Promise<string \| undefined>` | 파일 저장 다이얼로그 |

### 앱 유틸리티

| 채널 이름 | 방향  | Payload                              | 응답   | 설명               |
| --------- | ----- | ------------------------------------ | ------ | ------------------ |
| `app.log` | R → M | `{ level: string; message: string }` | `void` | Main 프로세스 로깅 |

## Preload 설정 예시

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Commands (R → M)
  mergePdf: (request: MergeRequest) =>
    ipcRenderer.invoke('pdf.merge:start', request),

  editPdf: (request: EditPageRequest) =>
    ipcRenderer.invoke('pdf.edit:apply', request),

  convertTiff: (request: ConvertTiffRequest) =>
    ipcRenderer.invoke('file.convert.tiff', request),

  getPdfInfo: (filePath: string) =>
    ipcRenderer.invoke('file.meta.get-pdf-info', filePath),

  // Dialogs
  showOpenDialog: (options?: { filters?: FileFilter[] }) =>
    ipcRenderer.invoke('dialog.show-open', options),

  showSaveDialog: (options?: { defaultPath?: string }) =>
    ipcRenderer.invoke('dialog.show-save', options),

  // Events (M → R)
  onMergeProgress: (callback: (progress: MergeProgress) => void) => {
    ipcRenderer.on('pdf.merge:progress', (_, data) => callback(data));
  },

  onMergeComplete: (callback: (result: MergeResult) => void) => {
    ipcRenderer.on('pdf.merge:complete', (_, data) => callback(data));
  },
});
```

## Renderer에서 사용 예시

```typescript
// src/renderer/shared/lib/ipc-client.ts
export const ipcClient = {
  merge: {
    start: (request: MergeRequest) => window.api.mergePdf(request),
    onProgress: (cb: (p: MergeProgress) => void) =>
      window.api.onMergeProgress(cb),
    onComplete: (cb: (r: MergeResult) => void) =>
      window.api.onMergeComplete(cb),
  },
  edit: {
    apply: (request: EditPageRequest) => window.api.editPdf(request),
  },
  convert: {
    tiff: (request: ConvertTiffRequest) => window.api.convertTiff(request),
  },
  dialog: {
    open: window.api.showOpenDialog,
    save: window.api.showSaveDialog,
  },
};
```
