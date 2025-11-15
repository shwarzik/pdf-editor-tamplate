import { useCallback, useEffect, useRef, useState } from "react";
import { isRenderingCancelled } from "../rendering";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderParameters,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";
import { type Canvas as FabricCanvas, type FabricImage, type FabricObject } from "fabric";
import { createFabricTextBlock } from "../fabric/FabricTextBlock";
import type { ParsedBlock, ParsedPage } from "@/lib/store";

const OVERLAY_HEIGHT_PADDING = 2;
const ROTATION_STEP_DEGREES = 90;

type NormalizedPoint = {
  x: number;
  y: number;
};

type OriginalBounds = {
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  heightRatio: number;
  captureRotation: number;
};

type OverlaySerializedMeta = {
  isRevealed?: boolean;
  originalBounds?: OriginalBounds;
};

const normalizeRotationSteps = (value: number) => {
  const steps = Math.round(value / ROTATION_STEP_DEGREES);
  const normalized = ((steps % 4) + 4) % 4;
  return normalized;
};

const rotateNormalizedPoint = (point: NormalizedPoint, steps: number): NormalizedPoint => {
  switch (steps) {
    case 1:
      return { x: 1 - point.y, y: point.x };
    case 2:
      return { x: 1 - point.x, y: 1 - point.y };
    case 3:
      return { x: point.y, y: 1 - point.x };
    default:
      return point;
  }
};

const boundsFromPoints = (points: NormalizedPoint[]) => {
  const xs = points.map((pt) => pt.x);
  const ys = points.map((pt) => pt.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    width: Math.max(maxX - minX, 0),
    height: Math.max(maxY - minY, 0),
  };
};

