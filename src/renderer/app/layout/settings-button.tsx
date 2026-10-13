import { Settings } from "lucide-react";
import { Button } from "@/renderer/shared/ui";

const SETTINGS_ICON_SIZE = 18;

interface SettingsButtonProps {
  onClick: () => void;
}

/** 머리 오른쪽 톱니(시안 1·10). 홈·번역 화면에 둔다(Q16). */
export function SettingsButton({ onClick }: SettingsButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="설정"
      onClick={onClick}
      className="text-muted-foreground ml-auto size-8 rounded-md"
    >
      <Settings size={SETTINGS_ICON_SIZE} aria-hidden="true" />
    </Button>
  );
}
