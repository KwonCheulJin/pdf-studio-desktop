import {
  COMPARE_SCREEN,
  CompareOptionsCard,
  CompareProgressCard,
  FileSlots,
  useCompareScreen
} from "@/renderer/features/pdf-compare";
import { CompareResultScreen } from "./compare-result-screen";

/** 진행 카드를 가운데 위에 두는 바탕(시안 9: 위아래 40px, 좌우 24px) */
const CENTERED_SCREEN_CLASS =
  "bg-canvas flex flex-1 justify-center overflow-auto px-6 py-10 text-sm/5.25";

interface ComparePageProps {
  /** 옵션 카드의 "취소": 비교 화면을 떠난다(홈으로). */
  onExit: () => void;
}

/**
 * 비교 화면. 옵션 화면(시안 3: 문서 슬롯 + 실행 전 옵션 카드), 실행하면 그 자리에 진행 카드(시안 9),
 * 끝나면 결과 화면(시안 4)을 보인다.
 */
export function ComparePage({ onExit }: ComparePageProps) {
  const screen = useCompareScreen();

  switch (screen) {
    case COMPARE_SCREEN.PROGRESS:
      return (
        <div className={CENTERED_SCREEN_CLASS}>
          <CompareProgressCard />
        </div>
      );
    case COMPARE_SCREEN.RESULT:
      return <CompareResultScreen />;
    default:
      return (
        <div className="bg-canvas flex flex-1 flex-col gap-4 overflow-auto px-6 py-5 text-sm/5.25">
          <FileSlots />
          <CompareOptionsCard onCancel={onExit} />
        </div>
      );
  }
}
