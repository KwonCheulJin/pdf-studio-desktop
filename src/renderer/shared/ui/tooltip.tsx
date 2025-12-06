import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/renderer/shared/lib/utils";

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  /** Tooltip이 닫힐 때 지연 시간 (ms) - 퀵 액션 버튼처럼 사라지는 요소에 유용 */
  closeDelay?: number;
}

export function Tooltip({
  children,
  content,
  side = "top",
  sideOffset = 4,
  closeDelay = 0
}: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={100}>
      <TooltipPrimitive.Root delayDuration={300} disableHoverableContent={closeDelay === 0}>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={sideOffset}
            className={cn(
              "bg-foreground text-background z-50 rounded-md px-3 py-1.5 text-xs",
              "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-foreground" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
