import { beforeEach, describe, expect, it } from "vitest";
import { useMergeStore } from "../merge-store";
import type { MergeOrderItem, PdfDocument, PdfPage } from "../pdf-document";
import { MERGE_STATUS, MERGE_VIEW } from "../merge-state";
import { PAGE_ROTATION } from "../../config/page-rotation";

// 테스트용 문서 생성 (페이지 ID: `${fileId}${순번}` 예: A1, A2)
function createTestDocument(fileId: string, pageCount: number): PdfDocument {
  const pages: PdfPage[] = Array.from({ length: pageCount }, (_, index) => ({
    id: `${fileId}${index + 1}`,
    sourceDocumentId: fileId,
    sourcePageIndex: index,
    rotation: PAGE_ROTATION.DEG_0,
    isDeleted: false
  }));
  return {
    id: fileId,
    path: `/tmp/${fileId}.pdf`,
    name: `${fileId}.pdf`,
    pageCount,
    pages
  };
}

// mergeOrder를 페이지 ID 배열로 변환
function orderOf(): string[] {
  return useMergeStore.getState().mergeOrder.map((item) => item.pageId);
}

function pageIdsOf(fileId: string): string[] {
  const file = useMergeStore
    .getState()
    .files.find((candidate) => candidate.id === fileId);
  return file?.pages.map((page) => page.id) ?? [];
}

function findPage(fileId: string, pageId: string): PdfPage | undefined {
  const file = useMergeStore
    .getState()
    .files.find((candidate) => candidate.id === fileId);
  return file?.pages.find((page) => page.id === pageId);
}

// A(A1,A2) B(B1,B2) C(C1) 를 순서대로 추가
function seedThreeFiles(): void {
  useMergeStore
    .getState()
    .addFiles([
      createTestDocument("A", 2),
      createTestDocument("B", 2),
      createTestDocument("C", 1)
    ]);
}

