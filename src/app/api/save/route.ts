import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PageExportPayload, TextOverlayExport, SavePayload } from "@/lib/pdf-export-types";

export const runtime = "nodejs";

const PREVIEW_DIR = join(process.cwd(), "public", "previews");

const sanitizeFileName = (input: string | null | undefined) => {
  const fallback = "edited-document";
  if (!input) return fallback;
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  const withoutExt = trimmed.replace(/\.pdf$/i, "");
  const safe = withoutExt.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-");
  return safe || fallback;
};

const clamp01 = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const normalizeRotationSteps = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.round(value / 90);
  return ((normalized % 4) + 4) % 4;
};

type NormalizedPoint = { x: number; y: number };

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
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
};

const hexToRgb = (input: string | undefined | null) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(input?.trim() ?? "");
  if (!match) {
    return rgb(0, 0, 0);
  }
  const value = parseInt(match[1], 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  return rgb(r, g, b);
};

const FONT_TABLE = [
  { match: /times|georgia|palatino/i, normal: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold },
  { match: /helvetica|arial|avenir|lato/i, normal: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold },
  { match: /courier|mono/i, normal: StandardFonts.Courier, bold: StandardFonts.CourierBold },
];

const pickStandardFont = (family: string | undefined, weight: "normal" | "bold") => {
  if (family) {
    const entry = FONT_TABLE.find((item) => item.match.test(family));
    if (entry) {
      return weight === "bold" ? entry.bold : entry.normal;
    }
  }
  return weight === "bold" ? StandardFonts.HelveticaBold : StandardFonts.Helvetica;
};

const deriveBounds = (
  overlay: TextOverlayExport,
  pagePayload: PageExportPayload,
  pageWidth: number,
  pageHeight: number
) => {
  const viewportWidth = pagePayload.width || pageWidth;
  const viewportHeight = pagePayload.height || pageHeight;
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }

  const leftRatio = clamp01(overlay.left / viewportWidth);
  const topRatio = clamp01(overlay.top / viewportHeight);
  const widthRatio = clamp01(overlay.width / viewportWidth);
  const heightRatio = clamp01(overlay.height / viewportHeight);

  if (widthRatio <= 0 || heightRatio <= 0) {
    return null;
  }

  const rotationSteps = normalizeRotationSteps(pagePayload.rotation ?? 0);
  const inverseSteps = (4 - rotationSteps) % 4;

  const rotatedPoints: NormalizedPoint[] = [
    { x: leftRatio, y: topRatio },
    { x: leftRatio + widthRatio, y: topRatio },
    { x: leftRatio + widthRatio, y: topRatio + heightRatio },
    { x: leftRatio, y: topRatio + heightRatio },
  ];

  const basePoints = inverseSteps === 0
    ? rotatedPoints
    : rotatedPoints.map((point) => rotateNormalizedPoint(point, inverseSteps));

  const normalized = boundsFromPoints(basePoints);

  const left = normalized.minX * pageWidth;
  const top = normalized.minY * pageHeight;
  const width = normalized.width * pageWidth;
  const height = normalized.height * pageHeight;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const rectY = pageHeight - (top + height);
  const verticalScale = pageHeight / viewportHeight;
  const scaledFontSize = Math.max(0.5, overlay.fontSize * verticalScale || 12);
  const baselineY = pageHeight - (top + scaledFontSize);

  return {
    rectX: left,
    rectY,
    width,
    height,
    baselineY,
    fontSize: scaledFontSize,
  };
};

