import {
  COMPARE_FILE_COUNT,
  COMPARE_SLOTS,
  type CompareSlot
} from "../config/compare-files";

export const SLOT_PLACEMENT_KIND = {
  /** 경로마다 넣을 슬롯이 정해졌다(빈 목록이면 넣을 것이 없다). */
  ASSIGN: "assign",
  /** 2개를 넘어 어느 둘을 비교할지 알 수 없다. */
  TOO_MANY: "tooMany",
  /** 한 파일을 슬롯 밖에 놓았는데 빈 슬롯이 없다. */
  SLOTS_FULL: "slotsFull"
} as const;

export interface SlotAssignment {
  slot: CompareSlot;
  path: string;
}

export type SlotPlacement =
  | {
      kind: typeof SLOT_PLACEMENT_KIND.ASSIGN;
      assignments: SlotAssignment[];
    }
  | { kind: typeof SLOT_PLACEMENT_KIND.TOO_MANY }
  | { kind: typeof SLOT_PLACEMENT_KIND.SLOTS_FULL };

interface PlanSlotPlacementParams {
  paths: string[];
  /** 놓은(또는 고르기를 누른) 슬롯. 슬롯 밖이거나 홈 카드면 `null` */
  target: CompareSlot | null;
  /** 지금 파일이 든 슬롯 */
  filledSlots: readonly CompareSlot[];
}

/**
 * 받은 파일을 어느 슬롯에 넣을지 정한다(계획서 P3-2).
 * - 2개: 어디에 놓았든 A·B에 받은 순서대로 넣는다(새 비교 한 쌍).
 * - 1개: 놓은 슬롯에 넣는다. 슬롯 밖이면 빈 슬롯을 A → B 순서로 채우고, 빈 슬롯이 없으면 넣지 않는다.
 * - 3개 이상: 넣지 않는다.
 */
export function planSlotPlacement({
  paths,
  target,
  filledSlots
}: PlanSlotPlacementParams): SlotPlacement {
  if (paths.length > COMPARE_FILE_COUNT) {
    return { kind: SLOT_PLACEMENT_KIND.TOO_MANY };
  }
  if (paths.length === COMPARE_FILE_COUNT) {
    return {
      kind: SLOT_PLACEMENT_KIND.ASSIGN,
      assignments: COMPARE_SLOTS.map((slot, index) => ({
        slot,
        path: paths[index]
      }))
    };
  }
  const [path] = paths;
  if (path === undefined) {
    return { kind: SLOT_PLACEMENT_KIND.ASSIGN, assignments: [] };
  }
  const slot =
    target ??
    COMPARE_SLOTS.find((candidate) => !filledSlots.includes(candidate));
  if (slot === undefined) {
    return { kind: SLOT_PLACEMENT_KIND.SLOTS_FULL };
  }
  return { kind: SLOT_PLACEMENT_KIND.ASSIGN, assignments: [{ slot, path }] };
}
