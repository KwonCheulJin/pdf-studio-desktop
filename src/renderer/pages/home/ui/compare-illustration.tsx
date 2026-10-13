import { ArrowLeftRight } from "lucide-react";

const ARROW_SIZE = 20;
const TEXT_LINE_CLASS = "bg-paper-line h-1.25 rounded-paper";
const MARK_LINE_CLASS = "h-1.75 rounded-paper";

/** 그림 속 글줄 하나. 폭은 Tailwind가 찾을 수 있게 클래스 전체를 적는다. */
interface SheetLine {
  id: string;
  className: string;
}

/** 이전 문서: 삭제(밑줄)와 변경(점선) */
const BEFORE_LINES: readonly SheetLine[] = [
  { id: "line-1", className: `${TEXT_LINE_CLASS} w-4/5` },
  { id: "line-2", className: `${TEXT_LINE_CLASS} w-full` },
  {
    id: "delete",
    className: `${MARK_LINE_CLASS} bg-diff-delete-fill border-diff-delete w-7/10 border-b`
  },
  { id: "line-3", className: `${TEXT_LINE_CLASS} w-9/10` },
  {
    id: "change",
    className: `${MARK_LINE_CLASS} bg-diff-change-fill outline-diff-change w-3/5 outline-1 outline-dashed`
  },
  { id: "line-4", className: `${TEXT_LINE_CLASS} w-17/20` }
];

/** 이후 문서: 추가(굵은 밑줄)와 변경(점선) */
const AFTER_LINES: readonly SheetLine[] = [
  { id: "line-1", className: `${TEXT_LINE_CLASS} w-4/5` },
  { id: "line-2", className: `${TEXT_LINE_CLASS} w-full` },
  {
    id: "insert",
    className: `${MARK_LINE_CLASS} bg-diff-insert-fill border-diff-insert w-3/4 border-b-2`
  },
  { id: "line-3", className: `${TEXT_LINE_CLASS} w-9/10` },
  {
    id: "change",
    className: `${MARK_LINE_CLASS} bg-diff-change-fill outline-diff-change w-11/20 outline-1 outline-dashed`
  },
  { id: "line-4", className: `${TEXT_LINE_CLASS} w-17/20` }
];

interface SheetProps {
  lines: readonly SheetLine[];
}

function Sheet({ lines }: SheetProps) {
  return (
    <div className="bg-paper shadow-paper rounded-paper flex h-29.5 w-21 flex-col gap-1.75 px-2.5 py-3.5">
      {lines.map((line) => (
        <div key={line.id} className={line.className} />
      ))}
    </div>
  );
}

/** 비교 카드 그림(시안 1): 이전 ↔ 이후 문서와 차이 표시 */
export function CompareIllustration() {
  return (
    <div
      aria-hidden="true"
      className="bg-canvas flex h-42 items-center justify-center gap-3 rounded-md"
    >
      <Sheet lines={BEFORE_LINES} />
      <ArrowLeftRight size={ARROW_SIZE} className="text-muted-foreground" />
      <Sheet lines={AFTER_LINES} />
    </div>
  );
}
