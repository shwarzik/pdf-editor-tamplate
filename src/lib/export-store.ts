import { create } from "zustand";
import type { PageExportPayload } from "./pdf-export-types";

export type PageExporter = () => Omit<PageExportPayload, "pageNumber"> | null;

interface PdfExportState {
  exporters: Record<number, PageExporter>;
  registerPageExporter: (pageNumber: number, exporter: PageExporter) => void;
  unregisterPageExporter: (pageNumber: number) => void;
  captureAllPages: () => PageExportPayload[];
}

export const usePdfExportStore = create<PdfExportState>((set, get) => ({
  exporters: {},
  registerPageExporter: (pageNumber, exporter) =>
    set((state) => ({
      exporters: {
        ...state.exporters,
        [pageNumber]: exporter,
      },
    })),
  unregisterPageExporter: (pageNumber) =>
    set((state) => {
      const next = { ...state.exporters };
      delete next[pageNumber];
      return { exporters: next };
    }),
  captureAllPages: () => {
    const entries = Object.entries(get().exporters)
      .map(([key, exporter]) => ({ pageNumber: Number(key), exporter }))
      .sort((a, b) => a.pageNumber - b.pageNumber);

    const snapshots: PageExportPayload[] = [];

    for (const entry of entries) {
      try {
        const snapshot = entry.exporter();
        if (!snapshot) continue;
        snapshots.push({
          pageNumber: entry.pageNumber,
          width: snapshot.width,
          height: snapshot.height,
          rotation: snapshot.rotation,
          overlays: snapshot.overlays,
        });
      } catch (error) {
        console.error(`Failed to export page ${entry.pageNumber}`, error);
      }
    }

    return snapshots;
  },
}));
