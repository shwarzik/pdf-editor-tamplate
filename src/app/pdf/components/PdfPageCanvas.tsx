import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { useFabricPageRender } from "../hooks/useFabricPageRender";

interface PdfPageCanvasProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  rotation: number;
}

export function PdfPageCanvas({ doc, pageNumber, zoom, rotation }: PdfPageCanvasProps) {
  const { registerCanvas, isRendering } = useFabricPageRender({
    doc,
    pageNumber,
    zoom,
    rotation,
  });

  return (
    <div
      id={`pdf-page-${pageNumber}`}
      className="relative flex min-w-max justify-center p-2"
    >
      <canvas
        ref={registerCanvas}
        className={`block rounded-xl border border-slate-800/70 bg-black/60 transition-opacity duration-150 ${isRendering ? "opacity-70" : "opacity-100"}`}
      />

      {isRendering && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/40 backdrop-blur-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" aria-label="Rendering page" />
        </div>
      )}
    </div>
  );
}
