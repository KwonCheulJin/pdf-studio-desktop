import { Loader2, FileText } from "lucide-react";

interface UploadingCardProps {
  fileName: string;
}

/**
 * 파일 업로드 중 표시되는 로딩 카드
 * DocumentCard와 동일한 구조 (카드 + 텍스트 분리)
 */
export function UploadingCard({ fileName }: UploadingCardProps) {
  return (
    <div className="flex h-full w-full flex-col">
      {/* 카드 본체 - flex-1로 남은 공간 채우기 */}
      <div className="border-primary bg-card flex-1 cursor-default rounded-xl border border-dashed p-3 transition-all">
        {/* 썸네일 영역 - 로딩 스피너 */}
        <div className="bg-muted relative flex h-full w-full items-center justify-center overflow-hidden rounded-sm">
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <FileText size={32} className="text-muted-foreground" />
              <Loader2
                size={16}
                className="text-primary absolute -right-1 -bottom-1 animate-spin"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 텍스트 영역 (카드 외부, 분리, 가운데 정렬) */}
      <div className="mt-3 text-center">
        <p
          className="text-foreground truncate text-sm font-medium"
          title={fileName}
        >
          {fileName}
        </p>
        <p className="text-muted-foreground text-xs">업로드 중...</p>
      </div>
    </div>
  );
}
