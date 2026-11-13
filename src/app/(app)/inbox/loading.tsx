import { Skeleton } from '../../components/ui/display';

export default function InboxLoading() {
  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(320px,440px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2 border-r border-border p-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
      <div className="hidden flex-col gap-3 p-6 lg:flex">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
