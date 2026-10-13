import { useCallback } from "react";
import {
  ZoomIn,
  ZoomOut,
  Trash2,
  RotateCw,
  RotateCcw,
  X,
  Combine,
  Undo2
} from "lucide-react";
import {
  useZoomStore,
  useCardSize,
  SELECTION_TYPE,
  type SelectionType
} from "@/renderer/features/pdf-merge";
import { ErrorReportingToggleButton } from "@/renderer/features/error-reporting";
import { ThemeToggleButton } from "@/renderer/features/theme-toggle";
import { Button, Slider, Tooltip } from "@/renderer/shared/ui";
import { ZOOM_CONFIG } from "@/renderer/shared/constants/zoom";

interface FloatingActionBarProps {
  selectedCount: number;
  selectionType: SelectionType;
  hasFiles: boolean;
  /** 선택에 섞인 삭제된 페이지 수. 0보다 크면 복원 버튼과 "(삭제됨 n)"을 보인다 */
  deletedInSelectionCount: number;
  onDelete: () => void;
  onRestore: () => void;
  onRotateCw: () => void;
  onRotateCcw: () => void;
  onClearSelection: () => void;
  onMergeSelected: () => void;
}

/** 막대 안 아이콘 버튼(시안 2: 32px, 모서리 8px) */
const ICON_BUTTON_CLASS = "h-8 w-8 rounded-md";

function Divider() {
  return <div className="bg-border h-6 w-px" />;
}

/**
 * 작업 공간 아래 떠 있는 막대(시안 2·6).
 * 고른 것이 있으면 선택 수 · 선택 동작을 앞에 두고, 확대 막대와 테마는 늘 함께 둔다.
 */
export function FloatingActionBar({
  selectedCount,
  selectionType,
  hasFiles,
  deletedInSelectionCount,
  onDelete,
  onRestore,
  onRotateCw,
  onRotateCcw,
  onClearSelection,
  onMergeSelected
}: FloatingActionBarProps) {
  const cardSize = useCardSize();
  const { setCardSize, zoomIn, zoomOut } = useZoomStore();

  const SLIDER_MAX = 100;
  const cardSizeRange = ZOOM_CONFIG.MAX_CARD_SIZE - ZOOM_CONFIG.MIN_CARD_SIZE;

  const handleSliderChange = useCallback(
    (value: number[]) => {
      const newSize =
        ZOOM_CONFIG.MIN_CARD_SIZE + (value[0] / SLIDER_MAX) * cardSizeRange;
      setCardSize(Math.round(newSize));
    },
    [setCardSize, cardSizeRange]
  );

  const hasSelection = selectedCount > 0;

  // 파일이 없으면 렌더링하지 않음
  if (!hasFiles) return null;

  const label =
    selectionType === SELECTION_TYPE.PAGE
      ? `${selectedCount}개 페이지 선택`
      : `${selectedCount}개 파일 선택`;

  // Slider value는 0-SLIDER_MAX 범위로 변환
  const sliderValue = Math.round(
    ((cardSize - ZOOM_CONFIG.MIN_CARD_SIZE) / cardSizeRange) * SLIDER_MAX
  );

  const isMinZoom = cardSize <= ZOOM_CONFIG.MIN_CARD_SIZE;
  const isMaxZoom = cardSize >= ZOOM_CONFIG.MAX_CARD_SIZE;

  return (
    <div className="border-border bg-card fixed bottom-16 left-1/2 z-50 flex max-w-[calc(100%-3rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-4 rounded-xl border px-6 py-3 shadow-xl">
      {hasSelection && (
        <>
          <span className="text-foreground text-sm/5.25 font-medium">
            {label}
            {deletedInSelectionCount > 0 && (
              <span className="text-muted-foreground font-normal">
                {` (삭제됨 ${deletedInSelectionCount})`}
              </span>
            )}
          </span>
          <Divider />
          <div className="flex items-center gap-2">
            {deletedInSelectionCount > 0 && (
              <Tooltip content="삭제된 페이지 복원">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRestore}
                  aria-label="선택 페이지 복원"
                  className="border-primary bg-card text-primary hover:bg-accent hover:text-accent-foreground h-8 gap-1.5 rounded-md text-[13px] font-medium"
                >
                  <Undo2 size={14} />
                  복원
                </Button>
              </Tooltip>
            )}
            <Tooltip content="삭제">
              <Button
                variant="ghost"
                size="icon"
                className={ICON_BUTTON_CLASS}
                onClick={onDelete}
                aria-label="선택 항목 삭제"
              >
                <Trash2 size={16} />
              </Button>
            </Tooltip>
            <Tooltip content="왼쪽으로 회전">
              <Button
                variant="ghost"
                size="icon"
                className={ICON_BUTTON_CLASS}
                onClick={onRotateCcw}
                aria-label="선택 항목 왼쪽으로 회전"
              >
                <RotateCcw size={16} />
              </Button>
            </Tooltip>
            <Tooltip content="오른쪽으로 회전">
              <Button
                variant="ghost"
                size="icon"
                className={ICON_BUTTON_CLASS}
                onClick={onRotateCw}
                aria-label="선택 항목 오른쪽으로 회전"
              >
                <RotateCw size={16} />
              </Button>
            </Tooltip>
            {selectedCount >= 2 && (
              <Tooltip content="선택 파일 병합">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onMergeSelected}
                  aria-label="선택 파일 병합"
                  className="h-8 gap-1 rounded-md px-2.5 font-normal"
                >
                  <Combine size={16} />
                  <span className="text-xs">병합하기</span>
                </Button>
              </Tooltip>
            )}
            <Tooltip content="선택 해제">
              <Button
                variant="ghost"
                size="icon"
                className={ICON_BUTTON_CLASS}
                onClick={onClearSelection}
                aria-label="선택 해제"
              >
                <X size={16} />
              </Button>
            </Tooltip>
          </div>
          <Divider />
        </>
      )}

      <div className="flex items-center gap-2">
        <Tooltip content="축소">
          <Button
            variant="ghost"
            size="icon"
            className={ICON_BUTTON_CLASS}
            onClick={zoomOut}
            disabled={isMinZoom}
            aria-label="축소"
          >
            <ZoomOut size={16} />
          </Button>
        </Tooltip>
        <Slider
          value={[sliderValue]}
          onValueChange={handleSliderChange}
          min={0}
          max={100}
          step={1}
          className="w-32"
        />
        <Tooltip content="확대">
          <Button
            variant="ghost"
            size="icon"
            className={ICON_BUTTON_CLASS}
            onClick={zoomIn}
            disabled={isMaxZoom}
            aria-label="확대"
          >
            <ZoomIn size={16} />
          </Button>
        </Tooltip>
        <span className="text-muted-foreground min-w-8 text-xs">
          {Math.round((cardSize / ZOOM_CONFIG.DEFAULT_CARD_SIZE) * 100)}%
        </span>
      </div>

      {/* 구분자 + 테마·오류 보고 설정 */}
      <Divider />
      <div className="flex items-center gap-2">
        <ThemeToggleButton />
        <ErrorReportingToggleButton />
      </div>
    </div>
  );
}
