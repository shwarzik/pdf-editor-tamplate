import { useCallback } from "react";
import type { KeyboardEvent } from "react";
import { RotateCw } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { usePdfThumbnail } from "../hooks/usePdfThumbnail";

interface PdfMinimapProps {
  doc: PDFDocumentProxy;
  pageNumbers: number[];
  rotations: Record<number, number>;
  onRotate: (pageNumber: number, delta: number) => void;
  activePage: number | null;
  onSelectPage: (pageNumber: number) => void;
}

export function PdfMinimap({
  doc,
  pageNumbers,
  rotations,
  onRotate,
  activePage,
  onSelectPage,
}: PdfMinimapProps) {
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
          onSelectPage={onSelectPage}
          isActive={activePage === pageNumber}
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
  onSelectPage: (pageNumber: number) => void;
  isActive: boolean;
}

function MinimapItem({
  doc,
  pageNumber,
  rotation,
  onRotate,
  onSelectPage,
  isActive,
}: MinimapItemProps) {
  const { registerCanvas, isRendering } = usePdfThumbnail({
    doc,
    pageNumber,
    rotation,
  });

  const handleRotate = useCallback(() => {
    onRotate(pageNumber, 90);
  }, [onRotate, pageNumber]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelectPage(pageNumber);
      }
    },
    [onSelectPage, pageNumber]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={isActive ? "page" : undefined}
      onClick={() => onSelectPage(pageNumber)}
      onKeyDown={handleKeyDown}
      className={`group relative flex min-w-[180px] flex-col gap-2 rounded-xl border p-3 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950/80 ${
        isActive
          ? "border-cyan-400/80 bg-slate-950/80 shadow-[0_16px_48px_-18px_rgba(34,211,238,0.55)]"
          : "border-slate-800/60 bg-slate-950/60 shadow-[0_10px_40px_-24px_rgba(148,163,184,0.45)] hover:border-slate-600/70"
      }`}
    >
      <span
        className={`pointer-events-none absolute left-4 right-4 top-3 h-[3px] rounded-full transition-opacity ${
          isActive ? "bg-cyan-400/80 opacity-100" : "bg-slate-700/60 opacity-0 group-hover:opacity-60"
        }`}
        aria-hidden="true"
      />
      <div className="relative">
        <canvas
          ref={registerCanvas}
          className={`h-auto w-full rounded-lg border transition-opacity duration-150 ${
            isActive
              ? "border-cyan-400/60 bg-slate-900/70 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.3)]"
              : "border-slate-800/40 bg-slate-900/60"
          } ${isRendering ? "opacity-60" : "opacity-100"}`}
        />

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            handleRotate();
          }}
          className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700/70 bg-slate-950/80 text-slate-200 opacity-0 transition hover:border-slate-500 hover:text-white focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
          aria-label={`Rotate page ${pageNumber}`}
        >
          <RotateCw className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span
          className={`text-sm font-medium transition ${
            isActive ? "text-cyan-200" : "text-slate-200 group-hover:text-white"
          }`}
        >
          Page {pageNumber}
        </span>
        <span
          className={`font-mono text-[11px] transition ${
            isActive ? "text-cyan-300" : "text-slate-500"
          }`}
        >
          {rotation}&deg;
        </span>
      </div>
    </div>
  );
}
