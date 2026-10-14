import { startTransition, useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, Crown, Check, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { PageHero } from '@/components/shared/PageHero'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { useAppSelector } from '@/app/hooks'
import { selectIsAuthenticated } from '@/features/auth/authSlice'
import { useGetSubscriptionPlansQuery } from '@/features/payments/payment.api'
import { Skeleton } from '@/components/ui/Skeleton'
import type { SubscriptionPlan } from '@/features/admin/subscriptionPlans.api'
import { useGetMeQuery } from '@/features/auth/auth.api'

function formatRemaining(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`
}

const premiumBenefits = [
  'Premium live streaming access',
  'Ad-free live streaming',
  'Premium live match access',
  'High-quality streaming where available',
  'Watch Premium on multiple devices',
  'Match reminders and notifications',
  'Secure Premium account access',
]

function getPrimaryPlans(plans: SubscriptionPlan[]) {
  const normalized = (plan: SubscriptionPlan) => plan.name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const findPlan = (kind: 'weekly' | 'biweekly' | 'monthly', durationDays: number) => plans.find((plan) => {
    const name = normalized(plan)
    if (kind === 'weekly') return (name.includes('weekly') && !name.includes('bi')) || plan.durationDays === durationDays
    if (kind === 'biweekly') return name.includes('biweekly') || name.includes('fortnight') || plan.durationDays === durationDays
    return name.includes('monthly') || plan.durationDays === durationDays
  })

  return [findPlan('weekly', 7), findPlan('biweekly', 14), findPlan('monthly', 30)]
    .filter((plan): plan is SubscriptionPlan => Boolean(plan))
}

export function SubscriptionsPage() {
  const navigate = useNavigate()
  const shouldReduceMotion = useReducedMotion()
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const { data: plans = [], isLoading: isLoadingPlans, isError } = useGetSubscriptionPlansQuery()
  const [expandedPlanIds, setExpandedPlanIds] = useState<Set<string>>(new Set())
  const { data: user, refetch: refetchUser } = useGetMeQuery(undefined, { skip: !isAuthenticated })
  const [now, setNow] = useState(() => Date.now())
  const activeSubscription = user?.subscription && user.subscription.status === 'ACTIVE' && new Date(user.subscription.expiresAt).getTime() > now ? user.subscription : null
  const remainingSeconds = activeSubscription ? Math.max(0, Math.floor((new Date(activeSubscription.expiresAt).getTime() - now) / 1000)) : 0

  useEffect(() => {
    if (!activeSubscription) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [activeSubscription])

  useEffect(() => {
    if (!activeSubscription) return
    const returnPath = sessionStorage.getItem('premium-return-path')
    if (!returnPath || !returnPath.startsWith('/') || returnPath.startsWith('//')) return
    sessionStorage.removeItem('premium-return-path')
    navigate(returnPath, { replace: true })
  }, [activeSubscription, navigate])

  useEffect(() => {
    if (user?.subscription && remainingSeconds === 0) void refetchUser()
  }, [remainingSeconds, refetchUser, user?.subscription])

  const recommendedPlanId: string | null = null
  const primaryPlans = getPrimaryPlans(plans)

  const togglePlanBenefits = (planId: string) => {
    setExpandedPlanIds((current) => {
      const next = new Set(current)
      if (next.has(planId)) next.delete(planId)
      else next.add(planId)
      return next
    })
  }

  useEffect(() => {
    const postAuthAction = sessionStorage.getItem('post-auth-action')
    if (isAuthenticated && postAuthAction) {
      const { action, planId } = JSON.parse(postAuthAction)
      if (action === 'subscribe' && planId) {
        const planToPurchase = plans.find((p) => p.id === planId)
        if (planToPurchase) {
          sessionStorage.removeItem('post-auth-action')
          startTransition(() => navigate(`/checkout?plan=${planToPurchase.id}`, { replace: true }))
        }
      }
    }
  }, [isAuthenticated, plans, navigate])

  const handleChoosePlan = (tier: SubscriptionPlan) => {
    if (!isAuthenticated) {
      // Store the intended action and redirect to login
      sessionStorage.setItem('post-auth-action', JSON.stringify({ action: 'subscribe', planId: tier.id }))
      toast.info('Please log in or create an account to subscribe.')
      navigate('/login?redirect=/subscriptions')
      return
    }

    // The payment page owns the wallet choice, the receiving number and the verification state.
    navigate(`/checkout?plan=${tier.id}`)
  }

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.5 }}
      className="app-page w-full min-w-0 space-y-5 sm:space-y-6"
    >
      <PageHero
        title="Unlock Premium Access"
        description="Choose a plan that suits you and enjoy uninterrupted access to all live matches, highlights, and exclusive content."
        eyebrow="Subscription Plans"
        icon={Crown}
      />
      {isError && (
        <div className="rounded-2xl border border-(--danger)/30 bg-(--danger-soft) p-4 text-center text-(--danger)">
          Could not load subscription plans. Please try again later.
        </div>
      )}

      {activeSubscription && (
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: shouldReduceMotion ? 0 : 0.1, duration: shouldReduceMotion ? 0 : 0.5 }}
          className="w-full"
        >
          <Card className="mx-auto w-full max-w-4xl border-accent/50 bg-linear-to-br from-accent/12 via-(--surface) to-(--surface-soft) shadow-[0_18px_55px_rgba(4,116,196,0.12)]" aria-label="Premium membership active">
            <CardContent className="space-y-4 p-4 sm:p-8">
              <div className="flex flex-wrap items-center gap-3 text-accent">
                <Crown className="h-6 w-6 shrink-0" aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-[0.16em] sm:text-sm sm:tracking-[0.2em]">Premium Membership</span>
              </div>
              <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="min-w-0">
                  <h2 className="wrap-break-word text-2xl font-bold text-text-primary sm:text-3xl">{activeSubscription.plan.name} Plan</h2>
                  <p className="mt-1 text-sm text-text-muted">{activeSubscription.plan.price} BDT / {activeSubscription.plan.durationDays} days</p>
                </div>
                <div className="min-w-0 sm:text-right">
                  <p className="text-sm font-semibold text-emerald-400">Premium Active</p>
                  <p className="mt-1 wrap-break-word font-mono text-lg tabular-nums text-text-primary motion-safe:animate-pulse sm:text-xl">{formatRemaining(remainingSeconds)} remaining</p>
                  <p className="mt-1 wrap-break-word text-xs text-text-muted sm:text-sm">Expires {new Date(activeSubscription.expiresAt).toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: shouldReduceMotion ? 0 : activeSubscription ? 0.15 : 0.1, duration: shouldReduceMotion ? 0 : 0.5 }}
        className="mx-auto grid w-full min-w-0 max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 lg:gap-6"
      >
        {isLoadingPlans &&
          Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="flex min-w-0 flex-col">
              <CardHeader className="p-4 sm:p-6">
                <Skeleton className="h-8 w-1/2" />
                <Skeleton className="h-10 w-1/3 pt-2" />
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between p-4 pt-0 sm:p-6 sm:pt-0">
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, featureIndex) => (
                    <Skeleton key={featureIndex} className="h-5 w-full" />
                  ))}
                </div>
                <Skeleton className="mt-8 h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        {!isLoadingPlans && primaryPlans.map((plan, index) => {
          const isCurrentPlan = activeSubscription?.plan.id === plan.id
          // With no current plan, the middle card is the visual focal point only; it carries no badge and no
          // recommendation claim, it just produces the center-focused composition.
          const isFocalDefault = !activeSubscription && primaryPlans.length > 1 && index === Math.floor(primaryPlans.length / 2)
          const isProminent = isCurrentPlan || isFocalDefault
          const siblingRecedes = !isProminent

          return (
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.28, delay: shouldReduceMotion ? 0 : index * 0.06, ease: 'easeOut' }}
            className={cn('relative h-full min-w-0', isProminent ? 'z-10' : 'z-0')}
          >
          <Card
            className={cn(
              'relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-linear-to-br from-(--surface-soft) to-(--surface) shadow-[0_20px_60px_var(--shadow)] transition-[transform,box-shadow,opacity,border-color] duration-300 ease-out will-change-transform',
              'md:motion-safe:hover:-translate-y-1.5 md:motion-safe:hover:scale-[1.02] motion-safe:focus-within:-translate-y-1 md:motion-safe:focus-within:scale-[1.02]',
              isProminent
                ? 'border-accent/50 ring-2 ring-accent shadow-[0_30px_90px_-30px_rgba(247,199,93,0.55)] md:motion-safe:scale-[1.04]'
                : siblingRecedes
                  ? 'border-(--border) md:motion-safe:scale-[0.97] md:opacity-90'
                  : cn('border-(--border)', plan.id === recommendedPlanId && 'border-accent/50 ring-2 ring-accent'),
            )}
          >
            <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 transition-opacity duration-700', isProminent ? 'opacity-100' : 'opacity-0')}>
              <div className="pricing-card-glow absolute -inset-1/3 rounded-full bg-[radial-gradient(circle_at_50%_25%,rgba(247,199,93,0.30),rgba(4,116,196,0.18)_45%,transparent_72%)]" />
            </div>
            {isCurrentPlan && (
              <div className="relative z-10 mx-4 mt-4 inline-flex w-fit max-w-[calc(100%-2rem)] items-center gap-1.5 rounded-full border border-accent/40 bg-accent/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-accent backdrop-blur-sm sm:mx-6 sm:mt-6">
                <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                Current plan
              </div>
            )}
            <Smartphone className="pointer-events-none absolute -right-5 -top-5 h-28 w-28 text-(--accent)/5" aria-hidden="true" />
            <CardHeader className={cn('relative min-w-0 p-4 sm:min-h-44 sm:p-6', isCurrentPlan && 'pt-3 sm:pt-4')}>
              {plan.id === recommendedPlanId && (
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                  Recommended
                </div>
              )}
              <CardTitle className="wrap-break-word text-xl sm:text-2xl">{plan.name}</CardTitle>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-2">
                <span className="text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">{plan.price}</span>
                <span className="text-base font-semibold text-text-muted sm:text-lg">BDT</span>
                <span className="text-xs text-text-muted sm:text-sm">/ {plan.durationDays} days</span>
              </div>
              <p className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-sm text-text-muted"><Smartphone className="h-4 w-4 shrink-0 text-(--accent)" /><span>Up to {plan.maxDevices} devices</span></p>
              <p className="mt-3 text-sm leading-5 text-text-muted sm:line-clamp-2 sm:min-h-10">{plan.description || `${plan.durationDays} days of premium access.`}</p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col p-4 pt-0 sm:p-6 sm:pt-0">
              <div className="mb-4 border-t border-(--border) pt-4 text-xs font-semibold uppercase tracking-[0.18em] text-(--text-muted)">Premium benefits</div>
              <ul id={`benefits-${plan.id}`} className="space-y-3 text-sm text-text-muted">
                {premiumBenefits.slice(0, 3).map((benefit) => (
                  <li key={benefit} className="flex items-start gap-3"><Check className="mt-0.5 h-5 w-5 shrink-0 text-green-500" /><span>{benefit}</span></li>
                ))}
                <AnimatePresence initial={false}>
                  {expandedPlanIds.has(plan.id) && premiumBenefits.slice(3).map((benefit) => (
                    <motion.li
                      key={benefit}
                      initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={shouldReduceMotion ? undefined : { opacity: 0, height: 0 }}
                      transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: 'easeOut' }}
                      className="flex items-start gap-3 overflow-hidden"
                    >
                      <Check className="mt-0.5 h-5 w-5 shrink-0 text-green-500" /><span>{benefit}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
              {premiumBenefits.length > 3 && (
                <button
                  type="button"
                  className="mt-4 inline-flex min-h-10 items-center gap-1.5 self-start rounded-md px-1 text-sm font-semibold text-[#0474C4] transition hover:text-[#1689d4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0474C4]/60"
                  aria-expanded={expandedPlanIds.has(plan.id)}
                  aria-controls={`benefits-${plan.id}`}
                  onClick={() => togglePlanBenefits(plan.id)}
                >
                  {expandedPlanIds.has(plan.id) ? 'Show Less' : 'Show More'}
                  {expandedPlanIds.has(plan.id) ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                </button>
              )}
              <Button
                variant={plan.id === recommendedPlanId ? 'default' : 'outline'}
                className="mt-auto h-11 w-full"
                onClick={() => handleChoosePlan(plan)}
                isLoading={false}
                disabled={activeSubscription?.plan.id === plan.id}
              >
                {activeSubscription?.plan.id === plan.id ? 'Current Plan' : 'Choose Plan'}
              </Button>
            </CardContent>
          </Card>
          </motion.div>
          )
        })}
      </motion.div>
    </motion.div>
  )
}