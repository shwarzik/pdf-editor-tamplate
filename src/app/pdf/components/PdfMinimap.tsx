import { useCallback } from "react";
import { RotateCw } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { usePdfThumbnail } from "../hooks/usePdfThumbnail";

interface PdfMinimapProps {
  doc: PDFDocumentProxy;
  pageNumbers: number[];
  rotations: Record<number, number>;
  onRotate: (pageNumber: number, delta: number) => void;
}

export function PdfMinimap({ doc, pageNumbers, rotations, onRotate }: PdfMinimapProps) {
  if (pageNumbers.length === 0) {
    return null;
  }

  return (
    <aside className="flex gap-3 overflow-x-auto pb-2 md:sticky md:top-24 md:max-h-[calc(100vh-8rem)] md:w-52 md:shrink-0 md:flex-col md:overflow-y-auto md:overflow-x-visible md:pb-0 md:pr-3">
      {pageNumbers.map((pageNumber) => (
        <MinimapItem
          key={`minimap-${pageNumber}`}
          doc={doc}
          pageNumber={pageNumber}
          rotation={rotations[pageNumber] ?? 0}
          onRotate={onRotate}
        />
      ))}
    </aside>
  );
}

interface MinimapItemProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  rotation: number;
  onRotate: (pageNumber: number, delta: number) => void;
}

function MinimapItem({ doc, pageNumber, rotation, onRotate }: MinimapItemProps) {
  const { registerCanvas, isRendering } = usePdfThumbnail({
    doc,
    pageNumber,
    rotation,
  });

  const scrollToPage = useCallback(() => {
    const target = document.getElementById(`pdf-page-${pageNumber}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pageNumber]);

  const handleRotate = useCallback(() => {
    onRotate(pageNumber, 90);
  }, [onRotate, pageNumber]);

  return (
    <div className="group relative flex min-w-[180px] flex-col gap-2 rounded-xl border border-slate-800/60 bg-slate-950/60 p-3 shadow-[0_10px_40px_-24px_rgba(148,163,184,0.45)]">
      <div className="relative">
        <canvas
          ref={registerCanvas}
          className={`h-auto w-full rounded-lg border border-slate-800/40 bg-slate-900/60 transition-opacity duration-150 ${isRendering ? "opacity-60" : "opacity-100"}`}
        />

        <button
          type="button"
          onClick={handleRotate}
          className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700/70 bg-slate-950/80 text-slate-200 opacity-0 transition hover:border-slate-500 hover:text-white focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
          aria-label={`Rotate page ${pageNumber}`}
        >
          <RotateCw className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={scrollToPage}
          className="text-slate-200 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
        >
          Page {pageNumber}
        </button>
        <span className="font-mono text-[11px] text-slate-500">{rotation}&deg;</span>
      </div>
    </div>
  );
}
