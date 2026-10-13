import type { CompareResult } from "@/renderer/shared/api/bindings";

/** 비교한 문서 하나 */
export interface ExportSourceFile {
  /** 비교에 쓴 PDF 경로(허용 경로 목록에 들어 있다) */
  path: string;
  /** 화면에 보이는 이름(확장자 포함). 만들 파일 이름에 쓴다. */
  name: string;
}

/** 내보낼 비교 결과와 그 결과를 만든 두 문서 */
export interface ExportComparison {
  result: CompareResult;
  before: ExportSourceFile;
  after: ExportSourceFile;
}
