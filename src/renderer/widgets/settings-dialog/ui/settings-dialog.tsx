import { useId, useState } from "react";
import { ChevronLeft, X } from "lucide-react";
import { ErrorReportingSetting } from "@/renderer/features/error-reporting";
import { ThemeModeSetting } from "@/renderer/features/theme-toggle";
import {
  SharedGlossaryEditor,
  TranslationRecordsSetting
} from "@/renderer/features/translate-settings";
import { isErrorReportingAvailable } from "@/renderer/shared/lib/error-report";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle
} from "@/renderer/shared/ui";
import {
  SETTINGS_TAB,
  SETTINGS_TAB_LABEL,
  SETTINGS_TAB_ORDER,
  SETTINGS_TEXT,
  type SettingsTab
} from "../config/settings-dialog";
import { AboutTab } from "./about-tab";
import { SettingsTabList } from "./settings-tab-list";
import { TranslateTab } from "./translate-tab";

const HEADER_ICON_SIZE = 18;

/** 오류 보고 기능이 없는 빌드면 그 탭을 두지 않는다(Q9). */
function availableTabs(): readonly SettingsTab[] {
  return isErrorReportingAvailable()
    ? SETTINGS_TAB_ORDER
    : SETTINGS_TAB_ORDER.filter((tab) => tab !== SETTINGS_TAB.ERROR_REPORTING);
}

interface TabContentProps {
  tab: SettingsTab;
  onEditGlossary: () => void;
}

function TabContent({ tab, onEditGlossary }: TabContentProps) {
  switch (tab) {
    case SETTINGS_TAB.GENERAL:
      return (
        <>
          <ThemeModeSetting />
          <TranslationRecordsSetting />
        </>
      );
    case SETTINGS_TAB.TRANSLATE:
      return <TranslateTab onEditGlossary={onEditGlossary} />;
    case SETTINGS_TAB.ERROR_REPORTING:
      return <ErrorReportingSetting />;
    default:
      return <AboutTab />;
  }
}

/** 모달 안 내용. 모달이 닫히면 함께 사라져 다음에 열면 첫 탭부터다. */
function SettingsBody() {
  const idPrefix = useId();
  const panelId = `${idPrefix}-panel`;
  const tabs = availableTabs();
  const [selectedTab, setSelectedTab] = useState<SettingsTab>(tabs[0]);
  const [isEditingGlossary, setIsEditingGlossary] = useState(false);
  const tabId = (tab: SettingsTab) => `${idPrefix}-${tab}`;

  const handleSelectTab = (tab: SettingsTab) => {
    setSelectedTab(tab);
    setIsEditingGlossary(false);
  };

  return (
    <>
      <nav className="bg-card-inset border-border flex w-45 shrink-0 flex-col gap-0.5 border-r px-2.5 py-5">
        <DialogTitle className="mb-3 ml-2.5 text-lg/6.5 font-semibold">
          {SETTINGS_TEXT.TITLE}
        </DialogTitle>
        <SettingsTabList
          tabs={tabs}
          selectedTab={selectedTab}
          onSelect={handleSelectTab}
          tabId={tabId}
          panelId={panelId}
        />
      </nav>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId(selectedTab)}
        className="flex min-w-0 flex-1 flex-col"
      >
        <div className="flex items-center gap-1 px-6 pt-5 pb-2">
          {isEditingGlossary && (
            <button
              type="button"
              aria-label={SETTINGS_TEXT.BACK_TO_TRANSLATE}
              onClick={() => setIsEditingGlossary(false)}
              className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring -ml-2 flex size-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
            >
              <ChevronLeft size={HEADER_ICON_SIZE} aria-hidden="true" />
            </button>
          )}
          <h3 className="text-[15px]/5.5 font-semibold">
            {isEditingGlossary
              ? SETTINGS_TEXT.GLOSSARY_EDITOR_TITLE
              : SETTINGS_TAB_LABEL[selectedTab]}
          </h3>
          <span className="grow" />
          <DialogClose
            aria-label={SETTINGS_TEXT.CLOSE}
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <X size={HEADER_ICON_SIZE} aria-hidden="true" />
          </DialogClose>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5.5 overflow-y-auto px-6 pt-2 pb-6">
          {isEditingGlossary ? (
            <SharedGlossaryEditor />
          ) : (
            <TabContent
              tab={selectedTab}
              onEditGlossary={() => setIsEditingGlossary(true)}
            />
          )}
        </div>
      </div>
    </>
  );
}

interface SettingsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * 설정 모달(시안 14, 760×480): 왼쪽 탭(일반·번역·오류 보고·정보) + 오른쪽 내용과 닫기 ✕(Esc).
 * 바꾸면 바로 저장한다(저장 버튼이 없다).
 */
export function SettingsDialog({ isOpen, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="bg-card flex h-120 max-h-[calc(100%-3rem)] max-w-[calc(100%-3rem)] flex-row gap-0 overflow-hidden rounded-xl border-0 p-0 text-sm/5.25 shadow-xl sm:max-w-190"
      >
        <SettingsBody />
      </DialogContent>
    </Dialog>
  );
}
