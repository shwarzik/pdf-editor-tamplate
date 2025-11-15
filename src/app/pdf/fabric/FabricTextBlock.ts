"use client";

type TextboxCtor = typeof import("fabric").Textbox;
type FabricTextbox = InstanceType<TextboxCtor>;
type TextboxOptions = ConstructorParameters<TextboxCtor>[1];

export type FabricTextBlockOptions = Partial<TextboxOptions> & {
  minWidth?: number;
  minHeight?: number;
  lockVerticalResize?: boolean;
};

export interface FabricTextBlockExport {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fontSize: number;
  fontFamily?: string;
  lineHeight?: number;
  pdfY: number;
}

const DEFAULT_WIDTH = 200;
const DEFAULT_FONT_SIZE = 24;
const DEFAULT_LINE_HEIGHT = 1.2;
const LINE_HEIGHT_MIN = 1;
const LINE_HEIGHT_MAX = 3;
const LINE_BREAK_REGEX = /\r?\n/;
const FONT_METRIC_SAMPLE = "HgypQÅß109";

type BaselineRatios = {
  ascent: number;
  descent: number;
};

const DEFAULT_BASELINE_RATIOS: BaselineRatios = {
  ascent: 1,
  descent: 0,
};

const FONT_RATIO_OVERRIDES: Record<string, BaselineRatios> = {
  "courier new": { ascent: 0.78, descent: 0.22 },
  courier: { ascent: 0.78, descent: 0.22 },
  "times new roman": { ascent: 0.92, descent: 0.08 },
  times: { ascent: 0.92, descent: 0.08 },
};

const measurementCanvas =
  typeof document !== "undefined" ? document.createElement("canvas") : null;
const measurementContext = measurementCanvas?.getContext("2d") ?? null;

type FontMetricOptions = {
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  fontSize: number;
  baselineRatios?: BaselineRatios;
};

type FontProfile = {
  lineCount: number;
  baselineOffset: number;
  descentExtension: number;
};

/**
 * Instantiate a Fabric Textbox that behaves like a true text block:
 * resizing updates width/height while keeping the font size and
 * scale factors intact.
 */
export function createFabricTextBlock(
  TextboxCtor: TextboxCtor,
  text: string,
  options: FabricTextBlockOptions = {}
): FabricTextbox {
  const {
    minWidth = DEFAULT_FONT_SIZE,
    minHeight = DEFAULT_FONT_SIZE,
    lockVerticalResize = false,
    ...textboxOptions
  } = options;

  const resolvedFontSize = textboxOptions.fontSize ?? DEFAULT_FONT_SIZE;
  const resolvedPadding = textboxOptions.padding ?? 0;
  const baselineRatios = resolveFontRatios(textboxOptions.fontFamily);
  const fontProfile = getFontProfileFromOptions(text, {
    fontFamily: textboxOptions.fontFamily,
    fontWeight: textboxOptions.fontWeight,
    fontStyle: textboxOptions.fontStyle,
    fontSize: resolvedFontSize,
    baselineRatios,
  });
  const normalizedLineHeight = normalizeLineHeight(
    text,
    textboxOptions.lineHeight,
    resolvedFontSize,
    textboxOptions.height
  );
  const contentLineCount = Math.max(fontProfile.lineCount, 1);
  const fallbackContentHeight = normalizedLineHeight * resolvedFontSize * contentLineCount;
  const providedHeight = textboxOptions.height;
  const resolvedContentHeight =
    typeof providedHeight === "number" ? providedHeight : fallbackContentHeight;
  const offsetTop = resolvedPadding + fontProfile.baselineOffset;
  const extraHeight = resolvedPadding * 2 + Math.max(fontProfile.descentExtension, 0);
  const resolvedHeight = resolvedContentHeight + extraHeight;
  const providedTop = textboxOptions.top;
  const resolvedTop = typeof providedTop === "number" ? providedTop - offsetTop : undefined;
  const resolvedWidth = textboxOptions.width ?? DEFAULT_WIDTH;

  const textbox = new TextboxCtor(text, {
    ...textboxOptions,
    ...(typeof resolvedTop === "number" ? { top: resolvedTop } : {}),
    ...(typeof resolvedHeight === "number" ? { height: resolvedHeight } : {}),
    width: resolvedWidth,
    fontSize: resolvedFontSize,
    lineHeight: normalizedLineHeight,
    textAlign: textboxOptions.textAlign ?? "left",
    editable: textboxOptions.editable ?? false,
    padding: resolvedPadding,
  });

  textbox.set({ scaleX: 1, scaleY: 1, lockScalingFlip: true });
  attachResizeBehavior(textbox, { minWidth, minHeight, lockVerticalResize });
  attachEditingHandleVisibility(textbox);

  return textbox;
}

