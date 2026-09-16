import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
import { useGetWatchChannelDataQuery, useGetChannelReactionsQuery, useToggleChannelReactionMutation } from '../../features/admin/channels.api'
import { SubscriptionModal } from '../../components/shared/SubscriptionModal'
import { Skeleton } from '../../components/ui/Skeleton'
import { AlertCircle, Tv, Film, ArrowLeft, ThumbsUp, ThumbsDown, Share2 } from 'lucide-react'
import { Heart } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/Tabs'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { selectFavoriteChannelIds, toggleFavoriteChannel } from '../../features/favorites/favorites.slice'
import { addRecentChannel } from '../../features/recent/recent.slice' //
import { selectIsAuthenticated, selectIsPremiumSubscriber } from '../../features/auth/authSlice'
import { cn } from '../../lib/utils'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useViewerCount } from '../../hooks/useViewerCount'
import { Input } from '../../components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/Select'
import { Switch } from '../../components/ui/Switch'
import { Label } from '../../components/ui/Label'
import { useGetPublicChannelsQuery } from '../../features/admin/channels.api'
import { useGetAdUnlockQuery, useGetInterstitialAdvertisementQuery } from '../../features/admin/advertisements.api'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from '../../components/ui/Pagination'
import { Channel, ChannelCategory } from '@/shared/types';
import { motion, AnimatePresence } from 'framer-motion'
import { useMiniPlayer } from '../../hooks/common/layouts/UserLayout'
import { BackToTopButton } from '../../components/shared/BackToTopButton'
import { useAdvertisementGate } from '../../hooks/useAdvertisementGate'
import { toast } from 'sonner'

