import { useCallback } from "react";
import { toast } from "sonner";
import type { OpenedFile } from "@/renderer/shared/api/bindings";
import { FILE_EXTENSIONS } from "@/renderer/shared/constants/app";
import {
  getPlatform,
  PlatformError,
  toPlatformError
} from "@/renderer/shared/platform";
import {
  COMPARE_INTAKE_MESSAGE,
  COMPARE_SLOTS,
  compareFileMessage,
  type CompareSlot
} from "../config/compare-files";
import { notifyCompareFailure } from "../lib/notify-compare-failure";
import {
  planSlotPlacement,
  SLOT_PLACEMENT_KIND,
  type SlotAssignment
} from "../lib/plan-slot-placement";
import { useCompareSessionStore } from "./compare-session-store";

/** 받을 파일을 넣을 슬롯. `null`이면 슬롯 밖(홈 카드, 비교 화면의 슬롯 아닌 곳)이다. */
interface CompareIntakeTarget {
  target: CompareSlot | null;
}

export interface PlaceCompareFilesParams extends CompareIntakeTarget {
  paths: string[];
}

interface UseCompareIntakeResult {
  /** 열기 다이얼로그로 고른 파일을 넣는다. 하나라도 넣었으면 `true` */
  pickCompareFiles: (params: CompareIntakeTarget) => Promise<boolean>;
  /** 받은 경로(드롭)를 넣는다. 하나라도 넣었으면 `true` */
  placeCompareFiles: (params: PlaceCompareFilesParams) => Promise<boolean>;
}

/**
 * 비교는 PDF만 받는다. 확장자는 Rust가 열 수 있는 것(PDF·TIFF)만 허용 목록에 들어오므로
 * 여기서는 PDF인지만 본다(TIFF를 PDF로 바꾸는 일은 병합이 한다).
 */
function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(FILE_EXTENSIONS.PDF);
}

/** PDF가 아닌 파일은 열지 않고 알린다. */
async function rejectNonPdf(
  assignments: SlotAssignment[]
): Promise<SlotAssignment[]> {
  const platform = getPlatform();
  const nonPdf = assignments.filter(({ path }) => !isPdfPath(path));
  for (const { path } of nonPdf) {
    toast.error(compareFileMessage.notPdfTitle(await platform.fileStem(path)), {
      description: COMPARE_INTAKE_MESSAGE.NOT_PDF_DESCRIPTION
    });
  }
  return assignments.filter(({ path }) => isPdfPath(path));
}

/** 열지 못한 파일을 파일마다 알린다. 열지 못한 파일의 슬롯은 그대로 둔다. */
async function notifyOpenFailure(
  failure: Extract<OpenedFile, { status: "error" }>
): Promise<void> {
  const fileName = await getPlatform().fileStem(failure.sourcePath);
  notifyCompareFailure({
    title: compareFileMessage.openFailedTitle(fileName),
    error: new PlatformError(failure.error),
    context: `비교 파일 열기 실패: ${failure.sourcePath}`
  });
}

/**
 * 비교할 문서를 받아 슬롯(A·B)에 넣는다. 어느 슬롯에 넣을지는 `planSlotPlacement`가 정하고,
 * PDF만 열어 이름·크기·쪽수를 읽는다. 받지 못한 파일은 알리고 그 슬롯은 그대로 둔다.
 */
export function useCompareIntake(): UseCompareIntakeResult {
  const setSlotFile = useCompareSessionStore((state) => state.setSlotFile);

  const placeCompareFiles = useCallback(
    async ({ paths, target }: PlaceCompareFilesParams) => {
      const session = useCompareSessionStore.getState();
      const placement = planSlotPlacement({
        paths,
        target,
        filledSlots: COMPARE_SLOTS.filter((slot) => session[slot] !== null)
      });
      if (placement.kind === SLOT_PLACEMENT_KIND.TOO_MANY) {
        toast.error(COMPARE_INTAKE_MESSAGE.TOO_MANY_TITLE, {
          description: COMPARE_INTAKE_MESSAGE.TOO_MANY_DESCRIPTION
        });
        return false;
      }
      if (placement.kind === SLOT_PLACEMENT_KIND.SLOTS_FULL) {
        toast.error(COMPARE_INTAKE_MESSAGE.SLOTS_FULL_TITLE, {
          description: COMPARE_INTAKE_MESSAGE.SLOTS_FULL_DESCRIPTION
        });
        return false;
      }

      const assignments = await rejectNonPdf(placement.assignments);
      if (assignments.length === 0) return false;

      let openedFiles: OpenedFile[];
      try {
        openedFiles = await getPlatform().openFiles(
          assignments.map(({ path }) => path)
        );
      } catch (error) {
        notifyCompareFailure({
          title: COMPARE_INTAKE_MESSAGE.OPEN_FAILED_TITLE,
          error: toPlatformError(error),
          context: `비교 파일 열기 요청 실패: ${paths.join(", ")}`
        });
        return false;
      }

      let placedCount = 0;
      // `openFiles`는 입력 순서대로 파일별 결과를 돌려준다.
      for (const [index, opened] of openedFiles.entries()) {
        const assignment = assignments[index];
        if (assignment === undefined) continue;
        if (opened.status === "error") {
          await notifyOpenFailure(opened);
          continue;
        }
        setSlotFile({
          slot: assignment.slot,
          file: {
            path: opened.pdfPath,
            name: opened.displayName,
            sizeBytes: opened.sizeBytes,
            pageCount: opened.info.pageCount
          }
        });
        placedCount += 1;
      }
      return placedCount > 0;
    },
    [setSlotFile]
  );

  const pickCompareFiles = useCallback(
    async ({ target }: CompareIntakeTarget) => {
      let paths: string[];
      try {
        paths = await getPlatform().pickFiles();
      } catch (error) {
        notifyCompareFailure({
          title: COMPARE_INTAKE_MESSAGE.PICK_FAILED_TITLE,
          error: toPlatformError(error),
          context: "비교 파일 선택 다이얼로그 실패"
        });
        return false;
      }
      return placeCompareFiles({ paths, target });
    },
    [placeCompareFiles]
  );

  return { pickCompareFiles, placeCompareFiles };
}
