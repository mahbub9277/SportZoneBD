import { startTransition, useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { usePerformanceProfile } from '@/hooks/usePerformanceProfile'
import { useGetMatchByIdQuery } from '../../features/matches/matches.api'
import { findNextStreamCandidate, getPreferredStreamUrl, getStreamCandidateChain, getStreamUrlCandidates, isPlayableStream, type Match, type Stream } from '../../features/matches/matches.types'
import { useAppSelector } from '../../app/hooks'
import { CustomVideoPlayer } from '../../components/player/CustomVideoPlayer'
import { selectIsPremiumSubscriber } from '../../features/auth/authSlice'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/Skeleton'
import { SubscriptionModal } from '../../components/shared/SubscriptionModal'
import {
  AlertCircle,
  Tv,
  Server,
  Radio,
  Share2,
  Clock3,
} from 'lucide-react'
import { FaFacebookF, FaLink, FaTelegram, FaWhatsapp, FaXTwitter } from 'react-icons/fa6'
import type { IconType } from 'react-icons'
import { Popover, PopoverTrigger, PopoverContent } from '../../components/ui/Popover'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import { useGetAdUnlockQuery, useGetInterstitialAdvertisementQuery } from '../../features/admin/advertisements.api'
import { useAdvertisementGate } from '../../hooks/useAdvertisementGate'
import { formatMatchKickoff } from '../../utils/matchDateTime'
import { getMatchCompetitionName } from '../../features/matches/matchCompetition'
import { useCountdown } from '../../hooks/useCountdown'
import { useResourceViewerCount } from '../../hooks/useResourceViewerCount'
import { useGetPublicSiteSettingsQuery } from '../../features/settings/siteSettings.api'
import { LIVE_BADGE_CLASS, LIVE_DOT_CLASS, formatViewerCount } from '../../utils/liveStatus'

export function MatchPage() {
  const { id } = useParams<{ id: string }>()
  const { data: match, isFetching, isError, error } = useGetMatchByIdQuery(id!, {
    skip: !id,
    refetchOnMountOrArgChange: 10,
  }) as { data?: Match; isFetching: boolean; isError: boolean; error?: unknown }

  const [isAutoMode, setIsAutoMode] = useState(true)
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | undefined>(undefined)
  const [selectedStreamId, setSelectedStreamId] = useState<string | undefined>(undefined)
  const [openSubscriptionModal, setOpenSubscriptionModal] = useState(false)
  const isPremiumSubscriber = useAppSelector(selectIsPremiumSubscriber)
  const openMatch = useAdvertisementGate('MATCH')
  const navigate = useNavigate()
  const location = useLocation()
  const { deviceTier, shouldReduceEffects } = usePerformanceProfile()
  const isLowPower = deviceTier === 'low' || shouldReduceEffects
  const matchViewerCount = useResourceViewerCount('match', match?.id)
  const matchTimer = useCountdown(match?.status === 'LIVE' ? match.kickoffAt : null)
  const isMissingMatch = typeof error === 'object' && error !== null && 'status' in error && error.status === 404

  const isMatchLocked = match?.premium === true && !isPremiumSubscriber
  const [isPlaybackAllowed, setIsPlaybackAllowed] = useState(false)
  const [gateRequested, setGateRequested] = useState(false)
  const { data: directAdvertisement, isFetching: isAdvertisementLoading } = useGetInterstitialAdvertisementQuery('MATCH', { skip: isPremiumSubscriber || Boolean(match?.premium) })
  const { data: directUnlock, isFetching: isUnlockLoading } = useGetAdUnlockQuery(undefined, { skip: isPremiumSubscriber || Boolean(match?.premium) })
  const configuredPreStartVideoUrl = import.meta.env.VITE_MATCH_PRE_START_VIDEO_URL
  const defaultPreStartVideoUrl = typeof configuredPreStartVideoUrl === 'string' && configuredPreStartVideoUrl.trim()
    ? configuredPreStartVideoUrl.trim()
    : null
  const configuredPreStartWindow = import.meta.env.VITE_MATCH_PRE_START_WINDOW_MINUTES
  const parsedPreStartWindow = Number(configuredPreStartWindow)
  const globalPreStartWindowMinutes = Number.isFinite(parsedPreStartWindow) && parsedPreStartWindow > 0
    ? Math.min(parsedPreStartWindow, 24 * 60)
    : 15
  const effectivePreStartEnabled = match?.preStartEnabled !== false
  const effectivePreStartWindowMinutes = match?.preStartWindowMinutes ?? globalPreStartWindowMinutes
  const [preStartVideoFailed, setPreStartVideoFailed] = useState(false)
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const availableStreams = useMemo(
    () =>
      (match?.streams ?? []).filter((stream) => {
        return isPlayableStream(stream)
      }),
    [match?.streams],
  )
  const initialStream = useMemo(() => getPreferredStreamUrl(availableStreams[0]) ?? undefined, [availableStreams])
  // Every playable URL of the match, in display order and de-duplicated, is the bounded chain the player
  // walks when a source fails: stream A primary → A backup → stream B → … → exhausted.
  const candidateChain = useMemo(() => getStreamCandidateChain(availableStreams), [availableStreams])
  const attemptedUrlsRef = useRef<Set<string>>(new Set())
  const matchStartTime = Date.parse(match?.kickoffAt ?? '')
  const preStartAt = Number.isFinite(matchStartTime)
    ? matchStartTime - effectivePreStartWindowMinutes * 60 * 1000
    : Number.NaN
  const isWithinPreStartWindow = Number.isFinite(matchStartTime)
    && currentTime >= preStartAt
    && currentTime < matchStartTime
  const shouldShowWaitingPlaceholder = isPlaybackAllowed
    && !currentStreamUrl
    && effectivePreStartEnabled
    && match?.status !== 'FINISHED'
    && (match?.status === 'LIVE' || isWithinPreStartWindow)
  // The site-level video is only read while the match really is waiting for its broadcast, so an ordinary
  // match page still issues no extra request. The match's own override wins, then the admin-configured site
  // video, then the deployment-level environment default.
  const { data: publicSiteSettings } = useGetPublicSiteSettingsQuery(undefined, { skip: !shouldShowWaitingPlaceholder })
  const sitePreStartVideoUrl = publicSiteSettings?.prestartVideoEnabled === false ? null : publicSiteSettings?.prestartVideoUrl ?? null
  const configuredMatchVideoUrl = match?.preStartVideoUrl
  const effectivePreStartVideoUrl = typeof configuredMatchVideoUrl === 'string' && configuredMatchVideoUrl.trim()
    ? configuredMatchVideoUrl.trim()
    : sitePreStartVideoUrl ?? defaultPreStartVideoUrl
  const matchCompetitionName = match ? getMatchCompetitionName(match) : null
  // The waiting panel names the real fixture, falling back to the stored match title when a side is unnamed.
  const matchFixtureLine = match && match.homeTeamName?.trim() && match.awayTeamName?.trim()
    ? `${match.homeTeamName.trim()} vs ${match.awayTeamName.trim()}`
    : match?.title?.trim() || null

  useEffect(() => {
    startTransition(() => {
      setIsPlaybackAllowed(false)
      setGateRequested(false)
      setCurrentStreamUrl(undefined)
      setSelectedStreamId(undefined)
      setPreStartVideoFailed(false)
    })
    attemptedUrlsRef.current = new Set()
  }, [id])

  /**
   * Moves to the next candidate after a source failure.
   *
   * Only URLs that have not been attempted yet are used, so the player can never bounce between two
   * entries of the same broken source, and `false` tells the player the chain is exhausted so it can
   * show the terminal error instead of waiting.
   */
  const handleStreamFallback = useCallback((failedUrl: string): boolean => {
    const attempted = attemptedUrlsRef.current
    attempted.add(failedUrl)
    const next = findNextStreamCandidate(candidateChain, failedUrl, attempted)
    if (!next) return false

    attempted.add(next.url)
    startTransition(() => {
      setCurrentStreamUrl(next.url)
      setSelectedStreamId(next.streamId)
      setIsAutoMode(false)
    })
    return true
  }, [candidateChain])

  /** A manual stream choice always gets a fresh attempt, even if that URL failed automatically before. */
  const selectStreamUrl = useCallback((streamId: string, nextUrl: string) => {
    attemptedUrlsRef.current.delete(nextUrl)
    startTransition(() => {
      setCurrentStreamUrl(nextUrl)
      setSelectedStreamId(streamId)
      setIsAutoMode(false)
    })
  }, [])

  useEffect(() => {
    startTransition(() => setPreStartVideoFailed(false))
  }, [effectivePreStartVideoUrl])

  useEffect(() => {
    startTransition(() => setCurrentTime(Date.now()))
    if (!Number.isFinite(preStartAt) || preStartAt <= Date.now()) return

    const timer = window.setTimeout(() => setCurrentTime(Date.now()), preStartAt - Date.now())
    return () => window.clearTimeout(timer)
  }, [id, preStartAt])

  useEffect(() => {
    if (!match || isMatchLocked || gateRequested || isAdvertisementLoading || isUnlockLoading) return
    startTransition(() => setGateRequested(true))
    if (isPremiumSubscriber) {
      startTransition(() => setIsPlaybackAllowed(true))
      return
    }
    const hasUnlock = Boolean(directUnlock && new Date(directUnlock.expiresAt).getTime() > Date.now())
    if (hasUnlock || !directAdvertisement) {
      startTransition(() => setIsPlaybackAllowed(true))
      return
    }
    openMatch(`/matches/${match.id}`, false, () => setIsPlaybackAllowed(true))
  }, [directAdvertisement, directUnlock, gateRequested, isAdvertisementLoading, isMatchLocked, isPremiumSubscriber, isUnlockLoading, match, openMatch])

  useEffect(() => {
    if (!match || isMatchLocked || (!isPremiumSubscriber && !isPlaybackAllowed)) return
    const firstStream = availableStreams[0]
    startTransition(() => {
      setCurrentStreamUrl(initialStream)
      setSelectedStreamId(firstStream?.id)
      setIsAutoMode(false)
    })
  }, [availableStreams, initialStream, isMatchLocked, isPlaybackAllowed, isPremiumSubscriber, match])

  useEffect(() => {
    const actionData = sessionStorage.getItem('post-auth-action')
    if (!actionData) return

    try {
      const action = JSON.parse(actionData) as { action: string; redirect?: string }
      const currentPath = `${location.pathname}${location.search}`
      if (action.action === 'unlockPremium' && action.redirect === currentPath) {
        sessionStorage.removeItem('post-auth-action')
        if (!isMatchLocked) return
        startTransition(() => setOpenSubscriptionModal(true))
      }
    } catch {
      // Ignore malformed post-auth actions
    }
  }, [isMatchLocked, location.pathname, location.search, navigate])

  if (isFetching) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[56.25vw] w-full max-h-[70vh] rounded-4xl" />
        <Skeleton className="h-24 w-full rounded-3xl" />
        <Skeleton className="h-24 w-full rounded-3xl" />
      </div>
    )
  }

  if (isError || !match) {
    return (
      <div className="flex h-64 items-center justify-center rounded-4xl border border-dashed border-(--danger)/50 bg-(--surface)">
        <div className="text-center">
          <motion.div className="mx-auto mb-2 flex items-center justify-center">
            <AlertCircle className="h-10 w-10 text-(--danger)" />
          </motion.div>
          <h3 className="text-xl font-semibold text-(--text-primary)">{isMissingMatch ? 'Match not found' : 'Match temporarily unavailable'}</h3>
          <p className="text-(--text-muted)">{isMissingMatch ? 'This match may have been removed.' : 'Please try again shortly.'}</p>
        </div>
      </div>
    )
  }

  // Define a type for the social platform objects to correctly type the 'icon' property
  interface SocialPlatform {
    name: string;
    icon: IconType;
    action?: () => void;
    url?: string;
  }

  const shareUrl = window.location.href
  const shareText = `Watch Live: ${match.title}`

  const socialPlatforms: SocialPlatform[] = [
    { name: 'Copy link', icon: FaLink, action: () => {
        navigator.clipboard.writeText(shareUrl)
        toast.success('Link Copied!', { description: 'You can now share it with your friends.' })
      }
    },
    { name: 'Facebook', icon: FaFacebookF, url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}` },
    { name: 'X', icon: FaXTwitter, url: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}` },
    { name: 'WhatsApp', icon: FaWhatsapp, url: `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}%20${encodeURIComponent(shareUrl)}` },
    { name: 'Telegram', icon: FaTelegram, url: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}` },
  ]

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
      },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, scale: 0.5 },
    visible: { opacity: 1, scale: 1 },
  }

  const handleShareClick = (platform: typeof socialPlatforms[0]) => {
    if (platform.action) {
      platform.action()
    } else if (platform.url) {
      window.open(platform.url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="w-full min-w-0 space-y-4 px-1 sm:space-y-5 sm:px-2 lg:space-y-6">
      <div className="flex justify-start">
      </div>
      {isMatchLocked && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }}><Card className="premium-border bg-black/80 p-4 text-center text-white sm:p-5">
          <motion.div className="mx-auto flex items-center justify-center">
            <Tv size={40} className="text-(--accent)" />
          </motion.div>
          <h2 className="mt-2 text-xl font-semibold sm:text-2xl">Premium Match Locked</h2>
          <p className="mt-2 text-sm text-white/70">Upgrade to unlock live streaming.</p>
          <Button onClick={() => setOpenSubscriptionModal(true)} className="mt-4 bg-(--accent) text-slate-950 hover:bg-(--accent-strong)">Unlock Premium Access</Button>
        </Card></motion.div>
      )}
      <SubscriptionModal isOpen={openSubscriptionModal} onClose={() => setOpenSubscriptionModal(false)} />

      <AnimatePresence mode="wait">
        {shouldShowWaitingPlaceholder ? (
          <motion.div
            key="match-prestart"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className={cn(
              'relative flex w-full aspect-video items-center justify-center overflow-hidden rounded-4xl border border-(--border) shadow-[0_24px_60px_rgba(2,8,20,0.55)]',
              preStartVideoFailed || !effectivePreStartVideoUrl
                ? 'bg-[radial-gradient(circle_at_50%_120%,#0a4f8f_0%,#062036_38%,#050510_72%,#020208_100%)]'
                : 'bg-[#050510]',
            )}
          >
            {effectivePreStartVideoUrl && !preStartVideoFailed && (
              <video
                src={effectivePreStartVideoUrl}
                autoPlay
                loop
                muted
                playsInline
                onError={() => setPreStartVideoFailed(true)}
                aria-hidden="true"
                tabIndex={-1}
                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40"
              />
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/35 to-black/60" aria-hidden="true" />
            {/* Waiting-state light sweep: transform-only, and removed entirely for reduced motion. */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden motion-safe:animate-shimmer" aria-hidden="true">
              <div className="h-full w-full bg-linear-to-r from-transparent via-white/6 to-transparent" />
            </div>
            <div className="relative z-10 flex w-full max-w-lg flex-col items-center gap-3 px-6 text-center sm:gap-4 sm:px-10">
              <span className="inline-flex items-center gap-2 rounded-full border border-sky-300/25 bg-sky-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-sky-200/90">
                <Radio className="h-3.5 w-3.5 motion-safe:animate-pulse" aria-hidden="true" />
                {match.status === 'LIVE' ? 'Broadcast pending' : 'Pre-match'}
              </span>
              <h2 className="text-2xl font-black uppercase leading-tight tracking-[0.12em] text-white sm:text-3xl">
                {match.status === 'LIVE' ? 'Match Started' : 'Match Starting Soon'}
              </h2>
              {matchCompetitionName && (
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/70 sm:text-xs">{matchCompetitionName}</p>
              )}
              {matchFixtureLine && (
                <p className="w-full truncate text-sm font-semibold text-white/90 sm:text-base">{matchFixtureLine}</p>
              )}
              {match.status !== 'LIVE' && (
                <span className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/85 sm:text-sm">
                  <Clock3 className="h-3.5 w-3.5 text-sky-200/80" aria-hidden="true" />
                  Kick-off {formatMatchKickoff(match.kickoffAt)}
                </span>
              )}
              <p className="text-xs text-white/65 sm:text-sm">Waiting for broadcast signal…</p>
            </div>
          </motion.div>
        ) : isPlaybackAllowed && currentStreamUrl ? (
          <motion.div
            key={`live-player-${selectedStreamId ?? currentStreamUrl}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="premium-border overflow-hidden rounded-4xl bg-black shadow-[0_25px_60px_rgba(0,0,0,0.35)]"
          >
            <CustomVideoPlayer
              url={currentStreamUrl}
              streamId={selectedStreamId}
              onStreamFallback={handleStreamFallback}
              presenceId={match.id}
              presenceType="match"
              matchId={match.id}
              title={match.title}
              autoPlay
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {selectedStreamId && (() => {
        const selectedStream = availableStreams.find((stream) => stream.id === selectedStreamId)
        if (!selectedStream) return null

        return (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}><Card className="premium-border bg-(--surface)/70 backdrop-blur-md">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {selectedStream.logo ? (
                    <img src={selectedStream.logo} alt={selectedStream.name ?? 'Stream logo'} className="h-10 w-10 rounded-full object-cover ring-1 ring-border" />
                  ) : (
                    <motion.div className="flex h-10 w-10 items-center justify-center rounded-full bg-(--accent)/10 text-(--accent)">
                      <Server className="h-4 w-4" />
                    </motion.div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-(--text-muted)">Now playing</p>
                    <p className="truncate text-sm font-semibold text-(--text-primary)">{selectedStream.name ?? selectedStream.quality ?? 'Live Stream'}</p>
                  </div>
                </div>
                <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]', LIVE_BADGE_CLASS)}>Live</span>
              </div>
            </CardContent>
          </Card></motion.div>
        )
      })()}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }}><Card className="premium-border bg-(--surface)/70 backdrop-blur-md">
        <CardHeader className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-(--accent)">{match.competition?.name ?? 'Match'}</p>
              <CardTitle className="text-xl leading-tight text-(--text-primary) sm:text-2xl">{match.title}</CardTitle>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-(--text-muted) sm:text-sm">
                <span className="flex items-center gap-1.5 rounded-md border border-(--border) bg-(--surface-soft)/80 px-2.5 py-1">
                    <motion.div className="flex items-center justify-center">
                    <Clock3 className="h-4 w-4" />
                  </motion.div>
                  {formatMatchKickoff(match.kickoffAt)}
                </span>
                <span className={cn('flex items-center gap-1.5 rounded-md border px-2.5 py-1', match.status === 'LIVE' ? LIVE_BADGE_CLASS : match.status === 'FINISHED' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
                  <span className={cn('h-2 w-2 rounded-full', match.status === 'LIVE' ? `motion-safe:animate-pulse ${LIVE_DOT_CLASS}` : match.status === 'FINISHED' ? 'bg-emerald-500' : 'bg-amber-500')} aria-hidden="true" />
                  {match.status === 'LIVE' ? `LIVE · ${matchTimer.elapsedFormatted}` : match.status}
                </span>
              </div>
            </div>
            <span className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold lg:ml-auto', LIVE_BADGE_CLASS)}><span className={cn('h-2 w-2 rounded-full motion-safe:animate-pulse', LIVE_DOT_CLASS)} aria-hidden="true" />{matchViewerCount === null ? 'Viewer count unavailable' : `${formatViewerCount(Math.max(0, matchViewerCount))} watching live`}</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="self-start">
                  <span className="flex items-center gap-2">
                    <motion.div className="flex items-center justify-center">
                      <Share2 size={16} />
                    </motion.div>
                    Share
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] bg-(--surface-strong)/80 p-3 backdrop-blur-lg">
                <div className="space-y-2">
                  <h4 className="text-sm font-medium leading-none text-(--text-primary)">Share match</h4>
                  <motion.div className="flex flex-wrap items-center gap-1.5" variants={containerVariants} initial={isLowPower ? false : 'hidden'} animate={isLowPower ? undefined : 'visible'}>
                    {socialPlatforms.map((platform) => (
                      <motion.div key={platform.name} variants={itemVariants} initial={isLowPower ? false : undefined} animate={isLowPower ? undefined : undefined}>
                        <Button variant="outline" size="icon" className="h-9 w-9 rounded-md" onClick={() => handleShareClick(platform)} title={platform.name} aria-label={platform.name}>
                          <platform.icon size={16} />
                        </Button>
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
          <h3 className="mb-2 text-base font-semibold text-(--text-primary) sm:text-lg">Available streams</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {availableStreams.map((stream: Stream) => {
              const streamUrls = getStreamUrlCandidates(stream)
              const primaryUrl = streamUrls[0] ?? ''
              const backupUrl = streamUrls[1] ?? ''
              const isSelected = !isAutoMode && selectedStreamId === stream.id

              const streamStatus = stream.status?.toUpperCase() ?? 'READY'
              const statusClass = streamStatus === 'LIVE' ? LIVE_BADGE_CLASS : streamStatus === 'ERROR' || streamStatus === 'OFFLINE' ? 'bg-slate-500/10 text-(--text-muted)' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'

              return (
                <div key={stream.id} className={cn('flex min-w-0 flex-col gap-2 rounded-xl border border-(--border) bg-(--surface-soft)/50 p-3 shadow-[0_8px_24px_rgba(4,116,196,0.06)] backdrop-blur-sm', isSelected && 'border-(--accent)/60 bg-(--accent)/10 shadow-[0_0_20px_rgba(4,116,196,0.16)]')}>
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                    {stream.logo ? <img src={stream.logo} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" /> : <Server className="h-4 w-4 shrink-0 text-(--accent)" />}
                    <span className="min-w-0 truncate text-sm font-semibold text-(--text-primary)">{stream.name ?? stream.quality ?? 'Stream'}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                      <span className="rounded-full bg-(--surface-strong) px-2 py-1 text-(--text-muted)">{stream.quality ?? 'Auto'}</span>
                      <span className={cn('rounded-full px-2 py-1', statusClass)}>{streamStatus}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="secondary" disabled={!primaryUrl} onClick={() => selectStreamUrl(stream.id, primaryUrl)} className={cn('h-9 gap-1.5 border border-(--border) bg-(--surface)/60 text-xs hover:border-(--accent)/50 hover:bg-(--accent)/10', isSelected && currentStreamUrl === primaryUrl && 'border-(--accent) text-(--accent) shadow-[0_0_14px_rgba(4,116,196,0.2)]')}>
                      <Server className="h-3.5 w-3.5" /> Primary
                    </Button>
                    <Button type="button" variant="secondary" disabled={!backupUrl} onClick={() => selectStreamUrl(stream.id, backupUrl)} className={cn('h-9 gap-1.5 border border-(--border) bg-(--surface)/60 text-xs hover:border-(--accent)/50 hover:bg-(--accent)/10', isSelected && currentStreamUrl === backupUrl && 'border-(--accent) text-(--accent) shadow-[0_0_14px_rgba(4,116,196,0.2)]')}>
                      <Server className="h-3.5 w-3.5" /> Backup
                    </Button>
                  </div>
                </div>
              )
            })}
            {availableStreams.length === 0 && (
              <p className="text-sm text-(--text-muted)">No streams are currently available for this match.</p>
            )}
          </div>
        </CardContent>
      </Card></motion.div>
    </motion.div>
  )
}