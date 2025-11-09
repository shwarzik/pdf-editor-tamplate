import { create } from "zustand";
import { ZOOM_DEFAULT } from "./viewer";

interface PdfState {
  zoom: number;
  rotations: Record<number, number>;
  setZoom: (v: number) => void;
  setRotation: (page: number, v: number) => void;
  resetRotations: () => void;
}

const normalizeRotation = (value: number) => {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

export const usePdfStore = create<PdfState>((set) => ({
  zoom: ZOOM_DEFAULT,
  rotations: {},
  setZoom: (v) => set({ zoom: v }),
  setRotation: (page, v) =>
    set((state) => ({
      rotations: {
        ...state.rotations,
        [page]: normalizeRotation(v),
      },
    })),
  resetRotations: () => set({ rotations: {} }),
}));