const computeMaskBoundsFromOriginal = (
  overlay: TextOverlayExport,
  pagePayload: PageExportPayload,
  pageWidth: number,
  pageHeight: number
) => {
  const original = overlay.originalBounds;
  if (!original) {
    return null;
  }

  const values = [
    original.leftRatio,
    original.topRatio,
    original.widthRatio,
    original.heightRatio,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const clampRatio = (value: number) => Math.min(1, Math.max(0, value));

  const rotationSteps = normalizeRotationSteps(pagePayload.rotation ?? 0);
  const captureSteps = normalizeRotationSteps(original.captureRotation ?? 0);
  const rotationDelta = (rotationSteps - captureSteps + 4) % 4;

  const basePoints: NormalizedPoint[] = [
    { x: clampRatio(original.leftRatio), y: clampRatio(original.topRatio) },
    {
      x: clampRatio(original.leftRatio + original.widthRatio),
      y: clampRatio(original.topRatio),
    },
    {
      x: clampRatio(original.leftRatio + original.widthRatio),
      y: clampRatio(original.topRatio + original.heightRatio),
    },
    {
      x: clampRatio(original.leftRatio),
      y: clampRatio(original.topRatio + original.heightRatio),
    },
  ];

  const rotatedPoints =
    rotationDelta === 0
      ? basePoints
      : basePoints.map((point) => rotateNormalizedPoint(point, rotationDelta));

  const normalized = boundsFromPoints(rotatedPoints);

  const width = normalized.width * pageWidth;
  const height = normalized.height * pageHeight;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const left = normalized.minX * pageWidth;
  const top = normalized.minY * pageHeight;
  const rectY = pageHeight - (top + height);

  return { rectX: left, rectY, width, height };
};

const resolveFont = async (
  pdfDoc: PDFDocument,
  cache: Map<string, PDFFont>,
  family: string | undefined,
  weight: "normal" | "bold"
) => {
  const key = `${family ?? "default"}|${weight}`;
  if (cache.has(key)) {
    return cache.get(key)!;
  }

  const fontName = pickStandardFont(family, weight);
  const font = await pdfDoc.embedFont(fontName, { subset: true });
  cache.set(key, font);
  return font;
};

const applyOverlaysToPage = async (
  pdfDoc: PDFDocument,
  page: PDFPage,
  pagePayload: PageExportPayload,
  fontCache: Map<string, PDFFont>
) => {
  if (!Array.isArray(pagePayload.overlays) || pagePayload.overlays.length === 0) {
    return false;
  }

  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  let modified = false;

  for (const overlay of pagePayload.overlays) {
    if (!overlay || typeof overlay.text !== "string" || !overlay.text.trim()) {
      continue;
    }

    const bounds = deriveBounds(overlay, pagePayload, pageWidth, pageHeight);
    if (!bounds) {
      continue;
    }

    const maskBounds =
      computeMaskBoundsFromOriginal(overlay, pagePayload, pageWidth, pageHeight) ?? bounds;

    page.drawRectangle({
      x: maskBounds.rectX,
      y: maskBounds.rectY,
      width: maskBounds.width,
      height: maskBounds.height,
      color: rgb(1, 1, 1),
      opacity: 1,
      borderColor: undefined,
    });

    const fontWeight = overlay.fontWeight === "bold" ? "bold" : "normal";
    const font = await resolveFont(pdfDoc, fontCache, overlay.fontFamily, fontWeight);
    const lineHeightRatio = Number.isFinite(overlay.lineHeight) && overlay.lineHeight > 0 ? overlay.lineHeight : 1.2;

    page.drawText(overlay.text.replace(/\r\n/g, "\n"), {
      x: bounds.rectX,
      y: bounds.baselineY,
      size: bounds.fontSize,
      lineHeight: bounds.fontSize * lineHeightRatio,
      maxWidth: bounds.width,
      font,
      color: hexToRgb(overlay.fill),
    });

    modified = true;
  }

  return modified;
};

export async function POST(req: NextRequest) {
  try {
    const modeParam = req.nextUrl.searchParams.get("mode");
    const mode: "preview" | "download" = modeParam === "download" ? "download" : "preview";

    const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected multipart/form-data payload." }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Original PDF is required." }, { status: 400 });
    }

    const payloadRaw = formData.get("payload");
    if (typeof payloadRaw !== "string") {
      return NextResponse.json({ error: "Export payload missing." }, { status: 400 });
    }

    const payload = JSON.parse(payloadRaw) as SavePayload;
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const pdfDoc = await PDFDocument.load(fileBuffer);
    const fontCache = new Map<string, PDFFont>();

    const pages: PageExportPayload[] = Array.isArray(payload.pages)
      ? payload.pages.sort((a, b) => a.pageNumber - b.pageNumber)
      : [];

    let modified = false;

    const allPages = pdfDoc.getPages();

    for (const pagePayload of pages) {
      if (!Number.isFinite(pagePayload.pageNumber)) {
        continue;
      }
      const pageIndex = Math.max(0, Math.floor(pagePayload.pageNumber - 1));
      const page = allPages[pageIndex];
      if (!page) {
        continue;
      }

      const changed = await applyOverlaysToPage(pdfDoc, page, pagePayload, fontCache);
      modified ||= changed;
    }

    const pdfBytes = await pdfDoc.save();
    const safeName = sanitizeFileName(payload.fileName);
    const downloadName = `${safeName}-edited.pdf`;

    if (mode === "preview") {
      await fs.mkdir(PREVIEW_DIR, { recursive: true });
      const fileToken = randomUUID();
      const storedFileName = `${fileToken}.pdf`;
      const storedPath = join(PREVIEW_DIR, storedFileName);
      await fs.writeFile(storedPath, pdfBytes);

      return NextResponse.json({
        id: fileToken,
        previewUrl: `/previews/${storedFileName}`,
        fileName: downloadName,
        modified,
      });
    }

    const pdfArrayBuffer = new Uint8Array(pdfBytes).buffer;
    const pdfBlob = new Blob([pdfArrayBuffer], { type: "application/pdf" });

    return new NextResponse(pdfBlob, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Content-Length": String(pdfBlob.size),
      },
    });
  } catch (error) {
    console.error("/api/save error", error);
    const message = error instanceof Error ? error.message : "Unable to save document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