/**
 * Intercepts Fabric's scaling gesture so the textbox resizes instead of scaling.
 * Note: Fabric does not auto-wrap vertically; height merely sets a clipping box.
 */
function attachResizeBehavior(
  textbox: FabricTextbox,
  behavior: { minWidth: number; minHeight: number; lockVerticalResize: boolean }
) {
  const applyResize = () => {
    const baseWidth = textbox.width ?? textbox.getScaledWidth();
    const baseHeight = textbox.height ?? textbox.getScaledHeight();
    const resizedWidth = Math.max(behavior.minWidth, baseWidth * textbox.scaleX);
    const resizedHeight = Math.max(behavior.minHeight, baseHeight * textbox.scaleY);
    const contentBounds = calculateContentBounds(textbox);
    const nextWidth = Math.max(resizedWidth, contentBounds.width);
    const nextHeight = Math.max(resizedHeight, contentBounds.height);

    textbox.set("scaleX", 1);
    textbox.set("scaleY", 1);
    textbox.set("width", nextWidth);
    if (!behavior.lockVerticalResize) {
      textbox.set("height", nextHeight);
    }

    textbox.setCoords();
    textbox.canvas?.requestRenderAll();
  };

  const handleScaling = () => applyResize();

  textbox.on("scaling", handleScaling);
}

function attachEditingHandleVisibility(textbox: FabricTextbox) {
  let removed = false;
  const ensureHandles = () => {
    textbox.set({
      hasControls: true,
      hasBorders: true,
      borderOpacityWhenMoving: 1,
    });
    textbox.canvas?.requestRenderAll();
  };

  const handleRemove = () => {
    removed = true;
    textbox.off("editing:entered", ensureHandles);
    textbox.off("editing:exited", ensureHandles);
    textbox.off("removed", handleRemove);
  };

  textbox.on("editing:entered", ensureHandles);
  textbox.on("editing:exited", ensureHandles);
  textbox.on("removed", handleRemove);

  if (!removed) {
    ensureHandles();
  }
}

/**
 * Generate the coordinates/font payload needed to map the block back to PDF units.
 * The `pdfY` value mirrors pdf.js convention: `pdfHeight - y - height`.
 */
export function exportFabricTextBlock(
  textbox: FabricTextbox,
  pdfHeight: number
): FabricTextBlockExport {
  const fontSize = textbox.fontSize ?? DEFAULT_FONT_SIZE;
  const lineHeight = textbox.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const padding = textbox.padding ?? 0;
  const fontProfile = getFontProfileFromTextbox(textbox);
  const x = textbox.left ?? 0;
  const boundingY = textbox.top ?? 0;
  const boundingWidth = textbox.width ?? textbox.getScaledWidth();
  const boundingHeight = textbox.height ?? textbox.getScaledHeight();
  const verticalAllowance = padding * 2 + Math.max(fontProfile.descentExtension, 0);
  const contentY = boundingY + padding + fontProfile.baselineOffset;
  const contentHeight = Math.max(0, boundingHeight - verticalAllowance);

  return {
    x,
    y: contentY,
    width: boundingWidth,
    height: contentHeight,
    rotation: textbox.angle ?? 0,
    fontSize,
    fontFamily: textbox.fontFamily,
    lineHeight,
    pdfY: pdfHeight - contentY - contentHeight,
  };
}

function normalizeLineHeight(
  text: string,
  provided: number | undefined,
  fontSize: number,
  explicitHeight?: number
) {
  if (typeof provided === "number" && provided >= LINE_HEIGHT_MIN && provided <= LINE_HEIGHT_MAX) {
    return provided;
  }

  const lines = countLines(text);
  if (fontSize <= 0) {
    return DEFAULT_LINE_HEIGHT;
  }

  if (explicitHeight && explicitHeight > 0) {
    const estimate = explicitHeight / (lines * fontSize);
    return clampLineHeight(estimate);
  }

  return DEFAULT_LINE_HEIGHT;
}

function calculateContentBounds(textbox: FabricTextbox) {
  const lines = textbox.text?.split(LINE_BREAK_REGEX) ?? [""];
  const longestLine = measureLongestLine(lines, textbox);
  const padding = textbox.padding ?? 0;
  const fontSize = textbox.fontSize ?? DEFAULT_FONT_SIZE;
  const lineHeight = textbox.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const lineCount = Math.max(lines.length, 1);

  return {
    width: Math.max(longestLine + padding * 2, fontSize),
    height: Math.max(lineCount * fontSize * lineHeight + padding * 2, fontSize),
  };
}

