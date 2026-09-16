import { Skeleton } from '../ui/Skeleton';

export function HomePageHeroSkeleton() {
  return (
    <div className="relative aspect-16/6 min-h-52 overflow-hidden rounded-4xl border border-border bg-surface shadow-premium sm:aspect-16/5 sm:min-h-64 lg:min-h-0">
      <div className="absolute inset-0 bg-linear-to-br from-(--surface-soft) to-(--surface)" />
      <div className="relative z-10 flex h-full items-end p-4 sm:p-8 lg:p-12">
        <div className="w-full max-w-2xl space-y-2 sm:space-y-4"><Skeleton className="h-3 w-24 sm:h-4 sm:w-32" /><Skeleton className="h-8 w-full max-w-xl sm:h-12" /><Skeleton className="h-4 w-full max-w-lg sm:h-6" /></div>
      </div>
    </div>
  );
}