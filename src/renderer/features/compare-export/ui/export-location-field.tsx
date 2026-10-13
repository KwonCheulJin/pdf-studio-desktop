import { useId } from "react";
import { cn } from "@/renderer/shared/lib/utils";
import { Button } from "@/renderer/shared/ui";
import { EXPORT_TEXT } from "../config/export-report";

interface ExportLocationFieldProps {
  /** 고른 폴더. 아직 고르지 않았으면 `null` */
  directory: string | null;
  /** 만들 파일 이름(고른 받을 파일 순서) */
  fileNames: readonly string[];
  onPick: () => void;
  isDisabled: boolean;
}

/**
 * 저장 위치(시안 5): 고른 폴더(mono, 넘치면 말줄임) + "바꾸기"(폴더 다이얼로그), 아래에 만들 파일 이름.
 * 아직 고르지 않았으면 "아직 고르지 않았어요" + "고르기"다.
 */
export function ExportLocationField({
  directory,
  fileNames,
  onPick,
  isDisabled
}: ExportLocationFieldProps) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-2">
      <span id={titleId} className="text-[13px] font-semibold">
        {EXPORT_TEXT.LOCATION}
      </span>
      <div className="flex items-center gap-2">
        <span
          title={directory ?? undefined}
          className={cn(
            "bg-muted flex h-9 min-w-0 flex-1 items-center truncate rounded-sm px-3 text-xs",
            directory === null ? "text-muted-foreground" : "font-mono"
          )}
        >
          {directory ?? EXPORT_TEXT.LOCATION_EMPTY}
        </span>
        <Button
          variant="outline"
          disabled={isDisabled}
          onClick={onPick}
          className="bg-card h-9 rounded-md px-3 text-[13px] font-normal"
        >
          {directory === null
            ? EXPORT_TEXT.PICK_LOCATION
            : EXPORT_TEXT.CHANGE_LOCATION}
        </Button>
      </div>
      <span className="text-muted-foreground text-xs/4.25">
        {EXPORT_TEXT.FILES_TO_CREATE}{" "}
        <span className="font-mono">
          {fileNames.length > 0
            ? fileNames.join(", ")
            : EXPORT_TEXT.NO_FILES_TO_CREATE}
        </span>
      </span>
    </div>
  );
}
