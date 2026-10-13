export type {
  Change,
  ChangeKind,
  CompareResult,
  PageSize,
  PageSources,
  Side
} from "@/renderer/shared/api/bindings";
export {
  CHANGE_KIND,
  CHANGE_KIND_LABEL,
  CHANGE_KIND_STYLE,
  CHANGE_KINDS,
  CHANGE_SIDE_LABEL,
  COMPARE_SIDE,
  COMPARE_SIDE_BADGE,
  COMPARE_SIDES,
  COMPARISON_TEXT,
  CONNECTOR_SHAPE,
  type ConnectorShape
} from "./config/change-kind";
export {
  changePositionOf,
  countChanges,
  EMPTY_CHANGE_FILTER,
  isChangeVisible,
  type ChangeCounts,
  type ChangeFilter,
  type ChangePosition
} from "./model/change-filter";
export {
  changeSideOf,
  groupByRow,
  highlightsByPage,
  indexPagePairs,
  numberChanges,
  rowOfChange,
  type BoxesPlacement,
  type ChangeGroup,
  type NumberedChange,
  type PageHighlight,
  type PageHighlights,
  type PagePair,
  type RowLookup
} from "./model/change-rows";
export {
  changeSummary,
  displayPageNumber,
  isOcrPage,
  pageOfPair,
  pairOcrLabel,
  pairPagesLabel
} from "./model/change-text";
export {
  connectorEndOf,
  connectorOf,
  type Connector,
  type ConnectorEnd
} from "./model/connector-ends";
export { noticeLinesOf } from "./model/notice-lines";
export { ChangeHighlight } from "./ui/change-highlight";
export { ChangeNumberTag } from "./ui/change-number-tag";
export { ChangeSwatch } from "./ui/change-swatch";
export { BADGE_TONE, TextBadge } from "./ui/text-badge";
