import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowDown, ArrowRight, ExternalLink, Globe2, Loader2, Sparkles, Timer, X } from 'lucide-react'
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
interface AdvertisementRequest { placement: AdvertisementPlacement; destination: string; onComplete?: () => void }
interface AdvertisementGateContextValue { openAdvertisement: (placement: AdvertisementPlacement, destination: string, onComplete?: () => void) => void }
const AdvertisementGateContext = createContext<AdvertisementGateContextValue | null>(null)
const isSafeDestination = (value: string): boolean => value.startsWith('/') && !value.startsWith('//')

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
      onComplete ? onComplete() : navigate(destination)
      return
    }
    const hasUnlock = Boolean(unlock && new Date(unlock.expiresAt).getTime() > Date.now())
    if (isPremium || hasUnlock || (!isAdvertisementLoading && !isUnlockLoading && !advertisement)) {
      onComplete ? onComplete() : navigate(destination)
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
  const sessionStartedAtRef = useRef<number | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const requiredDurationMsRef = useRef(0)
  const hasLeftSiteRef = useRef(false)
  const sponsorOpenedAtRef = useRef<number | null>(null)
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

  const completeCurrentSession = useCallback(async () => {
    const activeSessionId = sessionIdRef.current

    if (!activeSessionId || completionRequestedRef.current) return

    completionRequestedRef.current = true
    setCompletionState('verifying')

    try {
      await completeViewSession(activeSessionId).unwrap()
      clearCountdownTimer()
      setCountdownEndsAt(null)
      setRemaining(0)
      setIsSessionStarted(false)
      setSessionId(null)
      sessionIdRef.current = null
      sessionStartedAtRef.current = null
      requiredDurationMsRef.current = 0
      sponsorOpenedAtRef.current = null
      setCompletionState('unlocked')

      if (!request) return

      window.setTimeout(() => {
        if (request.onComplete) request.onComplete()
        else navigate(request.destination, { replace: true })
        setRequest(null)
      }, 700)
    } catch {
      completionRequestedRef.current = false
      setCompletionState('idle')
      setSessionError('We could not verify that the advertisement was completed. Please try again.')
      setRemaining(1)
    }
  }, [clearCountdownTimer, completeViewSession, navigate, request])

  const openAdvertisement = useCallback((placement: AdvertisementPlacement, destination: string, onComplete?: () => void) => {
    if (!isSafeDestination(destination)) return
    setRequest({ placement, destination, onComplete })
    setHasVisited(false)
    setSessionId(null)
    sessionIdRef.current = null
    setIsSessionStarted(false)
    clearCountdownTimer()
    setCountdownEndsAt(null)
    setRemaining(0)
    setCompletionState('idle')
    setEarlyExit(false)
    setSessionError(null)
    sessionStartedAtRef.current = null
    requiredDurationMsRef.current = 0
    hasLeftSiteRef.current = false
    sponsorOpenedAtRef.current = null
    completionRequestedRef.current = false
  }, [clearCountdownTimer])

  useEffect(() => {
    if (isPremium || request || !fullPageAdvertisement) return
    if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/login') || location.pathname === '/advertisements/interstitial') return
    const seenKey = `sportzone-full-page-ad:${fullPageAdvertisement.id}`
    if (sessionStorage.getItem(seenKey) === 'completed') return
    const destination = `${location.pathname}${location.search}`
    openAdvertisement('FULL_PAGE', destination, () => sessionStorage.setItem(seenKey, 'completed'))
  }, [fullPageAdvertisement, isPremium, location.pathname, location.search, openAdvertisement, request])

  useEffect(() => {
    if (!request || !advertisement) return
    void trackEvent({ type: 'ADVERTISEMENT_IMPRESSION', entityId: advertisement.id })
    if (unlock && new Date(unlock.expiresAt).getTime() > Date.now()) {
      if (request.onComplete) request.onComplete()
      else navigate(request.destination, { replace: true })
      queueMicrotask(() => setRequest(null))
    }
  }, [advertisement, navigate, request, trackEvent, unlock])

  useEffect(() => {
    if (!countdownEndsAt) return

    const timer = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1000))
      setRemaining(next)

      if (next === 0) {
        window.clearInterval(timer)
        countdownTimerRef.current = null
        void completeCurrentSession()
      }
    }, 250)

    countdownTimerRef.current = timer

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
  }, [cancelViewSession, clearCountdownTimer, completeViewSession, isSessionStarted, navigate, request])

  const handleVisit = useCallback(async () => {
    if (!advertisement || isStarting || isSessionStarted) return
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
      setSessionError('Unable to start the advertisement session. Please try again.')
    }
  }, [advertisement, isSessionStarted, isStarting, startViewSession, trackEvent])

  const handleClose = useCallback(() => {
    clearCountdownTimer()
    if (sessionId && isSessionStarted) void cancelViewSession(sessionId)
    sessionIdRef.current = null
    completionRequestedRef.current = false
    hasLeftSiteRef.current = false
    sessionStartedAtRef.current = null
    requiredDurationMsRef.current = 0
    sponsorOpenedAtRef.current = null
    setSessionError(null)
    setRequest(null)
  }, [cancelViewSession, clearCountdownTimer, isSessionStarted, sessionId])

  return (
    <AdvertisementGateContext.Provider value={{ openAdvertisement }}>
      {children}
      <AdvertisementModal
        request={request}
        advertisement={advertisement}
        isLoading={isLoading || isStarting}
        remaining={remaining}
        hasVisited={hasVisited}
        isCompleting={isCompleting}
        isSessionStarted={isSessionStarted}
        completionState={completionState}
        earlyExit={earlyExit}
        sessionError={sessionError}
        onVisit={() => void handleVisit()}
        onClose={handleClose}
      />
    </AdvertisementGateContext.Provider>
  )
}

  function AdvertisementModal({ request, advertisement, isLoading, remaining, hasVisited, isCompleting, isSessionStarted, completionState, earlyExit, sessionError, onVisit, onClose }: { request: AdvertisementRequest | null; advertisement?: Advertisement | null; isLoading: boolean; remaining: number; hasVisited: boolean; isCompleting: boolean; isSessionStarted: boolean; completionState: 'idle' | 'verifying' | 'unlocked'; earlyExit: boolean; sessionError: string | null; onVisit: () => void; onClose: () => void }) {
  const progress = advertisement ? Math.max(0, Math.min(100, ((advertisement.durationSeconds - remaining) / Math.max(1, advertisement.durationSeconds)) * 100)) : 0

  return (
    <AnimatePresence>
      {request && (
        <motion.div className="fixed inset-0 z-70 flex items-center justify-center overflow-hidden bg-slate-950/70 px-3 py-4 backdrop-blur-sm sm:px-6" role="dialog" aria-modal="true" aria-labelledby="interstitial-ad-title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-[28px] border border-white/10 bg-(--surface)/95 text-(--text-primary) shadow-[0_30px_100px_rgba(2,23,45,0.45)]" initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
            <button type="button" onClick={onClose} className="absolute right-3 top-3 z-30 grid h-9 w-9 place-items-center rounded-full border border-(--border) bg-(--surface-soft) text-(--text-muted) transition-colors hover:bg-(--surface-strong) hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)" aria-label="Close advertisement" title="Close advertisement">
              <X className="h-4 w-4" />
            </button>

            {isLoading ? (
              <div className="flex min-h-80 items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-(--accent)" />
                  <p className="text-sm text-(--text-muted)">Loading advertisement...</p>
                </div>
              </div>
            ) : advertisement ? (
              <>
                {isSessionStarted && (
                  <div className="sticky top-0 z-20 border-b border-(--border) bg-(--surface)/95 px-4 py-3 shadow-sm backdrop-blur-md sm:px-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-(--accent)">Sponsored access</p>
                        <p className="truncate text-xs text-(--text-muted)">{remaining > 0 ? `Your access unlocks in ${remaining}s` : 'Finalizing access...'}</p>
                      </div>
                      <p className="text-2xl font-bold tabular-nums text-(--text-primary)" aria-live="polite">{remaining}</p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--surface-soft)">
                      <motion.div className="h-full rounded-full bg-(--accent)" initial={{ width: '0%' }} animate={{ width: `${progress}%` }} transition={{ duration: 0.25 }} />
                    </div>
                  </div>
                )}

                <div className="border-b border-(--border) bg-linear-to-br from-(--accent)/15 via-(--surface-soft)/80 to-(--surface) px-4 py-4 sm:px-5 sm:py-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-(--accent)/30 bg-(--accent)/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-(--accent)">
                      <Sparkles className="h-3.5 w-3.5" />
                      Sponsored
                    </div>
                    <span className="rounded-full border border-(--border) bg-(--surface-soft) px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-(--text-muted)">
                      {request?.placement === 'FULL_PAGE' ? 'Full page ad' : request?.placement === 'MATCH' ? 'Match ad' : request?.placement === 'CHANNEL' ? 'Channel ad' : 'App ad'}
                    </span>
                  </div>
                  <h2 id="interstitial-ad-title" className="mt-3 pr-10 text-xl font-bold leading-tight text-(--text-primary)">{advertisement.title}</h2>
                  <p className="mt-2 text-sm leading-5 text-(--text-muted)">
                    {completionState === 'verifying'
                      ? 'Verifying advertisement...'
                      : completionState === 'unlocked'
                        ? 'Access unlocked successfully.'
                        : isSessionStarted
                          ? 'Keep this page open until the timer finishes.'
                          : 'Open the sponsor link to start the ad session.'}
                  </p>
                </div>

                <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
                  {sessionError || earlyExit ? (
                    <div className="rounded-2xl border border-(--danger)/35 bg-(--danger-soft) p-3.5">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-(--danger)" />
                        <div className="min-w-0 flex-1">
                          <p className="font-bold uppercase tracking-[0.16em] text-(--danger)">{earlyExit ? 'Advertisement interrupted' : 'Warning'}</p>
                          <p className="mt-1 font-semibold text-(--danger)">{earlyExit ? 'Advertisement not completed' : 'Could not continue'}</p>
                          <p className="mt-1 text-sm leading-5 text-(--text-muted)">
                            {sessionError ?? 'The ad session was interrupted before the full timer finished. Please reopen the ad and complete the full sponsor view to unlock access.'}
                          </p>
                          {earlyExit && (
                            <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-(--danger)"><Loader2 className="h-4 w-4 animate-spin" />Waiting for a completed ad session.</p>
                          )}
                        </div>
                      </div>
                      {earlyExit && (
                        <Button type="button" className="mt-3 w-full" onClick={onVisit}>
                          <ExternalLink className="mr-2 h-4 w-4" />Re-open Ads<ArrowRight className="ml-auto h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ) : null}
                  {advertisement.imageUrl ? (
                    <div className="w-full overflow-hidden rounded-2xl border border-(--border) bg-(--surface-soft)">
                      <img src={advertisement.imageUrl} alt={advertisement.title} className="block aspect-video w-full object-cover object-center" />
                    </div>
                  ) : (
                    <div className="flex min-h-32 items-center justify-center rounded-2xl border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface-strong) p-6 text-center">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.2em] text-(--accent)">Support SportZoneBD</p>
                        <p className="mt-2 text-sm text-(--text-muted)">Your support keeps live sports coverage available.</p>
                      </div>
                    </div>
                  )}

                  {advertisement.description && (
                    <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/60 p-3.5 text-sm leading-6 text-(--text-muted)">
                      <p className="text-base font-bold leading-6 text-(--text-primary)">{advertisement.description.split(/[.!?]\s+/)[0]}</p>
                      {advertisement.description.split(/[.!?]\s+/).slice(1).join('. ').trim() && (
                        <p className="mt-2">{advertisement.description.split(/[.!?]\s+/).slice(1).join('. ').trim()}</p>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-center gap-3 rounded-2xl border border-(--accent)/35 bg-linear-to-br from-(--accent)/12 to-(--surface-soft) p-4 text-center shadow-[0_12px_30px_rgba(4,116,196,0.1)]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-(--accent)/35 bg-(--accent)/10">
                      <Timer className="h-5 w-5 text-(--accent)" />
                    </div>
                    <div className="text-left">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-(--accent)">Live countdown</p>
                      <p className="mt-1 text-3xl font-bold tabular-nums text-(--text-primary)">{isSessionStarted ? remaining : '—'}</p>
                      <p className="text-xs text-(--text-muted)">{isSessionStarted ? 'seconds remaining' : 'ready to start'}</p>
                    </div>
                  </div>

                  {completionState === 'verifying' ? (
                    <div className="rounded-2xl border border-(--accent)/35 bg-(--accent-soft) p-4 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-(--accent)" />
                      <p className="mt-2 font-semibold text-(--text-primary)">Verifying advertisement...</p>
                    </div>
                  ) : completionState === 'unlocked' ? (
                    <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3.5 text-center">
                      <p className="font-semibold text-emerald-300">Ad-Free Access Unlocked</p>
                      <p className="mt-1 text-xs text-(--text-muted)">Continuing to your requested content...</p>
                    </div>
                  ) : !isSessionStarted ? (
                    <div className="relative mt-1 pt-5">
                      <ArrowDown className="absolute left-1/2 top-0 h-5 w-5 -translate-x-1/2 animate-bounce text-(--accent)" aria-hidden="true" />
                      <Button type="button" className="w-full" onClick={onVisit}>
                        <ExternalLink className="mr-2 h-4 w-4" />Watch Ad Now<ArrowRight className="ml-auto h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}

                  {advertisement.facebookUrl || advertisement.youtubeUrl || advertisement.telegramUrl || advertisement.instagramUrl || advertisement.websiteUrl ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      {advertisement.facebookUrl && <SocialLink href={advertisement.facebookUrl} label="Facebook" icon={<ExternalLink className="h-4 w-4" />} />}
                      {advertisement.youtubeUrl && <SocialLink href={advertisement.youtubeUrl} label="YouTube" icon={<ExternalLink className="h-4 w-4" />} />}
                      {advertisement.telegramUrl && <SocialLink href={advertisement.telegramUrl} label="Telegram" icon={<ExternalLink className="h-4 w-4" />} />}
                      {advertisement.instagramUrl && <SocialLink href={advertisement.instagramUrl} label="Instagram" icon={<ExternalLink className="h-4 w-4" />} />}
                      {advertisement.websiteUrl && <SocialLink href={advertisement.websiteUrl} label="Website" icon={<Globe2 className="h-4 w-4" />} />}
                    </div>
                  ) : null}

                  {isSessionStarted && (
                    <p className="text-center text-sm text-(--text-muted)">
                      {isCompleting ? 'Unlocking access...' : hasVisited && remaining > 0 ? 'Sponsor opened in a new tab.' : 'Finishing advertisement session...'}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="p-8 text-center">
                <p className="text-(--text-muted)">No active advertisement is configured.</p>
                <Button className="mt-4" onClick={onClose}>Close</Button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function SocialLink({ href, label, icon }: { href: string; label: string; icon: ReactNode }) { return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-text-muted transition hover:border-accent/50 hover:text-text-primary">{icon}{label}</a> }
