import { useRef } from "react";
import { FileUp } from "lucide-react";
import {
  DETECTED_LANGUAGE,
  DETECTED_LANGUAGE_LABEL
} from "@/renderer/entities/translation";
import type { TranslationPlan } from "@/renderer/shared/api/bindings";
import { formatFileSize } from "@/renderer/shared/lib/format-file-size";
import { useRenderedPage } from "@/renderer/shared/lib/pdfjs";
import { cn } from "@/renderer/shared/lib/utils";
import { TRANSLATE_THUMBNAIL_RENDER } from "../config/translate-files";
import {
  TRANSLATE_OPTIONS_TEXT,
  translateOptionsText
} from "../config/translate-options";
import {
  useTranslateFile,
  useTranslateFilePlan,
  type TranslateFile
} from "../model/translate-session-store";
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

interface FileMetaProps {
  file: TranslateFile;
  /** 이 문서로 받은 계획. 받기 전이면 크기·쪽수만 */
  plan: TranslationPlan | null;
}

/** mono 줄(`2.8 MB · 24쪽 · 글자층 22쪽 / 스캔 2쪽`)과 감지 배지 */
function FileMeta({ file, plan }: FileMetaProps) {
  const meta = [
    formatFileSize(file.sizeBytes),
    translateOptionsText.pages(file.pageCount),
    ...(plan === null ? [] : [translateOptionsText.pageKinds(plan)])
  ];
  const detected = plan?.detectedLanguage;
  return (
    <>
      <span className="text-muted-foreground font-mono text-xs/4">
        {meta.join(" · ")}
      </span>
      {detected !== undefined && (
        <span className="flex text-xs/4.25">
          <span className="bg-accent text-accent-foreground rounded-full px-2 leading-5 font-medium">
            {detected === DETECTED_LANGUAGE.UNKNOWN
              ? TRANSLATE_OPTIONS_TEXT.UNKNOWN_LANGUAGE_BADGE
              : translateOptionsText.detectedBadge(
                  DETECTED_LANGUAGE_LABEL[detected]
                )}
          </span>
        </span>
      )}
    </>
  );
}

/**
 * 번역할 문서 카드(시안 10 위쪽). 비어 있으면 누르거나 끌어다 놓는 점선 영역,
 * 채우면 첫 쪽 썸네일·이름·크기·쪽수(계획을 받으면 글자층·스캔 쪽 수와 감지 배지)와 "교체" 버튼이다. 파일을 끌어 카드 위에 올리면 `primary` 고리가 생긴다.
 * 창 어디에 놓아도 받는다(1개까지).
 */
export function TranslateFileCard() {
  const cardRef = useRef<HTMLElement>(null);
  const file = useTranslateFile();
  const plan = useTranslateFilePlan();
  const { pickTranslateFile, placeTranslateFiles } = useTranslateIntake();
  const isDropTarget = useTranslateFileDrop({
    areaRef: cardRef,
    onDrop: (paths) => void placeTranslateFiles(paths)
  });

  return (
    <section
      ref={cardRef}
      aria-label="번역할 문서"
      className={cn(
        "bg-card border-border flex items-center gap-5 rounded-xl border px-6 py-5 transition-shadow",
        // 비어 있으면 왼쪽 열의 남는 높이를 채운다(번역 옵션 카드는 열 아래에 붙는다)
        !file && "grow items-stretch",
        isDropTarget && "ring-primary ring-2"
      )}
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
            <FileMeta file={file} plan={plan} />
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