const getOriginOffsetValue = (origin: string | undefined, size: number) => {
  if (origin === "center") {
    return size / 2;
  }
  if (origin === "right" || origin === "bottom") {
    return size;
  }
  return 0;
};

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
  const OVERLAY_DATA_KEY = "__overlayPatchMeta" as const;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const imageRef = useRef<FabricImage | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const prevZoomRef = useRef<number>(zoom);
  const prevRotationRef = useRef<number>(rotation);
  const prevViewportRef = useRef<{ width: number; height: number } | null>(null);
  const userObjectsRef = useRef<FabricObject[]>([]);
  const fabricModuleRef = useRef<Awaited<typeof import("fabric")> | null>(null);
  const snapshotVersionRef = useRef(0);
  const editModeRef = useRef(editMode);
  const textboxMetaRef = useRef(
    new WeakMap<
      FabricObject,
      {
        backgroundPatch?: FabricObject;
        originalBounds?: OriginalBounds;
        isRevealed?: boolean;
        handlers?: {
          selected: () => void;
          deselected: () => void;
          removed: () => void;
        };
        snapshotVersion?: number;
      }
    >()
  );

  const isTextbox = useCallback(
    (obj: FabricObject): obj is FabricObject & { type: "textbox" } => obj?.type === "textbox",
    []
  );

  const getOverlayData = useCallback((textbox: FabricObject): OverlaySerializedMeta | null => {
    const data = (textbox as FabricObject & { data?: Record<string, unknown> }).data;
    const payload = data?.[OVERLAY_DATA_KEY];
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    return payload as OverlaySerializedMeta;
  }, [OVERLAY_DATA_KEY]);

  const persistOverlayData = useCallback(
    (textbox: FabricObject, updates: OverlaySerializedMeta) => {
      const target = textbox as FabricObject & { data?: Record<string, unknown> };
      const nextData = { ...(target.data ?? {}) } as Record<string, unknown>;
      const currentOverlay = getOverlayData(textbox) ?? {};
      nextData[OVERLAY_DATA_KEY] = { ...currentOverlay, ...updates };
      target.set("data", nextData);
    },
    [OVERLAY_DATA_KEY, getOverlayData]
  );

  const ensureTextboxMeta = useCallback(
    (textbox: FabricObject) => {
      let meta = textboxMetaRef.current.get(textbox);
      if (!meta) {
        meta = {};
        const overlayData = getOverlayData(textbox);
        if (overlayData) {
          if (typeof overlayData.isRevealed === "boolean") {
            meta.isRevealed = overlayData.isRevealed;
          }
          if (overlayData.originalBounds) {
            meta.originalBounds = overlayData.originalBounds;
          }
        }
        textboxMetaRef.current.set(textbox, meta);
      }
      return meta;
    },
    [getOverlayData]
  );

  const removePatch = useCallback((patch?: FabricObject) => {
    if (!patch) return;
    patch.canvas?.remove(patch);
    patch.dispose?.();
  }, []);

  const setTextboxIdleAppearance = useCallback(
    (textbox: FabricObject, hideText: boolean) => {
      const meta = ensureTextboxMeta(textbox);
      const shouldShow = !!meta.isRevealed;
      textbox.set("opacity", shouldShow ? 1 : 0);

      if (meta.backgroundPatch) {
        // Patch only needs to be visible while editing to cover original text
        const shouldShowPatch = hideText && shouldShow;
        meta.backgroundPatch.set("visible", shouldShowPatch);
      }
    },
    [ensureTextboxMeta]
  );

  const captureTextboxBoundsSnapshot = useCallback(
    (textbox: FabricObject, viewportOverride?: { width: number; height: number }) => {
      const viewportSize =
        viewportOverride ??
        prevViewportRef.current ??
        (textbox.canvas
          ? { width: textbox.canvas.getWidth(), height: textbox.canvas.getHeight() }
          : null);
      if (!viewportSize) {
        return null;
      }

      textbox.setCoords();
      const rect = textbox.getBoundingRect();
      if (!rect) {
        return null;
      }

      const bounds: OriginalBounds = {
        leftRatio: rect.left / viewportSize.width,
        topRatio: rect.top / viewportSize.height,
        widthRatio: rect.width / viewportSize.width,
        heightRatio: rect.height / viewportSize.height,
        captureRotation: normalizeRotationSteps(rotation) * ROTATION_STEP_DEGREES,
      };

      const meta = ensureTextboxMeta(textbox);
      meta.originalBounds = bounds;
      persistOverlayData(textbox, { originalBounds: bounds });

      return bounds;
    },
    [ensureTextboxMeta, persistOverlayData, rotation]
  );

  const applyRotationTransform = useCallback(
    (
      textbox: FabricObject,
      prevViewport: { width: number; height: number },
      nextViewport: { width: number; height: number },
      rotationStepDelta: number
    ) => {
      if (rotationStepDelta === 0) {
        return;
      }
      const rotationDeltaDegrees = rotationStepDelta * ROTATION_STEP_DEGREES;

      const widthPx =
        typeof textbox.getScaledWidth === "function"
          ? textbox.getScaledWidth()
          : textbox.width ?? 0;
      const heightPx =
        typeof textbox.getScaledHeight === "function"
          ? textbox.getScaledHeight()
          : textbox.height ?? 0;

      const originX = typeof textbox.originX === "string" ? textbox.originX : "left";
      const originY = typeof textbox.originY === "string" ? textbox.originY : "top";
      const originOffsetX = getOriginOffsetValue(originX, widthPx);
      const originOffsetY = getOriginOffsetValue(originY, heightPx);

      const centerPoint: NormalizedPoint = {
        x: ((textbox.left ?? 0) + originOffsetX) / prevViewport.width,
        y: ((textbox.top ?? 0) + originOffsetY) / prevViewport.height,
      };

      const rotatedCenter = rotateNormalizedPoint(centerPoint, rotationStepDelta);
      const newCenterX = rotatedCenter.x * nextViewport.width;
      const newCenterY = rotatedCenter.y * nextViewport.height;

      textbox.set({
        left: newCenterX - originOffsetX,
        top: newCenterY - originOffsetY,
        angle: (textbox.angle ?? 0) + rotationDeltaDegrees,
      });
      textbox.setCoords();
    },
    []
  );

  const applyZoomTransform = useCallback((textbox: FabricObject, zoomScale: number) => {
    if (zoomScale === 1) {
      return;
    }
    textbox.set({
      left: (textbox.left ?? 0) * zoomScale,
      top: (textbox.top ?? 0) * zoomScale,
      scaleX: (textbox.scaleX ?? 1) * zoomScale,
      scaleY: (textbox.scaleY ?? 1) * zoomScale,
    });
    textbox.setCoords();
  }, []);

  const enforceTextboxBounds = useCallback(
    (textbox: FabricObject) => {
      if (!isTextbox(textbox)) return;
      const canvas = textbox.canvas;
      if (!canvas) return;

      textbox.setCoords();
      const rect = textbox.getBoundingRect();
      if (!rect) return;

      let deltaX = 0;
      let deltaY = 0;

      if (rect.left < 0) {
        deltaX -= rect.left;
      }
      if (rect.top < 0) {
        deltaY -= rect.top;
      }

      const overflowRight = rect.left + rect.width - canvas.getWidth();
      if (overflowRight > 0) {
        deltaX -= overflowRight;
      }

      const overflowBottom = rect.top + rect.height - canvas.getHeight();
      if (overflowBottom > 0) {
        deltaY -= overflowBottom;
      }

      if (deltaX !== 0 || deltaY !== 0) {
        textbox.set({
          left: (textbox.left ?? 0) + deltaX,
          top: (textbox.top ?? 0) + deltaY,
        });
        textbox.setCoords();
      }
    },
    [isTextbox]
  );

  const ensureBackgroundPatch = useCallback(
    (textbox: FabricObject): FabricObject | null => {
    const fabricModule = fabricModuleRef.current;
    if (!fabricModule) {
      return null;
    }

    const meta = ensureTextboxMeta(textbox);
    if (meta.backgroundPatch && meta.snapshotVersion === snapshotVersionRef.current) {
      return meta.backgroundPatch;
    }

    if (meta.backgroundPatch) {
      removePatch(meta.backgroundPatch);
      meta.backgroundPatch = undefined;
    }

    const viewportSize =
      prevViewportRef.current ??
      (textbox.canvas
        ? { width: textbox.canvas.getWidth(), height: textbox.canvas.getHeight() }
        : null);
    if (!viewportSize) {
      return null;
    }

    const bounds = meta.originalBounds ?? captureTextboxBoundsSnapshot(textbox, viewportSize);
    if (!bounds) {
      return null;
    }

    const currentRotationSteps = normalizeRotationSteps(rotation);
    const captureSteps = normalizeRotationSteps(bounds.captureRotation);
    const rotationDelta = (currentRotationSteps - captureSteps + 4) % 4;

    const basePoints: NormalizedPoint[] = [
      { x: bounds.leftRatio, y: bounds.topRatio },
      { x: bounds.leftRatio + bounds.widthRatio, y: bounds.topRatio },
      {
        x: bounds.leftRatio + bounds.widthRatio,
        y: bounds.topRatio + bounds.heightRatio,
      },
      { x: bounds.leftRatio, y: bounds.topRatio + bounds.heightRatio },
    ];
    const rotatedPoints =
      rotationDelta === 0
        ? basePoints
        : basePoints.map((point) => rotateNormalizedPoint(point, rotationDelta));
    const normalizedBounds = boundsFromPoints(rotatedPoints);

    const width = normalizedBounds.width * viewportSize.width;
    let height = normalizedBounds.height * viewportSize.height;
    const left = normalizedBounds.minX * viewportSize.width;
    let top = normalizedBounds.minY * viewportSize.height;

    height = Math.max(1, height + OVERLAY_HEIGHT_PADDING);
    if (top + height > viewportSize.height) {
      height = viewportSize.height - top;
    }
    if (height < 1) {
      height = 1;
    }
    if (top < 0) {
      const correction = Math.min(-top, height - 1);
      top += correction;
      height -= correction;
    }

    const { Rect } = fabricModule;
    if (!Rect) {
      return null;
    }

    const patch = new Rect({
      width: Math.max(1, width),
      height: Math.max(1, height),
      left,
      top,
      originX: "left",
      originY: "top",
      angle: 0,
      scaleX: 1,
      scaleY: 1,
      rx: 0,
      ry: 0,
      fill: "#ffffff",
      strokeWidth: 0,
      selectable: false,
      evented: false,
      hoverCursor: "default",
      excludeFromExport: true,
      visible: false,
    });

    meta.backgroundPatch = patch;
    meta.snapshotVersion = snapshotVersionRef.current;

    const canvas = textbox.canvas;
    if (canvas) {
      const wasActive = canvas.getActiveObject() === textbox;
      canvas.remove(textbox);
      canvas.add(patch);
      canvas.add(textbox);
      if (wasActive) {
        canvas.setActiveObject(textbox);
      }
    }

      return patch;
    },
    [captureTextboxBoundsSnapshot, ensureTextboxMeta, removePatch, rotation]
  );

  const activateTextbox = useCallback(
    (textbox: FabricObject) => {
      const meta = ensureTextboxMeta(textbox);
      meta.isRevealed = true;
      persistOverlayData(textbox, { isRevealed: true });

      textbox.set("opacity", 1);
      const patch = ensureBackgroundPatch(textbox);
      if (patch) {
        patch.set("visible", true);
      }
    },
    [ensureBackgroundPatch, ensureTextboxMeta, persistOverlayData]
  );

  const bindTextboxInteractions = useCallback(
    (textbox: FabricObject) => {
    const meta = ensureTextboxMeta(textbox);
    if (meta.handlers) {
      return;
    }

    const handleSelected = () => {
      activateTextbox(textbox);
      textbox.canvas?.requestRenderAll();
    };

    const handleDeselected = () => {
      setTextboxIdleAppearance(textbox, editModeRef.current);
      textbox.canvas?.requestRenderAll();
    };

    const handleRemoved = () => {
      removePatch(meta.backgroundPatch);
      textbox.off("selected", handleSelected);
      textbox.off("deselected", handleDeselected);
      textbox.off("removed", handleRemoved);
      textbox.off("moving", handleMoving);
      textbox.off("modified", handleModified);
      textboxMetaRef.current.delete(textbox);
    };

    const handleMoving = () => enforceTextboxBounds(textbox);
    const handleModified = () => enforceTextboxBounds(textbox);

    meta.handlers = {
      selected: handleSelected,
      deselected: handleDeselected,
      removed: handleRemoved,
    };

      textbox.on("selected", handleSelected);
      textbox.on("deselected", handleDeselected);
      textbox.on("removed", handleRemoved);
      textbox.on("moving", handleMoving);
      textbox.on("modified", handleModified);
      enforceTextboxBounds(textbox);
    },
    [activateTextbox, enforceTextboxBounds, ensureTextboxMeta, removePatch, setTextboxIdleAppearance]
  );

  const registerTextboxes = useCallback(
    (entries: FabricObject[]) => {
      entries.forEach((obj) => {
        if (isTextbox(obj)) {
          bindTextboxInteractions(obj);
          setTextboxIdleAppearance(obj, editModeRef.current);
          enforceTextboxBounds(obj);
        }
      });
    },
    [bindTextboxInteractions, enforceTextboxBounds, isTextbox, setTextboxIdleAppearance]
  );

  useEffect(() => {
    return () => {
      userObjectsRef.current.forEach((obj) => obj.dispose());
      userObjectsRef.current = [];
      imageRef.current?.dispose();
      imageRef.current = null;
      fabricRef.current?.dispose();
      fabricRef.current = null;
      snapshotVersionRef.current = 0;
      textboxMetaRef.current = new WeakMap();
    };
  }, []);
  // Handle edit mode changes
  useEffect(() => {
    const fabricCanvas = fabricRef.current;
    if (!fabricCanvas) return;

    editModeRef.current = editMode;
    // Update canvas selection mode
    fabricCanvas.selection = editMode;
    // Update all user objects visibility and interactivity
    const activeObject = fabricCanvas.getActiveObject();

    userObjectsRef.current.forEach((obj) => {
      obj.set({
        selectable: editMode,
        evented: editMode,
        visible: true,
        editable: editMode,
        // Styling for the selection box (container/bounding box)
        borderColor: "#3b82f6", // Blue border for selection box
        borderScaleFactor: 1, // Border thickness
        cornerColor: "#3b82f6", // Blue corner handles
        cornerStrokeColor: "#3b82f6",
        cornerStyle: "circle", // Circular corner handles
        transparentCorners: false, // Solid corners
        cornerSize: editMode ? 4 : 0, // Show handles only in edit mode
        padding: 1, // Space between text and selection border
      });
      if (isTextbox(obj)) {
        const meta = textboxMetaRef.current.get(obj);
        if (editMode) {
          if (obj === activeObject) {
            activateTextbox(obj);
          } else if (meta?.isRevealed) {
            obj.set("opacity", 1);
            const patch = ensureBackgroundPatch(obj);
            if (patch) {
              patch.set("visible", true);
            }
          } else {
            setTextboxIdleAppearance(obj, true);
          }
        } else {
          setTextboxIdleAppearance(obj, false);
        }
      }
    });

    fabricCanvas.requestRenderAll();
  }, [activateTextbox, editMode, ensureBackgroundPatch, isRendering, isTextbox, setTextboxIdleAppearance]);

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
      const fabricModule = await import("fabric");
      if (!fabricModuleRef.current) {
        fabricModuleRef.current = fabricModule;
      }
      const { Textbox } = fabricModule;
      const ratioX = lastViewport.width / parsedPage.width;
      const ratioY = lastViewport.height / parsedPage.height;
      const createdTextboxes = parsedPage.blocks.map((blk: ParsedBlock) =>
        createFabricTextBlock(Textbox, blk.text, {
          left: blk.x * ratioX,
          top: blk.y * ratioY,
          width: Math.max(4, blk.width * ratioX),
          height: Math.max(4, blk.height * ratioY),
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
          minWidth: 4,
          minHeight: 4,
        })
      );
      createdTextboxes.forEach((obj) => fabricCanvas.add(obj));
      userObjectsRef.current = createdTextboxes;
      registerTextboxes(createdTextboxes);
      fabricCanvas.requestRenderAll();
    })().catch((e) => console.error("failed to add parsed blocks", e));
  }, [editMode, parsedPage, registerTextboxes]);

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

        snapshotVersionRef.current += 1;

        const fabricModule = await import("fabric");
        fabricModuleRef.current = fabricModule;
        const { Canvas, FabricImage } = fabricModule;

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

        // Cache previous viewport/rotation before updating refs
        const prevViewport = prevViewportRef.current;
        const prevRotation = prevRotationRef.current;
        const prevZoom = prevZoomRef.current;

        // Calculate zoom scale factor for transforms
        const zoomScale = prevZoom ? zoom / prevZoom : 1;

        prevZoomRef.current = zoom;
        prevRotationRef.current = rotation;
        prevViewportRef.current = { width: viewport.width, height: viewport.height };

        // Restore or create user objects
        if (userObjectsRef.current.length > 0) {
          // Restore existing user objects with adjusted position/size/rotation
          userObjectsRef.current.forEach((obj) => {
            if (!isNewCanvas && prevViewport) {
              const prevViewportSize = prevViewport;
              const nextViewportSize = { width: viewport.width, height: viewport.height };
              const prevRotationSteps = normalizeRotationSteps(prevRotation ?? rotation);
              const currentRotationSteps = normalizeRotationSteps(rotation);
              const rotationStepDelta = (currentRotationSteps - prevRotationSteps + 4) % 4;

              if (rotationStepDelta !== 0) {
                applyRotationTransform(obj, prevViewportSize, nextViewportSize, rotationStepDelta);
                if (zoomScale !== 1) {
                  applyZoomTransform(obj, zoomScale);
                }
              } else if (zoomScale !== 1) {
                applyZoomTransform(obj, zoomScale);
              }
            }
            fabricCanvas!.add(obj);
          });
          registerTextboxes(userObjectsRef.current);
        } else if (isNewCanvas && editMode && parsedPage && parsedPage.blocks.length > 0) {
          const fabricModuleForTextbox = await import("fabric");
          if (!fabricModuleRef.current) {
            fabricModuleRef.current = fabricModuleForTextbox;
          }
          const { Textbox } = fabricModuleForTextbox;
          const ratioX = viewport.width / parsedPage.width;
          const ratioY = viewport.height / parsedPage.height;

          const createdTextboxes = parsedPage.blocks.map((blk: ParsedBlock) =>
            createFabricTextBlock(Textbox, blk.text, {
              left: blk.x * ratioX,
              top: blk.y * ratioY,
              width: Math.max(4, blk.width * ratioX),
              height: Math.max(4, blk.height * ratioY),
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
              minWidth: 4,
              minHeight: 4,
            })
          );
          createdTextboxes.forEach((textbox) => fabricCanvas.add(textbox));
          userObjectsRef.current = createdTextboxes;
          registerTextboxes(createdTextboxes);
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
