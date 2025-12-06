# 절대 좌표 기반 카드 레이아웃 전환 계획

## 목표
PDF 카드 레이아웃을 **절대 좌표 기반**으로 변경해 카드 크기를 고정하고, 화면 폭 변화에 따라 **열 수만 재계산**되도록 한다. 카드 크기는 변하지 않고, 열 수만 1→2→3…로 변하며 세로 스크롤로 모든 카드를 볼 수 있게 한다. Acrobat의 카드/드롭존 크기를 참고해 기본값을 맞춘다.

## 핵심 아이디어
- **상수화**: `CARD_W`, `CARD_H`, `GAP`, `PADDING`, `DROPZONE_WIDTH`.
  - Acrobat 기준 참고값: 카드 폭 `≈231px`, 카드 높이 `≈320~360px`(썸네일 + 푸터), 갭 `16px` 전후, 컨테이너 패딩 `24px` 전후, 드롭 인디케이터 폭 `~8px` 수준.
- **열 수 계산**  
  `columns = max(1, floor((viewportWidth - 2*PADDING + GAP) / (CARD_W + GAP)))`
- **카드 좌표**  
  `x = PADDING + (index % columns) * (CARD_W + GAP)`  
  `y = PADDING + floor(index / columns) * (CARD_H + GAP)`
- **컨테이너 높이**  
  `containerHeight = PADDING*2 + rows*(CARD_H + GAP) - GAP`
  - 부모는 `relative w-full overflow-y-auto`; 내부는 `position: relative; height: containerHeight`.

## 구현 단계
1) **상수 정의**  
   - `shared/constants`에 `CARD_W`, `CARD_H`, `GAP`, `PADDING`, `DROPZONE_WIDTH` 추가.  
   - 초기값 제안: `CARD_W=231`, `CARD_H=340`, `GAP=16`, `PADDING=24`, `DROPZONE_WIDTH=8`.
2) **레이아웃 훅 추가**  
   - `useAbsoluteGridLayout(itemsCount, viewportWidth)` 작성.  
   - 반환: `columns`, `positions[{x,y}]`, `containerHeight`.
3) **FileGrid 수정**  
   - 기존 CSS grid/flex 제거.  
   - 부모: `relative w-full overflow-y-auto`; 내부: `position: relative; height: containerHeight`.  
   - 각 카드/페이지를 절대 좌표로 배치.
4) **GridItemWrapper 수정**  
   - `position: absolute; transform: translate3d(xpx, ypx, 0); width: CARD_W; height: CARD_H` 적용.  
   - 좌/우 드롭 인디케이터 폭을 `DROPZONE_WIDTH`로 고정하고, 카드 폭에는 포함하지 않도록 wrapper 전체 폭을 `CARD_W + DROPZONE_WIDTH*2`로 설정.
5) **반응형 처리**  
   - `ResizeObserver`(또는 `window resize`)로 viewportWidth 감지 → `columns` 재계산.
6) **검증**  
   - 화면 폭 변화 시 카드 크기는 고정되고 열 수만 변하는지 확인.  
   - 세로 스크롤 정상 동작, 드래그/호버/선택 UI가 깨지지 않는지 확인.

## 추가 고려
- 필요 시 특정 브레이크포인트 이하에서 열 수를 강제(예: 모바일 1~2열)하거나 CSS grid로 폴백하는 하이브리드도 가능.  
- 드래그 인디케이터 오버레이가 절대 좌표 기준으로 정상 표시되는지 수동 확인 필요.  
- 드롭존 클릭/호버 영역이 카드 본문과 겹치지 않도록 pointer 영역을 DROPZONE_WIDTH로 분리하고, 카드 영역에는 `pointer-events: auto`, 드롭존에는 드롭 핸들러만 허용.