const formatViewerCount = (count: number) => {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`
  }
  return count.toString()
}

export function WatchChannelPage() {
  const { channelId = '' } = useParams<{ channelId: string }>()
  const { data: watchData, isLoading, isError } = useGetWatchChannelDataQuery(channelId, {
    skip: !channelId,
    refetchOnMountOrArgChange: true,
  })
  const { data: reactions } = useGetChannelReactionsQuery(channelId, { skip: !channelId })
  const [toggleReaction] = useToggleChannelReactionMutation()
  const [optimisticReactions, setOptimisticReactions] = useState<ReactionSummary | null>(null)
  const reactionStateRef = useRef<ReactionSummary | null>(null)
  const serverReactionRef = useRef<ReactionSummary | null>(null)
  const desiredReactionRef = useRef<ReactionType | null>(null)
  const reactionTimerRef = useRef<number | null>(null)
  const reactionRequestActiveRef = useRef(false)
  const viewerId = null
  const { setActivePlayer } = useMiniPlayer()

  const navigate = useNavigate()
  const channel = watchData?.channel
  const relatedChannels = watchData?.relatedChannels ?? []

  const favoriteChannelIds = useAppSelector(selectFavoriteChannelIds)
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const isPremiumSubscriber = useAppSelector(selectIsPremiumSubscriber)
  const openChannel = useAdvertisementGate('CHANNEL')
  const [openSubscriptionModal, setOpenSubscriptionModal] = useState(false)
  const [playbackAllowedChannelId, setPlaybackAllowedChannelId] = useState<string | null>(null)
  const [gateRequested, setGateRequested] = useState(false)
  const dispatch = useAppDispatch()
  const location = useLocation()
  const isPlaybackAllowed = playbackAllowedChannelId === channelId
  const handleShare = async () => {
    const url = `${window.location.origin}/watch/${channelId}`
    try {
      if (navigator.share) await navigator.share({ title: channel?.name ?? 'SportZoneBD channel', url })
      else { await navigator.clipboard.writeText(url); toast.success('Channel link copied.') }
    } catch { toast.info('Share cancelled.') }
  }

  useEffect(() => {
    if (!reactions) return
    const next = { likeCount: reactions.likeCount, dislikeCount: reactions.dislikeCount, userReaction: reactions.userReaction }
    if (reactionRequestActiveRef.current || reactionTimerRef.current !== null) return
    serverReactionRef.current = next
    reactionStateRef.current = next
    desiredReactionRef.current = next.userReaction
    setOptimisticReactions(next)
  }, [reactions])

  useEffect(() => {
    if (reactionTimerRef.current !== null) window.clearTimeout(reactionTimerRef.current)
    reactionTimerRef.current = null
    reactionRequestActiveRef.current = false
    reactionStateRef.current = null
    serverReactionRef.current = null
    desiredReactionRef.current = null
    setOptimisticReactions(null)
  }, [channelId])

  useEffect(() => () => {
    if (reactionTimerRef.current !== null) window.clearTimeout(reactionTimerRef.current)
  }, [])

  const flushReaction = async () => {
    if (reactionRequestActiveRef.current) return
    const serverState = serverReactionRef.current
    const desiredReaction = desiredReactionRef.current
    if (!serverState || desiredReaction === serverState.userReaction) return

    const requestType = desiredReaction ?? serverState.userReaction
    if (!requestType) return

    reactionRequestActiveRef.current = true
    try {
      const result = await toggleReaction({ id: channelId, type: requestType }).unwrap()
      const confirmed = { likeCount: result.likeCount, dislikeCount: result.dislikeCount, userReaction: result.userReaction }
      serverReactionRef.current = confirmed
      reactionStateRef.current = confirmed
      setOptimisticReactions(confirmed)
    } catch {
      const rollback = serverReactionRef.current
      if (rollback) {
        reactionStateRef.current = rollback
        desiredReactionRef.current = rollback.userReaction
        setOptimisticReactions(rollback)
      }
      toast.error('Could not update your reaction. Please try again.')
    } finally {
      reactionRequestActiveRef.current = false
      if (desiredReactionRef.current !== serverReactionRef.current?.userReaction) {
        reactionTimerRef.current = window.setTimeout(() => {
          reactionTimerRef.current = null
          void flushReaction()
        }, 400)
      }
    }
  }

  const handleReaction = (type: ReactionType) => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=${encodeURIComponent(`/watch/${channelId}`)}`)
      return
    }

    const current = reactionStateRef.current ?? optimisticReactions ?? serverReactionRef.current
    if (!current) return
    const nextReaction = current.userReaction === type ? null : type
    const next = {
      likeCount: Math.max(0, current.likeCount + (nextReaction === 'LIKE' ? 1 : current.userReaction === 'LIKE' ? -1 : 0)),
      dislikeCount: Math.max(0, current.dislikeCount + (nextReaction === 'DISLIKE' ? 1 : current.userReaction === 'DISLIKE' ? -1 : 0)),
      userReaction: nextReaction,
    }

    reactionStateRef.current = next
    desiredReactionRef.current = nextReaction
    setOptimisticReactions(next)
    if (reactionTimerRef.current !== null) window.clearTimeout(reactionTimerRef.current)
    reactionTimerRef.current = window.setTimeout(() => {
      reactionTimerRef.current = null
      void flushReaction()
    }, 400)
  }
  const [relatedPage, setRelatedPage] = useState(1)
  const relatedChannelsPerPage = 6

  const isChannelLocked = channel?.isPremium && !isPremiumSubscriber
  const { data: directAdvertisement, isFetching: isAdvertisementLoading } = useGetInterstitialAdvertisementQuery('CHANNEL', { skip: isPremiumSubscriber || Boolean(channel?.isPremium) })
  const { data: directUnlock, isFetching: isUnlockLoading } = useGetAdUnlockQuery(undefined, { skip: isPremiumSubscriber || Boolean(channel?.isPremium) })

  useEffect(() => {
    setPlaybackAllowedChannelId(null)
    setGateRequested(false)
  }, [channelId])

  useEffect(() => {
    if (!channel || isChannelLocked || gateRequested || isAdvertisementLoading || isUnlockLoading) return
    setGateRequested(true)
    if (isPremiumSubscriber) {
      setPlaybackAllowedChannelId(channel.id)
      return
    }
    const hasUnlock = Boolean(directUnlock && new Date(directUnlock.expiresAt).getTime() > Date.now())
    if (hasUnlock || !directAdvertisement) {
      setPlaybackAllowedChannelId(channel.id)
      return
    }
    openChannel(`/watch/${channel.id}`, false, () => setPlaybackAllowedChannelId(channel.id))
  }, [channel, directAdvertisement, directUnlock, gateRequested, isAdvertisementLoading, isChannelLocked, isPremiumSubscriber, isUnlockLoading, openChannel])

  useEffect(() => {
    setActivePlayer(null)
  }, [channelId, setActivePlayer])

  useEffect(() => {
    if (!channel || channel.id !== channelId) return

    setActivePlayer(channel.url && !isChannelLocked && (isPremiumSubscriber || isPlaybackAllowed) ? {
      url: channel.url,
      title: channel.name,
      streamId: channel.id,
      channelId: channel.id,
      presenceType: 'channel',
      playbackRoute: `/watch/${channelId}`,
    } : null)
  }, [channel?.id, channel?.name, channel?.url, channelId, isChannelLocked, isPlaybackAllowed, isPremiumSubscriber, setActivePlayer])

  useEffect(() => {
    setRelatedPage(1)
  }, [channelId, relatedChannels.length])

  const relatedTotalPages = Math.max(1, Math.ceil(relatedChannels.length / relatedChannelsPerPage))
  const paginatedRelatedChannels = useMemo(() => {
    const start = (relatedPage - 1) * relatedChannelsPerPage
    return relatedChannels.slice(start, start + relatedChannelsPerPage)
  }, [relatedChannels, relatedPage])

  useEffect(() => {
    // When the channel data is successfully loaded, add it to the recent list.
    if (channel?.id) {
      dispatch(addRecentChannel(channel.id))
    }
  }, [channel?.id, dispatch])

  useEffect(() => {
    const actionData = sessionStorage.getItem('post-auth-action')
    if (!actionData) return

    try {
      const action = JSON.parse(actionData) as { action: string; redirect?: string }
      const currentPath = `${location.pathname}${location.search}`
      if (action.action === 'unlockPremium' && action.redirect === currentPath) {
        sessionStorage.removeItem('post-auth-action')
        if (!isChannelLocked) return
        setOpenSubscriptionModal(true)
      }
    } catch {
      // Ignore malformed post-auth actions
    }
  }, [isChannelLocked, location, navigate])

 

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="aspect-video w-full rounded-4xl" />
        <Skeleton className="h-24 w-full rounded-3xl" />
        <div className="space-y-4 pt-4">
          <Skeleton className="h-8 w-1/3" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-24 w-full rounded-3xl" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (isError || !channel) {
    return (
      <div className="flex h-[60vh] items-center justify-center rounded-4xl border border-dashed border-(--danger)/50 bg-(--danger-soft)">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-(--danger)" />
          <h2 className="mt-4 text-xl font-semibold text-(--danger)">Channel Not Found</h2>
          <p className="mt-2 text-(--danger)/80">This channel could not be loaded or may be inactive.</p>
          <Button variant="outline" onClick={() => navigate('/channels')} className="mt-6 gap-2">
            <ArrowLeft size={16} /> Go to Channels
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="app-page w-full min-w-0 space-y-3 px-3 pb-8 sm:px-5 lg:px-8">
      <div className="flex justify-start">
      </div>
      {isChannelLocked && (
        <Card className="app-page-section border-(--border) bg-black/80 p-4 text-center text-white sm:p-6">
          <Tv className="mx-auto h-14 w-14 text-(--accent) sm:h-16 sm:w-16" />
          <h2 className="mt-3 text-2xl font-semibold">Premium Channel</h2>
          <p className="mt-2 text-sm text-white/70">Upgrade to unlock live access.</p>
          <Button onClick={() => setOpenSubscriptionModal(true)} className="mt-4 w-full max-w-xs bg-(--accent) text-slate-950 hover:bg-(--accent-strong)">Unlock Premium Access</Button>
        </Card>
      )}
      <SubscriptionModal isOpen={openSubscriptionModal} onClose={() => setOpenSubscriptionModal(false)} />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <Card className="mb-3 border-(--border) bg-(--surface)/70 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant={optimisticReactions?.userReaction === 'LIKE' ? 'default' : 'outline'} size="sm" onClick={() => handleReaction('LIKE')} aria-label={isAuthenticated ? 'Like channel' : 'Sign in to like channel'}><ThumbsUp className="mr-1.5 h-4 w-4" />{optimisticReactions?.likeCount ?? reactions?.likeCount ?? 0}</Button>
          <Button type="button" variant={optimisticReactions?.userReaction === 'DISLIKE' ? 'default' : 'outline'} size="sm" onClick={() => handleReaction('DISLIKE')} aria-label={isAuthenticated ? 'Dislike channel' : 'Sign in to dislike channel'}><ThumbsDown className="mr-1.5 h-4 w-4" />{optimisticReactions?.dislikeCount ?? reactions?.dislikeCount ?? 0}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleShare()} aria-label="Share channel"><Share2 className="mr-1.5 h-4 w-4" />Share</Button>
        </div>
      </Card>
      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-center gap-4">
            <motion.div
              className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border border-accent/30 bg-surface-soft p-2 shadow-[0_12px_30px_rgba(2,6,23,0.18)] sm:h-24 sm:w-24"
              whileHover={{ scale: 1.06, rotate: 2 }}
            >
              <img
                src={buildCloudinaryUrl(channel.logo, { width: 120, height: 120, crop: 'fill' })}
                alt={`${channel.name} logo`}
                className="h-full w-full rounded-xl object-contain"
              />
            </motion.div>
            <div className="min-w-0 space-y-2">
              <h1 className="wrap-break-word text-2xl font-bold text-text-primary">{channel.name}</h1>
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <motion.span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" animate={{ scale: [1, 1.25, 1] }} transition={{ repeat: Infinity, duration: 1.8 }} />
                <span>Live channel</span>
              </div>
              <ViewerCountDisplay channelId={channel.id} initial={watchData?.liveViewers ?? 0} />
            </div>
          </div>
        <button
          onClick={() => dispatch(toggleFavoriteChannel(channel.id))} 
          className="shrink-0 self-end text-text-muted transition-colors hover:text-accent sm:self-auto"
          aria-label={favoriteChannelIds.includes(channel.id) ? `Remove ${channel.name} from favorites` : `Add ${channel.name} to favorites`}
        > 
          <Heart
            size={24}
            className={cn('transition-colors', favoriteChannelIds.includes(channel.id) ? 'fill-current text-(--danger)' : 'text-text-muted')}
          />
        </button>
      </Card>
      </motion.div>

      {relatedChannels.length > 0 && (
        <div>
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-text-primary">
            <motion.span whileHover={{ scale: 1.15, rotate: 5 }}><Film size={20} className="text-accent" /></motion.span>
            Related Channels
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {paginatedRelatedChannels.map((relatedChannel: Channel, index: number) => (
              <Link to={`/watch/${relatedChannel.id}`} key={relatedChannel.id || index}>
                <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
                <Card className="flex h-full flex-col items-center justify-center p-4 text-center transition-all hover:border-accent/50">
                  <img
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                    src={buildCloudinaryUrl(relatedChannel.logo, { width: 64, height: 64, crop: 'fill' })}
                    alt={relatedChannel.name}
                    className="mb-2 h-16 w-16 rounded-full border border-border bg-surface-soft object-contain p-1"
                  />
                  <p className="text-sm font-medium">{relatedChannel.name}</p>
                </Card>
                </motion.div>
              </Link>
            ))}
          </div>

          {relatedTotalPages > 1 && (
            <div className="mt-6 max-w-full overflow-x-auto">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setRelatedPage((page) => Math.max(page - 1, 1))}
                      disabled={relatedPage === 1}
                      aria-label="Previous related channels page"
                    />
                  </PaginationItem>

                  {Array.from({ length: relatedTotalPages }, (_, index) => index + 1).map((page) => (
                    <PaginationItem key={page}>
                      <PaginationLink
                        onClick={() => setRelatedPage(page)}
                        isActive={page === relatedPage}
                        aria-label={`Go to related channels page ${page}`}
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}

                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setRelatedPage((page) => Math.min(page + 1, relatedTotalPages))}
                      disabled={relatedPage === relatedTotalPages}
                      aria-label="Next related channels page"
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </div>
      )}

      {/* All / Category view for channels */}
      <div className="mt-8">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-text-primary">All Channels</h2>

        <ChannelsBrowser />
      </div>
      </div>
      <BackToTopButton scrollThreshold={400} />
    </>
  )
}

