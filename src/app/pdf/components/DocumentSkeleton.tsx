import { PAGE_SKELETON_COUNT } from "../rendering";

export function DocumentSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: PAGE_SKELETON_COUNT }).map((_, index) => (
        <div
          key={`skeleton-${index}`}
          className="h-[380px] w-full overflow-hidden rounded-xl border border-slate-800/60 bg-slate-900/40"
        >
          <div className="h-full w-full animate-pulse bg-linear-to-r from-slate-900 via-slate-800/60 to-slate-900" />
        </div>
      ))}
    </div>
  );
}
