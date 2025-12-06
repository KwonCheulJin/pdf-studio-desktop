import { Upload } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-6 rounded-xl bg-card p-8 shadow-sm">
      <div className="flex w-full flex-col items-center gap-6 rounded-xl border-2 border-dashed border-border px-6 py-14">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Upload size={32} />
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-lg font-bold leading-tight tracking-tight text-foreground">
            PDF 또는 TIFF 파일을 드래그 앤 드롭하세요
          </p>
          <p className="text-sm font-normal leading-normal text-muted-foreground">
            또는 &apos;파일 추가&apos; 버튼을 클릭하여 문서를 선택하세요
          </p>
        </div>
      </div>
    </div>
  );
}
