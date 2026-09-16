import { Card, CardContent } from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'

export function MatchCardSkeleton() {
  return (
    <Card className="h-full w-full overflow-hidden rounded-2xl border border-(--border)/80 bg-(--surface)/95 p-0 shadow-[0_10px_28px_rgba(4,116,196,0.08)]">
      <div className="bg-(--surface-strong) px-3 pb-4 pt-4 sm:px-4">
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-(--border) pb-2.5">
          <Skeleton className="h-4 min-w-0 flex-1 rounded-md" />
          <Skeleton className="h-3 w-28 shrink-0 rounded-md" />
        </div>

        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <Skeleton className="h-16 w-16 shrink-0 rounded-2xl sm:h-18 sm:w-18" />
            <Skeleton className="h-4 min-w-0 flex-1 rounded-md" />
          </div>
          <Skeleton className="h-4 w-6 shrink-0 rounded-md" />
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
            <Skeleton className="h-4 min-w-0 flex-1 rounded-md" />
            <Skeleton className="h-16 w-16 shrink-0 rounded-2xl sm:h-18 sm:w-18" />
          </div>
        </div>
      </div>

      <CardContent className="space-y-2 p-2 sm:p-2.5">
        <Skeleton className="h-3 w-28 rounded-md" />
        <div className="flex items-center justify-between gap-2 border-t border-(--border) pt-2">
          <Skeleton className="h-3 w-32 rounded-md" />
          <Skeleton className="h-6 w-16 rounded-md" />
        </div>
      </CardContent>
    </Card>
  )
}