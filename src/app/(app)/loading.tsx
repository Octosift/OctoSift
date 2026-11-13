import { Skeleton } from '../components/ui/display';

/** Shown while a screen's data loads. */
export default function ScreenLoading() {
  return (
    <div className="flex flex-col gap-4 px-6 py-5" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-80" />
      <Skeleton className="h-40 w-full max-w-3xl" />
      <Skeleton className="h-40 w-full max-w-3xl" />
    </div>
  );
}
