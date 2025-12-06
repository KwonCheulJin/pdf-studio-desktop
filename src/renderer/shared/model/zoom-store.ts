import { create } from "zustand";
import { ZOOM_CONFIG } from "@/renderer/shared/constants/zoom";

interface ZoomStoreState {
  cardSize: number;
}

interface ZoomStoreActions {
  setCardSize: (size: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

type ZoomStore = ZoomStoreState & ZoomStoreActions;

const clampCardSize = (size: number): number => {
  return Math.max(
    ZOOM_CONFIG.MIN_CARD_SIZE,
    Math.min(ZOOM_CONFIG.MAX_CARD_SIZE, size)
  );
};

export const useZoomStore = create<ZoomStore>((set) => ({
  cardSize: ZOOM_CONFIG.DEFAULT_CARD_SIZE,

  setCardSize: (size: number) => set({ cardSize: clampCardSize(size) }),

  zoomIn: () =>
    set((state) => ({
      cardSize: clampCardSize(state.cardSize + ZOOM_CONFIG.STEP)
    })),

  zoomOut: () =>
    set((state) => ({
      cardSize: clampCardSize(state.cardSize - ZOOM_CONFIG.STEP)
    })),

  resetZoom: () => set({ cardSize: ZOOM_CONFIG.DEFAULT_CARD_SIZE })
}));

// Selector hooks
export const useCardSize = () => useZoomStore((state) => state.cardSize);
