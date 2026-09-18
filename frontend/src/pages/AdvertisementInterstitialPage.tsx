import { startTransition, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, ExternalLink, Info, Loader2, ShieldCheck, Timer, X } from 'lucide-react'
import { useAppSelector } from '../app/hooks'
import { selectIsAuthenticated, selectIsPremiumSubscriber } from '../features/auth/authSlice'
import { useCompleteAdUnlockMutation, useGetAdUnlockQuery, useGetInterstitialAdvertisementQuery } from '../features/admin/advertisements.api'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'

const isSafeDestination = (value: string | null): value is string => Boolean(value && value.startsWith('/') && !value.startsWith('//'))

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
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [hasVisitedAdvertisement, setHasVisitedAdvertisement] = useState(false)
  const [showInteractionNotice, setShowInteractionNotice] = useState(true)

  useEffect(() => {
    if (isPremium || (unlock && new Date(unlock.expiresAt).getTime() > Date.now())) {
      navigate(destination, { replace: true })
      return
    }
    if (!advertisement) return
    const end = Date.now() + advertisement.durationSeconds * 1000
    startTransition(() => {
      setCountdownEndsAt(end)
      setRemaining(advertisement.durationSeconds)
      setHasVisitedAdvertisement(false)
      setShowInteractionNotice(true)
    })
  }, [advertisement, destination, isPremium, navigate, unlock])

  useEffect(() => {
    if (!countdownEndsAt) return
    const timer = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1000))
      setRemaining(next)
      if (next === 0) window.clearInterval(timer)
    }, 250)
    return () => window.clearInterval(timer)
  }, [countdownEndsAt])

  const continueToDestination = async () => {
    if (!advertisement || remaining > 0 || !hasVisitedAdvertisement || isCompleting) return
    if (isAuthenticated) await completeUnlock({ advertisementId: advertisement.id }).unwrap()
    navigate(destination, { replace: true })
  }

  const handleViewAdvertisement = () => {
    setHasVisitedAdvertisement(true)
    setShowInteractionNotice(false)
    window.open(advertisement?.link, '_blank', 'noopener,noreferrer')
  }

  if (isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
  if (!advertisement) return <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center p-6"><Card className="w-full p-8 text-center"><p className="text-text-muted">Advertisement unavailable.</p><Button className="mt-4" onClick={() => navigate(destination, { replace: true })}>Continue</Button></Card></div>

  return <main className="app-page relative w-full min-w-0 overflow-hidden px-3 pb-8 sm:px-5 md:px-8"><div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,rgba(4,116,196,0.2),transparent_68%)]" aria-hidden="true" /><motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="relative flex min-h-[70vh] w-full items-center justify-center py-6 sm:py-10"><Card className="w-full max-w-5xl overflow-hidden rounded-3xl border-(--border) bg-(--surface)/95 p-0 shadow-[0_28px_90px_rgba(2,23,45,0.3)]"><div className="flex items-center justify-between gap-4 border-b border-(--border) bg-(--surface-soft)/75 px-4 py-4 sm:px-7 sm:py-5"><div className="min-w-0"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-(--accent)"><ShieldCheck className="h-4 w-4" /> Sponsored content</div><h1 className="mt-2 truncate text-xl font-semibold text-(--text-primary) sm:text-2xl">{advertisement.title}</h1></div><Button variant="ghost" size="icon" onClick={() => navigate(destination, { replace: true })} aria-label="Close advertisement" title="Close advertisement" className="shrink-0 rounded-full border border-transparent hover:border-(--border) hover:bg-(--surface-strong)"><X className="h-5 w-5" /></Button></div><div className="grid gap-6 p-4 sm:p-7 lg:grid-cols-[1.35fr_0.65fr] lg:items-center"><div>{advertisement.imageUrl ? <div className="overflow-hidden rounded-2xl border border-(--border) bg-(--surface-soft) shadow-[0_16px_40px_rgba(2,23,45,0.18)]"><img src={advertisement.imageUrl} alt={advertisement.title} className="aspect-4/1 w-full object-cover" /></div> : <div className="flex min-h-40 items-center justify-center rounded-2xl border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface-strong) p-6 text-center text-sm text-(--text-muted)"><div><ShieldCheck className="mx-auto mb-3 h-8 w-8 text-(--accent)" /><p>Support SportZoneBD by visiting this sponsor.</p></div></div>}<div className="mt-5 flex flex-col gap-3 rounded-2xl border border-(--border) bg-(--surface-soft)/55 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3 text-sm text-(--text-muted)"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-(--accent)/10 text-(--accent)"><Timer className="h-5 w-5" /></span><span>{remaining > 0 ? `Continue available in ${remaining}s` : hasVisitedAdvertisement ? 'Advertisement completed' : 'Visit the advertisement to continue'}</span></div><Button variant="outline" asChild className="shrink-0"><a href={advertisement.link} onClick={() => setHasVisitedAdvertisement(true)} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Visit sponsor</a></Button></div></div><div className="rounded-3xl border border-(--accent)/25 bg-linear-to-br from-(--accent)/10 via-(--surface-soft)/70 to-(--surface) p-5 shadow-[0_18px_50px_rgba(4,116,196,0.12)] sm:p-6"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-(--accent)"><Timer className="h-4 w-4" /> Access status</div><p className="mt-3 text-3xl font-semibold tabular-nums text-(--text-primary)">{remaining > 0 ? `${remaining}s` : 'Ready'}</p><p className="mt-1 text-sm leading-6 text-(--text-muted)">{hasVisitedAdvertisement ? 'The sponsor visit is recorded. Continue when the timer completes.' : 'Visit the sponsor and wait for the timer to complete.'}</p><Button className="mt-5 w-full rounded-xl" onClick={() => void continueToDestination()} disabled={remaining > 0 || !hasVisitedAdvertisement || isCompleting}>{isCompleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}{isAuthenticated ? 'Unlock and continue' : 'Continue to content'}<ArrowRight className="ml-auto h-4 w-4" /></Button><p className="mt-3 text-center text-xs text-(--text-muted)">{isAuthenticated ? `Ad-free access lasts ${advertisement.unlockHours} hours after completion.` : 'Sign in to keep ad-free access across your account.'}</p></div></div></Card></motion.div>{showInteractionNotice && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="ad-interaction-title"><motion.div initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-md rounded-3xl border border-(--accent)/30 bg-(--surface) p-6 text-center shadow-[0_24px_80px_rgba(2,6,23,0.4)]"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-(--accent)/10 text-(--accent)"><Info className="h-6 w-6" /></span><h2 id="ad-interaction-title" className="mt-4 text-xl font-semibold text-(--text-primary)">View this advertisement to continue</h2><p className="mt-2 text-sm leading-6 text-(--text-muted)">The countdown must finish and you must visit the advertisement before ad-free access can be unlocked.</p><Button className="mt-5 w-full rounded-xl" onClick={handleViewAdvertisement}>View advertisement<ArrowRight className="ml-auto h-4 w-4" /></Button></motion.div></div>}</main>
}
