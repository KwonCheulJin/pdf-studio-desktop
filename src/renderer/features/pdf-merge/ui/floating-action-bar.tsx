import { useCallback } from "react";
import { ZoomIn, ZoomOut, Trash2, RotateCw, RotateCcw, X } from "lucide-react";
import {
  Button,
  Slider,
  Tooltip,
  ThemeToggleButton
} from "@/renderer/shared/ui";
import { useZoomStore, useCardSize } from "@/renderer/shared/model/zoom-store";
import { ZOOM_CONFIG } from "@/renderer/shared/constants/zoom";
import {
  SELECTION_TYPE,
  type SelectionType
} from "@/renderer/shared/constants/page-state";

interface FloatingActionBarProps {
  selectedCount: number;
  selectionType: SelectionType;
  hasFiles: boolean;
  onDelete: () => void;
  onRotateCw: () => void;
  onRotateCcw: () => void;
  onClearSelection: () => void;
}

export function FloatingActionBar({
  selectedCount,
  selectionType,
  hasFiles,
  onDelete,
  onRotateCw,
  onRotateCcw,
  onClearSelection
}: FloatingActionBarProps) {
  const cardSize = useCardSize();
  const { setCardSize, zoomIn, zoomOut } = useZoomStore();

  const handleSliderChange = useCallback(
    (value: number[]) => {
      const newSize =
        ZOOM_CONFIG.MIN_CARD_SIZE +
        (value[0] / 100) *
          (ZOOM_CONFIG.MAX_CARD_SIZE - ZOOM_CONFIG.MIN_CARD_SIZE);
      setCardSize(Math.round(newSize));
    },
    [setCardSize]
  );

  const hasSelection = selectedCount > 0;

  // 파일이 없으면 렌더링하지 않음
  if (!hasFiles) return null;

  const label =
    selectionType === SELECTION_TYPE.PAGE
      ? `${selectedCount}개 페이지 선택됨`
      : `${selectedCount}개 파일 선택됨`;

  // Slider value는 0-100 범위로 변환
  const sliderValue = Math.round(
    ((cardSize - ZOOM_CONFIG.MIN_CARD_SIZE) /
      (ZOOM_CONFIG.MAX_CARD_SIZE - ZOOM_CONFIG.MIN_CARD_SIZE)) *
      100
  );

  const isMinZoom = cardSize <= ZOOM_CONFIG.MIN_CARD_SIZE;
  const isMaxZoom = cardSize >= ZOOM_CONFIG.MAX_CARD_SIZE;

  return (
    <div className="border-border bg-card fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl border px-6 py-3 shadow-2xl">
      {hasSelection ? (
        <>
          <span className="text-foreground text-sm font-medium">{label}</span>
          <div className="bg-border h-6 w-px" />
          <div className="flex items-center gap-2">
            <Tooltip content="왼쪽으로 회전">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onRotateCcw}
              >
                <RotateCcw size={16} />
              </Button>
            </Tooltip>
            <Tooltip content="오른쪽으로 회전">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onRotateCw}
              >
                <RotateCw size={16} />
              </Button>
            </Tooltip>
            <Tooltip content="삭제">
              <Button variant="ghost" size="sm" onClick={onDelete}>
                <Trash2 size={16} />
              </Button>
            </Tooltip>
          </div>
          <div className="bg-border h-6 w-px" />
          <Tooltip content="선택 해제">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onClearSelection}
              aria-label="선택 해제"
            >
              <X size={16} />
            </Button>
          </Tooltip>
        </>
      ) : (
        <>
          <Tooltip content="축소">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
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
              className="h-8 w-8"
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
        </>
      )}

      {/* 구분자 + 테마 토글 버튼 */}
      <div className="bg-border h-6 w-px" />
      <ThemeToggleButton />
    </div>
  );
}
