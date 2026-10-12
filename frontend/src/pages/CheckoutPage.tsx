import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, Crown, ExternalLink, Lock, ShieldCheck, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { getErrorMessage } from '@/utils/get-error-message'
import { useGetSubscriptionPlansQuery, useStartHostedCheckoutMutation } from '@/features/payments/payment.api'
import { useGetMeQuery } from '@/features/auth/auth.api'

/**
 * The start of the hosted checkout.
 *
 * SportZoneBD creates the payment session on the server and then hands the customer to ZiniPay's own payment
 * page: the wallet list, the payment form and the branding on that page belong to ZiniPay, and none of it is
 * reproduced here. This page only describes what is about to happen and where the customer comes back to.
 */

/** Official ZiniPay logo, used as attribution for the redirect that is about to happen. */
const ZINIPAY_LOGO_URL = 'https://zinipay.com/zini-pay-logo.webp'

export function CheckoutPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const planId = searchParams.get('plan') ?? ''
  const wasCancelled = searchParams.get('cancel') === '1'
  const [isRedirecting, setIsRedirecting] = useState(false)

  const { data: plans = [], isLoading: isLoadingPlans, isError: isPlansError } = useGetSubscriptionPlansQuery()
  const { data: user } = useGetMeQuery()
  const [startCheckout, { isLoading: isStarting, isError: isStartError, error: startError }] = useStartHostedCheckoutMutation()

  const plan = useMemo(() => plans.find((candidate) => candidate.id === planId) ?? null, [plans, planId])
  // Read once: the page only needs to know whether the membership is already active when it opens.
  const [openedAt] = useState(() => Date.now())
  const activeSubscription = user?.subscription && user.subscription.status === 'ACTIVE' && new Date(user.subscription.expiresAt).getTime() > openedAt
    ? user.subscription
    : null

  // A checkout without a plan is not a checkout: the plan list is the only place that can start one.
  useEffect(() => {
    if (isLoadingPlans || isPlansError) return
    if (!plan) navigate('/subscriptions', { replace: true })
  }, [isLoadingPlans, isPlansError, plan, navigate])

  const handleStart = async () => {
    if (!plan) return

    try {
      const session = await startCheckout({ subscriptionPlanId: plan.id }).unwrap()
      setIsRedirecting(true)
      // The provider's page is a full-page navigation: nothing here resumes after it.
      window.location.assign(session.paymentUrl)
    } catch (error) {
      setIsRedirecting(false)
      toast.error(getErrorMessage(error))
    }
  }

  const busy = isStarting || isRedirecting

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="app-page mx-auto max-w-3xl space-y-5"
    >
      <motion.section
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-4xl border border-(--border) bg-[radial-gradient(circle_at_top_left,rgba(247,199,93,0.20),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(126,200,255,0.12),transparent_48%),linear-gradient(155deg,var(--surface-soft),transparent)] p-6 shadow-[0_30px_90px_var(--shadow)] sm:p-8"
      >
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 h-48 w-48 rounded-full bg-(--accent)/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-(--accent)/30 bg-linear-to-br from-(--accent) to-amber-500 text-slate-900 shadow-[0_18px_50px_rgba(247,199,93,0.28)]">
            <Crown className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-(--text-primary) sm:text-4xl">
              Continue to secure payment
            </h1>
            <p className="mt-2 text-sm leading-6 text-(--text-muted)">
              You will pay on ZiniPay&apos;s own payment page and come back here afterwards.
            </p>
          </div>
        </div>
      </motion.section>

      {wasCancelled && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 rounded-2xl border border-(--border) bg-(--surface-soft)/70 p-4 text-sm leading-6 text-(--text-muted) shadow-[0_18px_50px_var(--shadow)]"
        >
          <span aria-hidden="true" className="mt-1 h-7 w-1 shrink-0 rounded-full bg-(--accent)/60" />
          <span>The payment was cancelled, so nothing was charged and Premium was not activated. You can start again below.</span>
        </motion.div>
      )}

      {isPlansError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 rounded-2xl border border-(--danger)/30 bg-(--danger-soft) p-4 text-sm leading-6 text-(--danger) shadow-[0_18px_50px_var(--shadow)]"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>The payment page could not be loaded. Please try again in a moment.</span>
        </motion.div>
      )}

      {isLoadingPlans && !plan && (
        <Card className="rounded-[1.8rem]">
          <CardContent className="space-y-3 p-6">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </CardContent>
        </Card>
      )}

      {plan && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.05 }}>
          <Card className="relative overflow-hidden rounded-[1.8rem] border-(--accent)/30 shadow-[0_28px_80px_var(--shadow)]">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(247,199,93,0.18),transparent_58%)]" />
            <CardContent className="relative flex flex-wrap items-end justify-between gap-4 p-6">
              <div>
                <p className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-(--accent)">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Selected plan
                </p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-(--text-primary)">{plan.name}</p>
                <span className="mt-2 inline-flex items-center rounded-full border border-(--border) bg-(--surface-soft)/70 px-3 py-1 text-xs font-semibold text-(--text-secondary)">
                  {plan.durationDays} days
                </span>
              </div>
              <p className="text-4xl font-bold tabular-nums tracking-tight text-(--text-primary)">
                {plan.price} <span className="text-base font-semibold text-(--text-muted)">BDT</span>
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {activeSubscription && plan && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 rounded-2xl border border-(--accent)/40 bg-(--accent-soft) p-4 text-sm text-(--text-primary) shadow-[0_18px_50px_var(--shadow)]"
        >
          <span aria-hidden="true" className="mt-1 h-7 w-1 shrink-0 rounded-full bg-(--accent)" />
          <div>
            <p className="font-semibold">You already have an active Premium subscription.</p>
            <p className="mt-1 text-(--text-muted)">A confirmed payment adds {plan.durationDays} days to your current expiry.</p>
          </div>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.1 }}>
        <Card className="rounded-[1.8rem] shadow-[0_24px_70px_var(--shadow)]">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <ul className="divide-y divide-(--border) overflow-hidden rounded-2xl border border-(--border) bg-(--surface-soft)/40">
              <li className="flex items-start gap-3 p-4 transition-colors hover:bg-(--surface)/60">
                <ShieldCheck className="h-9 w-9 shrink-0 rounded-xl bg-(--accent-soft) p-2 text-(--accent)" aria-hidden="true" />
                <span className="text-sm leading-6 text-(--text-muted)">ZiniPay&apos;s page shows the payment methods enabled for this account and guides you through the payment.</span>
              </li>
              <li className="flex items-start gap-3 p-4 transition-colors hover:bg-(--surface)/60">
                <Lock className="h-9 w-9 shrink-0 rounded-xl bg-(--accent-soft) p-2 text-(--accent)" aria-hidden="true" />
                <span className="text-sm leading-6 text-(--text-muted)">SportZoneBD never sees or stores your wallet PIN or card details.</span>
              </li>
              <li className="flex items-start gap-3 p-4 transition-colors hover:bg-(--surface)/60">
                <ExternalLink className="h-9 w-9 shrink-0 rounded-xl bg-(--accent-soft) p-2 text-(--accent)" aria-hidden="true" />
                <span className="text-sm leading-6 text-(--text-muted)">Premium activates only after SportZoneBD verifies the payment with ZiniPay on the server, right after you return.</span>
              </li>
            </ul>

            <Button
              variant="neon"
              size="lg"
              className="w-full rounded-2xl"
              onClick={() => void handleStart()}
              disabled={busy || !plan}
              isLoading={busy}
            >
              {busy ? 'Opening ZiniPay…' : 'Pay with ZiniPay'}
            </Button>

            {isStartError && (
              <div className="flex items-start gap-3 rounded-2xl border border-(--danger)/30 bg-(--danger-soft) p-4 text-sm text-(--danger)">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">The payment session could not be created.</p>
                  <p className="mt-1">{getErrorMessage(startError)}</p>
                  <p className="mt-1 text-xs opacity-90">Nothing was charged. You can try again, or report the issue from the help page if it keeps failing.</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-(--border) bg-(--surface-soft)/40 px-4 py-3 text-center text-xs text-(--text-muted)">
              <span>Payments are processed on ZiniPay&apos;s official hosted page.</span>
              <img
                src={ZINIPAY_LOGO_URL}
                alt="ZiniPay"
                loading="lazy"
                className="h-4 w-auto opacity-90"
                onError={(event) => { event.currentTarget.style.display = 'none' }}
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