describe("merge-store", () => {
  beforeEach(() => {
    useMergeStore.getState().reset();
  });

  describe("초기 상태", () => {
    it("파일·순서·그룹이 비어 있고 대기 상태의 작업 화면이다", () => {
      const state = useMergeStore.getState();
      expect(state.files).toEqual([]);
      expect(state.mergeOrder).toEqual([]);
      expect(state.collapsedGroups.size).toBe(0);
      expect(state.status).toBe(MERGE_STATUS.IDLE);
      expect(state.progress).toBe(0);
      expect(state.errorMessage).toBeNull();
      expect(state.view).toBe(MERGE_VIEW.WORKSPACE);
      expect(state.mergedDocument).toBeNull();
    });
  });

  describe("addFiles", () => {
    it("파일을 뒤에 붙이고 mergeOrder에 페이지를 순서대로 추가한다", () => {
      seedThreeFiles();
      expect(useMergeStore.getState().files.map((file) => file.id)).toEqual([
        "A",
        "B",
        "C"
      ]);
      expect(orderOf()).toEqual(["A1", "A2", "B1", "B2", "C1"]);
    });

    it("mergeOrder 아이템에 fileId와 pageId를 담는다", () => {
      useMergeStore.getState().addFiles([createTestDocument("A", 1)]);
      const expected: MergeOrderItem[] = [{ fileId: "A", pageId: "A1" }];
      expect(useMergeStore.getState().mergeOrder).toEqual(expected);
    });

    it("추가된 파일의 첫 페이지 그룹은 접힌 상태로 시작한다", () => {
      seedThreeFiles();
      const collapsed = useMergeStore.getState().collapsedGroups;
      expect([...collapsed].sort()).toEqual([
        "group_A1",
        "group_B1",
        "group_C1"
      ]);
    });

    it("이미 있는 파일 뒤에 추가해도 기존 순서를 유지한다", () => {
      seedThreeFiles();
      useMergeStore.getState().addFiles([createTestDocument("D", 1)]);
      expect(orderOf()).toEqual(["A1", "A2", "B1", "B2", "C1", "D1"]);
    });

    it("삭제된 페이지는 mergeOrder에 넣지 않는다", () => {
      const document = createTestDocument("A", 2);
      const withDeleted: PdfDocument = {
        ...document,
        pages: [{ ...document.pages[0], isDeleted: true }, document.pages[1]]
      };
      useMergeStore.getState().addFiles([withDeleted]);
      expect(orderOf()).toEqual(["A2"]);
      expect([...useMergeStore.getState().collapsedGroups]).toEqual([
        "group_A2"
      ]);
    });

    it("모든 페이지가 삭제된 파일은 그룹과 순서 없이 files에만 들어간다", () => {
      const document = createTestDocument("A", 1);
      const allDeleted: PdfDocument = {
        ...document,
        pages: [{ ...document.pages[0], isDeleted: true }]
      };
      useMergeStore.getState().addFiles([allDeleted]);
      expect(useMergeStore.getState().files).toHaveLength(1);
      expect(orderOf()).toEqual([]);
      expect(useMergeStore.getState().collapsedGroups.size).toBe(0);
    });
  });

  describe("insertFiles", () => {
    it("지정 인덱스 파일의 첫 페이지 앞에 새 파일을 삽입한다", () => {
      seedThreeFiles();
      useMergeStore.getState().insertFiles(1, [createTestDocument("X", 2)]);
      expect(useMergeStore.getState().files.map((file) => file.id)).toEqual([
        "A",
        "X",
        "B",
        "C"
      ]);
      expect(orderOf()).toEqual(["A1", "A2", "X1", "X2", "B1", "B2", "C1"]);
    });

    it("인덱스 0이면 맨 앞에 삽입한다", () => {
      seedThreeFiles();
      useMergeStore.getState().insertFiles(0, [createTestDocument("X", 1)]);
      expect(orderOf()).toEqual(["X1", "A1", "A2", "B1", "B2", "C1"]);
    });

    it("범위를 넘는 인덱스면 mergeOrder 끝에 삽입한다", () => {
      seedThreeFiles();
      useMergeStore.getState().insertFiles(99, [createTestDocument("X", 1)]);
      expect(useMergeStore.getState().files.map((file) => file.id)).toEqual([
        "A",
        "B",
        "C",
        "X"
      ]);
      expect(orderOf()).toEqual(["A1", "A2", "B1", "B2", "C1", "X1"]);
    });

    it("삽입 파일은 collapsedGroups에 추가하지 않는다", () => {
      seedThreeFiles();
      useMergeStore.getState().insertFiles(1, [createTestDocument("X", 1)]);
      expect(useMergeStore.getState().collapsedGroups.has("group_X1")).toBe(
        false
      );
    });
  });

  describe("removeFile", () => {
    it("파일과 해당 파일의 mergeOrder 아이템을 제거한다", () => {
      seedThreeFiles();
      useMergeStore.getState().removeFile("B");
      expect(useMergeStore.getState().files.map((file) => file.id)).toEqual([
        "A",
        "C"
      ]);
      expect(orderOf()).toEqual(["A1", "A2", "C1"]);
    });
  });

  describe("clearFiles", () => {
    it("파일·순서·그룹·진행 상태를 모두 초기화한다", () => {
      seedThreeFiles();
      const store = useMergeStore.getState();
      store.setStatus(MERGE_STATUS.ERROR);
      store.setProgress(50);
      store.setView(MERGE_VIEW.PREVIEW);
      store.clearFiles();
      const state = useMergeStore.getState();
      expect(state.files).toEqual([]);
      expect(state.mergeOrder).toEqual([]);
      expect(state.collapsedGroups.size).toBe(0);
      expect(state.status).toBe(MERGE_STATUS.IDLE);
      expect(state.progress).toBe(0);
      expect(state.view).toBe(MERGE_VIEW.WORKSPACE);
    });
  });

  describe("reorderFiles", () => {
    it("파일 순서를 바꾸고 mergeOrder를 파일 순서대로 다시 만든다", () => {
      seedThreeFiles();
      useMergeStore.getState().reorderFiles(0, 2);
      expect(useMergeStore.getState().files.map((file) => file.id)).toEqual([
        "B",
        "C",
        "A"
      ]);
      expect(orderOf()).toEqual(["B1", "B2", "C1", "A1", "A2"]);
    });

    it("페이지 단위로 섞어 둔 mergeOrder는 파일 단위로 되돌아간다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .movePageInMergeOrder({ pageId: "B1", targetPageId: "A2" });
      useMergeStore.getState().reorderFiles(0, 0);
      expect(orderOf()).toEqual(["A1", "A2", "B1", "B2", "C1"]);
    });
  });

  describe("insertFileAtPosition", () => {
    it("파일의 모든 페이지를 대상 페이지 앞으로 옮긴다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .insertFileAtPosition({ fileId: "A", targetPageId: "C1" });
      expect(orderOf()).toEqual(["B1", "B2", "A1", "A2", "C1"]);
    });

    it("targetPageId가 null이면 파일을 맨 끝으로 옮긴다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .insertFileAtPosition({ fileId: "A", targetPageId: null });
      expect(orderOf()).toEqual(["B1", "B2", "C1", "A1", "A2"]);
    });

    it("앞쪽 파일의 페이지 앞으로 옮길 수 있다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .insertFileAtPosition({ fileId: "C", targetPageId: "A1" });
      expect(orderOf()).toEqual(["C1", "A1", "A2", "B1", "B2"]);
    });

    it("대상 페이지가 없으면 끝으로 옮긴다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .insertFileAtPosition({ fileId: "A", targetPageId: "NONE" });
      expect(orderOf()).toEqual(["B1", "B2", "C1", "A1", "A2"]);
    });

    it("없는 파일이면 아무것도 바꾸지 않는다", () => {
      seedThreeFiles();
      const before = useMergeStore.getState().mergeOrder;
      useMergeStore
        .getState()
        .insertFileAtPosition({ fileId: "NONE", targetPageId: "C1" });
      expect(useMergeStore.getState().mergeOrder).toBe(before);
    });

    it("자기 첫 페이지 앞에 놓으면 상태 객체를 그대로 유지한다", () => {
      seedThreeFiles();
      const before = useMergeStore.getState().mergeOrder;
      useMergeStore
        .getState()
        .insertFileAtPosition({ fileId: "B", targetPageId: "B1" });
      expect(useMergeStore.getState().mergeOrder).toBe(before);
    });

    it("이동 파일의 삭제된 페이지도 함께 옮긴다(B10: 제자리 복원용)", () => {
      seedThreeFiles();
      useMergeStore.getState().deletePage("A", "A1");
      useMergeStore
        .getState()
        .insertFileAtPosition({ fileId: "A", targetPageId: null });
      expect(orderOf()).toEqual(["B1", "B2", "C1", "A1", "A2"]);
    });

    it("files 배열은 바꾸지 않는다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .insertFileAtPosition({ fileId: "A", targetPageId: null });
      expect(useMergeStore.getState().files.map((file) => file.id)).toEqual([
        "A",
        "B",
        "C"
      ]);
    });
  });

  describe("movePageInMergeOrder", () => {
    it("같은 파일 안에서 페이지를 대상 페이지 앞으로 옮긴다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .movePageInMergeOrder({ pageId: "A2", targetPageId: "A1" });
      expect(orderOf()).toEqual(["A2", "A1", "B1", "B2", "C1"]);
    });

    it("다른 파일 페이지 사이로 옮기면 mergeOrder에서 인터리브된다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .movePageInMergeOrder({ pageId: "B1", targetPageId: "A2" });
      expect(orderOf()).toEqual(["A1", "B1", "A2", "B2", "C1"]);
    });

    it("파일 간 이동해도 아이템의 fileId는 원래 파일 그대로다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .movePageInMergeOrder({ pageId: "B1", targetPageId: "A2" });
      const moved = useMergeStore
        .getState()
        .mergeOrder.find((item) => item.pageId === "B1");
      expect(moved).toEqual({ fileId: "B", pageId: "B1" });
    });

    it("앞쪽 페이지를 뒤쪽 페이지 앞으로 옮기면 대상 직전에 놓인다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .movePageInMergeOrder({ pageId: "A1", targetPageId: "B2" });
      expect(orderOf()).toEqual(["A2", "B1", "A1", "B2", "C1"]);
    });

    it("targetPageId가 null이면 맨 끝으로 옮긴다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .movePageInMergeOrder({ pageId: "A1", targetPageId: null });
      expect(orderOf()).toEqual(["A2", "B1", "B2", "C1", "A1"]);
    });

    it("대상 페이지가 없으면 맨 끝으로 옮긴다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .movePageInMergeOrder({ pageId: "A1", targetPageId: "NONE" });
      expect(orderOf()).toEqual(["A2", "B1", "B2", "C1", "A1"]);
    });

    it("자기 자신 앞에 놓으면 상태 객체를 그대로 유지한다", () => {
      seedThreeFiles();
      const before = useMergeStore.getState().mergeOrder;
      useMergeStore
        .getState()
        .movePageInMergeOrder({ pageId: "B1", targetPageId: "B1" });
      expect(useMergeStore.getState().mergeOrder).toBe(before);
    });

    it("바로 다음 페이지 앞에 놓으면 상태 객체를 그대로 유지한다", () => {
      seedThreeFiles();
      const before = useMergeStore.getState().mergeOrder;
      useMergeStore
        .getState()
        .movePageInMergeOrder({ pageId: "A2", targetPageId: "B1" });
      expect(useMergeStore.getState().mergeOrder).toBe(before);
    });

    it("mergeOrder에 없는 페이지면 아무것도 바꾸지 않는다", () => {
      seedThreeFiles();
      const before = useMergeStore.getState().mergeOrder;
      useMergeStore
        .getState()
        .movePageInMergeOrder({ pageId: "NONE", targetPageId: "A1" });
      expect(useMergeStore.getState().mergeOrder).toBe(before);
    });

    it("files의 페이지 배열은 바꾸지 않는다", () => {
      seedThreeFiles();
      useMergeStore
        .getState()
        .movePageInMergeOrder({ pageId: "B1", targetPageId: "A2" });
      expect(pageIdsOf("A")).toEqual(["A1", "A2"]);
      expect(pageIdsOf("B")).toEqual(["B1", "B2"]);
    });
  });

  describe("그룹 접기/펼치기", () => {
    it("toggleGroupExpand는 접힌 그룹을 펼치고 펼친 그룹을 접는다", () => {
      seedThreeFiles();
      useMergeStore.getState().toggleGroupExpand("group_A1");
      expect(useMergeStore.getState().collapsedGroups.has("group_A1")).toBe(
        false
      );
      useMergeStore.getState().toggleGroupExpand("group_A1");
      expect(useMergeStore.getState().collapsedGroups.has("group_A1")).toBe(
        true
      );
    });

    it("toggleGroupExpand는 다른 그룹 상태를 건드리지 않는다", () => {
      seedThreeFiles();
      useMergeStore.getState().toggleGroupExpand("group_A1");
      expect([...useMergeStore.getState().collapsedGroups].sort()).toEqual([
        "group_B1",
        "group_C1"
      ]);
    });

    it("expandGroup은 접힌 그룹만 펼친다", () => {
      seedThreeFiles();
      useMergeStore.getState().expandGroup("group_B1");
      expect([...useMergeStore.getState().collapsedGroups].sort()).toEqual([
        "group_A1",
        "group_C1"
      ]);
    });

    it("expandGroup은 이미 펼쳐진 그룹이면 상태 객체를 유지한다", () => {
      seedThreeFiles();
      const before = useMergeStore.getState().collapsedGroups;
      useMergeStore.getState().expandGroup("group_NONE");
      expect(useMergeStore.getState().collapsedGroups).toBe(before);
    });

    it("expandAll은 모든 그룹을 펼친다", () => {
      seedThreeFiles();
      useMergeStore.getState().expandAll();
      expect(useMergeStore.getState().collapsedGroups.size).toBe(0);
    });

    it("collapseAll은 mergeOrder에서 연속된 같은 파일 구간마다 그룹을 접는다", () => {
      seedThreeFiles();
      useMergeStore.getState().expandAll();
      useMergeStore
        .getState()
        .movePageInMergeOrder({ pageId: "B1", targetPageId: "A2" });
      // 순서: A1 B1 A2 B2 C1 -> 연속 구간 5개 (A1, B1, A2, B2, C1)
      useMergeStore.getState().collapseAll();
      expect([...useMergeStore.getState().collapsedGroups].sort()).toEqual([
        "group_A1",
        "group_A2",
        "group_B1",
        "group_B2",
        "group_C1"
      ]);
    });

    it("collapseAll은 연속된 같은 파일 페이지를 하나의 그룹으로 묶는다", () => {
      seedThreeFiles();
      useMergeStore.getState().expandAll();
      useMergeStore.getState().collapseAll();
      expect([...useMergeStore.getState().collapsedGroups].sort()).toEqual([
        "group_A1",
        "group_B1",
        "group_C1"
      ]);
    });
  });

  describe("deletePage", () => {
    it("페이지를 soft delete 하고 mergeOrder 자리는 남긴다(B10)", () => {
      seedThreeFiles();
      useMergeStore.getState().deletePage("A", "A1");
      expect(findPage("A", "A1")?.isDeleted).toBe(true);
      expect(orderOf()).toEqual(["A1", "A2", "B1", "B2", "C1"]);
    });

    it("pages 배열과 pageCount는 그대로 유지한다", () => {
      seedThreeFiles();
      useMergeStore.getState().deletePage("A", "A1");
      const file = useMergeStore
        .getState()
        .files.find((candidate) => candidate.id === "A");
      expect(file?.pages).toHaveLength(2);
      expect(file?.pageCount).toBe(2);
    });

    it("다른 페이지는 삭제 표시하지 않는다", () => {
      seedThreeFiles();
      useMergeStore.getState().deletePage("A", "A1");
      expect(findPage("A", "A2")?.isDeleted).toBe(false);
      expect(findPage("B", "B1")?.isDeleted).toBe(false);
    });
  });

  describe("restorePage", () => {
    it("isDeleted를 false로 되돌린다", () => {
      seedThreeFiles();
      useMergeStore.getState().deletePage("A", "A1");
      useMergeStore.getState().restorePage("A", "A1");
      expect(findPage("A", "A1")?.isDeleted).toBe(false);
    });

    it("복원하면 mergeOrder의 원래 자리 그대로다(B10)", () => {
      seedThreeFiles();
      useMergeStore.getState().deletePage("A", "A1");
      useMergeStore.getState().restorePage("A", "A1");
      expect(orderOf()).toEqual(["A1", "A2", "B1", "B2", "C1"]);
    });
  });

  describe("rotatePage", () => {
    it("기본값은 90도씩 시계 방향으로 더한다", () => {
      seedThreeFiles();
      useMergeStore.getState().rotatePage("A", "A1");
      expect(findPage("A", "A1")?.rotation).toBe(PAGE_ROTATION.DEG_90);
    });

    it("270도에서 90도를 더하면 0도로 돌아온다", () => {
      seedThreeFiles();
      const store = useMergeStore.getState();
      store.rotatePage("A", "A1", PAGE_ROTATION.DEG_270);
      store.rotatePage("A", "A1");
      expect(findPage("A", "A1")?.rotation).toBe(PAGE_ROTATION.DEG_0);
    });

    it("지정한 페이지만 회전한다", () => {
      seedThreeFiles();
      useMergeStore.getState().rotatePage("A", "A1", PAGE_ROTATION.DEG_180);
      expect(findPage("A", "A2")?.rotation).toBe(PAGE_ROTATION.DEG_0);
    });
  });

  describe("movePage", () => {
    it("다른 파일로 옮기면 files의 pages만 바뀌고 mergeOrder는 그대로다", () => {
      seedThreeFiles();
      useMergeStore.getState().movePage("A", "A1", "B", 1);
      expect(pageIdsOf("A")).toEqual(["A2"]);
      expect(pageIdsOf("B")).toEqual(["B1", "A1", "B2"]);
      expect(orderOf()).toEqual(["A1", "A2", "B1", "B2", "C1"]);
    });

    it("같은 파일 안에서는 페이지 순서만 바꾼다", () => {
      seedThreeFiles();
      useMergeStore.getState().movePage("A", "A1", "A", 1);
      expect(pageIdsOf("A")).toEqual(["A2", "A1"]);
    });
  });

  describe("상태 액션", () => {
    it("setError는 메시지가 있으면 상태를 ERROR로 바꾼다", () => {
      useMergeStore.getState().setError("실패");
      expect(useMergeStore.getState().errorMessage).toBe("실패");
      expect(useMergeStore.getState().status).toBe(MERGE_STATUS.ERROR);
    });

    it("setError(null)은 메시지만 지우고 상태는 유지한다", () => {
      useMergeStore.getState().setError("실패");
      useMergeStore.getState().setError(null);
      expect(useMergeStore.getState().errorMessage).toBeNull();
      expect(useMergeStore.getState().status).toBe(MERGE_STATUS.ERROR);
    });

    it("reset은 초기 상태로 되돌린다", () => {
      seedThreeFiles();
      useMergeStore.getState().setProgress(70);
      useMergeStore.getState().reset();
      const state = useMergeStore.getState();
      expect(state.files).toEqual([]);
      expect(state.progress).toBe(0);
    });
  });
});
