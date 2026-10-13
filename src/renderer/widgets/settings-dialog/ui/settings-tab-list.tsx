import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/renderer/shared/lib/utils";
import {
  SETTINGS_TAB_LABEL,
  SETTINGS_TEXT,
  TAB_ARROW_STEP,
  type SettingsTab
} from "../config/settings-dialog";

interface SettingsTabListProps {
  tabs: readonly SettingsTab[];
  selectedTab: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
  tabId: (tab: SettingsTab) => string;
  panelId: string;
}

/** 왼쪽 세로 탭 목록. 고른 탭만 Tab으로 들어오고 ↑↓로 옮기면 바로 그 탭을 연다. */
export function SettingsTabList({
  tabs,
  selectedTab,
  onSelect,
  tabId,
  panelId
}: SettingsTabListProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = TAB_ARROW_STEP[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = tabs.indexOf(selectedTab);
    const nextIndex = (index + step + tabs.length) % tabs.length;
    onSelect(tabs[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={SETTINGS_TEXT.TAB_LIST}
      aria-orientation="vertical"
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-0.5"
    >
      {tabs.map((tab, index) => {
        const isSelected = tab === selectedTab;
        return (
          <button
            key={tab}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={tabId(tab)}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-controls={panelId}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(tab)}
            className={cn(
              "focus-visible:ring-ring h-8.5 rounded-sm px-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
              isSelected
                ? "bg-accent text-accent-foreground font-semibold"
                : "text-foreground hover:bg-secondary"
            )}
          >
            {SETTINGS_TAB_LABEL[tab]}
          </button>
        );
      })}
    </div>
  );
}
