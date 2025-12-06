# IPC 채널 완전 참조

## 채널 네이밍 규칙

```
scope.action:detail
```

- **scope**: 도메인 영역 (pdf, file, dialog, app)
- **action**: 동작 유형 (merge, edit, convert)
- **detail**: 세부 이벤트 (start, progress, complete)

## PDF 병합 (Merge)

### pdf.merge:start
- **방향**: Renderer → Main
- **Payload**: `MergeRequest`
- **응답**: `void` (비동기 작업)
- **설명**: 병합 작업 시작 요청

```typescript
interface MergeRequest {
  files: MergeFileItem[];
  outputPath?: string;
}

interface MergeFileItem {
  path: string;
  pages?: number[];
}
```

### pdf.merge:progress
- **방향**: Main → Renderer
- **Payload**: `MergeProgress`
- **설명**: 실시간 진행률 업데이트

```typescript
interface MergeProgress {
  current: number;
  total: number;
  percentage: number;
}
```

### pdf.merge:complete
- **방향**: Main → Renderer
- **Payload**: `MergeResult`
- **설명**: 병합 완료 알림

```typescript
interface MergeResult {
  outputPath: string;
  totalPages: number;
}
```

## PDF 편집 (Edit)

### pdf.edit:apply
- **방향**: Renderer → Main
- **Payload**: `EditPageRequest`
- **응답**: `Promise<void>`
- **설명**: 페이지 편집 적용

```typescript
interface EditPageRequest {
  filePath: string;
  operations: PageOperation[];
}

interface PageOperation {
  type: 'delete' | 'reorder';
  pageIndices: number[];
  newOrder?: number[];  // reorder 시 사용
}
```

## 파일 변환 (Convert)

### file.convert.tiff
- **방향**: Renderer → Main
- **Payload**: `ConvertTiffRequest`
- **응답**: `Promise<ConvertResult>`
- **설명**: TIFF → PDF 변환

```typescript
interface ConvertTiffRequest {
  tiffPath: string;
  outputDir?: string;
}

interface ConvertResult {
  outputPdfPath: string;
  pageCount: number;
}
```

## 메타데이터 조회

### file.meta.get-pdf-info
- **방향**: Renderer → Main
- **Payload**: `string` (파일 경로)
- **응답**: `Promise<PdfInfo>`
- **설명**: PDF 메타 정보 조회

```typescript
interface PdfInfo {
  pageCount: number;
  title?: string;
  author?: string;
  creationDate?: string;
}
```

## 시스템 다이얼로그

### dialog.show-open
- **방향**: Renderer → Main
- **Payload**: `OpenDialogOptions`
- **응답**: `Promise<string[]>`
- **설명**: 파일 열기 다이얼로그

```typescript
interface OpenDialogOptions {
  filters?: FileFilter[];
  properties?: ('openFile' | 'multiSelections' | 'openDirectory')[];
}

interface FileFilter {
  name: string;
  extensions: string[];
}
```

### dialog.show-save
- **방향**: Renderer → Main
- **Payload**: `SaveDialogOptions`
- **응답**: `Promise<string | undefined>`
- **설명**: 파일 저장 다이얼로그

```typescript
interface SaveDialogOptions {
  defaultPath?: string;
  filters?: FileFilter[];
}
```

## 앱 유틸리티

### app.log
- **방향**: Renderer → Main
- **Payload**: `LogEntry`
- **응답**: `void`
- **설명**: Main 프로세스 로깅

```typescript
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
}
```

## 에러 처리 패턴

### IPC 에러 타입

```typescript
interface IpcError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export const IPC_ERROR_CODE = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_PDF: 'INVALID_PDF',
  MERGE_FAILED: 'MERGE_FAILED',
  CONVERT_FAILED: 'CONVERT_FAILED',
} as const;
```

### 에러 처리 예시

```typescript
// Main Process
ipcMain.handle('pdf.merge:start', async (_, request) => {
  try {
    return await mergeService.merge(request);
  } catch (error) {
    throw {
      code: IPC_ERROR_CODE.MERGE_FAILED,
      message: error.message,
    };
  }
});

// Renderer Process
try {
  await ipcClient.merge.start(request);
} catch (error) {
  const ipcError = error as IpcError;
  if (ipcError.code === IPC_ERROR_CODE.MERGE_FAILED) {
    toast.error('병합에 실패했습니다.');
  }
}
```

## 이벤트 구독 해제 패턴

```typescript
// Renderer에서 이벤트 구독
useEffect(() => {
  const unsubscribeProgress = ipcClient.merge.onProgress(setProgress);
  const unsubscribeComplete = ipcClient.merge.onComplete(handleComplete);

  return () => {
    unsubscribeProgress();
    unsubscribeComplete();
  };
}, []);
```
