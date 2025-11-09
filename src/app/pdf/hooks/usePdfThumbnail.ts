import { useCallback, useEffect, useRef, useState } from "react";
import { isRenderingCancelled, THUMBNAIL_TARGET_WIDTH } from "../rendering";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderParameters,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";

export interface UsePdfThumbnailArgs {
  doc: PDFDocumentProxy;
  pageNumber: number;
  rotation: number;
}

export interface UsePdfThumbnailResult {
  registerCanvas: (element: HTMLCanvasElement | null) => void;
  isRendering: boolean;
}

export function usePdfThumbnail({
  doc,
  pageNumber,
  rotation,
}: UsePdfThumbnailArgs): UsePdfThumbnailResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let page: PDFPageProxy | null = null;
    let renderTask: RenderTask | null = null;

    const renderThumbnail = async () => {
      setIsRendering(true);
      try {
        page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1, rotation });
        const scale = Math.min(THUMBNAIL_TARGET_WIDTH / baseViewport.width, 0.5);
        const viewport = page.getViewport({ scale, rotation });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext("2d");
        if (!context) {
          return;
        }
        context.save();
        context.fillStyle = "#0f172a";
        context.fillRect(0, 0, viewport.width, viewport.height);
        context.restore();

        renderTask = page.render({
          canvasContext: context,
          viewport,
        } as RenderParameters);

        try {
          await renderTask.promise;
        } catch (error) {
          if (!isRenderingCancelled(error)) {
            throw error;
          }
        }
      } catch (error) {
        if (!cancelled && !isRenderingCancelled(error)) {
          console.error(error);
        }
      } finally {
        if (!cancelled) {
          setIsRendering(false);
        }
        renderTask?.cancel();
        page?.cleanup();
      }
    };

    renderThumbnail();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, rotation]);

  const registerCanvas = useCallback((element: HTMLCanvasElement | null) => {
    canvasRef.current = element;
  }, []);

  return { registerCanvas, isRendering };
}
