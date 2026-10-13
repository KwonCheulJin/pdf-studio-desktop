import { useId } from "react";
import { CircleAlert } from "lucide-react";
import {
  GlossaryTable,
  normalizeGlossary,
  toGlossaryTerms,
  type GlossaryRow
} from "@/renderer/entities/glossary";
import {
  RECOMMENDED_MODEL_BADGE,
  TARGET_LANGUAGE_LABEL,
  TRANSLATE_MODEL_INFO,
  TRANSLATE_MODEL_ORDER
} from "@/renderer/entities/translation";
import type { TranslateModel } from "@/renderer/shared/api/bindings";
import { cn } from "@/renderer/shared/lib/utils";
import { Checkbox, SegmentedControl } from "@/renderer/shared/ui";
import {
  rangeErrorMessage,
  SOURCE_LANGUAGE_OPTIONS,
  TRANSLATE_OPTIONS_TEXT,
  translateOptionsText
} from "../config/translate-options";
import { translateRangeErrorOf } from "../lib/translate-range";
import {
  useTranslateFile,
  useTranslateFilePlan,
  useTranslateSessionOptions,
  useTranslateSessionStore
} from "../model/translate-session-store";

const ERROR_ICON_SIZE = 14;

const FIELD_LABEL_CLASS = "text-[13px] font-semibold";

/** 페이지 범위(비교와 같은 문법·검사·문구). 끝에 `/ N쪽`, 틀리면 빨간 테두리와 아래 이유 */
function PageRangeField() {
  const inputId = useId();
  const errorId = useId();
  const file = useTranslateFile();
  const range = useTranslateSessionOptions().range;
  const setRange = useTranslateSessionStore((state) => state.setRange);
  const rangeError = translateRangeErrorOf({ file, range });
  const errorMessage =
    file && rangeError
      ? rangeErrorMessage({ error: rangeError, pageCount: file.pageCount })
      : null;

  return (
    <>
      <label
        htmlFor={inputId}
        className={cn(FIELD_LABEL_CLASS, "flex h-8.5 items-center self-start")}
      >
        {TRANSLATE_OPTIONS_TEXT.RANGE}
      </label>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="text"
            value={range}
            placeholder={TRANSLATE_OPTIONS_TEXT.RANGE_PLACEHOLDER}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={errorMessage !== null}
            aria-describedby={errorMessage ? errorId : undefined}
            onChange={(event) => setRange(event.target.value)}
            className={cn(
              "bg-card placeholder:text-muted-foreground focus-visible:ring-ring h-8.5 w-55 max-w-full rounded-sm border px-2.5 focus-visible:ring-2 focus-visible:outline-none",
              errorMessage ? "border-destructive" : "border-input"
            )}
          />
          {file && (
            <span className="text-muted-foreground shrink-0 font-mono text-xs">
              {translateOptionsText.pageCount(file.pageCount)}
            </span>
          )}
        </div>
        {errorMessage && (
          <p
            id={errorId}
            className="text-destructive flex items-center gap-1 text-xs/4.25"
          >
            <CircleAlert
              size={ERROR_ICON_SIZE}
              aria-hidden="true"
              className="shrink-0"
            />
            {errorMessage}
          </p>
        )}
      </div>
    </>
  );
}

interface ModelCardsProps {
  /** 고른 모델(고르지 않았으면 설정의 기본 모델) */
  model: TranslateModel;
}

