## PDF Fabric Editor (Stage 1)

Stage 1 delivers a browser-based PDF viewer built with Next.js 14, pdf.js, Fabric.js, Zustand, and lucide-react icons. It now renders every page of a PDF into individual Fabric canvases with an elevated toolbar that supports upload and percentage-based zoom, plus a sidebar minimap that handles per-page rotation controls.

## Features

- Upload any local PDF via the file input (handled client-side with `URL.createObjectURL`).
- Render each page into its own Fabric-managed `<canvas>` using pdf.js.
- Zoom between 50% and 300% in 10% steps (with a single-click reset to 100%).
- Rotate each page clockwise in 90° steps from the minimap sidebar, with Fabric automatically redrawing the background image layer.
- Shared viewer state managed through a lightweight Zustand store.

## Project Structure

- `src/app/page.tsx` – Client page that hosts the styled upload/toolbar surface and dynamic viewer.
- `src/app/pdf/PdfViewer.tsx` – Fabric-enabled canvas that re-renders on zoom/rotation, using offscreen rendering to create a Fabric image background.
- `src/app/pdf/utils.ts` – Lazy pdf.js loader with worker configuration scoped to the browser.
- `src/lib/store.ts` – Zustand store providing `scale` and `rotation` setters.
- `src/lib/store.ts` – Zustand store providing percentage-based `zoom` and `rotation` setters.
- `src/types/url.d.ts` – Module declaration for URL-style imports when needed.

## Getting Started

Install dependencies (already run during scaffolding):

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to upload and interact with a PDF.

## Usage Notes

- All pages render in sequence; pagination UI is deferred to a later stage.
- Zoom changes trigger a fresh pdf.js render followed by Fabric background updates. Page rotations are managed individually from the minimap.
- Uploaded object URLs are automatically revoked as soon as you choose a different file or navigate away.
- pdf.js workers are configured lazily in the browser (`import.meta.url`), keeping SSR bundles free of DOM-specific globals.

## Available Scripts

- `npm run dev` – Start the Next.js dev server (Turbopack).
- `npm run lint` – Run ESLint with the default Next.js configuration.

## Tech Stack

- [Next.js 14](https://nextjs.org/) with the App Router.
- [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) for PDF rendering.
- [Fabric.js](http://fabricjs.com/) for canvas interactivity.
- [Zustand](https://github.com/pmndrs/zustand) for viewer state management.
- [lucide-react](https://lucide.dev/) for toolbar iconography.
# pdf-editor-tamplate
