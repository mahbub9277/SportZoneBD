/* eslint-disable react-refresh/only-export-components */
/* eslint-disable react-hooks/set-state-in-effect */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Loader2,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Timer,
  Users,
  X,
} from 'lucide-react'
import { useAppSelector } from '../app/hooks'
import { selectIsPremiumSubscriber } from '../features/auth/authSlice'
import {
  useCancelAdViewSessionMutation,
  useCompleteAdViewSessionMutation,
  useGetAdUnlockQuery,
  useGetInterstitialAdvertisementQuery,
  useStartAdViewSessionMutation,
} from '../features/admin/advertisements.api'
import type { Advertisement } from '../features/admin/advertisements.api'
import { useTrackEventMutation } from '../features/analytics/analytics.api'
import { Button } from '../components/ui/Button'

type AdvertisementPlacement = 'MATCH' | 'CHANNEL' | 'FULL_PAGE'
interface AdvertisementRequest { placement: AdvertisementPlacement; destination: string; onComplete?: () => void; seenKey?: string }
interface AdvertisementGateContextValue {
  openAdvertisement: (placement: AdvertisementPlacement, destination: string, onComplete?: () => void, seenKey?: string) => void
}
const AdvertisementGateContext = createContext<AdvertisementGateContextValue | null>(null)
const isSafeDestination = (value: string): boolean => value.startsWith('/') && !value.startsWith('//')
const placementLabels: Record<AdvertisementPlacement, string> = {
  MATCH: 'Match ad',
  CHANNEL: 'Channel ad',
  FULL_PAGE: 'Full page ad',
}
// The countdown only commits state when the displayed second changes, so a 250ms tick keeps the
// timer accurate without re-rendering the dialog four times per second.
const COUNTDOWN_TICK_MS = 250
// A completed session hands control back to the requested destination after a short beat.
const AUTO_RETURN_DELAY_MS = 700

export function useAdvertisementGate(placement: AdvertisementPlacement) {
  const context = useContext(AdvertisementGateContext)
  const navigate = useNavigate()
  const isPremium = useAppSelector(selectIsPremiumSubscriber)
  const { data: advertisement, isFetching: isAdvertisementLoading } = useGetInterstitialAdvertisementQuery(placement, { skip: isPremium })
  const { data: unlock, isFetching: isUnlockLoading } = useGetAdUnlockQuery(undefined, { skip: isPremium })

  if (!context) throw new Error('useAdvertisementGate must be used within AdvertisementGateProvider')

  return useCallback((destination: string, requiresPremium = false, onComplete?: () => void) => {
    if (!isSafeDestination(destination)) return
    if (requiresPremium) {
      if (onComplete) onComplete()
      else navigate(destination)
      return
    }
    const hasUnlock = Boolean(unlock && new Date(unlock.expiresAt).getTime() > Date.now())
    if (isPremium || hasUnlock || (!isAdvertisementLoading && !isUnlockLoading && !advertisement)) {
      if (onComplete) onComplete()
      else navigate(destination)
    } else if (!isAdvertisementLoading && !isUnlockLoading && advertisement) {
      context.openAdvertisement(placement, destination, onComplete)
    }
  }, [advertisement, context, isAdvertisementLoading, isPremium, isUnlockLoading, navigate, placement, unlock])
}

