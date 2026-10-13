import { FileSlots } from "@/renderer/features/pdf-compare";

/**
 * 비교 화면(시안 3). 위는 비교할 두 문서 슬롯이고, 그 아래 실행 전 옵션 카드와
 * 실행 줄은 Step 26에서 이 열에 더한다.
 */
export function ComparePage() {
  return (
    <div className="bg-canvas flex flex-1 flex-col gap-4 overflow-auto px-6 py-5 text-sm/5.25">
      <FileSlots />
    </div>
  );
}