/** 모델 라디오 카드 두 장(시안 10). 고른 카드는 `primary` 테두리 + `accent` 3px 고리 */
function ModelCards({ model }: ModelCardsProps) {
  const name = useId();
  const setModel = useTranslateSessionStore((state) => state.setModel);

  return (
    <div
      role="radiogroup"
      aria-label={TRANSLATE_OPTIONS_TEXT.MODEL}
      className="grid grid-cols-2 gap-2.5"
    >
      {TRANSLATE_MODEL_ORDER.map((option) => {
        const info = TRANSLATE_MODEL_INFO[option];
        const isChecked = option === model;
        return (
          <label
            key={option}
            className={cn(
              "has-focus-visible:ring-ring flex cursor-pointer items-start gap-2.5 rounded-lg border px-3.5 py-3 has-focus-visible:ring-2",
              isChecked ? "border-primary ring-accent ring-3" : "border-border"
            )}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={isChecked}
              onChange={() => setModel(option)}
              className="border-input bg-card checked:border-primary mt-0.75 size-3.5 shrink-0 appearance-none rounded-full border outline-none checked:border-4"
            />
            <span className="min-w-0">
              <span className="font-semibold">{info.name}</span>
              {info.isRecommended && (
                <span className="bg-accent text-accent-foreground ml-1 rounded-full px-1.5 text-[11px]/4.5">
                  {RECOMMENDED_MODEL_BADGE}
                </span>
              )}
              <span className="text-muted-foreground block text-xs/4.25">
                {info.description}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** 스캔 쪽 그림을 읽어 번역할지(기본 끔). 스캔 쪽이 없으면 행 대신 "스캔 쪽 없음" */
function ScanPagesOption() {
  const file = useTranslateFile();
  const plan = useTranslateFilePlan();
  const isChecked = useTranslateSessionOptions().includeScanPages;
  const setIncludeScanPages = useTranslateSessionStore(
    (state) => state.setIncludeScanPages
  );

  if (plan !== null && plan.scanPages === 0) {
    return (
      <span className="text-muted-foreground">
        {TRANSLATE_OPTIONS_TEXT.NO_SCAN_PAGES}
      </span>
    );
  }
  const count =
    plan === null ? TRANSLATE_OPTIONS_TEXT.PENDING : String(plan.scanPages);
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <Checkbox
        checked={isChecked}
        disabled={file === null}
        onCheckedChange={(checked) => setIncludeScanPages(checked === true)}
      />
      <span>
        {translateOptionsText.scanOption(count)}{" "}
        <span className="text-muted-foreground text-xs">
          {TRANSLATE_OPTIONS_TEXT.SCAN_TOKEN_NOTE}
        </span>
      </span>
    </label>
  );
}

interface TranslateOptionsCardProps {
  /** 설정의 기본 모델(옵션에서 고르지 않았으면 이것) */
  defaultModel: TranslateModel;
  /** 설정의 공용 용어집 표. 번역에 실리는 수를 안내한다. */
  sharedGlossaryRows: readonly GlossaryRow[];
}

/**
 * 번역 옵션 카드(시안 10): 원문 언어 · 번역 언어(고정) · 페이지 범위 · 모델 · 문서별 용어집 · 스캔 페이지.
 * 바꾸면 실행 전 확인의 계획을 다시 받는다.
 */
export function TranslateOptionsCard({
  defaultModel,
  sharedGlossaryRows
}: TranslateOptionsCardProps) {
  const titleId = useId();
  const options = useTranslateSessionOptions();
  const setSourceLanguage = useTranslateSessionStore(
    (state) => state.setSourceLanguage
  );
  const setGlossaryRows = useTranslateSessionStore(
    (state) => state.setGlossaryRows
  );
  const sharedTermCount = normalizeGlossary(
    toGlossaryTerms(sharedGlossaryRows)
  ).length;

  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex flex-col rounded-xl border"
    >
      <h2 id={titleId} className="px-6 pt-4.5 pb-1 text-lg/6.5 font-semibold">
        {TRANSLATE_OPTIONS_TEXT.OPTIONS_TITLE}
      </h2>
      <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-x-5 gap-y-4 px-6 pt-3 pb-5">
        <span className={FIELD_LABEL_CLASS}>
          {TRANSLATE_OPTIONS_TEXT.SOURCE_LANGUAGE}
        </span>
        <div className="justify-self-start">
          <SegmentedControl
            label={TRANSLATE_OPTIONS_TEXT.SOURCE_LANGUAGE}
            options={SOURCE_LANGUAGE_OPTIONS}
            value={options.sourceLanguage}
            onChange={setSourceLanguage}
          />
        </div>

        <span className={FIELD_LABEL_CLASS}>
          {TRANSLATE_OPTIONS_TEXT.TARGET_LANGUAGE}
        </span>
        <span>{TARGET_LANGUAGE_LABEL}</span>

        <PageRangeField />

        <span className={cn(FIELD_LABEL_CLASS, "self-start pt-2")}>
          {TRANSLATE_OPTIONS_TEXT.MODEL}
        </span>
        <ModelCards model={options.model ?? defaultModel} />

        <span className={cn(FIELD_LABEL_CLASS, "self-start pt-1")}>
          {TRANSLATE_OPTIONS_TEXT.GLOSSARY}
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <GlossaryTable
            rows={options.glossaryRows}
            onRowsChange={setGlossaryRows}
          />
          <p className="text-muted-foreground text-xs/4.25">
            {TRANSLATE_OPTIONS_TEXT.GLOSSARY_NOTE}
            {sharedTermCount > 0 &&
              ` · ${translateOptionsText.sharedGlossary(sharedTermCount)}`}
          </p>
        </div>

        <span className={FIELD_LABEL_CLASS}>
          {TRANSLATE_OPTIONS_TEXT.SCAN_PAGES}
        </span>
        <ScanPagesOption />
      </div>
    </section>
  );
}
