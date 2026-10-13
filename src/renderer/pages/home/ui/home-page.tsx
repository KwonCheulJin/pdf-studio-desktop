import { useCallback, useRef } from "react";
import { Shield } from "lucide-react";
import { useAddDroppedFiles, useAddFiles } from "@/renderer/features/pdf-merge";
import { useCompareIntake } from "@/renderer/features/pdf-compare";
import { useTranslateIntake } from "@/renderer/features/pdf-translate";
import { HOME_CARD } from "../config/home-card";
import {
  useCardFileDrop,
  type CardFileDrop
} from "../model/use-card-file-drop";
import { CompareIllustration } from "./compare-illustration";
import { MergeIllustration } from "./merge-illustration";
import { TaskCard } from "./task-card";
import { TranslateIllustration } from "./translate-illustration";

const NOTICE_ICON_SIZE = 14;

interface HomePageProps {
  /** 병합 작업 공간에 문서를 넣은 뒤 불린다. */
  onEnterMerge: () => void;
  /** 비교 세션에 문서를 넣은 뒤 불린다. */
  onEnterCompare: () => void;
  /** 번역할 문서를 넣은 뒤 불린다. */
  onEnterTranslate: () => void;
}

/**
 * 첫 화면(시안 1): 작업 고르기 카드 3장. 카드의 버튼으로 파일을 고르거나 카드 위에 파일을 놓으면
 * 그 작업에 파일을 넣고 모드를 바꾼다. 고르기를 취소했거나 아무것도 넣지 못하면 홈에 남는다.
 */
export function HomePage({
  onEnterMerge,
  onEnterCompare,
  onEnterTranslate
}: HomePageProps) {
  const mergeCardRef = useRef<HTMLElement>(null);
  const compareCardRef = useRef<HTMLElement>(null);
  const translateCardRef = useRef<HTMLElement>(null);
  const { handleAddFiles } = useAddFiles();
  const addDroppedFiles = useAddDroppedFiles();
  const { pickCompareFiles, placeCompareFiles } = useCompareIntake();
  const { pickTranslateFile, placeTranslateFiles } = useTranslateIntake();

  const handlePickMerge = useCallback(async () => {
    if ((await handleAddFiles()) > 0) onEnterMerge();
  }, [handleAddFiles, onEnterMerge]);

  const handlePickCompare = useCallback(async () => {
    if (await pickCompareFiles({ target: null })) onEnterCompare();
  }, [pickCompareFiles, onEnterCompare]);

  const handlePickTranslate = useCallback(async () => {
    if (await pickTranslateFile()) onEnterTranslate();
  }, [pickTranslateFile, onEnterTranslate]);

  const handleCardDrop = useCallback(
    async ({ card, paths }: CardFileDrop) => {
      if (card === HOME_CARD.MERGE) {
        const added = await addDroppedFiles({ paths, targetPageId: null });
        if (added > 0) onEnterMerge();
        return;
      }
      if (card === HOME_CARD.COMPARE) {
        if (await placeCompareFiles({ paths, target: null })) onEnterCompare();
        return;
      }
      if (await placeTranslateFiles(paths)) onEnterTranslate();
    },
    [
      addDroppedFiles,
      placeCompareFiles,
      placeTranslateFiles,
      onEnterMerge,
      onEnterCompare,
      onEnterTranslate
    ]
  );

  const activeCard = useCardFileDrop({
    cardRefs: {
      [HOME_CARD.MERGE]: mergeCardRef,
      [HOME_CARD.COMPARE]: compareCardRef,
      [HOME_CARD.TRANSLATE]: translateCardRef
    },
    onDrop: (drop) => void handleCardDrop(drop)
  });

  return (
    <div className="bg-canvas flex flex-1 justify-center overflow-auto px-6 py-12 text-sm/5.25">
      <div className="flex w-full max-w-240 flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">어떤 작업을 할까요?</h1>
          <p className="text-muted-foreground">
            카드를 누르거나 파일을 카드 위에 끌어다 놓으면 바로 시작해요.
          </p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,17.5rem),1fr))] gap-4">
          <TaskCard
            ref={mergeCardRef}
            title="PDF 병합"
            description="여러 PDF와 TIFF를 한 파일로 합쳐요. 페이지 순서를 바꾸고, 돌리고, 뺄 수 있어요."
            actionLabel="파일 선택"
            caption="PDF, TIFF · 여러 개"
            isDropTarget={activeCard === HOME_CARD.MERGE}
            illustration={<MergeIllustration />}
            onAction={handlePickMerge}
          />
          <TaskCard
            ref={compareCardRef}
            title="PDF 비교"
            description="두 PDF에서 달라진 글자를 찾아 나란히 보여 줘요. 추가, 삭제, 변경을 페이지 위에 표시해요."
            actionLabel="두 파일 선택"
            caption="PDF · 이전과 이후 2개"
            isDropTarget={activeCard === HOME_CARD.COMPARE}
            illustration={<CompareIllustration />}
            onAction={handlePickCompare}
          />
          <TaskCard
            ref={translateCardRef}
            title="PDF 번역"
            description="중국어·영어 PDF를 한국어로 옮겨 원문과 나란히 보여 줘요. 내 Claude API 키로 실행해요."
            actionLabel="파일 선택"
            actionAriaLabel="번역할 파일 선택"
            caption="PDF 1개 · 인터넷 연결 필요"
            isDropTarget={activeCard === HOME_CARD.TRANSLATE}
            illustration={<TranslateIllustration />}
            onAction={handlePickTranslate}
          />
        </div>

        <p className="text-muted-foreground flex items-center gap-2 text-xs/4.25">
          <Shield size={NOTICE_ICON_SIZE} aria-hidden="true" />
          원본 파일은 바뀌지 않아요. 결과는 저장할 곳을 골라 새 파일로 만들어요.
        </p>
      </div>
    </div>
  );
}
