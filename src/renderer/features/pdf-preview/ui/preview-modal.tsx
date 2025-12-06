import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/renderer/shared/ui";
import { VirtuosoPreviewList } from "./virtuoso-preview-list";
import { SinglePagePreview } from "./single-page-preview";
import {
  PREVIEW_MODE,
  type PreviewTarget
} from "@/renderer/shared/constants/preview";
import { useFile } from "@/renderer/shared/model/merge-store";

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: PreviewTarget | null;
}

/**
 * PDF 미리보기 모달
 * - DOCUMENT 모드: 전체 페이지 가상화 스크롤
 * - PAGE 모드: 단일 페이지 표시
 * - 회전 상태는 merge-store에서 실시간 구독
 */
export function PreviewModal({ isOpen, onClose, target }: PreviewModalProps) {
  // target에서 기본 정보 추출 (null-safe)
  const documentId = target?.document.id ?? "";
  const initialPageIndex = target?.initialPageIndex ?? 0;
  const mode = target?.mode ?? PREVIEW_MODE.DOCUMENT;

  // merge-store에서 최신 파일 상태 구독 (회전 등 실시간 반영)
  const liveDocument = useFile(documentId);

  // target 또는 liveDocument가 없으면 렌더링 안함
  if (!target || !liveDocument) {
    return null;
  }

  // 실시간 document 사용
  const document = liveDocument;

  // 모달 타이틀 생성
  const getTitle = () => {
    if (mode === PREVIEW_MODE.PAGE) {
      return `${document.name} - ${initialPageIndex + 1}페이지`;
    }
    return document.name;
  };

  // 푸터 텍스트 생성
  const getFooterText = () => {
    if (mode === PREVIEW_MODE.PAGE) {
      return `${initialPageIndex + 1} / ${document.pageCount}페이지`;
    }
    return `${document.pageCount}페이지`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[80vh] flex-col gap-0 p-0">
        {/* 헤더 */}
        <DialogHeader className="border-border shrink-0 border-b px-6 py-4">
          <DialogTitle className="text-sm font-medium">
            {getTitle()}
          </DialogTitle>
        </DialogHeader>

        {/* 콘텐츠 */}
        <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
          {mode === PREVIEW_MODE.DOCUMENT ? (
            <VirtuosoPreviewList document={document} isOpen={isOpen} />
          ) : (
            <SinglePagePreview
              document={document}
              pageIndex={initialPageIndex}
            />
          )}
        </div>

        {/* 푸터 */}
        <DialogFooter className="border-border shrink-0 justify-center border-t px-6 py-3">
          <span className="text-muted-foreground text-xs">
            {getFooterText()}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
