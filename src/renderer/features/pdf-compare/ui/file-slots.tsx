import { useRef } from "react";
import { ArrowLeftRight } from "lucide-react";
import { cn } from "@/renderer/shared/lib/utils";
import { COMPARE_SLOT } from "../config/compare-files";
import {
  useCompareSessionStore,
  useCompareSlotFile
} from "../model/compare-session-store";
import { useCompareIntake } from "../model/use-compare-intake";
import { useSlotFileDrop } from "../model/use-slot-file-drop";
import { FileSlot } from "./file-slot";

const SWAP_ICON_SIZE = 18;

/**
 * 비교할 두 문서(시안 3 위쪽): A(이전) 슬롯 · 맞바꾸기 · B(이후) 슬롯.
 * 슬롯을 누르면 열기 다이얼로그, 창 밖에서 끌어온 파일은 놓은 슬롯에 들어간다.
 * 슬롯 밖에 놓으면 빈 슬롯을 A → B 순서로 채운다(`planSlotPlacement`).
 */
export function FileSlots() {
  const beforeRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const before = useCompareSlotFile(COMPARE_SLOT.BEFORE);
  const after = useCompareSlotFile(COMPARE_SLOT.AFTER);
  const swapSlots = useCompareSessionStore((state) => state.swapSlots);
  const { pickCompareFiles, placeCompareFiles } = useCompareIntake();

  const activeSlot = useSlotFileDrop({
    slotRefs: {
      [COMPARE_SLOT.BEFORE]: beforeRef,
      [COMPARE_SLOT.AFTER]: afterRef
    },
    onDrop: (drop) => void placeCompareFiles(drop)
  });

  /** 드롭존이 하나라도 남아 있으면 남는 높이를 채운다. 둘 다 채우면 파일 카드는 제 높이로 위에 쌓는다. */
  const isFillingHeight = !before || !after;

  return (
    <section
      aria-label="비교할 문서"
      className={cn(
        "bg-card border-border flex gap-4 rounded-xl border px-6 py-5",
        isFillingHeight && "flex-1"
      )}
    >
      <FileSlot
        ref={beforeRef}
        slot={COMPARE_SLOT.BEFORE}
        file={before}
        isDropTarget={activeSlot === COMPARE_SLOT.BEFORE}
        onPick={() => void pickCompareFiles({ target: COMPARE_SLOT.BEFORE })}
      />
      <button
        type="button"
        aria-label="A와 B 바꾸기"
        disabled={!before && !after}
        onClick={swapSlots}
        className="border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring mt-7.5 flex size-10 shrink-0 items-center justify-center self-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        <ArrowLeftRight size={SWAP_ICON_SIZE} aria-hidden="true" />
      </button>
      <FileSlot
        ref={afterRef}
        slot={COMPARE_SLOT.AFTER}
        file={after}
        isDropTarget={activeSlot === COMPARE_SLOT.AFTER}
        onPick={() => void pickCompareFiles({ target: COMPARE_SLOT.AFTER })}
      />
    </section>
  );
}
