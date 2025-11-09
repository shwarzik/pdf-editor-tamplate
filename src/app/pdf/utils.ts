let pdfjsLibPromise: Promise<typeof import("pdfjs-dist")> | null = null;

export const getPdfjs = async () => {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist").then((module) => {
      // Configure the worker once in the browser to avoid touching DOM APIs on the server.
      if (typeof window !== "undefined" && "Worker" in window) {
        const workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        );
        module.GlobalWorkerOptions.workerSrc = workerSrc.toString();
      }
      return module;
    });
  }

  return pdfjsLibPromise;
};
