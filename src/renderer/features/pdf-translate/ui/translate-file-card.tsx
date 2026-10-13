import { useRef } from "react";
import { FileUp } from "lucide-react";
import { formatFileSize } from "@/renderer/shared/lib/format-file-size";
import { useRenderedPage } from "@/renderer/shared/lib/pdfjs";
import { TRANSLATE_THUMBNAIL_RENDER } from "../config/translate-files";
import { useTranslateFile } from "../model/translate-session-store";
import { useTranslateFileDrop } from "../model/use-translate-file-drop";
import { useTranslateIntake } from "../model/use-translate-intake";

const EMPTY_ICON_SIZE = 20;

interface ThumbnailProps {
  path: string;
}

/** 첫 쪽 썸네일(시안 10: 72×102). 그리는 동안은 같은 크기의 빈 종이를 둔다. */
function Thumbnail({ path }: ThumbnailProps) {
  const { url } = useRenderedPage({
    path,
    pageIndex: TRANSLATE_THUMBNAIL_RENDER.FIRST_PAGE_INDEX,
    scale: TRANSLATE_THUMBNAIL_RENDER.SCALE,
    isEnabled: true
  });
  if (!url) {
    return (
      <div
        aria-hidden="true"
        className="bg-paper rounded-paper shadow-paper h-25.5 w-18 shrink-0"
      />
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="bg-paper rounded-paper shadow-paper h-25.5 w-auto max-w-30 shrink-0 object-contain"
    />
  );
}

/**
 * 번역할 문서 카드(시안 10 위쪽). 비어 있으면 누르거나 끌어다 놓는 점선 영역,
 * 채우면 첫 쪽 썸네일·이름·크기·쪽수와 "교체" 버튼이다. 파일을 끌어 카드 위에 올리면 `primary` 고리가 생긴다.
 * 창 어디에 놓아도 받는다(1개까지).
 */
export function TranslateFileCard() {
  const cardRef = useRef<HTMLElement>(null);
  const file = useTranslateFile();
  const { pickTranslateFile, placeTranslateFiles } = useTranslateIntake();
  const isDropTarget = useTranslateFileDrop({
    areaRef: cardRef,
    onDrop: (paths) => void placeTranslateFiles(paths)
  });

  return (
    <section
      ref={cardRef}
      aria-label="번역할 문서"
      className={`bg-card border-border flex items-center gap-5 rounded-xl border px-6 py-5 transition-shadow ${
        isDropTarget ? "ring-primary ring-2" : ""
      }`}
    >
      {file ? (
        <>
          <Thumbnail path={file.path} />
          <div className="flex min-w-0 grow flex-col gap-1">
            <span
              title={file.name}
              className="truncate text-[15px]/5.5 font-semibold"
            >
              {file.name}
            </span>
            <span className="text-muted-foreground font-mono text-xs/4">
              {formatFileSize(file.sizeBytes)} · {file.pageCount}쪽
            </span>
          </div>
          <button
            type="button"
            onClick={() => void pickTranslateFile()}
            className="border-border bg-card hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring h-7.5 shrink-0 rounded-md border px-3 text-[13px] transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            교체
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void pickTranslateFile()}
          className="border-input bg-card-inset hover:border-primary focus-visible:ring-ring flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none"
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
    </section>
  );
}
