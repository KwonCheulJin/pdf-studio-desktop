import { describe, it, expect } from "vitest";
import {
  mergeUploadingFiles,
  RENDER_ITEM_TYPE
} from "../merge-uploading-files";
import type { FlatCard } from "../flatten-file-grid";
import type { UploadingFile } from "../../hooks/use-file-drop-zone";
import type { PdfDocument } from "../../model/pdf-document";
import { FLAT_CARD_TYPE } from "../../constants/flat-card";

// 테스트용 FlatCard 생성 헬퍼
function createFileCard(
  id: string,
  fileIndex: number,
  flatIndex: number
): FlatCard {
  const doc: PdfDocument = {
    id,
    path: `/test/${id}.pdf`,
    name: `${id}.pdf`,
    pageCount: 1,
    pages: [
      {
        id: `page-${id}-0`,
        sourceDocumentId: id,
        sourcePageIndex: 0,
        rotation: 0,
        isDeleted: false
      }
    ]
  };
  return {
    type: FLAT_CARD_TYPE.FILE,
    file: doc,
    fileIndex,
    flatIndex,
    groupPageCount: 1,
    firstPageId: `page-${id}-0`
  };
}

// 테스트용 UploadingFile 생성 헬퍼
function createUploadingFile(id: string, insertIndex: number): UploadingFile {
  return {
    id,
    name: `${id}.pdf`,
    insertIndex
  };
}

