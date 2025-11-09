export const PAGE_SKELETON_COUNT = 3;
export const THUMBNAIL_TARGET_WIDTH = 160;

export const isRenderingCancelled = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;
  const maybeError = error as { name?: string };
  return maybeError.name === "RenderingCancelledException";
};
