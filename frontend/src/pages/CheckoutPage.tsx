import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, Crown, ExternalLink, Lock, ShieldCheck } from 'lucide-react'
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="app-page mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-linear-to-br from-accent to-amber-500 text-slate-900">
          <Crown className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Continue to secure payment</h1>
          <p className="text-sm text-text-muted">You will pay on ZiniPay&apos;s own payment page and come back here afterwards.</p>
        </div>
      </div>

      {wasCancelled && (
        <div className="rounded-2xl border border-(--border) bg-(--surface-soft) p-4 text-sm text-text-muted">
          The payment was cancelled, so nothing was charged and Premium was not activated. You can start again below.
        </div>
      )}

      {isPlansError && (
        <div className="rounded-2xl border border-(--danger)/30 bg-(--danger-soft) p-4 text-sm text-(--danger)">
          The payment page could not be loaded. Please try again in a moment.
        </div>
      )}

      {isLoadingPlans && !plan && (
        <Card><CardContent className="space-y-3 p-6"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-20 w-full" /></CardContent></Card>
      )}

      {plan && (
        <Card className="border-accent/40 bg-accent/5">
          <CardContent className="flex flex-wrap items-end justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Selected plan</p>
              <p className="text-xl font-bold text-text-primary">{plan.name}</p>
              <p className="text-sm text-text-muted">{plan.durationDays} days</p>
            </div>
            <p className="text-3xl font-bold text-text-primary">{plan.price} <span className="text-base font-semibold text-text-muted">BDT</span></p>
          </CardContent>
        </Card>
      )}

      {activeSubscription && plan && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm text-text-primary">
          <p className="font-semibold">You already have an active Premium subscription.</p>
          <p className="mt-1 text-text-muted">A confirmed payment adds {plan.durationDays} days to your current expiry.</p>
        </div>
      )}

      <Card>
        <CardContent className="space-y-4 p-5">
          <ul className="space-y-2 text-sm text-text-muted">
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" /><span>ZiniPay&apos;s page shows the payment methods enabled for this account and guides you through the payment.</span></li>
            <li className="flex gap-2"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" /><span>SportZoneBD never sees or stores your wallet PIN or card details.</span></li>
            <li className="flex gap-2"><ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" /><span>Premium activates only after SportZoneBD verifies the payment with ZiniPay on the server, right after you return.</span></li>
          </ul>

          <Button
            className="w-full"
            onClick={() => void handleStart()}
            disabled={busy || !plan}
            isLoading={busy}
          >
            {busy ? 'Opening ZiniPay…' : 'Pay with ZiniPay'}
          </Button>

          {isStartError && (
            <div className="flex items-start gap-2 rounded-lg border border-(--danger)/30 bg-(--danger-soft) p-3 text-sm text-(--danger)">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">The payment session could not be created.</p>
                <p className="mt-1">{getErrorMessage(startError)}</p>
                <p className="mt-1 text-xs">Nothing was charged. You can try again, or report the issue from the help page if it keeps failing.</p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2 text-center text-xs text-text-muted">
            <span>Payments are processed on ZiniPay&apos;s official hosted page.</span>
            <img
              src={ZINIPAY_LOGO_URL}
              alt="ZiniPay"
              loading="lazy"
              className="h-4 w-auto opacity-80"
              onError={(event) => { event.currentTarget.style.display = 'none' }}
            />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
