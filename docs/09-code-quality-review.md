# 코드 품질 점검 (매직 값 및 훅 분리 후보)

## 요약
- 매직 스트링/넘버가 여러 파일에 흩어져 있어 폴더명/확장자/레이아웃 튜닝 시 동기화 리스크가 존재함.
- 복잡한 드래그/레이아웃 로직이 단일 컴포넌트에 집중되어 있어 가독성과 테스트 가능성이 낮음.

## 매직 스트링·넘버 정리 필요
- `src/main/services/pdf-merge-service.ts:59` · `src/main/services/file-converter-service.ts:67`  
  출력 경로에 `"PDF Studio"`를 하드코딩. 동일 문자열이 테스트(`src/main/services/__tests__/file-converter-service.test.ts`)에도 사용되어 변경 시 누락 가능. `DEFAULT_OUTPUT_DIR`와 같은 상수로 통합 필요.
- `src/renderer/shared/hooks/use-file-drop-zone.ts:7`, `src/renderer/shared/hooks/use-dropped-files.ts:6`  
  허용 확장자 배열이 두 곳에 중복. 유지보수 시 한쪽만 수정될 수 있으므로 `shared/constants/file-types.ts` 등으로 이동 후 재사용 권장.
- `src/renderer/features/pdf-preview/model/use-preview-loader.ts:32-35`  
  `".pdf"` 확장자 체크와 에러 메시지가 인라인 문자열로 존재. 드롭존 확장자 정책과 함께 상수화하면 확장자 정책 변경 시 일관성 확보 가능.
- `src/renderer/features/pdf-merge/ui/file-grid.tsx:337,347,380`  
  드롭 인디케이터 위치 보정에 `-2`, `-4` 같은 오프셋이 하드코딩되어 GRID_CONFIG와 분리되어 있음. 레이아웃 조정 시 누락 위험이 있으니 오프셋 상수로 묶어 한 곳에서 관리 필요.
- `src/main/app/main.ts:15-23`  
  BrowserWindow 기본 크기(1200×800)가 매직 넘버로 박혀 있음. 설계 해상도 변경 시를 대비해 창 크기/최소 크기를 설정 파일이나 상수로 이동하는 편이 안전.

## 훅/모듈 분리 후보 (비즈니스 로직)
- `src/renderer/features/pdf-merge/ui/file-grid.tsx:150-464`  
  플랫 카드 생성, 드롭 인덱스 변환, 업로드 중 항목 삽입, 위치 계산까지 한 컴포넌트에 집중. 레이아웃 계산(`useFlatCardsLayout`), 업로드/드래그 상태 병합(`useGridRenderItems`) 등을 훅으로 분리하면 책임이 명확해지고 테스트 작성이 용이.
- `src/renderer/shared/hooks/use-file-drop-zone.ts:47-113,149-210`  
  좌표 기반 드롭 인덱스 계산과 파일 → PdfDocument 변환/상태 업데이트가 한 훅에 뒤섞여 있음. 인덱스 계산 유틸(순수 함수)과 파일 변환/스토어 반영 로직을 분리하면 계산 로직 단위 테스트와 I/O 의존 로직 분리가 가능.
