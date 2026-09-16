import React, { useState } from 'react'
import { useGetHighlightsQuery } from '../highlights.api'
import type { Highlight } from '../highlights.types'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Skeleton } from '../../../components/ui/Skeleton'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'

interface HighlightsListProps {
  // If you provide a matchId, the component will fetch highlights for that specific match.
  // Otherwise, it will fetch all highlights.
  matchId?: string
}

const getHighlightImageUrl = (highlight: Highlight): string => {
  const imageUrl = highlight.thumbnail || highlight.thumbnailUrl
  return buildCloudinaryUrl(imageUrl, {
    width: 640,
    height: 360,
    crop: 'fill',
    quality: 'auto',
    format: 'auto',
  })
}

/**
 * A simple card component to display a single highlight.
 */
const HighlightCard: React.FC<{ highlight: Highlight }> = ({ highlight }) => {
  const imageUrl = getHighlightImageUrl(highlight)

  return (
    <Card className="m-0 flex min-w-0 flex-col gap-3 border-border/60 bg-surface-soft/70 p-4 sm:p-5">
      <h4 className="truncate text-base font-semibold text-text-primary">{highlight.title}</h4>
      <p className="text-sm text-text-muted">Duration: {highlight.duration || 'N/A'}</p>
      {imageUrl && imageUrl !== '/placeholder-image.svg' ? (
        <img src={imageUrl} alt={highlight.title} className="aspect-video w-full rounded-2xl object-cover" />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-2xl border border-dashed border-border bg-surface-muted text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">
          Highlight
        </div>
      )}
      <a href={highlight.url} target="_blank" rel="noopener noreferrer" className="mt-auto inline-flex w-fit text-sm font-semibold text-accent hover:underline">
        Watch Highlight
      </a>
    </Card>
  )
}

/**
 * A component that fetches and displays a list of highlights using the useGetHighlightsQuery hook.
 */
export const HighlightsList: React.FC<HighlightsListProps> = ({ matchId }) => {
  const [page, setPage] = useState(1)
  const limit = 10

  // 1. Call the hook with parameters for pagination and optional filtering.
  const { data, error, isLoading, isFetching } = useGetHighlightsQuery({
    page,
    limit,
    matchId,
  })

  // 2. Handle the loading state.
  if (isLoading) {
    return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-40 w-full rounded-3xl" />)}</div>
  }

  // 3. Handle the error state.
  if (error) {
    const errorMessage = 'data' in error ? JSON.stringify(error.data) : 'An unknown error occurred'
    return <div className="rounded-2xl border border-(--danger)/30 bg-(--danger-soft) p-4 text-sm text-(--danger)">Error fetching highlights: {errorMessage}</div>
  }

  // 4. Handle the success state.
  if (!data || data.items.length === 0) {
    return <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-text-muted">No highlights found.</div>
  }

  const { items, meta } = data

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl font-semibold text-text-primary">{matchId ? 'Highlights for Match' : 'All Highlights'}</h3>
        {isFetching && <p className="text-sm text-text-muted">Updating...</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((highlight) => (
          <HighlightCard key={highlight.id} highlight={highlight} />
        ))}
      </div>

      {/* 5. Add pagination controls */}
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || isFetching}>
          Previous
        </Button>
        <span className="text-sm text-text-muted">
          Page {meta.currentPage} of {meta.totalPages}
        </span>
        <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page === meta.totalPages || isFetching}>
          Next
        </Button>
      </div>
    </div>
  )
}