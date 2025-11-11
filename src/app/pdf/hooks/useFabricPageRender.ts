import { useCallback, useEffect, useRef, useState } from "react";
import { isRenderingCancelled } from "../rendering";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderParameters,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";
import { type Canvas as FabricCanvas, type FabricImage, type FabricObject } from "fabric";
import type { ParsedBlock, ParsedPage } from "@/lib/store";

export interface UseFabricPageRenderArgs {
  doc: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  rotation: number;
  editMode: boolean;
  parsedPage?: ParsedPage;
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
  editMode,
  parsedPage,
}: UseFabricPageRenderArgs): UseFabricPageRenderResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const imageRef = useRef<FabricImage | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const prevZoomRef = useRef<number>(zoom);
  const prevRotationRef = useRef<number>(rotation);
  const prevViewportRef = useRef<{ width: number; height: number } | null>(null);
  const userObjectsRef = useRef<FabricObject[]>([]);

  useEffect(() => {
    return () => {
      userObjectsRef.current.forEach((obj) => obj.dispose());
      userObjectsRef.current = [];
      imageRef.current?.dispose();
      imageRef.current = null;
      fabricRef.current?.dispose();
      fabricRef.current = null;
    };
  }, []);
  // Handle edit mode changes
  useEffect(() => {
    const fabricCanvas = fabricRef.current;
    if (!fabricCanvas) return;
    // Update canvas selection mode
    fabricCanvas.selection = editMode;
    // Update all user objects visibility and interactivity
    userObjectsRef.current.forEach((obj) => {
      obj.set({
        selectable: editMode,
        evented: editMode,
        visible: editMode, // Keep text visible even when not in edit mode
        editable: editMode,
        // Styling for the selection box (container/bounding box)
        borderColor: "#3b82f6", // Blue border for selection box
        borderScaleFactor: 1, // Border thickness
        cornerColor: "#3b82f6", // Blue corner handles
        cornerStrokeColor: "#3b82f6",
        cornerStyle: "circle", // Circular corner handles
        transparentCorners: false, // Solid corners
        cornerSize: editMode ? 5 : 0, // Show handles only in edit mode
        padding: 2, // Space between text and selection border
      });
    });

    fabricCanvas.requestRenderAll();
  }, [isRendering, editMode]);

  // If user toggles editMode on after initial render, add parsed blocks
  useEffect(() => {
    const fabricCanvas = fabricRef.current;
    if (!fabricCanvas) return;
    if (!editMode) return;
    if (userObjectsRef.current.length > 0) return;
    if (!parsedPage || parsedPage.blocks.length === 0) return;
    const lastViewport = prevViewportRef.current;
    if (!lastViewport) return;

    (async () => {
      const { Textbox } = await import("fabric");
      const ratioX = lastViewport.width / parsedPage.width;
      const ratioY = lastViewport.height / parsedPage.height;
      const createdTextboxes = parsedPage.blocks.map((blk: ParsedBlock) =>
        new Textbox(blk.text, {
          left: blk.x * ratioX,
          top: blk.y * ratioY,
          width: Math.max(4, blk.width * ratioX),
          fontSize: Math.max(4, blk.fontSize * ratioY),
          lineHeight: blk.lineHeight,
          fill: blk.fill,
          fontFamily: blk.fontFamily,
          fontWeight: blk.fontWeight,
          selectable: true,
          editable: true,
          evented: true,
          visible: true,
          hasControls: true,
          hasBorders: true,
          borderColor: "#3b82f6",
          borderScaleFactor: 2,
          cornerColor: "#3b82f6",
          cornerStrokeColor: "#3b82f6",
          cornerStyle: "circle",
          transparentCorners: false,
          cornerSize: 5,
          padding: 2,
        })
      );
      createdTextboxes.forEach((obj) => fabricCanvas.add(obj));
      userObjectsRef.current = createdTextboxes;
      fabricCanvas.requestRenderAll();
    })().catch((e) => console.error("failed to add parsed blocks", e));
  }, [editMode, parsedPage]);

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
        const isNewCanvas = !fabricCanvas;
        
        if (!fabricCanvas) {
          fabricCanvas = new Canvas(canvasEl, { selection: false });
          fabricRef.current = fabricCanvas;
        } else {
          // Save user objects before clearing
          const allObjects = fabricCanvas.getObjects();
          userObjectsRef.current = allObjects.filter((obj) => !obj.excludeFromExport);
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

        // Calculate zoom scale factor and rotation delta
        const zoomScale = zoom / prevZoomRef.current;
        const rotationDelta = rotation - prevRotationRef.current;
        const prevViewport = prevViewportRef.current;
        
        prevZoomRef.current = zoom;
        prevRotationRef.current = rotation;
        prevViewportRef.current = { width: viewport.width, height: viewport.height };

        // Restore or create user objects
        if (userObjectsRef.current.length > 0) {
          // Restore existing user objects with adjusted position/size/rotation
          userObjectsRef.current.forEach((obj) => {
            if (!isNewCanvas && prevViewport) {
              let objLeft = obj.left ?? 0;
              let objTop = obj.top ?? 0;
              
              // If rotation changed, transform coordinates
              if (rotationDelta !== 0) {
                // Normalize position to 0-1 range based on previous viewport
                const normalizedX = objLeft / prevViewport.width;
                const normalizedY = objTop / prevViewport.height;
                
                // Apply rotation transformation on normalized coordinates
                // Rotation point is at (0.5, 0.5) - center of normalized space
                const relX = normalizedX - 0.5;
                const relY = normalizedY - 0.5;
                
                const radians = (rotationDelta * Math.PI) / 180;
                const cos = Math.cos(radians);
                const sin = Math.sin(radians);
                
                const rotatedX = 0.5 + (relX * cos - relY * sin);
                const rotatedY = 0.5 + (relX * sin + relY * cos);
                
                // Convert back to current viewport coordinates
                objLeft = rotatedX * viewport.width;
                objTop = rotatedY * viewport.height;
                
                // Update object's own rotation
                const currentRotation = obj.angle ?? 0;
                obj.set({ angle: currentRotation + rotationDelta });
              } else if (zoomScale !== 1) {
                // Only zoom changed, scale position
                objLeft *= zoomScale;
                objTop *= zoomScale;
              }
              
              obj.set({
                left: objLeft,
                top: objTop,
                scaleX: (obj.scaleX ?? 1) * (zoomScale !== 1 ? zoomScale : 1),
                scaleY: (obj.scaleY ?? 1) * (zoomScale !== 1 ? zoomScale : 1),
              });
            }
            fabricCanvas!.add(obj);
          });
        } else if (isNewCanvas && editMode && parsedPage && parsedPage.blocks.length > 0) {
          const { Textbox } = await import("fabric");
          const ratioX = viewport.width / parsedPage.width;
          const ratioY = viewport.height / parsedPage.height;

          const createdTextboxes = parsedPage.blocks.map((blk: ParsedBlock) =>
            new Textbox(blk.text, {
              left: blk.x * ratioX,
              top: blk.y * ratioY,
              width: Math.max(4, blk.width * ratioX),
              fontSize: Math.max(4, blk.fontSize * ratioY),
              lineHeight: blk.lineHeight,
              fill: blk.fill,
              fontFamily: blk.fontFamily,
              fontWeight: blk.fontWeight,
              selectable: true,
              editable: true,
              evented: true,
              visible: true,
              hasControls: true,
              hasBorders: true,
              borderColor: "#3b82f6",
              borderScaleFactor: 2,
              cornerColor: "#3b82f6",
              cornerStrokeColor: "#3b82f6",
              cornerStyle: "circle",
              transparentCorners: false,
              cornerSize: 5,
              padding: 2,
            })
          );
          createdTextboxes.forEach((textbox) => fabricCanvas.add(textbox));
          userObjectsRef.current = createdTextboxes;
        }

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, rotation, zoom]);

  const registerCanvas = useCallback((element: HTMLCanvasElement | null) => {
    canvasRef.current = element;
  }, []);

  return { registerCanvas, isRendering };
}
