import { cn } from '../../lib/utils'

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-(--surface-soft)',
        "after:absolute after:inset-0 after:animate-shimmer after:bg-linear-to-r after:from-transparent after:via-(--skeleton-shimmer) after:to-transparent motion-reduce:after:hidden",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }