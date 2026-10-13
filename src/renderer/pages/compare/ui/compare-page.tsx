import {
  useCompareAfterFile,
  useCompareBeforeFile,
  type CompareFile
} from "@/renderer/features/pdf-compare";

interface SlotPlaceholderProps {
  badge: string;
  title: string;
  file: CompareFile | null;
}

/** 파일 슬롯 자리(시안 3 위쪽). 끌어 놓기·교체·맞바꾸기는 파일 슬롯(Step 25)에서 붙인다. */
function SlotPlaceholder({ badge, title, file }: SlotPlaceholderProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2 font-semibold">
        <span
          aria-hidden="true"
          className="bg-foreground text-background inline-flex size-5.5 items-center justify-center rounded-xs text-xs"
        >
          {badge}
        </span>
        {title}
      </div>
      <div className="border-input flex min-h-42 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center">
        {file ? (
          <span className="max-w-full truncate text-[15px]/5.5 font-semibold">
            {file.name}
          </span>
        ) : (
          <span className="text-muted-foreground">비어 있음</span>
        )}
      </div>
    </div>
  );
}

/** 비교 화면. 지금은 비교 세션에 든 두 문서만 보인다(옵션·실행은 다음 Step). */
export function ComparePage() {
  const before = useCompareBeforeFile();
  const after = useCompareAfterFile();

  return (
    <div className="bg-canvas flex flex-1 flex-col gap-4 overflow-auto px-6 py-5 text-sm/5.25">
      <section
        aria-label="비교할 문서"
        className="bg-card border-border grid grid-cols-2 gap-4 rounded-xl border px-6 py-5"
      >
        <SlotPlaceholder badge="A" title="이전 문서" file={before} />
        <SlotPlaceholder badge="B" title="이후 문서" file={after} />
      </section>
    </div>
  );
}
