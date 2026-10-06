import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, ExternalLink, Loader2, ShieldCheck, Timer, X } from 'lucide-react'
import { useAppSelector } from '../app/hooks'
import { selectIsAuthenticated, selectIsPremiumSubscriber } from '../features/auth/authSlice'
import { useCompleteAdUnlockMutation, useGetAdUnlockQuery, useGetInterstitialAdvertisementQuery } from '../features/admin/advertisements.api'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import {
  getAdStorage,
  hasDurationElapsed,
  initialAdVisitState,
  isUnlockActive,
  recordAdCompletion,
  recordAdDismissal,
  reduceAdVisit,
  type AdVisitState,
} from '../features/ads/adSession'
import { useAdCountdown } from '../features/ads/useAdCountdown'

const isSafeDestination = (value: string | null): value is string => Boolean(value && value.startsWith('/') && !value.startsWith('//'))
const noop = () => {}

export function AdvertisementInterstitialPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const isPremium = useAppSelector(selectIsPremiumSubscriber)
  const params = new URLSearchParams(location.search)
  const placement = params.get('placement') === 'CHANNEL' ? 'CHANNEL' : params.get('placement') === 'FULL_PAGE' ? 'FULL_PAGE' : 'MATCH'
  const destination = isSafeDestination(params.get('to')) ? params.get('to')! : '/'
  const { data: advertisement, isLoading } = useGetInterstitialAdvertisementQuery(placement, { skip: isPremium })
  const { data: unlock } = useGetAdUnlockQuery(undefined, { skip: !isAuthenticated || isPremium })
  const [completeUnlock, { isLoading: isCompleting }] = useCompleteAdUnlockMutation()
  const [visit, setVisit] = useState<AdVisitState>(initialAdVisitState)
  const [hasVisitedAdvertisement, setHasVisitedAdvertisement] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const visitRef = useRef(visit)
  const advertisementRef = useRef(advertisement)
  const startedAdvertisementIdRef = useRef<string | null>(null)
  const completingRef = useRef(false)
  // Refs are synced in an effect, which always runs before any click handler or timer callback.
  useEffect(() => {
    visitRef.current = visit
    advertisementRef.current = advertisement
  })

  const remaining = useAdCountdown({
    startedAtMs: visit.startedAtMs,
    durationSeconds: visit.durationSeconds,
    active: visit.status === 'active',
    onElapsed: noop,
  })

  useEffect(() => {
    if (isPremium || isUnlockActive(unlock, Date.now())) {
      navigate(destination, { replace: true })
      return
    }
    if (!advertisement) return
    // One visit per advertisement: a refetch of the advertisement or the unlock must never restart the
    // countdown.
    if (startedAdvertisementIdRef.current === advertisement.id) return
    startedAdvertisementIdRef.current = advertisement.id
    const startedAtMs = Date.now()
    startTransition(() => {
      setVisit((current) => reduceAdVisit(current, { type: 'start', sessionId: null, startedAtMs, durationSeconds: advertisement.durationSeconds }))
      setHasVisitedAdvertisement(false)
      setUnlockError(null)
    })
  }, [advertisement, destination, isPremium, navigate, unlock])

  const continueToDestination = useCallback(async () => {
    const current = advertisementRef.current
    const active = visitRef.current
    if (!current || completingRef.current) return
    // 'failed' is a retryable state: the duration already elapsed and the sponsor visit is retained.
    if (active.status !== 'active' && active.status !== 'failed') return
    if (active.startedAtMs === null) return
    if (!hasVisitedAdvertisement) return
    if (!hasDurationElapsed(active.startedAtMs, active.durationSeconds, Date.now())) return

    completingRef.current = true
    setUnlockError(null)
    setVisit((state) => reduceAdVisit(state, { type: 'beginCompletion' }))
    try {
      if (isAuthenticated) await completeUnlock({ advertisementId: current.id }).unwrap()
      recordAdCompletion(getAdStorage(), current.id, Date.now())
      setVisit((state) => reduceAdVisit(state, { type: 'completionSucceeded' }))
      navigate(destination, { replace: true })
    } catch {
      // The visit stays retryable: the elapsed countdown and the recorded sponsor visit are kept, so a
      // retry never restarts the timer or loses the visit.
      completingRef.current = false
      setVisit((state) => reduceAdVisit(state, { type: 'completionFailed', message: 'Unlock failed. Please try again.' }))
      setUnlockError('We could not unlock ad-free access. Please try again.')
    }
  }, [completeUnlock, destination, hasVisitedAdvertisement, isAuthenticated, navigate])

  const leaveAdvertisement = useCallback(() => {
    const current = advertisementRef.current
    if (current && visitRef.current.status !== 'completed') recordAdDismissal(getAdStorage(), current.id, Date.now())
    navigate(destination, { replace: true })
  }, [destination, navigate])

  if (isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-(--accent)" /></div>
  if (!advertisement) return <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center p-6"><Card className="w-full p-8 text-center"><p className="text-(--text-muted)">Advertisement unavailable.</p><Button className="mt-4" onClick={() => navigate(destination, { replace: true })}>Continue</Button></Card></div>

  const durationSeconds = Math.max(1, advertisement.durationSeconds)
  const progress = Math.max(0, Math.min(100, ((durationSeconds - remaining) / durationSeconds) * 100))
  const isReady = remaining === 0 && hasVisitedAdvertisement

  return (
    <main className="app-page relative w-full min-w-0 overflow-hidden px-3 pb-8 sm:px-5 md:px-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,rgba(4,116,196,0.2),transparent_68%)]" aria-hidden="true" />
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="relative flex min-h-[70vh] w-full items-center justify-center py-6 sm:py-10">
        <Card className="w-full max-w-5xl overflow-hidden rounded-3xl border-(--border) bg-(--surface)/95 p-0 shadow-[0_28px_90px_rgba(2,23,45,0.3)]">
          <div className="flex items-center justify-between gap-4 border-b border-(--border) bg-(--surface-soft)/75 px-4 py-4 sm:px-7 sm:py-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-(--accent)">
                <ShieldCheck className="h-4 w-4" />
                Sponsored content
              </div>
              <h1 className="mt-2 truncate text-xl font-semibold text-(--text-primary) sm:text-2xl">{advertisement.title}</h1>
            </div>
            <Button variant="ghost" size="icon" onClick={leaveAdvertisement} aria-label="Close advertisement" title="Close advertisement" className="shrink-0 rounded-full border border-transparent hover:border-(--border) hover:bg-(--surface-strong)">
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="h-1 w-full overflow-hidden bg-(--surface-soft)">
            <div className="h-full rounded-r-full bg-linear-to-r from-(--accent) to-(--accent-strong) transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${progress}%` }} />
          </div>

          <div className="grid gap-6 p-4 sm:p-7 lg:grid-cols-[1.35fr_0.65fr] lg:items-start">
            <div className="flex min-w-0 flex-col gap-4">
              {advertisement.imageUrl ? (
                <div className="overflow-hidden rounded-2xl border border-(--border) bg-(--surface-soft) shadow-[0_16px_40px_rgba(2,23,45,0.18)]">
                  <img src={advertisement.imageUrl} alt={advertisement.title} decoding="async" className="aspect-video w-full object-cover" />
                </div>
              ) : (
                <div className="flex min-h-40 items-center justify-center rounded-2xl border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface-strong) p-6 text-center text-sm text-(--text-muted)">
                  <div>
                    <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-(--accent)" />
                    <p>Support SportZoneBD by visiting this sponsor.</p>
                  </div>
                </div>
              )}

              {advertisement.description && (
                <p className="rounded-2xl border border-(--border) bg-(--surface-soft)/60 p-4 text-sm leading-6 text-(--text-muted)">{advertisement.description}</p>
              )}

              <div className="flex flex-col gap-3 rounded-2xl border border-(--border) bg-(--surface-soft)/55 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 text-sm text-(--text-muted)">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-(--accent)/10 text-(--accent)">
                    <Timer className="h-5 w-5" />
                  </span>
                  <span>{remaining > 0 ? `Continue available in ${remaining}s` : hasVisitedAdvertisement ? 'Advertisement completed' : 'Visit the advertisement to continue'}</span>
                </div>
                <Button variant="outline" asChild className="shrink-0">
                  <a href={advertisement.link} onClick={() => setHasVisitedAdvertisement(true)} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Visit sponsor
                  </a>
                </Button>
              </div>
            </div>

            <div className="rounded-3xl border border-(--accent)/25 bg-linear-to-br from-(--accent)/10 via-(--surface-soft)/70 to-(--surface) p-5 shadow-[0_18px_50px_rgba(4,116,196,0.12)] sm:p-6">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-(--accent)">
                <Timer className="h-4 w-4" />
                Access status
              </div>
              <p className="mt-3 flex items-end gap-1 text-3xl font-semibold tabular-nums text-(--text-primary)">
                {remaining > 0 ? (
                  <>
                    <span role="timer">{remaining}</span>
                    <span className="pb-1 text-sm font-semibold text-(--text-muted)">sec</span>
                  </>
                ) : isReady ? (
                  'Ready'
                ) : (
                  'Waiting'
                )}
              </p>
              <p className="mt-1 text-sm leading-6 text-(--text-muted)">
                {hasVisitedAdvertisement ? 'The sponsor visit is recorded. Continue when the timer completes.' : 'Visit the sponsor and wait for the timer to complete.'}
              </p>
              <Button className="mt-5 w-full rounded-xl" onClick={() => void continueToDestination()} disabled={remaining > 0 || !hasVisitedAdvertisement || isCompleting}>
                {isCompleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : isReady ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                {isAuthenticated ? 'Unlock and continue' : 'Continue to content'}
                <ArrowRight className="ml-auto h-4 w-4" />
              </Button>
              {unlockError ? <p role="alert" className="mt-3 text-center text-xs font-semibold text-(--danger)">{unlockError}</p> : null}
              <p className="mt-3 text-center text-xs text-(--text-muted)">
                {isAuthenticated ? `Ad-free access lasts ${advertisement.unlockHours} hours after completion.` : 'Sign in to keep ad-free access across your account.'}
              </p>
            </div>
          </div>
        </Card>
      </motion.div>
    </main>
  )
}
