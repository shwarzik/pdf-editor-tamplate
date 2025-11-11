import { NextRequest, NextResponse } from "next/server";
import * as mupdf from "mupdf";

// Use MuPDF.js for precise text extraction with accurate font attributes
// Runtime must be Node.js
export const runtime = "nodejs";

interface ParsedBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: "normal" | "bold";
  lineHeight: number;
  fill: string;
}

interface ParsedPage {
  pageNumber: number;
  width: number;
  height: number;
  blocks: ParsedBlock[];
}

const COLOR_FALLBACK = "#1a1a1a";

const toHexComponent = (value: number) => {
  const normalized = value > 1 ? value : value * 255;
  const clamped = Math.max(0, Math.min(255, Math.round(normalized)));
  return clamped.toString(16).padStart(2, "0");
};

const rgbToHex = (r: number, g: number, b: number): string => {
  return `#${toHexComponent(r)}${toHexComponent(g)}${toHexComponent(b)}`;
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Load PDF with MuPDF for precise text extraction
    const doc = mupdf.Document.openDocument(buffer, "application/pdf");
    const numPages = doc.countPages();

    const pages: ParsedPage[] = [];

    for (let i = 0; i < numPages; i++) {
      const page = doc.loadPage(i);
      const bounds = page.getBounds();
      const pageWidth = bounds[2] - bounds[0];
      const pageHeight = bounds[3] - bounds[1];

      // Parse text items from MuPDF
      type TextItem = {
        text: string;
        x: number;
        y: number;
        width: number;
        height: number;
        fontSize: number;
        fontFamily: string;
        fontWeight: "normal" | "bold";
        fill: string;
        lineHeight: number;
      };

      const textItems: TextItem[] = [];
      
      // Use structured text to get positioning
      const sText = page.toStructuredText("preserve-whitespace,preserve-spans");
      
      // Walk the structured text to extract detailed information
      // Signature: onChar(char: string, origin: Point, font: Font, size: number, quad: Quad, color: Color)
      sText.walk({
        onChar: (char: string, origin: any, font: any, size: number, quad: any, color: any) => {
          if (char && char.trim() !== "") {
            // quad is a Quad object with points defining the character bounding box
            // Typically quad has properties like ul (upper-left), ur, ll (lower-left), lr
            const bbox = quad || { ul: { x: 0, y: 0 }, lr: { x: 0, y: 0 } };
            const x = bbox.ul?.x ?? bbox[0] ?? 0;
            const y = bbox.ul?.y ?? bbox[1] ?? 0;
            const x2 = bbox.lr?.x ?? bbox[2] ?? (x + 10);
            const y2 = bbox.lr?.y ?? bbox[3] ?? (y + size);
            const width = Math.abs(x2 - x);
            const height = Math.abs(y2 - y);

            // Extract font attributes
            const fontSize = size || 12;
            let fontName = font?.getName?.() || font?.toString?.() || "sans-serif";
            
            // Clean up font family name - PDF fonts often have format like "BAAAAA+FontName" or "FontName-Bold"
            // Remove subset prefix (6 uppercase letters + plus sign)
            fontName = fontName.replace(/^[A-Z]{6}\+/, "");
            
            // Split on common separators and get the base font name
            const fontParts = fontName.split(/[-,]/);
            let fontFamily = fontParts[0]?.trim() || "sans-serif";
            
            // Map common PDF font names to standard web fonts
            const fontMap: Record<string, string> = {
              "TimesNewRoman": "Times New Roman",
              "TimesNewRomanPS": "Times New Roman",
              "Arial": "Arial",
              "ArialMT": "Arial",
              "Helvetica": "Helvetica",
              "Courier": "Courier New",
              "CourierNew": "Courier New",
              "Calibri": "Calibri",
              "Verdana": "Verdana",
              "Georgia": "Georgia",
              "Palatino": "Palatino",
            };
            
            // Check if the font matches a known mapping
            for (const [key, value] of Object.entries(fontMap)) {
              if (fontFamily.toLowerCase().includes(key.toLowerCase())) {
                fontFamily = value;
                break;
              }
            }
            
            // Determine font weight from font name (check all parts for weight indicators)
            const fullFontName = fontName.toLowerCase();
            const isBold = /bold|heavy|black|demibold|semibold/i.test(fullFontName);
            const fontWeight: "normal" | "bold" = isBold ? "bold" : "normal";

            // Extract color from MuPDF (color is RGB array [r, g, b] in 0-1 range)
            let fill = COLOR_FALLBACK;
            if (color && Array.isArray(color) && color.length >= 3) {
              fill = rgbToHex(color[0], color[1], color[2]);
            }

            textItems.push({
              text: char,
              x,
              y,
              width,
              height,
              fontSize,
              fontFamily,
              fontWeight,
              fill,
              lineHeight: 1.2,
            });
          }
        }
      });

      // Group into lines by top Y proximity
      const yTol = 3; // px tolerance
      type Line = { y: number; items: TextItem[] };
      const lines: Line[] = [];
      for (const it of textItems) {
        const topY = it.y;
        let line = lines.find((ln) => Math.abs(ln.y - topY) <= yTol);
        if (!line) {
          line = { y: topY, items: [] };
          lines.push(line);
        }
        line.items.push(it);
      }
      // Sort
      lines.sort((a, b) => a.y - b.y);
      for (const ln of lines) ln.items.sort((a, b) => a.x - b.x);
      
      // Merge characters into words with proper spacing
      const processedLines: Line[] = [];
      for (const ln of lines) {
        const mergedItems: TextItem[] = [];
        let currentWord: TextItem | null = null;
        
        for (let i = 0; i < ln.items.length; i++) {
          const item = ln.items[i];
          const nextItem = ln.items[i + 1];
          
          if (!currentWord) {
            currentWord = { ...item };
          } else {
            // Check if there's a gap suggesting a space between characters
            const gap = item.x - (currentWord.x + currentWord.width);
            const spaceThreshold = currentWord.fontSize * 0.25; // 25% of font size
            
            if (gap > spaceThreshold) {
              // Add space before this character
              currentWord.text += " " + item.text;
              currentWord.width = (item.x + item.width) - currentWord.x;
            } else {
              // Merge without space
              currentWord.text += item.text;
              currentWord.width = (item.x + item.width) - currentWord.x;
            }
          }
          
          // If this is the last item or next item starts a new word group, push current word
          if (!nextItem || (nextItem.x - (item.x + item.width)) > item.fontSize * 0.25) {
            if (currentWord) {
              mergedItems.push(currentWord);
              currentWord = null;
            }
          }
        }
        
        if (mergedItems.length > 0) {
          processedLines.push({ y: ln.y, items: mergedItems });
        }
      }

      // Group consecutive lines into paragraphs based on fontSize and color
      const alignTol = 10; // px tolerance for left-edge alignment
      const gapTol = 18; // px tolerance between consecutive lines
      const fontSizeTol = 0.5; // tolerance for fontSize equality
      
      type ParagraphLine = {
        text: string;
        minX: number;
        maxX: number;
        y: number;
        height: number;
        fontSize: number;
        fontFamily: string;
        fontWeight: "normal" | "bold";
        lineHeight: number;
        fill: string;
      };
      
      const resultBlocks: ParsedBlock[] = [];
      let currentParagraph: ParagraphLine[] = [];
      
      for (const ln of processedLines) {
        const minX = Math.min(...ln.items.map((it) => it.x));
        const maxX = Math.max(...ln.items.map((it) => it.x + it.width));
        const text = ln.items.map((it) => it.text).join(" ");
        const height = Math.max(...ln.items.map((it) => it.height));
        const fontSize = Math.max(...ln.items.map((it) => it.fontSize));
        const fontFamily = ln.items[0]?.fontFamily ?? "Helvetica";
        const fontWeight = ln.items[0]?.fontWeight ?? "normal";
        const lineHeight = ln.items[0]?.lineHeight ?? 1.2;
        const fill = ln.items[0]?.fill ?? COLOR_FALLBACK;
        
        const currentLine: ParagraphLine = { 
          text, minX, maxX, y: ln.y, height, fontSize, fontFamily, fontWeight, lineHeight, fill 
        };
        
        if (currentParagraph.length === 0) {
          // Start new paragraph
          currentParagraph.push(currentLine);
        } else {
          const prev = currentParagraph[currentParagraph.length - 1];

          // Determine alignment tolerance based on font size to allow slight indentation differences
          const maxFontSize = Math.max(prev.fontSize, fontSize);
          const alignThreshold = Math.max(alignTol, maxFontSize * 1.5);
          const alignDiff = Math.abs(prev.minX - minX);
          const aligned = alignDiff <= alignThreshold;

          const gap = currentLine.y - prev.y;
          const sameFontSize = Math.abs(prev.fontSize - fontSize) <= fontSizeTol;
          const sameColor = prev.fill === fill;
          const hardBreak = prev.text.trim().endsWith(".");
          const gapThreshold = Math.max(prev.height, currentLine.height, maxFontSize) + gapTol;
          const closeEnough = gap <= gapThreshold;

          // Only merge if BOTH fontSize AND color match (and other conditions)
          if (aligned && sameFontSize && sameColor && !hardBreak && closeEnough) {
            // Continue current paragraph
            currentParagraph.push(currentLine);
          } else {
            // Flush current paragraph and start new one
            const paragraphText = currentParagraph.map((l) => l.text).join("\n");
            const paragraphMinX = Math.min(...currentParagraph.map((l) => l.minX));
            const paragraphMaxX = Math.max(...currentParagraph.map((l) => l.maxX));
            const paragraphMinY = Math.min(...currentParagraph.map((l) => l.y));
            const paragraphHeight =
              Math.max(...currentParagraph.map((l) => l.y + l.height)) - paragraphMinY;

            resultBlocks.push({
              text: paragraphText,
              x: paragraphMinX,
              y: paragraphMinY,
              width: paragraphMaxX - paragraphMinX,
              height: paragraphHeight,
              fontSize: currentParagraph[0].fontSize,
              fontFamily: currentParagraph[0].fontFamily,
              fontWeight: currentParagraph[0].fontWeight,
              lineHeight: currentParagraph[0].lineHeight,
              fill: currentParagraph[0].fill,
            });

            // Start new paragraph with current line
            currentParagraph = [currentLine];
          }
        }
      }
      
      // Flush last paragraph
      if (currentParagraph.length > 0) {
        const paragraphText = currentParagraph.map(l => l.text).join("\n");
        const paragraphMinX = Math.min(...currentParagraph.map(l => l.minX));
        const paragraphMaxX = Math.max(...currentParagraph.map(l => l.maxX));
        const paragraphMinY = Math.min(...currentParagraph.map(l => l.y));
        const paragraphHeight =
          Math.max(...currentParagraph.map((l) => l.y + l.height)) - paragraphMinY;
        
        resultBlocks.push({
          text: paragraphText,
          x: paragraphMinX,
          y: paragraphMinY,
          width: paragraphMaxX - paragraphMinX,
          height: paragraphHeight,
          fontSize: currentParagraph[0].fontSize,
          fontFamily: currentParagraph[0].fontFamily,
          fontWeight: currentParagraph[0].fontWeight,
          lineHeight: currentParagraph[0].lineHeight,
          fill: currentParagraph[0].fill,
        });
      }

      pages.push({ pageNumber: i + 1, width: pageWidth, height: pageHeight, blocks: resultBlocks });
    }

    return NextResponse.json({ pages });
  } catch (err: any) {
    console.error("/api/parse error", err);
    return NextResponse.json({ error: err?.message ?? "Parse failed" }, { status: 500 });
  }
}
