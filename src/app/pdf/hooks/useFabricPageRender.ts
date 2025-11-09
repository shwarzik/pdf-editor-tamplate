import { useCallback, useEffect, useRef, useState } from "react";
import { isRenderingCancelled } from "../rendering";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderParameters,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";
import type { Canvas as FabricCanvas, FabricImage } from "fabric";

export interface UseFabricPageRenderArgs {
  doc: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  rotation: number;
}

export interface UseFabricPageRenderResult {
  registerCanvas: (element: HTMLCanvasElement | null) => void;
  isRendering: boolean;
}

export function useFabricPageRender({
  doc,
  pageNumber,
  zoom,
  rotation,
}: UseFabricPageRenderArgs): UseFabricPageRenderResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const imageRef = useRef<FabricImage | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  useEffect(() => {
    return () => {
      imageRef.current?.dispose();
      imageRef.current = null;
      fabricRef.current?.dispose();
      fabricRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let page: PDFPageProxy | null = null;
    let pendingImage: FabricImage | null = null;

    const render = async () => {
      setIsRendering(true);
      try {
        page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: zoom / 100, rotation });
        const offscreenCanvas = document.createElement("canvas");
        offscreenCanvas.width = viewport.width;
        offscreenCanvas.height = viewport.height;

        const offscreenContext = offscreenCanvas.getContext("2d");
        if (!offscreenContext) return;

        const params: RenderParameters = {
          canvasContext: offscreenContext,
          viewport,
          canvas: offscreenCanvas,
        };

        renderTask = page.render(params);
        try {
          await renderTask.promise;
        } catch (error) {
          if (!isRenderingCancelled(error)) {
            throw error;
          }
          return;
        }

        if (cancelled) return;

        const { Canvas, FabricImage } = await import("fabric");

        let fabricCanvas = fabricRef.current;
        if (!fabricCanvas) {
          fabricCanvas = new Canvas(canvasEl, { selection: false });
          fabricRef.current = fabricCanvas;
        } else {
          fabricCanvas.clear();
        }

        canvasEl.width = viewport.width;
        canvasEl.height = viewport.height;
        fabricCanvas.setDimensions({ width: viewport.width, height: viewport.height });

        pendingImage = await FabricImage.fromURL(
          offscreenCanvas.toDataURL(),
          undefined,
          {
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
            excludeFromExport: true,
            hoverCursor: "default",
            originX: "left",
            originY: "top",
            left: 0,
            top: 0,
          }
        );

        if (cancelled) {
          pendingImage.dispose();
          pendingImage = null;
          return;
        }

        fabricCanvas.add(pendingImage);
        fabricCanvas.requestRenderAll();

        imageRef.current?.dispose();
        imageRef.current = pendingImage;
        pendingImage = null;
      } catch (error) {
        if (!cancelled && !isRenderingCancelled(error)) {
          console.error(error);
        }
      } finally {
        if (!cancelled) {
          setIsRendering(false);
        }
        if (pendingImage) {
          pendingImage.dispose();
        }
        if (page) {
          page.cleanup();
        }
      }
    };

    render();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, rotation, zoom]);

  const registerCanvas = useCallback((element: HTMLCanvasElement | null) => {
    canvasRef.current = element;
  }, []);

  return { registerCanvas, isRendering };
}
