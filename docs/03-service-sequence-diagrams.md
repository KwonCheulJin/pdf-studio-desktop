# 🔁 서비스 시퀀스 다이어그램

핵심 기능 3가지의 서비스 간 상호작용 및 데이터 흐름입니다.

## 1. PDF 병합 시퀀스 (Merge)

### 흐름 개요

1. 사용자가 "Combine" 버튼 클릭
2. Renderer → Main으로 병합 요청 전송
3. Worker에서 청크 단위로 병합 처리
4. 진행률 실시간 업데이트
5. 완료 후 결과 파일 경로 반환

### 시퀀스 다이어그램

```mermaid
sequenceDiagram
    participant User
    participant R as Renderer (UI/Context)
    participant I as IPC (ipc-handler)
    participant M as Main (PdfMergeService)
    participant W as Worker (merge-worker)

    User->>R: "Combine" 클릭
    R->>I: pdf.merge:start (MergeRequest)
    I->>M: 병합 요청 위임

    loop 각 파일 청크
        M->>W: 파일 병합 청크 처리
        W->>W: pdf-lib 호출 (페이지 복사)
        W-->>M: partial 상태 반환
        M->>I: pdf.merge:progress 이벤트 발행
        I->>R: 진행률 업데이트
    end

    M->>M: fs-extra 호출 (결과 PDF 저장)
    M->>I: pdf.merge:complete (MergeResult)
    I->>R: 완료 이벤트 수신
    R->>User: 완료 토스트/버튼 표시
```

### 주요 처리 로직

- **청크 단위 처리**: 대용량 PDF 병합 시 메모리 효율성 확보
- **Worker 분리**: Main 프로세스 블로킹 방지
- **실시간 진행률**: `pdf.merge:progress` 이벤트로 UI 업데이트

---

## 2. PDF 편집 시퀀스 (Edit)

### 흐름 개요

1. 사용자가 페이지 삭제/순서 변경 후 "Apply" 클릭
2. Optimistic UI 업데이트 (즉시 반영)
3. Main Process에서 실제 PDF 수정
4. 완료 후 썸네일 리렌더링

### 시퀀스 다이어그램

```mermaid
sequenceDiagram
    participant User
    participant R as Renderer (UI/Context)
    participant I as IPC (ipc-handler)
    participant E as Main (PdfEditService)
    participant W as Worker (edit-worker)

    User->>R: 페이지 삭제/순서 변경 후 "Apply" 클릭
    R->>R: 로컬 상태 업데이트 (Optimistic)
    R->>I: pdf.edit:apply (EditPageRequest)
    I->>E: 편집 요청 위임

    E->>W: 실제 PDF 수정 수행
    W->>W: pdf-lib 호출 (페이지 재구성/삭제)
    W->>W: fs-extra 호출 (수정된 파일 덮어쓰기)
    W-->>E: 성공/실패 반환

    E->>I: 처리 결과 반환
    I->>R: 성공 알림
    R->>User: 완료 토스트, 썸네일 리렌더 요청
```

### 주요 처리 로직

- **Optimistic Update**: UI 즉시 반영으로 빠른 사용자 경험
- **페이지 재구성**: pdf-lib로 새 PDF 문서 생성 후 선택된 페이지만 복사
- **덮어쓰기**: 원본 파일 직접 수정 (또는 새 파일로 저장 옵션)

---

## 3. TIFF → PDF 변환 시퀀스 (Convert)

### 흐름 개요

1. 사용자가 TIFF 파일 선택
2. sharp/libvips로 멀티페이지 TIFF 디코딩
3. pdf-lib로 이미지 삽입 및 PDF 생성
4. 변환된 PDF를 MergeContext에 추가

### 시퀀스 다이어그램

```mermaid
sequenceDiagram
    participant User
    participant R as Renderer (UI/Context)
    participant I as IPC (ipc-handler)
    participant C as Main (FileConverterService)
    participant W as Worker (convert-worker)

    User->>R: "Add TIFF" 클릭 후 파일 선택
    R->>I: file.convert.tiff (ConvertTiffRequest)
    I->>C: 변환 요청 위임

    C->>W: TIFF 처리 작업 요청
    W->>W: sharp/libvips 호출 (멀티페이지 디코딩)
    W->>W: pdf-lib 호출 (이미지 삽입 및 PDF 생성)
    W->>W: fs-extra 호출 (임시 PDF 저장)
    W-->>C: ConvertResult 반환

    C->>I: ConvertResult 반환
    I->>R: 변환 결과 전달 (outputPdfPath)
    R->>R: MergeContext에 변환된 PDF 추가
    R->>User: 새 문서 카드/썸네일 표시
```

### 주요 처리 로직

- **멀티페이지 지원**: TIFF의 여러 페이지를 각각 PDF 페이지로 변환
- **임시 파일 관리**: 변환된 PDF는 임시 디렉토리에 저장
- **자동 추가**: 변환 완료 시 자동으로 병합 대상 목록에 추가

---

## 사용 라이브러리 매핑

| 작업            | 라이브러리          | 위치     |
| --------------- | ------------------- | -------- |
| PDF 페이지 조작 | `pdf-lib`           | Worker   |
| TIFF 디코딩     | `sharp` / `libvips` | Worker   |
| 파일 I/O        | `fs-extra`          | Worker   |
| 썸네일 렌더링   | `pdf.js`            | Renderer |
