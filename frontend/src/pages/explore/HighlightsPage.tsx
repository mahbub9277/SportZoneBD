import { useCallback, useMemo, useState } from 'react'
import { ArrowRight, Eye, PlayCircle, X } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { Skeleton } from '../../components/ui/Skeleton'
import { Card } from '../../components/ui/Card'
import { PageHero } from '../../components/shared/PageHero'
import { CustomVideoPlayer } from '../../components/player/CustomVideoPlayer'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { useGetHighlightsQuery, useIncrementHighlightViewMutation } from '../../features/highlights/highlights.api'
import { claimHighlightView } from '../../features/highlights/highlightViews'
import type { Highlight } from '../../features/highlights/highlights.types'
import { useAppSelector } from '../../app/hooks'
import { selectIsAuthenticated } from '../../features/auth/authSlice'

const resolvePosterUrl = (thumbnail?: string | null, thumbnailUrl?: string | null) => {
  const source = thumbnail ?? thumbnailUrl
  if (!source) return undefined

  return buildCloudinaryUrl(source, {
    width: 1280,
    height: 720,
    crop: 'fill',
    quality: 'auto',
    format: 'auto',
  })
}

const formatViewCount = (count: number): string => `${count.toLocaleString()} ${count === 1 ? 'view' : 'views'}`

export function HighlightsPage() {
  const shouldReduceMotion = useReducedMotion()
  const { data, isLoading, isError } = useGetHighlightsQuery({ page: 1, limit: 50 })
  const highlights = data?.items ?? []
  const [selectedHighlight, setSelectedHighlight] = useState<(typeof highlights)[number] | null>(null)

  const selectedPoster = useMemo(
    () => resolvePosterUrl(selectedHighlight?.thumbnail, selectedHighlight?.thumbnailUrl),
    [selectedHighlight],
  )

  const [incrementHighlightView] = useIncrementHighlightViewMutation()
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({})
  const isAuthenticated = useAppSelector(selectIsAuthenticated)

  // One intentional open = one view, no matter how many times React re-renders or remounts the card.
  const openHighlight = useCallback((highlight: Highlight) => {
    setSelectedHighlight(highlight)

    // Guests watch public highlights without being counted. The view endpoint is authenticated-only,
    // so asking for a count anonymously would only produce an authentication error toast.
    if (!isAuthenticated) return
    if (!claimHighlightView(highlight.id)) return

    const previousCount = highlight.viewCount ?? 0
    setViewCounts((counts) => ({ ...counts, [highlight.id]: (counts[highlight.id] ?? previousCount) + 1 }))

    void incrementHighlightView(highlight.id)
      .unwrap()
      .then((result) => setViewCounts((counts) => ({ ...counts, [highlight.id]: result.viewCount })))
      .catch(() => setViewCounts((counts) => ({ ...counts, [highlight.id]: previousCount })))
  }, [incrementHighlightView, isAuthenticated])

  return (
    <div className="app-page space-y-3">
      <PageHero
        title="Highlights"
        description="Catch the best moments from recent matches and stay on top of the action."
        eyebrow="Watch the best bits"
        icon={PlayCircle}
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : null}

      {isError ? (
        <Card className="border-(--danger)/30 bg-(--danger-soft) p-6 text-center text-(--danger)">
          We could not load the highlights right now.
        </Card>
      ) : null}

      {!isLoading && !isError ? (
        <>
          {selectedHighlight && selectedHighlight.url ? (
            <motion.section
              aria-labelledby="highlight-player-title"
              initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.26, ease: 'easeOut' }}
              className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_18px_50px_rgba(0,0,0,0.18)]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-soft/70 p-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                    Now playing
                  </p>
                  <h3 id="highlight-player-title" className="mt-1 truncate text-base font-semibold text-text-primary sm:text-lg">
                    {selectedHighlight.title}
                  </h3>
                </div>

                <button type="button" onClick={() => setSelectedHighlight(null)} aria-label="Close highlight player" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-surface text-text-muted transition-colors hover:border-accent/50 hover:text-text-primary">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="bg-black">
                <div className="aspect-video w-full" aria-label={`${selectedHighlight.title} video`}>
                  <CustomVideoPlayer url={selectedHighlight.url} title={selectedHighlight.title} poster={selectedPoster} autoPlay />
                </div>
              </div>
            </motion.section>
          ) : null}

          <motion.div
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: shouldReduceMotion ? 0 : 0.06 } } }}
          >
            {highlights.map((highlight) => {
              const thumbnailUrl = highlight.thumbnail ?? highlight.thumbnailUrl
              const hasVideoUrl = Boolean(highlight.url)
              const cardPoster = resolvePosterUrl(thumbnailUrl)

              return (
                <motion.div
                  key={highlight.id}
                  initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.24, ease: 'easeOut' }}
                >
                  <Card className="overflow-hidden border border-white/10 bg-surface-soft/70 p-0 shadow-[0_18px_42px_rgba(0,0,0,0.22)] transition-all duration-200 hover:border-white/15 hover:bg-surface-soft/90">
                    <button
                      type="button"
                      onClick={() => {
                        if (hasVideoUrl) {
                          openHighlight(highlight)
                        }
                      }}
                      className={`group block w-full text-left transition-all duration-200 ${hasVideoUrl ? 'cursor-pointer hover:-translate-y-0.5' : 'cursor-default'}`}
                      aria-label={hasVideoUrl ? `Watch ${highlight.title}` : `${highlight.title} highlight`}
                      disabled={!hasVideoUrl}
                    >
                      <div className="relative h-44 overflow-hidden bg-surface-soft">
                        {cardPoster ? (
                          <img
                            src={cardPoster}
                            alt={highlight.title}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center bg-linear-to-br from-surface-soft via-surface to-surface-muted text-sm font-semibold uppercase tracking-[0.18em] text-text-muted">
                            Highlight
                          </div>
                        )}

                        <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/10 to-transparent" />

                        <div className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/85 backdrop-blur-sm">
                          <PlayCircle className="h-3.5 w-3.5" />
                          {hasVideoUrl ? 'Watch' : 'Unavailable'}
                        </div>

                        <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/85 backdrop-blur-sm">
                          <Eye className="h-3.5 w-3.5" />
                          {formatViewCount(viewCounts[highlight.id] ?? highlight.viewCount ?? 0)}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-text-primary">{highlight.title}</p>
                          <p className="mt-1 truncate text-sm text-text-muted">
                            {highlight.category || highlight.duration
                              ? `${highlight.category || 'General'} • ${highlight.duration || 'N/A'}`
                              : 'General highlight'}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 text-accent">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em]">
                            {hasVideoUrl ? 'Open' : 'Preview'}
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0" />
                        </div>
                      </div>
                    </button>
                  </Card>
                </motion.div>
              )
            })}
          </motion.div>
        </>
      ) : null}
    </div>
  )
}
