import { TranslateFileCard } from "@/renderer/features/pdf-translate";

/** 번역 화면(시안 10): 번역할 문서 카드. */
export function TranslatePage() {
  return (
    <div className="bg-canvas flex flex-1 flex-col gap-4 overflow-auto px-6 py-5 text-sm/5.25">
      <TranslateFileCard />
    </div>
  );
}
