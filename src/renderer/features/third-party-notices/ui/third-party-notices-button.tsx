import { useCallback, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/renderer/shared/ui";
import { NOTICES_STATUS } from "../config/notices-status";
import {
  useThirdPartyNotices,
  type ThirdPartyNotices
} from "../model/use-third-party-notices";

const NOTICES_TITLE = "오픈소스 라이선스";

interface NoticesBodyProps {
  notices: ThirdPartyNotices;
}

function NoticesBody({ notices }: NoticesBodyProps) {
  switch (notices.status) {
    case NOTICES_STATUS.LOADED:
      return (
        <pre className="text-foreground font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
          {notices.text}
        </pre>
      );
    case NOTICES_STATUS.FAILED:
      return (
        <p role="alert" className="text-destructive text-sm">
          {notices.errorMessage}
        </p>
      );
    default:
      return <p className="text-muted-foreground text-sm">불러오는 중…</p>;
  }
}

interface ThirdPartyNoticesButtonProps {
  /** 버튼 모양을 바꿀 때(설정 › 정보). 없으면 상태바의 글자 버튼 */
  className?: string;
}

/** 앱 정보: 번들한 제3자 고지(THIRD_PARTY_NOTICES.md)를 대화상자로 보여 준다. */
export function ThirdPartyNoticesButton({
  className = "text-muted-foreground text-sm font-normal"
}: ThirdPartyNoticesButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { notices, loadNotices } = useThirdPartyNotices();

  const isLoaded = notices.status === NOTICES_STATUS.LOADED;
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open && !isLoaded) {
        void loadNotices();
      }
    },
    [isLoaded, loadNotices]
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={className}>
          {NOTICES_TITLE}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[80vh] flex-col gap-0 p-0">
        <DialogHeader className="border-border shrink-0 border-b px-6 py-4">
          <DialogTitle>{NOTICES_TITLE}</DialogTitle>
          <DialogDescription>
            PDF Studio는 MIT 라이선스로 배포됩니다. 앱에 함께 들어 있는 제3자
            소프트웨어의 라이선스 고지입니다.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <NoticesBody notices={notices} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
