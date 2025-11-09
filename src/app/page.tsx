"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
} from "react";
import { Upload, ZoomIn, ZoomOut } from "lucide-react";
import { usePdfStore } from "@/lib/store";
import type { PdfViewerProps } from "./pdf/PdfViewer";
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, ZOOM_DEFAULT } from "@/lib/viewer";
import { PdfMinimap } from "./pdf/components/PdfMinimap";
import { DocumentSkeleton } from "./pdf/components/DocumentSkeleton";
import { ErrorBanner } from "./pdf/components/ErrorBanner";
import { usePdfDocument } from "./pdf/hooks/usePdfDocument";

const PdfViewer = dynamic<PdfViewerProps>(() => import("./pdf/PdfViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[480px] items-center justify-center rounded-xl border border-slate-800/60 bg-slate-900/40 text-sm text-slate-400">
      Preparing viewer…
    </div>
  ),
}) as unknown as ComponentType<PdfViewerProps>;

export default function Page() {
  const [fileUrl, setFileUrl] = useState<string>("");
  const [fileName, setFileName] = useState<string | null>(null);
  const zoom = usePdfStore((state) => state.zoom);
  const setZoom = usePdfStore((state) => state.setZoom);
  const resetRotations = usePdfStore((state) => state.resetRotations);
  const rotations = usePdfStore((state) => state.rotations);
  const setRotation = usePdfStore((state) => state.setRotation);
  const { doc, pageCount, loading, error } = usePdfDocument(fileUrl);
  const [scrollAreaHeight, setScrollAreaHeight] = useState<number | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const pendingFitRef = useRef(false);

  const hasDocument = useMemo(() => Boolean(fileUrl), [fileUrl]);
  const pageNumbers = useMemo(() => {
    if (!doc || pageCount === 0) return [];
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }, [doc, pageCount]);
  const contentReady = Boolean(doc) && pageNumbers.length > 0;

  useEffect(() => {
    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  useEffect(() => {
    if (!hasDocument) {
      setScrollAreaHeight(null);
      pendingFitRef.current = false;
      return;
    }

    let frameId: number | null = null;

    const updateHeight = () => {
      const container = scrollAreaRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const bottomPadding = 48; // matches main padding to avoid overflow
      const available = window.innerHeight - rect.top - bottomPadding;
      const nextHeight = Math.max(320, available);

      setScrollAreaHeight((prev) => {
        if (prev !== null && Math.abs(prev - nextHeight) < 1) {
          return prev;
        }
        pendingFitRef.current = true;
        return nextHeight;
      });
    };

    frameId = window.requestAnimationFrame(updateHeight);
    window.addEventListener("resize", updateHeight);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("resize", updateHeight);
    };
  }, [hasDocument, loading]);

  useEffect(() => {
    if (!doc || !pendingFitRef.current || scrollAreaHeight === null) {
      return;
    }

    const container = scrollAreaRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;
    let frameId: number | null = null;

    const fitToWidth = async () => {
      let page: Awaited<ReturnType<typeof doc.getPage>> | null = null;
      try {
        page = await doc.getPage(1);
        if (cancelled) {
          return;
        }

        const styles = window.getComputedStyle(container);
        const paddingLeft = parseFloat(styles.paddingLeft || "0");
        const paddingRight = parseFloat(styles.paddingRight || "0");
        const availableWidth =
          container.clientWidth - (paddingLeft + paddingRight);

        if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
          return;
        }

        const viewport = page.getViewport({ scale: 1 });
        const rawPercent = (availableWidth / viewport.width) * 100;

        if (!Number.isFinite(rawPercent) || rawPercent <= 0) {
          return;
        }

        const snapped = Math.round(rawPercent / ZOOM_STEP) * ZOOM_STEP;
        const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped));

        setZoom(clamped);
        pendingFitRef.current = false;
      } catch (error) {
        console.error("Failed to fit PDF to width", error);
        pendingFitRef.current = false;
      } finally {
        page?.cleanup?.();
      }
    };

    frameId = window.requestAnimationFrame(() => {
      void fitToWidth();
    });

    return () => {
      cancelled = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [doc, scrollAreaHeight, setZoom]);

  const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setFileUrl(url);
      setFileName(file.name);
      setZoom(ZOOM_DEFAULT);
      resetRotations();
      pendingFitRef.current = true;
      setScrollAreaHeight(null);
    }
  };

  const handleRotate = useCallback(
    (pageNumber: number, delta: number) => {
      const current = rotations[pageNumber] ?? 0;
      setRotation(pageNumber, current + delta);
    },
    [rotations, setRotation]
  );

  const zoomIn = () => setZoom(Math.min(ZOOM_MAX, zoom + ZOOM_STEP));
  const zoomOut = () => setZoom(Math.max(ZOOM_MIN, zoom - ZOOM_STEP));
  const resetZoom = () => setZoom(ZOOM_DEFAULT);
  return (
    <main className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 px-2 text-slate-50">
      <section className="flex flex-1 flex-col rounded-3xl border border-slate-800/60 bg-slate-900/60 p-2 shadow-[0_12px_80px_-28px_rgba(148,163,184,0.4)] backdrop-blur">
        <div className="flex flex-wrap items-center gap-4">
          <label className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/60 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-900">
            <Upload className="h-5 w-5 text-slate-400 transition group-hover:text-slate-200" />
            <span>{fileName ?? "Upload PDF"}</span>
            <input
              className="sr-only"
              type="file"
              accept="application/pdf"
              onChange={handleUpload}
            />
          </label>

          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800/60 bg-slate-950/40 p-2">
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN || !hasDocument}
              className="flex items-center gap-2 rounded-xl bg-slate-900/80 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
              <span>-{ZOOM_STEP}%</span>
            </button>

            <div className="flex items-center gap-2 rounded-xl bg-slate-900/80 px-4 py-2 text-sm text-slate-300">
              <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Zoom
              </span>
              <span className="font-mono text-base text-white">{zoom}%</span>
            </div>

            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX || !hasDocument}
              className="flex items-center gap-2 rounded-xl bg-slate-900/80 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
              <span>+{ZOOM_STEP}%</span>
            </button>

            <button
              type="button"
              onClick={resetZoom}
              disabled={!hasDocument || zoom === ZOOM_DEFAULT}
              className="rounded-xl border border-slate-700/70 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="mt-1 flex flex-1 flex-col gap-4">
          {hasDocument ? (
            <div className="flex flex-1 min-h-0 gap-4 rounded-2xl border border-slate-800/60 bg-slate-950/40 p-4">
              {contentReady && doc ? (
                <PdfMinimap
                  doc={doc}
                  pageNumbers={pageNumbers}
                  rotations={rotations}
                  onRotate={handleRotate}
                />
              ) : null}

              <div
                ref={scrollAreaRef}
                className="relative flex-1 min-h-0 overflow-x-auto overflow-y-auto rounded-xl border border-slate-800/60 bg-slate-950/60"
                style={
                  scrollAreaHeight
                    ? { height: `${scrollAreaHeight}px` }
                    : undefined
                }
              >
                {loading && <DocumentSkeleton />}
                {error && <ErrorBanner message={error} />}
                {contentReady && doc && (
                  <PdfViewer
                    doc={doc}
                    fileUrl={fileUrl}
                    pageNumbers={pageNumbers}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800/60 bg-slate-950/40 p-4">
              <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-center text-slate-500">
                <div className="rounded-full border border-dashed border-slate-700/70 p-6">
                  <Upload className="h-8 w-8 text-slate-600" />
                </div>
                <p className="text-base font-medium text-slate-300">
                  Drop a PDF here or use the uploader to begin.
                </p>
                <p className="max-w-lg text-sm text-slate-500">
                  Each page renders onto its own Fabric canvas so you can zoom
                  in for detail work and rotate individual pages from the
                  minimap sidebar.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>  
    </main>
  );
}
