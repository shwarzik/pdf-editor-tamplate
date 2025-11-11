import { create } from "zustand";
import { ZOOM_DEFAULT } from "./viewer";

export interface ParsedBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: "normal" | "bold";
  lineHeight: number;
  fill: string;
}

export interface ParsedPage {
  pageNumber: number;
  width: number;
  height: number;
  blocks: ParsedBlock[];
}

interface PdfState {
  zoom: number;
  rotations: Record<number, number>;
  editMode: boolean;
  parsedPages: ParsedPage[] | null;
  parseError: string | null;
  setParsedPages: (pages: ParsedPage[] | null) => void;
  setParseError: (err: string | null) => void;
  setZoom: (v: number) => void;
  setRotation: (page: number, v: number) => void;
  resetRotations: () => void;
  setEditMode: (v: boolean) => void;
}

const normalizeRotation = (value: number) => {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

export const usePdfStore = create<PdfState>((set) => ({
  zoom: ZOOM_DEFAULT,
  rotations: {},
  editMode: false,
  parsedPages: null,
  parseError: null,
  setParsedPages: (pages) => set({ parsedPages: pages }),
  setParseError: (err) => set({ parseError: err }),
  setZoom: (v) => set({ zoom: v }),
  setRotation: (page, v) =>
    set((state) => ({
      rotations: {
        ...state.rotations,
        [page]: normalizeRotation(v),
      },
    })),
  resetRotations: () => set({ rotations: {} }),
  setEditMode: (v) => set({ editMode: v }),
}));