function measureLongestLine(lines: string[], textbox: FabricTextbox) {
  if (!lines.length) return 0;
  return lines.reduce((max, line) => Math.max(max, measureLineWidth(line, textbox)), 0);
}

function measureLineWidth(text: string, textbox: FabricTextbox) {
  const fallbackWidth = (textbox.fontSize ?? DEFAULT_FONT_SIZE) * (text.length || 1) * 0.5;
  if (!measurementContext) {
    return fallbackWidth;
  }

  measurementContext.font = buildFontDeclarationFromTarget(textbox);
  const metrics = measurementContext.measureText(text || " ");
  const charSpacing = textbox.charSpacing ?? 0;
  const spacingExtra = charSpacing
    ? ((textbox.fontSize ?? DEFAULT_FONT_SIZE) * charSpacing * Math.max((text.length || 1) - 1, 0)) / 1000
    : 0;
  return metrics.width + spacingExtra;
}

function buildFontDeclarationFromTarget(target: {
  fontStyle?: string;
  fontWeight?: string | number;
  fontSize?: number;
  fontFamily?: string;
}) {
  const fontStyle = target.fontStyle ?? "normal";
  const fontWeight =
    typeof target.fontWeight === "number" ? target.fontWeight.toString() : target.fontWeight ?? "normal";
  const fontSize = target.fontSize ?? DEFAULT_FONT_SIZE;
  const fontFamily = target.fontFamily ?? "sans-serif";
  return `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`.trim();
}

function clampLineHeight(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_LINE_HEIGHT;
  }
  return Math.min(Math.max(value, LINE_HEIGHT_MIN), LINE_HEIGHT_MAX);
}

function countLines(text: string) {
  return Math.max(text.split(LINE_BREAK_REGEX).length, 1);
}

function getFontProfileFromOptions(text: string, options: FontMetricOptions): FontProfile {
  const lines = text.split(LINE_BREAK_REGEX);
  const ratios = options.baselineRatios ?? resolveFontRatios(options.fontFamily);
  const metricOptions: FontMetricOptions = {
    ...options,
    baselineRatios: ratios,
  };
  const sampleExtents = measureLineExtents(FONT_METRIC_SAMPLE, metricOptions);
  const ascent = sampleExtents.ascent || options.fontSize * ratios.ascent;
  const descent = sampleExtents.descent || options.fontSize * ratios.descent;
  const expectedAscent = options.fontSize * ratios.ascent;
  const expectedDescent = options.fontSize * ratios.descent;

  return {
    lineCount: Math.max(lines.length, 1),
    baselineOffset: clampFinite(ascent - expectedAscent),
    descentExtension: clampFinite(descent - expectedDescent),
  };
}

function getFontProfileFromTextbox(textbox: FabricTextbox): FontProfile {
  const text = textbox.text ?? "";
  const options: FontMetricOptions = {
    fontFamily: textbox.fontFamily,
    fontWeight: textbox.fontWeight,
    fontStyle: textbox.fontStyle,
    fontSize: textbox.fontSize ?? DEFAULT_FONT_SIZE,
    baselineRatios: resolveFontRatios(textbox.fontFamily),
  };
  return getFontProfileFromOptions(text, options);
}

function measureLineExtents(text: string, options: FontMetricOptions) {
  const ratios = options.baselineRatios ?? resolveFontRatios(options.fontFamily);
  if (!measurementContext) {
    return {
      ascent: options.fontSize * ratios.ascent,
      descent: options.fontSize * ratios.descent,
    };
  }

  const fontTarget = {
    fontFamily: options.fontFamily,
    fontStyle: options.fontStyle,
    fontWeight: options.fontWeight,
    fontSize: options.fontSize,
  };

  measurementContext.font = buildFontDeclarationFromTarget(fontTarget);
  const metrics = measurementContext.measureText(text || " ");
  const ascent = metrics.actualBoundingBoxAscent ?? options.fontSize * ratios.ascent;
  const descent = metrics.actualBoundingBoxDescent ?? options.fontSize * ratios.descent;
  return {
    ascent,
    descent,
  };
}

function resolveFontRatios(fontFamily?: string): BaselineRatios {
  if (!fontFamily) {
    return DEFAULT_BASELINE_RATIOS;
  }
  const key = fontFamily.trim().toLowerCase();
  return FONT_RATIO_OVERRIDES[key] ?? DEFAULT_BASELINE_RATIOS;
}

function clampFinite(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value;
}
