import { startTransition, useEffect, useState } from "react";
import { getPdfjs } from "../utils";
import { isRenderingCancelled } from "../rendering";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from "pdfjs-dist/types/src/display/api";

export interface PdfDocumentState {
  doc: PDFDocumentProxy | null;
  pageCount: number;
  loading: boolean;
  error: string | null;
}

export function usePdfDocument(fileUrl: string): PdfDocumentState {
  const [state, setState] = useState<PdfDocumentState>({
    doc: null,
    pageCount: 0,
    loading: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let currentDoc: PDFDocumentProxy | null = null;

    if (!fileUrl) {
      startTransition(() => {
        setState((prev) => {
          prev.doc?.destroy();
          if (
            prev.doc === null &&
            prev.pageCount === 0 &&
            !prev.loading &&
            prev.error === null
          ) {
            return prev;
          }
          return { doc: null, pageCount: 0, loading: false, error: null };
        });
      });
      return () => {
        cancelled = true;
      };
    }

    startTransition(() => {
      setState({ doc: null, pageCount: 0, loading: true, error: null });
    });

    const load = async () => {
      try {
        const pdfjsLib = await getPdfjs();
        loadingTask = pdfjsLib.getDocument(fileUrl);
        const loadedDoc = await loadingTask.promise;
        if (cancelled) {
          loadedDoc.destroy();
          return;
        }

        currentDoc = loadedDoc;
        setState({
          doc: loadedDoc,
          pageCount: loadedDoc.numPages,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (!cancelled && !isRenderingCancelled(error)) {
          console.error(error);
        }
        if (!cancelled) {
          setState({
            doc: null,
            pageCount: 0,
            loading: false,
            error: "Unable to load PDF document.",
          });
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      loadingTask?.destroy();
      currentDoc?.destroy();
      currentDoc = null;
    };
  }, [fileUrl]);

  return state;
}
