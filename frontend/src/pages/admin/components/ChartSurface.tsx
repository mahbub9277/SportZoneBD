import { AlertTriangle, BarChart3 } from 'lucide-react'
import { Skeleton } from '../../../components/ui/Skeleton'
import { CHART_HEIGHT, type ChartState } from './chartStyles'

interface ChartSurfaceProps {
  state: ChartState
  /** Height of the plot area; the loading, empty and error states keep the same box so nothing shifts. */
  height?: number
  emptyMessage?: string
  errorMessage?: string
  onRetry?: () => void
  children: React.ReactNode
}

/**
 * Renders one chart with states that all occupy the same box: a skeleton while the data loads, and a
 * plain message when the request failed or came back with nothing to draw. An empty chart otherwise
 * looks like a broken chart, which is exactly what an operator cannot tell apart at a glance.
 */
export function ChartSurface({
  state,
  height = CHART_HEIGHT,
  emptyMessage = 'No data for this period yet.',
  errorMessage = 'This chart could not be loaded.',
  onRetry,
  children,
}: ChartSurfaceProps) {
  if (state === 'ready') return <>{children}</>

  if (state === 'loading') {
    return <Skeleton className="w-full" style={{ height }} />
  }

  return (
    <div
      className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-(--border) bg-(--surface-soft)/40 px-4 text-center"
      style={{ height }}
      role={state === 'error' ? 'alert' : 'status'}
    >
      {state === 'error'
        ? <AlertTriangle className="h-6 w-6 text-(--text-muted)" aria-hidden="true" />
        : <BarChart3 className="h-6 w-6 text-(--text-muted)" aria-hidden="true" />}
      <p className="max-w-sm text-sm text-(--text-muted)">{state === 'error' ? errorMessage : emptyMessage}</p>
      {state === 'error' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-(--border) px-3 py-1.5 text-xs font-semibold text-(--text-primary) transition-colors hover:border-(--accent)/50 hover:text-(--accent) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
        >
          Try again
        </button>
      )}
    </div>
  )
}
