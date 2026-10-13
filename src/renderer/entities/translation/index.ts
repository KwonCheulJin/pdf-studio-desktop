export {
  baseSourceLanguageOf,
  DETECTED_LANGUAGE,
  DETECTED_LANGUAGE_LABEL,
  SOURCE_LANGUAGE,
  SOURCE_LANGUAGE_LABEL,
  TARGET_LANGUAGE_LABEL
} from "./config/translate-language";
export {
  RECOMMENDED_MODEL_BADGE,
  TRANSLATE_MODEL,
  TRANSLATE_MODEL_INFO,
  TRANSLATE_MODEL_ORDER,
  type TranslateModelInfo
} from "./config/translate-model";
export { PAGE_KIND, PARAGRAPH_STATUS } from "./config/translation-result";
export {
  firstRangePageOf,
  isUntranslatedParagraph,
  paragraphCountOf,
  rangePageCountOf
} from "./lib/translation-result";