describe("mergeUploadingFiles", () => {
  it("빈 배열 입력 시 빈 배열 반환", () => {
    const result = mergeUploadingFiles({ flatCards: [], uploadingFiles: [] });
    expect(result).toEqual([]);
  });

  it("업로드 파일 없이 카드만 있는 경우", () => {
    const flatCards: FlatCard[] = [
      createFileCard("doc1", 0, 0),
      createFileCard("doc2", 1, 1)
    ];

    const result = mergeUploadingFiles({ flatCards, uploadingFiles: [] });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      type: RENDER_ITEM_TYPE.CARD,
      positionIndex: 0
    });
    expect(result[1]).toMatchObject({
      type: RENDER_ITEM_TYPE.CARD,
      positionIndex: 1
    });
  });

  it("맨 앞에 업로드 파일 삽입 (insertIndex: 0)", () => {
    const flatCards: FlatCard[] = [
      createFileCard("doc1", 0, 0),
      createFileCard("doc2", 1, 1)
    ];
    const uploadingFiles: UploadingFile[] = [createUploadingFile("upload1", 0)];

    const result = mergeUploadingFiles({ flatCards, uploadingFiles });

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      type: RENDER_ITEM_TYPE.UPLOADING,
      positionIndex: 0
    });
    expect(result[1]).toMatchObject({
      type: RENDER_ITEM_TYPE.CARD,
      positionIndex: 1
    });
    expect(result[2]).toMatchObject({
      type: RENDER_ITEM_TYPE.CARD,
      positionIndex: 2
    });
  });

  it("중간에 업로드 파일 삽입", () => {
    const flatCards: FlatCard[] = [
      createFileCard("doc1", 0, 0),
      createFileCard("doc2", 1, 1),
      createFileCard("doc3", 2, 2)
    ];
    const uploadingFiles: UploadingFile[] = [
      createUploadingFile("upload1", 2) // doc2 뒤에 삽입
    ];

    const result = mergeUploadingFiles({ flatCards, uploadingFiles });

    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({
      type: RENDER_ITEM_TYPE.CARD,
      positionIndex: 0
    }); // doc1
    expect(result[1]).toMatchObject({
      type: RENDER_ITEM_TYPE.CARD,
      positionIndex: 1
    }); // doc2
    expect(result[2]).toMatchObject({
      type: RENDER_ITEM_TYPE.UPLOADING,
      positionIndex: 2
    }); // upload1
    expect(result[3]).toMatchObject({
      type: RENDER_ITEM_TYPE.CARD,
      positionIndex: 3
    }); // doc3
  });

  it("마지막에 업로드 파일 추가 (insertIndex: -1)", () => {
    const flatCards: FlatCard[] = [
      createFileCard("doc1", 0, 0),
      createFileCard("doc2", 1, 1)
    ];
    const uploadingFiles: UploadingFile[] = [
      createUploadingFile("upload1", -1)
    ];

    const result = mergeUploadingFiles({ flatCards, uploadingFiles });

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      type: RENDER_ITEM_TYPE.CARD,
      positionIndex: 0
    });
    expect(result[1]).toMatchObject({
      type: RENDER_ITEM_TYPE.CARD,
      positionIndex: 1
    });
    expect(result[2]).toMatchObject({
      type: RENDER_ITEM_TYPE.UPLOADING,
      positionIndex: 2
    });
  });

  it("flatCards.length 이상의 insertIndex는 마지막에 추가", () => {
    const flatCards: FlatCard[] = [createFileCard("doc1", 0, 0)];
    const uploadingFiles: UploadingFile[] = [
      createUploadingFile("upload1", 100) // 범위 초과
    ];

    const result = mergeUploadingFiles({ flatCards, uploadingFiles });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      type: RENDER_ITEM_TYPE.CARD,
      positionIndex: 0
    });
    expect(result[1]).toMatchObject({
      type: RENDER_ITEM_TYPE.UPLOADING,
      positionIndex: 1
    });
  });

  it("여러 위치에 업로드 파일 삽입", () => {
    const flatCards: FlatCard[] = [
      createFileCard("doc1", 0, 0),
      createFileCard("doc2", 1, 1),
      createFileCard("doc3", 2, 2)
    ];
    const uploadingFiles: UploadingFile[] = [
      createUploadingFile("upload1", 0), // 맨 앞
      createUploadingFile("upload2", 2), // doc2 뒤
      createUploadingFile("upload3", -1) // 마지막
    ];

    const result = mergeUploadingFiles({ flatCards, uploadingFiles });

    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({ type: RENDER_ITEM_TYPE.UPLOADING }); // upload1
    expect(result[1]).toMatchObject({ type: RENDER_ITEM_TYPE.CARD }); // doc1
    expect(result[2]).toMatchObject({ type: RENDER_ITEM_TYPE.CARD }); // doc2
    expect(result[3]).toMatchObject({ type: RENDER_ITEM_TYPE.UPLOADING }); // upload2
    expect(result[4]).toMatchObject({ type: RENDER_ITEM_TYPE.CARD }); // doc3
    expect(result[5]).toMatchObject({ type: RENDER_ITEM_TYPE.UPLOADING }); // upload3
  });

  it("positionIndex가 연속적으로 증가", () => {
    const flatCards: FlatCard[] = [
      createFileCard("doc1", 0, 0),
      createFileCard("doc2", 1, 1)
    ];
    const uploadingFiles: UploadingFile[] = [
      createUploadingFile("upload1", 0),
      createUploadingFile("upload2", 1)
    ];

    const result = mergeUploadingFiles({ flatCards, uploadingFiles });

    result.forEach((item, index) => {
      expect(item.positionIndex).toBe(index);
    });
  });

  it("동일 insertIndex에 여러 업로드 파일", () => {
    const flatCards: FlatCard[] = [createFileCard("doc1", 0, 0)];
    const uploadingFiles: UploadingFile[] = [
      createUploadingFile("upload1", 1),
      createUploadingFile("upload2", 1)
    ];

    const result = mergeUploadingFiles({ flatCards, uploadingFiles });

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      type: RENDER_ITEM_TYPE.CARD,
      positionIndex: 0
    });
    expect(result[1]).toMatchObject({
      type: RENDER_ITEM_TYPE.UPLOADING,
      positionIndex: 1
    });
    expect(result[2]).toMatchObject({
      type: RENDER_ITEM_TYPE.UPLOADING,
      positionIndex: 2
    });
  });
});
