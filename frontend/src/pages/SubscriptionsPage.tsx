import { startTransition, useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, Crown, Check, Copy, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { PageHero } from '@/components/shared/PageHero'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { useAppSelector } from '@/app/hooks'
import { selectIsAuthenticated } from '@/features/auth/authSlice'
import { useGetManualPaymentConfigQuery, useGetSubscriptionPlansQuery, useSubmitManualPaymentMutation } from '@/features/payments/payment.api'
import { getErrorMessage } from '@/utils/get-error-message'
import { Skeleton } from '@/components/ui/Skeleton'
import type { SubscriptionPlan } from '@/features/admin/subscriptionPlans.api'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
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
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null)
  const [expandedPlanIds, setExpandedPlanIds] = useState<Set<string>>(new Set())
  const [isPaymentStepOpen, setIsPaymentStepOpen] = useState(false)
  const [transactionId, setTransactionId] = useState('')
  const { data: manualConfig } = useGetManualPaymentConfigQuery(undefined, { skip: !isAuthenticated })
  const { data: user, refetch: refetchUser } = useGetMeQuery(undefined, { skip: !isAuthenticated })
  const [submitManualPayment, { isLoading: isSubmitting }] = useSubmitManualPaymentMutation()
  const [now, setNow] = useState(() => Date.now())
  const activeSubscription = user?.subscription && user.subscription.status === 'ACTIVE' && new Date(user.subscription.expiresAt).getTime() > now ? user.subscription : null
  const remainingSeconds = activeSubscription ? Math.max(0, Math.floor((new Date(activeSubscription.expiresAt).getTime() - now) / 1000)) : 0

  useEffect(() => {
    if (!activeSubscription) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [activeSubscription?.expiresAt])

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
          startTransition(() => setSelectedPlan(planToPurchase))
        }
      }
    }
  }, [isAuthenticated, plans])

  const handleChoosePlan = async (tier: SubscriptionPlan) => {
    if (!isAuthenticated) {
      // Store the intended action and redirect to login
      sessionStorage.setItem('post-auth-action', JSON.stringify({ action: 'subscribe', planId: tier.id }))
      toast.info('Please log in or create an account to subscribe.')
      navigate('/login?redirect=/subscriptions')
      return
    }

    setTransactionId('')
    setSelectedPlan(tier)
    setIsPaymentStepOpen(!activeSubscription)
  }

  const handleSubmit = async () => {
    if (!selectedPlan || !transactionId.trim()) return
    try {
      await submitManualPayment({ subscriptionPlanId: selectedPlan.id, transactionId: transactionId.trim() }).unwrap()
      toast.success('Payment submitted for admin review.')
      setSelectedPlan(null)
      setIsPaymentStepOpen(false)
      setTransactionId('')
    } catch (error) {
      toast.error(`Payment submission failed: ${getErrorMessage(error)}`)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="app-page space-y-3">
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
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <Card className="mx-auto max-w-4xl border-accent/60 bg-accent/10 shadow-[0_0_35px_rgba(247,199,93,0.18)]" aria-label="Premium membership active">
          <CardContent className="space-y-4 p-6 sm:p-8">
            <div className="flex items-center gap-3 text-accent"><Crown className="h-6 w-6" /><span className="text-sm font-bold uppercase tracking-[0.2em]">Premium Membership</span></div>
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div><h2 className="text-3xl font-bold text-text-primary">{activeSubscription.plan.name} Plan</h2><p className="mt-1 text-text-muted">{activeSubscription.plan.price} BDT / {activeSubscription.plan.durationDays} days</p></div>
              <div className="text-left sm:text-right"><p className="text-sm font-semibold text-emerald-400">Premium Active</p><p className="mt-1 font-mono text-xl text-text-primary motion-safe:animate-pulse">{formatRemaining(remainingSeconds)} remaining</p><p className="mt-1 text-sm text-text-muted">Expires {new Date(activeSubscription.expiresAt).toLocaleString()}</p></div>
            </div>
          </CardContent>
        </Card>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: activeSubscription ? 0.15 : 0.1, duration: 0.5 }} className="mx-auto grid max-w-6xl grid-cols-1 gap-6 md:grid-cols-3">
        {isLoadingPlans &&
          Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="flex flex-col">
              <CardHeader className="p-6">
                <Skeleton className="h-8 w-1/2" />
                <Skeleton className="h-10 w-1/3 pt-2" />
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between p-6 pt-0">
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, featureIndex) => (
                    <Skeleton key={featureIndex} className="h-5 w-full" />
                  ))}
                </div>
                <Skeleton className="mt-8 h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        {!isLoadingPlans && primaryPlans.map((plan, index) => (
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.28, delay: shouldReduceMotion ? 0 : index * 0.06, ease: 'easeOut' }}
          >
          <Card
            className={cn(
              'relative flex h-full flex-col overflow-hidden rounded-2xl border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface) shadow-[0_20px_60px_var(--shadow)]',
              plan.id === recommendedPlanId && 'border-accent/50 ring-2 ring-accent',
            )}
          >
            <Smartphone className="pointer-events-none absolute -right-5 -top-5 h-28 w-28 text-(--accent)/5" aria-hidden="true" />
            <CardHeader className="min-h-44 p-6">
              {plan.id === recommendedPlanId && (
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                  Recommended
                </div>
              )}
              <CardTitle className="text-2xl">{plan.name}</CardTitle>
              <div className="flex items-baseline gap-2 pt-2">
                <span className="text-4xl font-bold tracking-tight text-text-primary">{plan.price}</span>
                <span className="text-lg font-semibold text-text-muted">BDT</span>
                <span className="text-sm text-text-muted">/ {plan.durationDays} days</span>
              </div>
              <p className="mt-2 flex items-center gap-2 text-sm text-text-muted"><Smartphone className="h-4 w-4 text-(--accent)" />Up to {plan.maxDevices} devices</p>
              <p className="mt-3 line-clamp-2 min-h-10 text-sm text-text-muted">{plan.description || `${plan.durationDays} days of premium access.`}</p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col p-6 pt-0">
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
        ))}
      </motion.div>
      <Dialog open={!!selectedPlan} onOpenChange={(open) => { if (!open) { setSelectedPlan(null); setIsPaymentStepOpen(false) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manual bKash Payment</DialogTitle>
            <DialogDescription>Send the exact amount, then submit your transaction ID for admin review.</DialogDescription>
          </DialogHeader>
          {selectedPlan && (
            <div className="space-y-5">
              {activeSubscription && activeSubscription.plan.id !== selectedPlan.id && !isPaymentStepOpen ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm text-text-primary">
                    <p className="font-semibold">You already have an active Premium subscription.</p>
                    <p className="mt-2 text-text-muted">Your current {activeSubscription.plan.name} subscription will remain active. Current remaining time: {formatRemaining(remainingSeconds)}. After successful payment, {selectedPlan.durationDays} days will be added to its current expiry.</p>
                  </div>
                  <Button className="w-full" onClick={() => setIsPaymentStepOpen(true)}>Continue to Payment</Button>
                </div>
              ) : (
                <>
              <div className="rounded-lg border border-border/50 bg-surface-soft p-4">
                <p className="font-semibold text-text-primary">{selectedPlan.name}</p>
                <p className="text-2xl font-bold text-text-primary">{selectedPlan.price} BDT</p>
                <p className="text-sm text-text-muted">{selectedPlan.durationDays} days</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-text-primary">bKash payment number</p>
                <div className="flex gap-2">
                  <Input readOnly value={manualConfig?.paymentNumber ?? 'Not configured'} />
                  <Button type="button" variant="outline" size="icon" disabled={!manualConfig?.paymentNumber} onClick={() => navigator.clipboard.writeText(manualConfig!.paymentNumber!)} aria-label="Copy bKash number">
                    <motion.div whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }} className="flex items-center justify-center">
                      <Copy className="h-4 w-4" />
                    </motion.div>
                  </Button>
                </div>
                <p className="text-sm text-text-muted">bKash app -&gt; Send Money -&gt; enter payment number -&gt; enter exact amount</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="transaction-id" className="text-sm font-semibold text-text-primary">Transaction ID</label>
                <Input id="transaction-id" value={transactionId} onChange={(event) => setTransactionId(event.target.value)} placeholder="Enter Transaction ID" />
              </div>
                  <Button className="w-full" onClick={handleSubmit} disabled={isSubmitting || !transactionId.trim() || !manualConfig?.paymentNumber} isLoading={isSubmitting}>Verify Payment</Button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}