function ChannelsBrowser() {
  const { data: categoriesResp, isLoading, isError } = useGetPublicChannelsQuery()
  const categories = categoriesResp ?? []

  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [query, setQuery] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | 'all'>('all')
  const [premiumOnly, setPremiumOnly] = useState(false)
  const [allChannelsPage, setAllChannelsPage] = useState(1)
  const channelsPerPage = 12

  const allChannels = useMemo(() => categories.flatMap((c: ChannelCategory) => c.channels ?? []), [categories])

  const processedCategories = useMemo(() => {
    const q = query.trim().toLowerCase()

    const filterAndSortChannels = (channels: Channel[] | undefined) => {
      let list = channels ?? []
      if (premiumOnly) {
        list = list.filter((ch) => ch.isPremium)
      }
      if (q) {
        list = list.filter((ch) => (ch.name ?? '').toLowerCase().includes(q))
      }
      return [...list].sort((a, b) => { // Create a shallow copy before sorting to avoid mutating original array
        const na = (a.name ?? '').toLowerCase()
        const nb = (b.name ?? '').toLowerCase()
        if (na < nb) return sortOrder === 'asc' ? -1 : 1
        if (na > nb) return sortOrder === 'asc' ? 1 : -1
        return 0
      })
    }

    const sourceCategories = selectedCategoryId === 'all' ? categories : categories.filter((c: any) => c.id === selectedCategoryId)

    return sourceCategories
      .map((category: any) => ({ ...category, channels: filterAndSortChannels(category.channels) }))
      .filter((category: any) => category.channels.length > 0)
  }, [categories, query, selectedCategoryId, premiumOnly, sortOrder])

  useEffect(() => {
    setAllChannelsPage(1)
  }, [query, selectedCategoryId, premiumOnly, sortOrder])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/4 mb-4" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return <div className="text-center text-red-500">Failed to load channels.</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-3 sm:w-2/3 sm:flex-row">
          <Input className="min-w-0 flex-1" placeholder="Search channels..." value={query} onChange={(e) => setQuery(e.target.value)} />

          <Select onValueChange={(val) => setSelectedCategoryId(val as string)} value={selectedCategoryId}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue>{selectedCategoryId === 'all' ? 'All Categories' : categories.find((c: any) => c.id === selectedCategoryId)?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto sm:justify-end">
          <div className="flex min-w-0 items-center gap-2">
            <Switch id="browser-premium-only" checked={premiumOnly} onCheckedChange={(v) => setPremiumOnly(Boolean(v))} />
            <Label htmlFor="browser-premium-only" className="text-sm text-text-muted cursor-pointer">Premium only</Label>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}>{sortOrder === 'asc' ? 'A → Z' : 'Z → A'}</Button>
        </div>
      </div>

      <Tabs defaultValue="byCategory">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="byCategory">By Category</TabsTrigger>
          <TabsTrigger value="all">All (A–Z)</TabsTrigger>
        </TabsList>

        <TabsContent value="byCategory" className="pt-4">
          {processedCategories.map((category: any) => (
            <div key={category.id} className="mb-6">
              <h3 className="text-lg font-semibold mb-3">{category.name}</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {category.channels.map((channel: Channel) => (
                  <Card key={channel.id} className="flex flex-col items-center justify-center p-4 text-center h-full relative group">
                    <Link to={`/watch/${channel.id}`} className="flex flex-col items-center justify-center h-full w-full">
                      <img loading="lazy" decoding="async" fetchPriority="low" src={buildCloudinaryUrl(channel.logo, { width: 64, height: 64, crop: 'fill' })} alt={channel.name} className="h-16 w-16 rounded-full object-contain bg-gray-700 p-1 mb-2" />
                      <p className="text-sm font-medium">{channel.name}</p>
                    </Link>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="all" className="pt-4">
          {(() => {
            const allFilteredChannels = processedCategories.flatMap((c: any) => c.channels)
            const totalPages = Math.max(1, Math.ceil(allFilteredChannels.length / channelsPerPage))
            const paginatedChannels = allFilteredChannels.slice((allChannelsPage - 1) * channelsPerPage, allChannelsPage * channelsPerPage)
            return (
              <>
          <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-text-muted">{allFilteredChannels.length} channels</p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {paginatedChannels.map((channel) => (
              <Card key={channel.id} className="flex flex-col items-center justify-center p-4 text-center h-full relative group">
                <Link to={`/watch/${channel.id}`} className="flex flex-col items-center justify-center h-full w-full"> 
                  <img loading="lazy" decoding="async" fetchPriority="low" src={buildCloudinaryUrl(channel.logo, { width: 64, height: 64, crop: 'fill' })} alt={channel.name} className="h-16 w-16 rounded-full object-contain bg-gray-700 p-1 mb-2" />
                  <p className="text-sm font-medium">{channel.name}</p>
                </Link>
              </Card>
            ))}
          </div>

                {totalPages > 1 && (
            <div className="mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationLink
                      onClick={() => setAllChannelsPage((page) => Math.max(page - 1, 1))}
                          disabled={allChannelsPage === 1}
                      aria-label="Previous channels page"
                    >
                      <PaginationPrevious />
                    </PaginationLink>
                  </PaginationItem>

                      {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                    <PaginationItem key={page}>
                      <PaginationLink
                        onClick={() => setAllChannelsPage(page)}
                        isActive={page === allChannelsPage}
                        aria-label={`Go to channels page ${page}`}
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}

                  <PaginationItem>
                    <PaginationLink
                          onClick={() => setAllChannelsPage((page) => Math.min(page + 1, totalPages))}
                          disabled={allChannelsPage === totalPages}
                      aria-label="Next channels page"
                    >
                      <PaginationNext />
                    </PaginationLink>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
                )}
              </>
            )
          })()}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ViewerCountDisplay({ channelId, initial }: { channelId: string; initial?: number }) {
  const count = useViewerCount(channelId, initial)
  const formattedCount = formatViewerCount(Math.max(0, count ?? 0))

  return (
    <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-[0.2em] text-emerald-300/90">
      <span>Live •</span>
      <AnimatePresence mode="wait">
        <motion.span
          key={formattedCount}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2 }}
        >
          {formattedCount}
        </motion.span>
      </AnimatePresence>
      <span>watching</span>
    </p>
  )
}

type ReactionType = 'LIKE' | 'DISLIKE'
type ReactionSummary = { likeCount: number; dislikeCount: number; userReaction: ReactionType | null }