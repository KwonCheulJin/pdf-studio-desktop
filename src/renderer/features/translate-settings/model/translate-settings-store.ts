import { create } from "zustand";
import {
  isGlossaryTerms,
  toGlossaryRows,
  toGlossaryTerms,
  type GlossaryRow
} from "@/renderer/entities/glossary";
import type { TranslateModel } from "@/renderer/shared/api/bindings";
import {
  getPlatform,
  LOG_LEVEL,
  type SetSettingParams
} from "@/renderer/shared/platform";
import {
  DEFAULT_TRANSLATE_SETTINGS,
  TRANSLATE_MODEL,
  TRANSLATE_SETTING_KEY
} from "../config/translate-settings";

interface TranslateSettingsState {
  defaultModel: TranslateModel;
  confirmExternalTransfer: boolean;
  /** 공용 용어집 표(적힌 그대로, 빈 칸 포함). 번역에 실을 때 정규화한다. */
  glossaryRows: GlossaryRow[];
}

interface TranslateSettingsActions {
  setDefaultModel: (model: TranslateModel) => void;
  setConfirmExternalTransfer: (isConfirmed: boolean) => void;
  setGlossaryRows: (rows: GlossaryRow[]) => void;
}

type TranslateSettingsStore = TranslateSettingsState & TranslateSettingsActions;

/** 바꾸면 바로 저장한다(설정에는 저장 버튼이 없다, 계획서 P6-8). */
function saveSetting({ key, value }: SetSettingParams): void {
  getPlatform()
    .setSetting({ key, value })
    .catch((error: unknown) => {
      getPlatform().log({
        level: LOG_LEVEL.WARN,
        message: `번역 설정 저장 실패(${key}): ${String(error)}`
      });
    });
}

export const useTranslateSettingsStore = create<TranslateSettingsStore>(
  (set) => ({
    defaultModel: DEFAULT_TRANSLATE_SETTINGS.MODEL,
    confirmExternalTransfer:
      DEFAULT_TRANSLATE_SETTINGS.CONFIRM_EXTERNAL_TRANSFER,
    glossaryRows: [],

    setDefaultModel: (defaultModel) => {
      set({ defaultModel });
      saveSetting({
        key: TRANSLATE_SETTING_KEY.DEFAULT_MODEL,
        value: defaultModel
      });
    },
    setConfirmExternalTransfer: (confirmExternalTransfer) => {
      set({ confirmExternalTransfer });
      saveSetting({
        key: TRANSLATE_SETTING_KEY.CONFIRM_EXTERNAL_TRANSFER,
        value: confirmExternalTransfer
      });
    },
    setGlossaryRows: (glossaryRows) => {
      set({ glossaryRows });
      saveSetting({
        key: TRANSLATE_SETTING_KEY.GLOSSARY,
        value: toGlossaryTerms(glossaryRows)
      });
    }
  })
);

const TRANSLATE_MODELS: readonly unknown[] = Object.values(TRANSLATE_MODEL);

function isTranslateModel(value: unknown): value is TranslateModel {
  return TRANSLATE_MODELS.includes(value);
}

async function readSetting(key: string): Promise<unknown> {
  try {
    return await getPlatform().getSetting(key);
  } catch (error) {
    getPlatform().log({
      level: LOG_LEVEL.WARN,
      message: `번역 설정 읽기 실패(${key}): ${String(error)}`
    });
    return undefined;
  }
}

/** 저장된 용어집을 표 행으로. 없거나 손상됐으면 빈 표 */
function toStoredGlossaryRows(stored: unknown): GlossaryRow[] {
  return isGlossaryTerms(stored) ? toGlossaryRows(stored) : [];
}

/** 부팅 때 저장된 번역 설정을 읽는다. 없거나 모르는 값이면 기본값이다. */
export async function loadTranslateSettings(): Promise<void> {
  const [model, confirm, glossary] = await Promise.all([
    readSetting(TRANSLATE_SETTING_KEY.DEFAULT_MODEL),
    readSetting(TRANSLATE_SETTING_KEY.CONFIRM_EXTERNAL_TRANSFER),
    readSetting(TRANSLATE_SETTING_KEY.GLOSSARY)
  ]);
  useTranslateSettingsStore.setState({
    defaultModel: isTranslateModel(model)
      ? model
      : DEFAULT_TRANSLATE_SETTINGS.MODEL,
    confirmExternalTransfer:
      typeof confirm === "boolean"
        ? confirm
        : DEFAULT_TRANSLATE_SETTINGS.CONFIRM_EXTERNAL_TRANSFER,
    glossaryRows: toStoredGlossaryRows(glossary)
  });
}
