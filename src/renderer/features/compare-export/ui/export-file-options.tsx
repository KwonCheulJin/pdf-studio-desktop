import { useId } from "react";
import type { ReportLayout } from "@/renderer/shared/api/bindings";
import { cn } from "@/renderer/shared/lib/utils";
import { Checkbox } from "@/renderer/shared/ui";
import {
  EXPORT_FILE_KIND,
  EXPORT_TEXT,
  REPORT_LAYOUT_LABEL,
  REPORT_LAYOUTS,
  type ExportFileKind
} from "../config/export-report";
import type { ExportSettings } from "../lib/export-settings";

/** 고른 파일 카드는 `primary` 테두리 + 3px `accent` 고리(시안 5), 아니면 `border` 테두리 */
const FILE_CARD_CLASS = {
  SELECTED: "border-primary ring-accent ring-3",
  IDLE: "border-border"
} as const;

interface ExportFileOptionsProps {
  settings: ExportSettings;
  onChange: (settings: ExportSettings) => void;
  /** "차이가 있는 쪽만 넣기" 옆 쪽수 변화 "(19쪽 → 6쪽)". 보이지 않을 때는 빈 글자 */
  pageChange: string;
}

interface FileCheckboxProps {
  kind: ExportFileKind;
  title: string;
  description: string;
  settings: ExportSettings;
  onChange: (settings: ExportSettings) => void;
}

/** 받을 파일 하나의 체크박스와 제목·설명(설명은 이름이 아니라 설명으로 읽힌다) */
function FileCheckbox({
  kind,
  title,
  description,
  settings,
  onChange
}: FileCheckboxProps) {
  const checkboxId = useId();
  const titleId = useId();
  const descriptionId = useId();
  return (
    <label
      htmlFor={checkboxId}
      className="flex cursor-pointer items-start gap-3"
    >
      <Checkbox
        id={checkboxId}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        checked={settings.files[kind]}
        onCheckedChange={(checked) =>
          onChange({
            ...settings,
            files: { ...settings.files, [kind]: checked === true }
          })
        }
        className="mt-0.75"
      />
      <span>
        <span id={titleId} className="font-semibold">
          {title}
        </span>
        <span
          id={descriptionId}
          className="text-muted-foreground block text-xs/4.25"
        >
          {description}
        </span>
      </span>
    </label>
  );
}

interface LayoutToggleProps {
  layout: ReportLayout;
  onSelect: (layout: ReportLayout) => void;
}

/** 쪽 구성 `A·B 나란히 | A만 | B만`(결과 화면 보기 방식과 같은 모양: `secondary` 바탕, 고른 칸은 카드색) */
function LayoutToggle({ layout, onSelect }: LayoutToggleProps) {
  return (
    <div
      role="group"
      aria-label={EXPORT_TEXT.LAYOUT}
      className="bg-secondary inline-flex gap-0.5 self-start rounded-md p-0.5"
    >
      {REPORT_LAYOUTS.map((option) => {
        const isActive = option === layout;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(option)}
            className={cn(
              "focus-visible:ring-ring h-6.5 rounded-sm px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none",
              isActive
                ? "bg-card text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {REPORT_LAYOUT_LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}

interface OptionCheckboxProps {
  label: string;
  isChecked: boolean;
  onCheckedChange: (isChecked: boolean) => void;
  /** 글자 뒤에 붙는 mono 덧붙임(쪽수 변화) */
  detail?: string;
}

function OptionCheckbox({
  label,
  isChecked,
  onCheckedChange,
  detail
}: OptionCheckboxProps) {
  const checkboxId = useId();
  return (
    <label
      htmlFor={checkboxId}
      className="flex cursor-pointer items-center gap-2 text-[13px] has-disabled:cursor-not-allowed"
    >
      <Checkbox
        id={checkboxId}
        aria-label={label}
        checked={isChecked}
        onCheckedChange={(checked) => onCheckedChange(checked === true)}
      />
      {label}
      {detail && (
        <span className="text-muted-foreground font-mono text-xs">
          {detail}
        </span>
      )}
    </label>
  );
}

/**
 * 받을 파일(시안 5): 비교 PDF(쪽 구성·차이 있는 쪽만·색 상자)와 주석 PDF. 비교 PDF를 끄면 하위 옵션을 막는다.
 */
export function ExportFileOptions({
  settings,
  onChange,
  pageChange
}: ExportFileOptionsProps) {
  const titleId = useId();
  const isCompareSelected = settings.files[EXPORT_FILE_KIND.COMPARE];
  const isAnnotatedSelected = settings.files[EXPORT_FILE_KIND.ANNOTATED];

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="flex flex-col gap-2.5"
    >
      <span id={titleId} className="text-[13px] font-semibold">
        {EXPORT_TEXT.FILES}
      </span>
      <div
        className={cn(
          "flex flex-col gap-3 rounded-lg border px-4 py-3.5",
          isCompareSelected ? FILE_CARD_CLASS.SELECTED : FILE_CARD_CLASS.IDLE
        )}
      >
        <FileCheckbox
          kind={EXPORT_FILE_KIND.COMPARE}
          title={EXPORT_TEXT.COMPARE_PDF}
          description={EXPORT_TEXT.COMPARE_PDF_DESCRIPTION}
          settings={settings}
          onChange={onChange}
        />
        <fieldset
          disabled={!isCompareSelected}
          className="border-border ml-7 flex flex-col gap-2.5 border-l-2 pl-3.5 disabled:opacity-50"
        >
          <LayoutToggle
            layout={settings.layout}
            onSelect={(layout) => onChange({ ...settings, layout })}
          />
          <OptionCheckbox
            label={EXPORT_TEXT.CHANGED_ONLY}
            isChecked={settings.isChangedOnly}
            onCheckedChange={(isChangedOnly) =>
              onChange({ ...settings, isChangedOnly })
            }
            detail={pageChange}
          />
          <OptionCheckbox
            label={EXPORT_TEXT.DRAW_BOXES}
            isChecked={settings.isBoxDrawn}
            onCheckedChange={(isBoxDrawn) =>
              onChange({ ...settings, isBoxDrawn })
            }
          />
        </fieldset>
      </div>
      <div
        className={cn(
          "rounded-lg border px-4 py-3.5",
          isAnnotatedSelected ? FILE_CARD_CLASS.SELECTED : FILE_CARD_CLASS.IDLE
        )}
      >
        <FileCheckbox
          kind={EXPORT_FILE_KIND.ANNOTATED}
          title={EXPORT_TEXT.ANNOTATED_PDF}
          description={EXPORT_TEXT.ANNOTATED_PDF_DESCRIPTION}
          settings={settings}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