export function AdvertisementGateProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const isPremium = useAppSelector(selectIsPremiumSubscriber)
  const [request, setRequest] = useState<AdvertisementRequest | null>(null)
  const [hasVisited, setHasVisited] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isSessionStarted, setIsSessionStarted] = useState(false)
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [completionState, setCompletionState] = useState<'idle' | 'verifying' | 'unlocked'>('idle')
  const [earlyExit, setEarlyExit] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const completionRequestedRef = useRef(false)
  const countdownTimerRef = useRef<number | null>(null)
  const autoReturnTimerRef = useRef<number | null>(null)
  const sessionStartedAtRef = useRef<number | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const requiredDurationMsRef = useRef(0)
  const hasLeftSiteRef = useRef(false)
  const sponsorOpenedAtRef = useRef<number | null>(null)
  const visitInFlightRef = useRef(false)
  const impressedAdvertisementIdRef = useRef<string | null>(null)
  const { data: advertisement, isLoading } = useGetInterstitialAdvertisementQuery(request?.placement ?? 'MATCH', { skip: !request || isPremium })
  const { data: unlock } = useGetAdUnlockQuery(undefined, { skip: !request || isPremium })
  const { data: fullPageAdvertisement } = useGetInterstitialAdvertisementQuery('FULL_PAGE', { skip: isPremium })
  const [startViewSession, { isLoading: isStarting }] = useStartAdViewSessionMutation()
  const [completeViewSession, { isLoading: isCompleting }] = useCompleteAdViewSessionMutation()
  const [cancelViewSession] = useCancelAdViewSessionMutation()
  const [trackEvent] = useTrackEventMutation()

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
  }, [])

  const clearAutoReturnTimer = useCallback(() => {
    if (autoReturnTimerRef.current !== null) {
      window.clearTimeout(autoReturnTimerRef.current)
      autoReturnTimerRef.current = null
    }
  }, [])

  const completeCurrentSession = useCallback(async () => {
    const activeSessionId = sessionIdRef.current

    if (!activeSessionId || completionRequestedRef.current) return

    completionRequestedRef.current = true
    setCompletionState('verifying')

    try {
      await completeViewSession(activeSessionId).unwrap()
      clearCountdownTimer()
      clearAutoReturnTimer()
      setCountdownEndsAt(null)
      setRemaining(0)
      setIsSessionStarted(false)
      setSessionId(null)
      sessionIdRef.current = null
      sessionStartedAtRef.current = null
      requiredDurationMsRef.current = 0
      sponsorOpenedAtRef.current = null
      visitInFlightRef.current = false
      setCompletionState('unlocked')

      if (!request) return

      autoReturnTimerRef.current = window.setTimeout(() => {
        autoReturnTimerRef.current = null
        if (request.onComplete) request.onComplete()
        else navigate(request.destination, { replace: true })
        setRequest(null)
      }, AUTO_RETURN_DELAY_MS)
    } catch {
      completionRequestedRef.current = false
      visitInFlightRef.current = false
      setCompletionState('idle')
      setIsSessionStarted(false)
      setCountdownEndsAt(null)
      setSessionError('We could not verify that the advertisement was completed. Please try again.')
      setRemaining(1)
    }
  }, [clearAutoReturnTimer, clearCountdownTimer, completeViewSession, navigate, request])

  const openAdvertisement = useCallback((placement: AdvertisementPlacement, destination: string, onComplete?: () => void, seenKey?: string) => {
    if (!isSafeDestination(destination)) return
    clearCountdownTimer()
    clearAutoReturnTimer()
    setRequest({ placement, destination, onComplete, seenKey })
    setHasVisited(false)
    setSessionId(null)
    sessionIdRef.current = null
    setIsSessionStarted(false)
    setCountdownEndsAt(null)
    setRemaining(0)
    setCompletionState('idle')
    setEarlyExit(false)
    setSessionError(null)
    sessionStartedAtRef.current = null
    requiredDurationMsRef.current = 0
    hasLeftSiteRef.current = false
    sponsorOpenedAtRef.current = null
    visitInFlightRef.current = false
    completionRequestedRef.current = false
    impressedAdvertisementIdRef.current = null
  }, [clearAutoReturnTimer, clearCountdownTimer])

  useEffect(() => () => {
    clearCountdownTimer()
    clearAutoReturnTimer()
  }, [clearAutoReturnTimer, clearCountdownTimer])

  useEffect(() => {
    if (isPremium || request || !fullPageAdvertisement) return
    if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/login') || location.pathname === '/advertisements/interstitial') return
    const seenKey = `sportzone-full-page-ad:${fullPageAdvertisement.id}`
    if (sessionStorage.getItem(seenKey)) return
    const destination = `${location.pathname}${location.search}`
    openAdvertisement('FULL_PAGE', destination, () => sessionStorage.setItem(seenKey, 'completed'), seenKey)
  }, [fullPageAdvertisement, isPremium, location.pathname, location.search, openAdvertisement, request])

  useEffect(() => {
    if (!request || !advertisement) return
    if (impressedAdvertisementIdRef.current !== advertisement.id) {
      impressedAdvertisementIdRef.current = advertisement.id
      void trackEvent({ type: 'ADVERTISEMENT_IMPRESSION', entityId: advertisement.id })
    }
    if (unlock && new Date(unlock.expiresAt).getTime() > Date.now()) {
      if (request.onComplete) request.onComplete()
      else navigate(request.destination, { replace: true })
      queueMicrotask(() => setRequest(null))
    }
  }, [advertisement, navigate, request, trackEvent, unlock])

  useEffect(() => {
    if (!countdownEndsAt) return

    const tick = () => {
      const next = Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1000))
      setRemaining((current) => (current === next ? current : next))

      if (next === 0) {
        if (countdownTimerRef.current !== null) {
          window.clearInterval(countdownTimerRef.current)
          countdownTimerRef.current = null
        }
        void completeCurrentSession()
      }
    }

    const timer = window.setInterval(tick, COUNTDOWN_TICK_MS)
    countdownTimerRef.current = timer
    tick()

    return () => {
      window.clearInterval(timer)
      if (countdownTimerRef.current === timer) countdownTimerRef.current = null
    }
  }, [completeCurrentSession, countdownEndsAt])

  useEffect(() => {
    if (!isSessionStarted) return
    const handleReturnToSite = () => {
      if (document.hidden) {
        hasLeftSiteRef.current = true
        return
      }
      if (!hasLeftSiteRef.current || completionRequestedRef.current) return
      if (sponsorOpenedAtRef.current && Date.now() - sponsorOpenedAtRef.current < 300) return

      const startedAt = sessionStartedAtRef.current
      const durationMs = requiredDurationMsRef.current
      const activeSessionId = sessionIdRef.current
      const elapsedMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0
      const remainingSeconds = Math.max(0, Math.ceil((durationMs - elapsedMs) / 1000))

      if (elapsedMs < durationMs) {
        clearCountdownTimer()
        if (activeSessionId) void cancelViewSession(activeSessionId)
        completionRequestedRef.current = true
        visitInFlightRef.current = false
        setEarlyExit(true)
        setIsSessionStarted(false)
        setSessionId(null)
        sessionIdRef.current = null
        setCountdownEndsAt(null)
        setRemaining(remainingSeconds)
        return
      }

      void completeCurrentSession()
    }
    document.addEventListener('visibilitychange', handleReturnToSite)
    window.addEventListener('focus', handleReturnToSite)
    return () => {
      document.removeEventListener('visibilitychange', handleReturnToSite)
      window.removeEventListener('focus', handleReturnToSite)
    }
  }, [cancelViewSession, clearCountdownTimer, completeCurrentSession, isSessionStarted, navigate, request])

  useEffect(() => {
    if (!request) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [request])

  const handleVisit = useCallback(async () => {
    if (!advertisement || isStarting || isSessionStarted || visitInFlightRef.current) return
    visitInFlightRef.current = true
    try {
      completionRequestedRef.current = false
      setEarlyExit(false)
      setSessionError(null)
      const session = await startViewSession({ advertisementId: advertisement.id }).unwrap()
      void trackEvent({ type: 'ADVERTISEMENT_WATCH_NOW', entityId: advertisement.id })
      setSessionId(session.sessionId)
      sessionIdRef.current = session.sessionId
      setIsSessionStarted(true)
      setHasVisited(true)
      hasLeftSiteRef.current = true
      const startedAtMs = new Date(session.startedAt).getTime()
      const durationMs = session.durationSeconds * 1000
      sessionStartedAtRef.current = startedAtMs
      requiredDurationMsRef.current = durationMs
      sponsorOpenedAtRef.current = Date.now()
      setCountdownEndsAt(startedAtMs + durationMs)
      setRemaining(session.durationSeconds)
      window.open(advertisement.link, '_blank', 'noopener,noreferrer')
    } catch {
      visitInFlightRef.current = false
      setSessionError('Unable to start the advertisement session. Please try again.')
    }
  }, [advertisement, isSessionStarted, isStarting, startViewSession, trackEvent])

  const handleReopenSponsor = useCallback(() => {
    if (!advertisement) return
    sponsorOpenedAtRef.current = Date.now()
    window.open(advertisement.link, '_blank', 'noopener,noreferrer')
  }, [advertisement])

  const handleClose = useCallback(() => {
    clearCountdownTimer()
    clearAutoReturnTimer()
    if (request?.seenKey) {
      try {
        sessionStorage.setItem(request.seenKey, 'dismissed')
      } catch {
        // Storage can be unavailable (private mode); the dismissal still applies to this mount.
      }
    }
    if (sessionId && isSessionStarted) void cancelViewSession(sessionId)
    sessionIdRef.current = null
    completionRequestedRef.current = false
    hasLeftSiteRef.current = false
    sessionStartedAtRef.current = null
    requiredDurationMsRef.current = 0
    sponsorOpenedAtRef.current = null
    visitInFlightRef.current = false
    setSessionError(null)
    setRequest(null)
  }, [cancelViewSession, clearAutoReturnTimer, clearCountdownTimer, isSessionStarted, request, sessionId])

  useEffect(() => {
    if (!request) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose, request])

  const contextValue = useMemo(() => ({ openAdvertisement }), [openAdvertisement])

  return (
    <AdvertisementGateContext.Provider value={contextValue}>
      {children}
      <AdvertisementModal
        request={request}
        advertisement={advertisement}
        isLoading={isLoading}
        isStarting={isStarting}
        remaining={remaining}
        hasVisited={hasVisited}
        isCompleting={isCompleting}
        isSessionStarted={isSessionStarted}
        completionState={completionState}
        earlyExit={earlyExit}
        sessionError={sessionError}
        onVisit={() => void handleVisit()}
        onReopen={handleReopenSponsor}
        onClose={handleClose}
      />
    </AdvertisementGateContext.Provider>
  )
}

