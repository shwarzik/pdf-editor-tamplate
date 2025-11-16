import { useEffect } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { useFabricPageRender } from "../hooks/useFabricPageRender";
import { usePdfStore } from "@/lib/store";
import { usePdfExportStore } from "@/lib/export-store";

interface PdfPageCanvasProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  rotation: number;
  editMode: boolean;
}

export function PdfPageCanvas({ doc, pageNumber, zoom, rotation, editMode }: PdfPageCanvasProps) {
  const parsedPages = usePdfStore((s) => s.parsedPages);
  const pageMeta = parsedPages?.find((p) => p.pageNumber === pageNumber) || null;
  const { registerCanvas, isRendering, exportPageData } = useFabricPageRender({
    doc,
    pageNumber,
    zoom,
    rotation,
    editMode,
    parsedPage: pageMeta ?? undefined,
  });
  const registerPageExporter = usePdfExportStore((s) => s.registerPageExporter);
  const unregisterPageExporter = usePdfExportStore((s) => s.unregisterPageExporter);

  useEffect(() => {
    registerPageExporter(pageNumber, exportPageData);
    return () => unregisterPageExporter(pageNumber);
  }, [exportPageData, pageNumber, registerPageExporter, unregisterPageExporter]);

  return (
    <div
      id={`pdf-page-${pageNumber}`}
      className="relative flex min-w-max justify-center p-2"
    >
      <canvas
        ref={registerCanvas}
        className={`block rounded-xl border border-slate-800/70 transition-opacity duration-150 ${isRendering ? "opacity-70" : "opacity-100"}`}
      />

      {isRendering && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/40 backdrop-blur-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" aria-label="Rendering page" />
        </div>
      )}
    </div>
  );
}
