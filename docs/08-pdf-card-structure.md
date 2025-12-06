# PDF 카드 그리드 구조 (업로드/그룹/펼치기 상태)

Adobe Acrobat Combine 화면의 DOM 스냅샷을 기준으로, 업로드된 PDF 카드가 어떻게 구성되고 상태별로 어떤 클래스가 붙는지 정리했습니다. Merge/Organize 워크스페이스 구현 시 레이어/역할 대응에 활용하세요.

## 공통 래퍼 계층
- `rowgroup` 컨테이너: 절대 배치, `transform: translate3d`로 그리드 위치를 계산.
- `item` (role `presentation`): 실제 카드 단위. `transform`으로 위치, `transition-duration` 상속.
- `row` (role `row`): 스펙트럼 GridView 아이템.
- `DCGridItem__wrapper` (role `region`): 좌/우 드롭 인디케이터와 본문을 감쌈.
- 좌우 인디케이터: `GridItemIndicator__container` (`...left`, `...right`) → 드래그 오버 시 강조 영역.
- `section > gridItemWrapper > combineItem`: 카드 본문 래퍼. 배경/보더/스택 레이어 관리.

## 카드 본문 (접힘/펼침 공통)
- 상단 썸네일 영역: `CombineGridItem__topItem` 내부에 `OrganizeGridItem__providerV2` → `spectrum-Card`로 썸네일 렌더.
- 썸네일 이미지: `OrganizeGridItem__thumbnailImage` 안에 `<img>` (object-fit: contain).
- 체크박스: `spectrum-QuickActions spectrum-Card-quickActions` 내 `spectrum-Checkbox`.
- 퀵 액션 버튼 그룹: `spectrum-ButtonGroup spectrum-QuickActions` (`OverlayedButtons__thumbnailActionsContainer`)에
  - Expand/Collapse (`combine-expand-button` / `combine-collapse-button`)
  - Rotate left/right (`rotate-left-button`, `rotate-right-button`)
  - Delete (`delete-button`)
- 하단 푸터: `GridItemFooter__footer` 안에
  - 파일명: `GridItemFooter__filename`
  - 페이지 범위/수: `GridItemFooter__pageNumber`

## 상태별 클래스/구성
- 기본 업로드 카드
  - 컨테이너: `CombineGridItem__combineItem`
  - 썸네일: `spectrum-Card spectrum-Card--quiet OrganizeGridItem__card`
  - 배경/보더: `CombineGridItem__thumbnailBorderTop`, `CombineGridItem__thumbnailBorderLeft`
  - 퀵 액션: Expand(페이지 보기), 회전, 삭제 노출
- 그룹(접힘) 상태
  - 상단 썸네일에 `CombineGridItem__stacked` + `CombineGridItem__isLast` → 여러 페이지를 겹쳐놓은 듯한 시각 효과
  - 배경 진하게: `CombineGridItem__darkerBackground`
  - Expand 버튼(`combine-expand-button`) 표시, Collapse는 숨김
  - 푸터의 페이지 범위가 `1-4` 등으로 표시
- 그룹(펼침) 상태
  - 개별 페이지별 `item`이 연속 렌더됨 (페이지 단위로 여러 카드 생성)
  - 각 카드에는 `CombineGridItem__darkerBackground`만 적용, `__stacked`/`__isLast`는 빠짐
  - Collapse 버튼(`combine-collapse-button`) 노출, Expand는 숨김
  - 푸터의 페이지 번호가 단일 값(`1`, `2`, `3` 등)으로 표시

## 구현 시 매핑 포인트
- 스택 효과: collapsed 상태에만 `__stacked`/`__isLast` 클래스 추가 후 썸네일 상단/좌측 보더로 레이어 표현.
- 액션 토글: collapsed → Expand 버튼만, expanded(페이지 보기) → Collapse + 회전/삭제 유지.
- 드래그 오버: 좌/우 `GridItemIndicator`를 하이라이트해 드롭 위치를 안내.
- 위치 계산: 그리드 엔진이 `item`에 `transform: translate3d(x, y, 0)`를 주입; 우리 앱에서는 Masonry/virtual grid 레이아웃에서 동일 패턴 사용 가능.
