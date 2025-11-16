export interface OverlayBounds {
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  heightRatio: number;
  captureRotation: number;
}

export interface TextOverlayExport {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  fontWeight: "normal" | "bold";
  fill: string;
  opacity: number;
  originalBounds?: OverlayBounds;
}

export interface PageExportPayload {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  overlays: TextOverlayExport[];
}

export interface SavePayload {
  fileName?: string | null;
  pages: PageExportPayload[];
}
