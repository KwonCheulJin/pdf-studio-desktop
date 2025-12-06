import type { FlatCard } from "./flatten-file-grid";
import type { UploadingFile } from "../hooks/use-file-drop-zone";
import type { ValueOf } from "../types/common";

/**
 * 렌더링할 아이템 타입 (카드 또는 업로드 중인 파일)
 */
export const RENDER_ITEM_TYPE = {
  CARD: "card",
  UPLOADING: "uploading"
} as const;

export type RenderItemType = ValueOf<typeof RENDER_ITEM_TYPE>;

export type RenderItem =
  | {
      type: typeof RENDER_ITEM_TYPE.CARD;
      card: FlatCard;
      positionIndex: number;
    }
  | {
      type: typeof RENDER_ITEM_TYPE.UPLOADING;
      file: UploadingFile;
      positionIndex: number;
    };

interface MergeUploadingFilesParams {
  flatCards: FlatCard[];
  uploadingFiles: UploadingFile[];
}

/**
 * 평면화된 카드와 업로드 중인 파일을 병합하여 렌더링 순서 생성
 * - insertIndex 위치에 업로드 중인 파일 삽입
 * - -1 또는 flatCards.length 이상인 경우 마지막에 추가
 *
 * @param params.flatCards 평면화된 카드 배열
 * @param params.uploadingFiles 업로드 중인 파일 배열
 * @returns 렌더링할 아이템 배열
 */
export function mergeUploadingFiles({
  flatCards,
  uploadingFiles
}: MergeUploadingFilesParams): RenderItem[] {
  const items: RenderItem[] = [];
  let positionIndex = 0;

  // insertIndex별로 업로드 파일 그룹화
  const getUploadingFilesAtIndex = (index: number): UploadingFile[] =>
    uploadingFiles.filter((file) => file.insertIndex === index);

  // 맨 앞 업로드 중인 파일들
  const frontUploading = getUploadingFilesAtIndex(0);
  for (const uf of frontUploading) {
    items.push({
      type: RENDER_ITEM_TYPE.UPLOADING,
      file: uf,
      positionIndex: positionIndex++
    });
  }

  // 카드들과 그 뒤의 업로드 중인 파일들
  for (let i = 0; i < flatCards.length; i++) {
    const card = flatCards[i];
    items.push({
      type: RENDER_ITEM_TYPE.CARD,
      card,
      positionIndex: positionIndex++
    });

    // 해당 카드 뒤의 업로드 중인 파일들 (insertIndex === i + 1)
    const uploading = getUploadingFilesAtIndex(i + 1);
    for (const uf of uploading) {
      items.push({
        type: RENDER_ITEM_TYPE.UPLOADING,
        file: uf,
        positionIndex: positionIndex++
      });
    }
  }

  // 마지막에 업로드 중인 파일들 (insertIndex가 -1이거나 flatCards.length 이상)
  const tailUploading = uploadingFiles.filter(
    (file) => file.insertIndex === -1 || file.insertIndex >= flatCards.length
  );
  for (const uploadFile of tailUploading) {
    // 이미 추가된 것 제외
    if (
      !items.some(
        (item) =>
          item.type === RENDER_ITEM_TYPE.UPLOADING &&
          item.file.id === uploadFile.id
      )
    ) {
      items.push({
        type: RENDER_ITEM_TYPE.UPLOADING,
        file: uploadFile,
        positionIndex: positionIndex++
      });
    }
  }

  return items;
}