interface AdvertisementModalProps {
  request: AdvertisementRequest | null
  advertisement?: Advertisement | null
  isLoading: boolean
  isStarting: boolean
  remaining: number
  hasVisited: boolean
  isCompleting: boolean
  isSessionStarted: boolean
  completionState: 'idle' | 'verifying' | 'unlocked'
  earlyExit: boolean
  sessionError: string | null
  onVisit: () => void
  onReopen: () => void
  onClose: () => void
}

function AdvertisementModal({ request, advertisement, isLoading, isStarting, remaining, hasVisited, isCompleting, isSessionStarted, completionState, earlyExit, sessionError, onVisit, onReopen, onClose }: AdvertisementModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const durationSeconds = advertisement?.durationSeconds ?? 0
  const progress = durationSeconds > 0 ? Math.max(0, Math.min(100, ((durationSeconds - remaining) / durationSeconds) * 100)) : 0
  const isActive = isSessionStarted || completionState !== 'idle'
  const socialLinks: { key: string; label: string; href: string; icon: ReactNode }[] = []
  if (advertisement?.facebookUrl) socialLinks.push({ key: 'facebook', label: 'Facebook', href: advertisement.facebookUrl, icon: <Users className="h-4 w-4" /> })
  if (advertisement?.youtubeUrl) socialLinks.push({ key: 'youtube', label: 'YouTube', href: advertisement.youtubeUrl, icon: <Play className="h-4 w-4" /> })
  if (advertisement?.instagramUrl) socialLinks.push({ key: 'instagram', label: 'Instagram', href: advertisement.instagramUrl, icon: <Camera className="h-4 w-4" /> })
  if (advertisement?.telegramUrl) socialLinks.push({ key: 'telegram', label: 'Telegram', href: advertisement.telegramUrl, icon: <Send className="h-4 w-4" /> })
  if (advertisement?.websiteUrl) socialLinks.push({ key: 'website', label: 'Website', href: advertisement.websiteUrl, icon: <Globe2 className="h-4 w-4" /> })

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true })
  }, [request])

  const statusLine = completionState === 'verifying'
    ? 'Verifying your advertisement view...'
    : completionState === 'unlocked'
      ? 'Access unlocked. Continuing to your content...'
      : isSessionStarted
        ? 'Keep this SportZoneBD tab open until the timer finishes.'
        : 'Watch the sponsor advertisement once to unlock ad-free access.'

  const countdownLabel = completionState === 'unlocked'
    ? 'Access unlocked'
    : completionState === 'verifying'
      ? 'Verifying view'
      : 'Live ad session'

  const countdownHint = completionState === 'unlocked'
    ? `Enjoy ${advertisement?.unlockHours ?? 24} hours without ads.`
    : completionState === 'verifying'
      ? 'Confirming the sponsor visit with our server...'
      : remaining > 0
        ? 'You can switch back to the sponsor tab any time.'
        : 'Finalizing access...'

  return (
    <AnimatePresence>
      {request && (
        <motion.div className="fixed inset-0 z-70 flex items-center justify-center overflow-y-auto overscroll-contain bg-slate-950/75 px-3 py-4 backdrop-blur-md sm:px-6" role="dialog" aria-modal="true" aria-label="Sponsored advertisement" aria-labelledby="interstitial-ad-title" aria-describedby="interstitial-ad-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div ref={panelRef} tabIndex={-1} className="relative flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-(--surface)/95 text-(--text-primary) shadow-[0_30px_100px_rgba(2,23,45,0.45)] outline-none" initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top,rgba(247,199,93,0.18),transparent_70%)]" aria-hidden="true" />

            <button type="button" onClick={onClose} className="absolute right-3 top-3 z-30 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-slate-950/45 text-white/80 backdrop-blur transition-colors hover:bg-slate-950/75 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)" aria-label="Close advertisement" title="Close advertisement">
              <X className="h-5 w-5" />
            </button>

            {isLoading ? (
              <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-center">
                <Loader2 className="h-9 w-9 animate-spin text-(--accent)" />
                <p className="text-sm text-(--text-muted)">Loading advertisement...</p>
              </div>
            ) : advertisement ? (
              <>
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-(--border) bg-(--surface-soft)/70 px-4 py-3 pr-16 sm:px-6">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-(--accent)/30 bg-(--accent)/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-(--accent)">
                    <Sparkles className="h-3.5 w-3.5" />
                    Sponsored
                  </span>
                  <span className="rounded-full border border-(--border) bg-(--surface-soft) px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-(--text-muted)">{placementLabels[request.placement]}</span>
                  <span className="ml-auto hidden items-center gap-1.5 text-[11px] font-semibold text-(--text-muted) sm:inline-flex">
                    <ShieldCheck className="h-3.5 w-3.5 text-(--accent)" />
                    {advertisement.unlockHours}h ad-free
                  </span>
                </div>

                {isActive && (
                  <div className="shrink-0 border-b border-(--border) bg-(--surface)/95 px-4 py-3 backdrop-blur-md sm:px-6">
                    <div className="flex items-end justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-(--accent)">{countdownLabel}</p>
                        <p className="mt-1 truncate text-xs text-(--text-muted)">{countdownHint}</p>
                      </div>
                      <div className="flex items-end gap-1 leading-none">
                        {completionState === 'unlocked' ? (
                          <CheckCircle2 className="h-7 w-7 text-emerald-400" />
                        ) : (
                          <>
                            <span className="text-3xl font-bold tabular-nums text-(--text-primary)" role="timer">{remaining}</span>
                            <span className="pb-0.5 text-xs font-semibold text-(--text-muted)">sec</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--surface-soft)">
                      <div className="h-full rounded-full bg-linear-to-r from-(--accent) to-(--accent-strong) transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
                    <div className="relative isolate min-h-44 overflow-hidden bg-linear-to-br from-(--surface-soft) to-(--surface-strong) sm:min-h-56 lg:min-h-full">
                      {advertisement.imageUrl ? (
                        <img src={advertisement.imageUrl} alt={advertisement.title} decoding="async" className="h-44 w-full object-cover object-center sm:h-56 lg:h-full lg:min-h-72" />
                      ) : (
                        <div className="flex h-44 items-center justify-center p-6 text-center sm:h-56 lg:h-full lg:min-h-72">
                          <div>
                            <Sparkles className="mx-auto h-8 w-8 text-(--accent)" />
                            <p className="mt-3 text-xs font-bold uppercase tracking-[0.2em] text-(--accent)">Support SportZoneBD</p>
                            <p className="mt-2 text-sm text-(--text-muted)">Your support keeps live sports coverage available.</p>
                          </div>
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-slate-950/85 via-slate-950/25 to-transparent lg:bg-linear-to-r lg:from-slate-950/75 lg:via-slate-950/15 lg:to-transparent" aria-hidden="true" />
                      <span className="absolute bottom-3 left-3 rounded-full border border-white/15 bg-slate-950/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/85 backdrop-blur">Sponsored partner</span>
                    </div>

                    <div className="flex flex-col gap-4 p-4 sm:p-6">
                      <div>
                        <h2 id="interstitial-ad-title" className="text-xl font-bold leading-tight text-(--text-primary) sm:text-2xl">{advertisement.title}</h2>
                        <p id="interstitial-ad-status" className="mt-2 text-sm leading-6 text-(--text-muted)" aria-live="polite">{statusLine}</p>
                      </div>

                      {advertisement.description && (
                        <p className="rounded-2xl border border-(--border) bg-(--surface-soft)/60 p-3.5 text-sm leading-6 text-(--text-muted)">{advertisement.description}</p>
                      )}

                      <div className="flex items-center gap-3 rounded-2xl border border-(--border) bg-(--surface-soft)/60 p-3.5">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-(--accent)/10 text-(--accent)">
                          <ShieldCheck className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 text-sm">
                          <p className="font-semibold text-(--text-primary)">{advertisement.unlockHours} hours of ad-free access</p>
                          <p className="text-xs text-(--text-muted)">One completed ad view unlocks uninterrupted browsing.</p>
                        </div>
                      </div>

                      {sessionError || earlyExit ? (
                        <div className="rounded-2xl border border-(--danger)/35 bg-(--danger-soft) p-3.5">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-(--danger)" />
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-(--danger)">{earlyExit ? 'Advertisement interrupted' : 'Warning'}</p>
                              <p className="mt-1 font-semibold text-(--danger)">{earlyExit ? 'Advertisement not completed' : 'Could not continue'}</p>
                              <p className="mt-1 text-sm leading-5 text-(--text-muted)">
                                {sessionError ?? 'The ad session was interrupted before the full timer finished. Please reopen the ad and complete the full sponsor view to unlock access.'}
                              </p>
                            </div>
                          </div>
                          {earlyExit && (
                            <Button type="button" className="mt-3 w-full rounded-xl" onClick={onVisit}>
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Re-open ad
                              <ArrowRight className="ml-auto h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ) : null}

                      {completionState === 'idle' && !isSessionStarted ? (
                        <div className="rounded-3xl border border-(--accent)/30 bg-linear-to-br from-(--accent)/12 via-(--surface-soft)/60 to-(--surface) p-4 shadow-[0_18px_50px_rgba(4,116,196,0.12)]">
                          <Button type="button" size="lg" className="w-full rounded-2xl" onClick={onVisit} isLoading={isStarting}>
                            <ExternalLink className="mr-2 h-5 w-5" />
                            Watch ad &amp; unlock access
                          </Button>
                          <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-(--text-muted)">
                            <Timer className="h-3.5 w-3.5 text-(--accent)" />
                            Opens the sponsor in a new tab
                            <span aria-hidden="true">&middot;</span>
                            {advertisement.durationSeconds}s countdown
                          </p>
                        </div>
                      ) : null}

                      {isSessionStarted ? (
                        <div className="flex flex-col gap-3 rounded-3xl border border-(--border) bg-(--surface-soft)/60 p-4">
                          <div className="flex items-center gap-3">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-(--accent)/10 text-(--accent)">
                              <ExternalLink className="h-5 w-5" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-(--text-primary)">Sponsor opened in a new tab</p>
                              <p className="text-xs text-(--text-muted)">{isCompleting ? 'Unlocking access...' : hasVisited ? 'Watch the sponsor page until the countdown ends.' : 'Opening the sponsor page...'}</p>
                            </div>
                          </div>
                          <Button type="button" variant="outline" size="sm" className="w-full rounded-xl" onClick={onReopen}>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Reopen sponsor page
                          </Button>
                        </div>
                      ) : null}

                      {completionState === 'verifying' ? (
                        <div className="rounded-2xl border border-(--accent)/35 bg-(--accent-soft) p-4 text-center">
                          <Loader2 className="mx-auto h-6 w-6 animate-spin text-(--accent)" />
                          <p className="mt-2 font-semibold text-(--text-primary)">Verifying your view...</p>
                        </div>
                      ) : completionState === 'unlocked' ? (
                        <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3.5">
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                          <div className="min-w-0">
                            <p className="font-semibold text-emerald-300">Ad-free access unlocked</p>
                            <p className="text-xs text-(--text-muted)">Continuing to your requested content...</p>
                          </div>
                        </div>
                      ) : null}

                      {socialLinks.length > 0 ? (
                        <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3.5">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-(--text-muted)">Follow the sponsor</p>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {socialLinks.map((link) => <SocialLink key={link.key} href={link.href} label={link.label} icon={link.icon} />)}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-(--border) bg-(--surface-soft)/60 px-4 py-3 sm:px-6">
                  <p className="min-w-0 text-[11px] leading-4 text-(--text-muted)">Sponsored content keeps SportZoneBD free. Thanks for supporting us.</p>
                  <Button type="button" variant="ghost" size="sm" className="shrink-0 rounded-full" onClick={onClose}>{isSessionStarted ? 'Close' : 'Maybe later'}</Button>
                </div>
              </>
            ) : (
              <div className="p-8 text-center">
                <p className="text-(--text-muted)">No active advertisement is configured.</p>
                <Button type="button" className="mt-4" onClick={onClose}>Close</Button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function SocialLink({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-2 rounded-full border border-(--border) bg-(--surface-soft)/60 px-3.5 py-2 text-xs font-semibold text-(--text-muted) transition-all duration-200 hover:-translate-y-px hover:border-(--accent)/50 hover:bg-(--accent)/10 hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) active:scale-[0.98] motion-reduce:hover:translate-y-0">
      <span className="text-(--accent) transition-transform duration-200 group-hover:scale-110 motion-reduce:group-hover:scale-100">{icon}</span>
      {label}
    </a>
  )
}
