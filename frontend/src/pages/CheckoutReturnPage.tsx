import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { useVerifyHostedCheckoutMutation, type HostedCheckoutState, type HostedCheckoutStatus } from '@/features/payments/payment.api'
import { useGetMeQuery } from '@/features/auth/auth.api'

/**
 * Where the customer lands after paying on ZiniPay's page.
 *
 * A browser redirect cannot prove a payment, so nothing here is decided locally: the page asks the backend to
 * check the invoice with ZiniPay and reports that answer. A pending or unknown answer keeps the customer
 * informed and lets them re-check without paying twice.
 */

/** How often the page re-checks while the provider still reports the payment as pending. */
const POLL_INTERVAL_MS = 10_000
/**
 * How long the page keeps re-checking on its own before it hands the decision to the customer. Deliberately
 * short: every check costs a request, and the customer has an explicit "check again" action anyway.
 */
const POLL_WINDOW_MS = 40_000

interface StatusPresentation {
  icon: typeof CheckCircle2
  tone: string
  title: string
}

const PRESENTATION: Record<HostedCheckoutStatus, StatusPresentation> = {
  COMPLETED: { icon: CheckCircle2, tone: 'border-emerald-500/40 bg-emerald-500/10', title: 'Payment confirmed — Premium is active' },
  PENDING: { icon: Clock3, tone: 'border-amber-500/40 bg-amber-500/10', title: 'Payment not confirmed yet' },
  FAILED: { icon: XCircle, tone: 'border-(--danger)/30 bg-(--danger-soft)', title: 'Payment failed' },
  CANCELLED: { icon: XCircle, tone: 'border-(--danger)/30 bg-(--danger-soft)', title: 'Payment cancelled' },
  UNKNOWN: { icon: ShieldAlert, tone: 'border-(--danger)/30 bg-(--danger-soft)', title: 'Payment status could not be confirmed' },
}

export function CheckoutReturnPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const paymentId = searchParams.get('payment') ?? ''
  const [verifyCheckout, { isLoading }] = useVerifyHostedCheckoutMutation()
  const { refetch: refetchUser } = useGetMeQuery()

  const [state, setState] = useState<HostedCheckoutState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasChecked, setHasChecked] = useState(false)
  const [pollDeadline, setPollDeadline] = useState<number | null>(null)

  const check = useCallback(async () => {
    if (!paymentId) return
    try {
      const result = await verifyCheckout({ paymentId }).unwrap()
      setState(result)
      setError(null)

      if (result.status === 'PENDING') {
        // Bound the automatic re-checking: after the window the customer decides when to look again.
        setPollDeadline((current) => current ?? Date.now() + POLL_WINDOW_MS)
      } else {
        setPollDeadline(null)
        if (result.status === 'COMPLETED') {
          // The membership UI reads the user profile, so it is refreshed before success is shown.
          await refetchUser()
        }
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The payment status could not be checked.')
    } finally {
      setHasChecked(true)
    }
  }, [paymentId, verifyCheckout, refetchUser])

  // ZiniPay sends the customer back here after the payment, so the first check happens on arrival. It is
  // scheduled rather than called inline so the page paints the "checking" state before the request starts.
  useEffect(() => {
    if (!paymentId) {
      navigate('/subscriptions', { replace: true })
      return
    }
    const timer = window.setTimeout(() => { void check() }, 0)
    return () => window.clearTimeout(timer)
  }, [paymentId, check, navigate])

  // Re-check while the provider reports the payment as pending, and stop when the window closes.
  useEffect(() => {
    if (pollDeadline === null) return

    const interval = window.setInterval(() => {
      if (Date.now() > pollDeadline) {
        setPollDeadline(null)
        return
      }
      void check()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [pollDeadline, check])

  const presentation = state ? PRESENTATION[state.status] : null
  const Icon = presentation?.icon ?? Loader2
  const isBusy = isLoading || (!hasChecked && !state)
  const isPolling = pollDeadline !== null

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="app-page mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Payment status</h1>
        <p className="text-sm text-text-muted">Every payment is verified with ZiniPay on the server before Premium is activated.</p>
      </div>

      <Card className={cn(presentation?.tone)}>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-start gap-3">
            <span className={cn('mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full', state?.status === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-text-muted')}>
              <Icon className={cn('h-5 w-5', isBusy && 'animate-spin')} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-text-primary">{isBusy ? 'Checking your payment…' : presentation?.title ?? 'Payment status could not be confirmed'}</p>
              <p className="mt-1 text-sm text-text-muted">{state?.message ?? 'The payment reference is missing from this page, so there is nothing to check here.'}</p>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-(--danger)/30 bg-(--danger-soft) p-3 text-sm text-(--danger)">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {paymentId && (
            <p className="text-xs text-text-muted">
              Payment reference: <span className="font-mono text-text-secondary">{paymentId}</span>
            </p>
          )}

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            {state?.status === 'COMPLETED' ? (
              <>
                <Button onClick={() => navigate('/subscriptions', { replace: true })}>View my membership</Button>
                <Button variant="outline" onClick={() => navigate('/matches')}>Start watching</Button>
              </>
            ) : (
              <>
                <Button onClick={() => void check()} disabled={isLoading}>
                  <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} aria-hidden="true" />
                  {isPolling ? 'Checking again…' : 'Check payment again'}
                </Button>
                <Button variant="outline" onClick={() => navigate('/subscriptions')}>Back to plans</Button>
              </>
            )}
          </div>

          {state && state.status !== 'COMPLETED' && (
            <p className="text-xs text-text-muted">
              Do not pay a second time for this purchase. If you paid and the status stays unconfirmed, contact support with the reference
              above, or see your <Link to="/profile/payment-history" className="text-accent underline">payment history</Link>.
            </p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
