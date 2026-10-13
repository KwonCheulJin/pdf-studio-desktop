import { useId, type RefObject } from "react";
import { FileUp } from "lucide-react";
import { formatFileSize } from "@/renderer/shared/lib/format-file-size";
import { useRenderedPage } from "@/renderer/shared/lib/pdfjs";
import { COMPARE_SLOT_LABEL, type CompareSlot } from "../config/compare-files";
import { SLOT_THUMBNAIL_RENDER } from "../config/slot-thumbnail";
import type { CompareFile } from "../model/compare-session-store";

const EMPTY_ICON_SIZE = 20;

/**
 * 슬롯 몸통: 시안 3의 12px 모서리, 옅은 면. 시안 HTML은 content-box라 `min-height: 168px`에
 * 패딩 32px·테두리 2px가 더해져 202px로 그려진다. 앱은 border-box라 그 높이(202px)를 그대로 쓴다.
 */
const SLOT_BODY_CLASS =
  "flex min-h-50.5 w-full flex-col items-center justify-center gap-2 rounded-lg border p-4 text-center transition-colors";
/** 끌어온 파일이 슬롯 위에 있을 때의 테두리·바탕. 평상시 테두리·바탕과 함께 붙이지 않는다. */
const DROP_TARGET_SURFACE_CLASS = "border-primary bg-accent";
const FILLED_SURFACE_CLASS = "border-border bg-card-inset";
/** 빈 슬롯은 누르는 컨트롤이라 테두리를 `input`(3:1)으로 둔다. */
const EMPTY_SURFACE_CLASS = "border-input bg-card-inset hover:border-primary";

interface SlotThumbnailProps {
  path: string;
}

/** 첫 쪽 썸네일. 그리는 동안은 같은 크기의 빈 종이를 둔다. */
function SlotThumbnail({ path }: SlotThumbnailProps) {
  const { url } = useRenderedPage({
    path,
    pageIndex: SLOT_THUMBNAIL_RENDER.FIRST_PAGE_INDEX,
    scale: SLOT_THUMBNAIL_RENDER.SCALE,
    isEnabled: true
  });
  if (!url) {
    return (
      <div
        aria-hidden="true"
        className="bg-paper rounded-paper shadow-paper h-15.5 w-11"
      />
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="bg-paper rounded-paper shadow-paper h-15.5 w-auto max-w-20 object-contain"
    />
  );
}

interface FileSlotProps {
  ref: RefObject<HTMLDivElement | null>;
  slot: CompareSlot;
  file: CompareFile | null;
  /** 끌어온 파일이 이 슬롯 위에 있다. */
  isDropTarget: boolean;
  /** 비어 있으면 고르기, 차 있으면 교체(열기 다이얼로그) */
  onPick: () => void;
}

/**
 * 비교 슬롯 하나(시안 3 위쪽). 빈 상태는 누르거나 끌어다 놓는 점선 영역,
 * 채운 상태는 첫 쪽 썸네일·이름·크기·쪽수와 "교체" 버튼이다.
 */
export function FileSlot({
  ref,
  slot,
  file,
  isDropTarget,
  onPick
}: FileSlotProps) {
  const titleId = useId();
  const { badge, title } = COMPARE_SLOT_LABEL[slot];
  const dropSurfaceClass = isDropTarget ? DROP_TARGET_SURFACE_CLASS : null;

  return (
    <div
      ref={ref}
      role="group"
      aria-labelledby={titleId}
      className="flex min-w-0 flex-1 flex-col gap-2"
    >
      <div className="flex items-center gap-2 font-semibold">
        <span
          aria-hidden="true"
          className="bg-foreground text-background inline-flex size-5.5 items-center justify-center rounded-xs text-xs"
        >
          {badge}
        </span>
        <span id={titleId}>{title}</span>
        {file && (
          <span className="bg-success-subtle text-success-subtle-foreground ml-1 rounded-full px-2 text-xs/5 font-medium">
            준비됨
          </span>
        )}
      </div>

      {file ? (
        <div
          className={`${SLOT_BODY_CLASS} ${dropSurfaceClass ?? FILLED_SURFACE_CLASS}`}
        >
          <SlotThumbnail path={file.path} />
          <span
            title={file.name}
            className="max-w-full truncate text-[15px]/5.5 font-semibold"
          >
            {file.name}
          </span>
          <span className="text-muted-foreground font-mono text-xs/4">
            {formatFileSize(file.sizeBytes)} · {file.pageCount}쪽
          </span>
          <button
            type="button"
            onClick={onPick}
            className="border-border bg-card hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring h-7 rounded-sm border px-2.5 text-[13px] transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            교체
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          className={`${SLOT_BODY_CLASS} ${dropSurfaceClass ?? EMPTY_SURFACE_CLASS} focus-visible:ring-ring border-dashed focus-visible:ring-2 focus-visible:outline-none`}
        >
          <FileUp
            size={EMPTY_ICON_SIZE}
            aria-hidden="true"
            className="text-muted-foreground"
          />
          <span className="font-medium">PDF 고르기</span>
          <span className="text-muted-foreground text-xs/4.25">
            또는 여기에 끌어다 놓기
          </span>
        </button>
      )}
    </div>
  );
}
