"use client";

import { usePdfStore } from "@/lib/store";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { PdfPageCanvas } from "./components/PdfPageCanvas";

export interface PdfViewerProps {
  doc: PDFDocumentProxy;
  fileUrl: string;
  pageNumbers: number[];
}

export default function PdfViewer({ doc, fileUrl, pageNumbers }: PdfViewerProps) {
  const zoom = usePdfStore((state) => state.zoom);
  const rotations = usePdfStore((state) => state.rotations);
  const editMode = usePdfStore((state) => state.editMode);

  if (!doc || pageNumbers.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {pageNumbers.map((pageNumber) => (
        <PdfPageCanvas
          key={`${fileUrl}-page-${pageNumber}`}
          doc={doc}
          pageNumber={pageNumber}
          zoom={zoom}
          rotation={rotations[pageNumber] ?? 0}
          editMode={editMode}
        />
      ))}
    </div>
  );
}
