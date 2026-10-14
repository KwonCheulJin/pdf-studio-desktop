import { useCallback, useRef } from "react";
import { Shield } from "lucide-react";
import { useAddDroppedFiles } from "@/renderer/features/pdf-merge";
import { useCompareIntake } from "@/renderer/features/pdf-compare";
import { useTranslateIntake } from "@/renderer/features/pdf-translate";
import { HOME_CARD } from "../config/home-card";
import { HOME_LAYOUT, HOME_TEST_ID } from "../config/home-layout";
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
  /** 병합 화면으로 간다(카드를 눌렀거나 문서를 넣은 뒤). */
  onEnterMerge: () => void;
  /** 비교 화면으로 간다(카드를 눌렀거나 문서를 넣은 뒤). */
  onEnterCompare: () => void;
  /** 번역 화면으로 간다(카드를 눌렀거나 문서를 넣은 뒤). */
  onEnterTranslate: () => void;
}

/**
 * 첫 화면(시안 1): 작업 고르기 카드 3장. 카드를 누르면 파일 없이 그 작업의 빈 화면으로 가고,
 * 카드 위에 파일을 놓으면 그 파일을 넣고 간다. 아무것도 넣지 못하면 홈에 남는다.
 */
export function HomePage({
  onEnterMerge,
  onEnterCompare,
  onEnterTranslate
}: HomePageProps) {
  const mergeCardRef = useRef<HTMLElement>(null);
  const compareCardRef = useRef<HTMLElement>(null);
  const translateCardRef = useRef<HTMLElement>(null);
  const addDroppedFiles = useAddDroppedFiles();
  const { placeCompareFiles } = useCompareIntake();
  const { placeTranslateFiles } = useTranslateIntake();

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
    <div
      data-testid={HOME_TEST_ID.PAGE}
      className="bg-canvas flex flex-1 overflow-auto px-6 py-12 text-sm/5.25"
    >
      {/* m-auto: 남는 공간의 가로·세로 가운데. 넘치면 위에서부터 스크롤(잘림 없음). */}
      <div
        data-testid={HOME_TEST_ID.CONTENT}
        className={`m-auto flex w-full flex-col gap-8 ${HOME_LAYOUT.CONTENT_WIDTH}`}
      >
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
            caption="PDF, TIFF · 여러 개"
            isDropTarget={activeCard === HOME_CARD.MERGE}
            illustration={<MergeIllustration />}
            onNavigate={onEnterMerge}
          />
          <TaskCard
            ref={compareCardRef}
            title="PDF 비교"
            description="두 PDF에서 달라진 글자를 찾아 나란히 보여 줘요. 추가, 삭제, 변경을 페이지 위에 표시해요."
            caption="PDF · 이전과 이후 2개"
            isDropTarget={activeCard === HOME_CARD.COMPARE}
            illustration={<CompareIllustration />}
            onNavigate={onEnterCompare}
          />
          <TaskCard
            ref={translateCardRef}
            title="PDF 번역"
            description="중국어·영어 PDF를 한국어로 옮겨 원문과 나란히 보여 줘요. 내 Claude API 키로 실행해요."
            caption="PDF 1개 · 인터넷 연결 필요"
            isDropTarget={activeCard === HOME_CARD.TRANSLATE}
            illustration={<TranslateIllustration />}
            onNavigate={onEnterTranslate}
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
