import { ChevronLeft, Download, Ellipsis } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/renderer/shared/ui";
import { COMPARE_SLOT_LABEL, COMPARE_SLOTS } from "../config/compare-files";
import {
  COMPARE_RESULT_TEXT,
  compareResultMessage
} from "../config/compare-result";
import {
  useCompareSessionStore,
  useCompletedComparison
} from "../model/compare-session-store";
import { useCompareExecution } from "../model/use-compare-execution";

const BACK_ICON_SIZE = 18;
const EXPORT_ICON_SIZE = 16;
const MORE_ICON_SIZE = 18;

/**
 * 결과 화면 머리(시안 4, 모드 탭 오른쪽): 뒤로(옵션 화면), 제목 "A → B", 두 문서의 이름·쪽수와
 * 걸린 시간, "새 비교", "내보내기"(Step 29), ⋯(다시 실행).
 */
export function CompareResultHeading() {
  const completed = useCompletedComparison();
  const showOptions = useCompareSessionStore((state) => state.showOptions);
  const startNewCompare = useCompareSessionStore(
    (state) => state.startNewCompare
  );
  const { startCompare } = useCompareExecution();
  if (!completed) return null;
  const { files, elapsedMs } = completed;
  const title = COMPARE_SLOTS.map((slot) => files[slot].name).join(" → ");

  return (
    <>
      <button
        type="button"
        aria-label={COMPARE_RESULT_TEXT.BACK_TO_OPTIONS}
        onClick={showOptions}
        className="hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex size-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronLeft size={BACK_ICON_SIZE} aria-hidden="true" />
      </button>
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-[15px]/5.5 font-semibold">{title}</h1>
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs/4">
          {COMPARE_SLOTS.map((slot) => (
            <span key={slot}>
              {COMPARE_SLOT_LABEL[slot].badge} {files[slot].name} ·{" "}
              {files[slot].pageCount}쪽
            </span>
          ))}
          <span>{compareResultMessage.elapsed(elapsedMs)}</span>
        </span>
      </div>
      <span className="grow" />
      <Button
        variant="outline"
        onClick={startNewCompare}
        className="border-primary text-primary bg-card h-9 rounded-md px-3.5 font-normal"
      >
        {COMPARE_RESULT_TEXT.NEW_COMPARE}
      </Button>
      <Button disabled className="h-8.5 gap-1.5 rounded-md px-3.5 font-medium">
        <Download size={EXPORT_ICON_SIZE} aria-hidden="true" />
        {COMPARE_RESULT_TEXT.EXPORT}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={COMPARE_RESULT_TEXT.MORE}
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex size-8.5 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <Ellipsis size={MORE_ICON_SIZE} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void startCompare()}>
            {COMPARE_RESULT_TEXT.RERUN}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
