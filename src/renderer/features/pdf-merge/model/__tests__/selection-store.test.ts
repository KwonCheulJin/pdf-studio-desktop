import { beforeEach, describe, expect, it } from "vitest";
import { useSelectionStore } from "../selection-store";
import { SELECTION_TYPE } from "../../config/selection-type";

function selectedOf(): string[] {
  return [...useSelectionStore.getState().selectedIds].sort();
}

describe("selection-store", () => {
  beforeEach(() => {
    useSelectionStore.getState().setSelectionType(SELECTION_TYPE.FILE);
  });

  describe("초기 상태", () => {
    it("FILE 모드이고 선택이 비어 있다", () => {
      const state = useSelectionStore.getState();
      expect(state.selectionType).toBe(SELECTION_TYPE.FILE);
      expect(state.selectedIds.size).toBe(0);
      expect(state.lastSelectedId).toBeNull();
    });
  });

  describe("setSelectionType", () => {
    it("모드를 바꾸면서 선택과 마지막 선택을 비운다", () => {
      useSelectionStore.getState().select("f1");
      useSelectionStore.getState().setSelectionType(SELECTION_TYPE.PAGE);
      const state = useSelectionStore.getState();
      expect(state.selectionType).toBe(SELECTION_TYPE.PAGE);
      expect(state.selectedIds.size).toBe(0);
      expect(state.lastSelectedId).toBeNull();
    });

    it("PAGE에서 FILE로 되돌려도 선택을 비운다", () => {
      useSelectionStore.getState().setSelectionType(SELECTION_TYPE.PAGE);
      useSelectionStore.getState().select("p1");
      useSelectionStore.getState().setSelectionType(SELECTION_TYPE.FILE);
      expect(useSelectionStore.getState().selectionType).toBe(
        SELECTION_TYPE.FILE
      );
      expect(selectedOf()).toEqual([]);
    });
  });

  describe("select", () => {
    it("기존 선택을 대체하고 마지막 선택을 갱신한다", () => {
      useSelectionStore.getState().select("a");
      useSelectionStore.getState().select("b");
      expect(selectedOf()).toEqual(["b"]);
      expect(useSelectionStore.getState().lastSelectedId).toBe("b");
    });
  });

  describe("toggle", () => {
    it("없으면 추가하고 있으면 제거한다", () => {
      useSelectionStore.getState().toggle("a");
      useSelectionStore.getState().toggle("b");
      expect(selectedOf()).toEqual(["a", "b"]);
      useSelectionStore.getState().toggle("a");
      expect(selectedOf()).toEqual(["b"]);
    });

    it("제거할 때도 마지막 선택은 토글한 ID가 된다", () => {
      useSelectionStore.getState().toggle("a");
      useSelectionStore.getState().toggle("b");
      useSelectionStore.getState().toggle("a");
      expect(useSelectionStore.getState().lastSelectedId).toBe("a");
    });
  });

  describe("toggleFileWithPages", () => {
    it("선택 안 된 파일이면 파일과 모든 페이지를 함께 선택한다", () => {
      useSelectionStore.getState().toggleFileWithPages("f1", ["p1", "p2"]);
      expect(selectedOf()).toEqual(["f1", "p1", "p2"]);
      expect(useSelectionStore.getState().lastSelectedId).toBe("f1");
    });

    it("선택된 파일이면 파일과 페이지만 해제하고 나머지는 남긴다", () => {
      useSelectionStore.getState().toggleFileWithPages("f1", ["p1", "p2"]);
      useSelectionStore.getState().toggle("other");
      useSelectionStore.getState().toggleFileWithPages("f1", ["p1", "p2"]);
      expect(selectedOf()).toEqual(["other"]);
    });
  });

  describe("selectRange", () => {
    const allIds = ["a", "b", "c", "d", "e"];

    it("마지막 선택이 없으면 대상만 선택한다", () => {
      useSelectionStore.getState().selectRange(allIds, "c");
      expect(selectedOf()).toEqual(["c"]);
      expect(useSelectionStore.getState().lastSelectedId).toBe("c");
    });

    it("기준점부터 대상까지 구간을 선택하고 기준점은 옮기지 않는다", () => {
      useSelectionStore.getState().select("b");
      useSelectionStore.getState().selectRange(allIds, "d");
      expect(selectedOf()).toEqual(["b", "c", "d"]);
      expect(useSelectionStore.getState().lastSelectedId).toBe("b");
    });

    it("대상이 마지막 선택보다 앞이어도 구간을 선택한다", () => {
      useSelectionStore.getState().select("d");
      useSelectionStore.getState().selectRange(allIds, "b");
      expect(selectedOf()).toEqual(["b", "c", "d"]);
    });

    it("구간 밖의 기존 선택은 범위 선택으로 지운다", () => {
      useSelectionStore.getState().select("a");
      useSelectionStore.getState().toggle("e");
      useSelectionStore.getState().toggle("c");
      useSelectionStore.getState().selectRange(allIds, "d");
      expect(selectedOf()).toEqual(["c", "d"]);
    });

    it("목록에 없는 ID가 끼면 대상만 선택으로 대체한다", () => {
      useSelectionStore.getState().select("zzz");
      useSelectionStore.getState().selectRange(allIds, "c");
      expect(selectedOf()).toEqual(["c"]);
      expect(useSelectionStore.getState().lastSelectedId).toBe("c");
    });
  });

  describe("clearSelection", () => {
    it("선택과 마지막 선택을 비우지만 모드는 유지한다", () => {
      useSelectionStore.getState().setSelectionType(SELECTION_TYPE.PAGE);
      useSelectionStore.getState().select("p1");
      useSelectionStore.getState().clearSelection();
      const state = useSelectionStore.getState();
      expect(state.selectedIds.size).toBe(0);
      expect(state.lastSelectedId).toBeNull();
      expect(state.selectionType).toBe(SELECTION_TYPE.PAGE);
    });
  });

  describe("selectAll", () => {
    it("주어진 ID 전체를 선택하고 마지막 ID를 마지막 선택으로 둔다", () => {
      useSelectionStore.getState().select("old");
      useSelectionStore.getState().selectAll(["a", "b", "c"]);
      expect(selectedOf()).toEqual(["a", "b", "c"]);
      expect(useSelectionStore.getState().lastSelectedId).toBe("c");
    });

    it("빈 배열이면 선택을 비우고 마지막 선택을 null로 둔다", () => {
      useSelectionStore.getState().select("old");
      useSelectionStore.getState().selectAll([]);
      expect(selectedOf()).toEqual([]);
      expect(useSelectionStore.getState().lastSelectedId).toBeNull();
    });
  });

  describe("removeFromSelection", () => {
    it("단일 ID를 제거한다", () => {
      useSelectionStore.getState().selectAll(["a", "b", "c"]);
      useSelectionStore.getState().removeFromSelection("b");
      expect(selectedOf()).toEqual(["a", "c"]);
    });

    it("ID 배열을 한 번에 제거한다", () => {
      useSelectionStore.getState().selectAll(["a", "b", "c"]);
      useSelectionStore.getState().removeFromSelection(["a", "b"]);
      expect(selectedOf()).toEqual(["c"]);
    });

    it("마지막 선택이 제거되면 null로 비우고 아니면 유지한다", () => {
      useSelectionStore.getState().selectAll(["a", "b", "c"]);
      useSelectionStore.getState().removeFromSelection("a");
      expect(useSelectionStore.getState().lastSelectedId).toBe("c");
      useSelectionStore.getState().removeFromSelection("c");
      expect(useSelectionStore.getState().lastSelectedId).toBeNull();
    });
  });

  describe("ensurePagesSelected", () => {
    it("기존 선택에 페이지를 더하고 마지막 선택은 바꾸지 않는다", () => {
      useSelectionStore.getState().select("f1");
      useSelectionStore.getState().ensurePagesSelected(["p1", "p2"]);
      expect(selectedOf()).toEqual(["f1", "p1", "p2"]);
      expect(useSelectionStore.getState().lastSelectedId).toBe("f1");
    });
  });

  describe("switchToPageMode", () => {
    it("PAGE 모드로 바꾸고 파일 ID를 걸러낸 뒤 페이지를 토글해 추가한다", () => {
      useSelectionStore.getState().selectAll(["f1", "f2", "p1"]);
      useSelectionStore.getState().switchToPageMode(["f1", "f2"], "p2");
      const state = useSelectionStore.getState();
      expect(state.selectionType).toBe(SELECTION_TYPE.PAGE);
      expect(selectedOf()).toEqual(["p1", "p2"]);
      expect(state.lastSelectedId).toBe("p2");
    });

    it("이미 선택된 페이지를 토글하면 해제한다", () => {
      useSelectionStore.getState().selectAll(["f1", "p1", "p2"]);
      useSelectionStore.getState().switchToPageMode(["f1"], "p1");
      expect(selectedOf()).toEqual(["p2"]);
      expect(useSelectionStore.getState().lastSelectedId).toBe("p1");
    });
  });
});
