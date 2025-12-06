import { Upload } from "lucide-react";
import { Button } from "@/renderer/shared/ui";
import { useAddFiles } from "@/renderer/shared/hooks/use-add-files";

export function EmptyState() {
  const { handleAddFiles } = useAddFiles();

  return (
    <div className="bg-card flex w-full max-w-3xl flex-col items-center gap-6 rounded-xl p-8 shadow-sm">
      <div className="border-border flex w-full flex-col items-center gap-6 rounded-xl border-2 border-dashed px-6 py-14">
        <div className="bg-primary/10 text-primary flex h-16 w-16 items-center justify-center rounded-full">
          <Upload size={32} />
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-foreground text-lg leading-tight font-bold tracking-tight">
            PDF 또는 TIFF 파일을 드래그 앤 드롭하세요
          </p>
          <p className="text-muted-foreground text-sm leading-normal font-normal">
            또는 아래 버튼을 클릭하여 문서를 선택하세요
          </p>
        </div>
        <Button onClick={handleAddFiles}>파일 선택</Button>
      </div>
    </div>
  );
}
