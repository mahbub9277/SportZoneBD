import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCw, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import {
  useVerifyHostedCheckoutMutation,
  useVerifyPaymentTransactionMutation,
  type HostedCheckoutState,
  type HostedCheckoutStatus,
} from '@/features/payments/payment.api'
import { describeTrxVerification } from '@/features/payments/trxVerificationState'
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
  const [verifyTransaction, { isLoading: isVerifyingTrx }] = useVerifyPaymentTransactionMutation()
  const { refetch: refetchUser } = useGetMeQuery()

  const [state, setState] = useState<HostedCheckoutState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasChecked, setHasChecked] = useState(false)
  const [pollDeadline, setPollDeadline] = useState<number | null>(null)
  const [trxReference, setTrxReference] = useState('')
  const [trxError, setTrxError] = useState<string | null>(null)
  const [trxResult, setTrxResult] = useState<{ activated: boolean; message: string } | null>(null)

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

  const trx = describeTrxVerification({
    enabled: state?.trxVerificationEnabled,
    paymentStatus: state?.status ?? 'PENDING',
    isVerifying: isVerifyingTrx,
    reference: trxReference,
    attempt: trxResult,
    error: trxError,
  })

  /**
   * Sends the customer's own transaction reference to the backend.
   *
   * Nothing is shown as successful here: the page reports the backend's answer, and only a confirmed answer
   * refreshes the membership state.
   */
  const submitTransactionReference = async () => {
    if (!trx.canSubmit) return
    setTrxError(null)
    try {
      const result = await verifyTransaction({ paymentId, transactionId: trxReference.trim() }).unwrap()
      setTrxResult({ activated: result.activated, message: result.message })
      if (result.activated) {
        setPollDeadline(null)
        setState((current) => (current ? { ...current, status: 'COMPLETED', message: result.message } : current))
        await refetchUser()
      }
    } catch (requestError) {
      setTrxResult(null)
      setTrxError(requestError instanceof Error ? requestError.message : 'That transaction could not be verified.')
    }
  }

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
        className="relative overflow-hidden rounded-4xl border border-(--border) bg-[radial-gradient(circle_at_top_left,rgba(247,199,93,0.18),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(126,200,255,0.10),transparent_48%),linear-gradient(155deg,var(--surface-soft),transparent)] p-6 shadow-[0_30px_90px_var(--shadow)] sm:p-8"
      >
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 h-48 w-48 rounded-full bg-(--accent)/12 blur-3xl" />
        <div className="relative">
          <h1 className="text-3xl font-bold tracking-tight text-(--text-primary) sm:text-4xl">Payment status</h1>
          <p className="mt-2 text-sm leading-6 text-(--text-muted)">Every payment is verified with ZiniPay on the server before Premium is activated.</p>
        </div>
      </motion.section>

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.05 }}>
        <Card className={cn('relative overflow-hidden rounded-[1.8rem] shadow-[0_28px_80px_var(--shadow)]', presentation?.tone)}>
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0 opacity-80',
              state?.status === 'COMPLETED'
                ? 'bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.20),transparent_58%)]'
                : state?.status === 'PENDING'
                  ? 'bg-[radial-gradient(circle_at_top_right,rgba(247,199,93,0.18),transparent_58%)]'
                  : 'bg-[radial-gradient(circle_at_top_right,rgba(251,113,133,0.14),transparent_58%)]',
            )}
          />
          <CardContent className="relative space-y-4 p-6">
            <div className="flex items-start gap-4">
              <span
                className={cn(
                  'mt-0.5 grid h-12 w-12 shrink-0 place-items-center rounded-2xl border ring-1',
                  state?.status === 'COMPLETED'
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 ring-emerald-500/20'
                    : 'border-(--border) bg-(--surface)/60 text-(--text-muted) ring-(--border)',
                )}
              >
                <Icon className={cn('h-6 w-6', isBusy && 'animate-spin')} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xl font-bold tracking-tight text-(--text-primary)">
                  {isBusy ? 'Checking your payment…' : presentation?.title ?? 'Payment status could not be confirmed'}
                </p>
                <p className="mt-1.5 text-sm leading-6 text-(--text-muted)">{state?.message ?? 'The payment reference is missing from this page, so there is nothing to check here.'}</p>
              </div>
            </div>

            {state && (
              <span
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.22em]',
                  state.status === 'COMPLETED'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : state.status === 'PENDING'
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : 'border-(--danger)/30 bg-(--danger-soft) text-(--danger)',
                )}
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                {state.status}
              </span>
            )}

            {error && (
              <div className="flex items-start gap-3 rounded-2xl border border-(--danger)/30 bg-(--danger-soft) p-4 text-sm text-(--danger)">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {paymentId && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-(--text-muted)">
                <span>Payment reference:</span>
                <span className="rounded-xl border border-(--border) bg-(--surface-soft)/50 px-2.5 py-1 font-mono text-(--text-secondary)">{paymentId}</span>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              {state?.status === 'COMPLETED' ? (
                <>
                  <Button size="lg" className="rounded-2xl" onClick={() => navigate('/subscriptions', { replace: true })}>View my membership</Button>
                  <Button size="lg" variant="outline" className="rounded-2xl" onClick={() => navigate('/matches')}>Start watching</Button>
                </>
              ) : (
                <>
                  <Button size="lg" className="rounded-2xl" onClick={() => void check()} disabled={isLoading}>
                    <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} aria-hidden="true" />
                    {isPolling ? 'Checking again…' : 'Check payment again'}
                  </Button>
                  <Button size="lg" variant="outline" className="rounded-2xl" onClick={() => navigate('/subscriptions')}>Back to plans</Button>
                </>
              )}
            </div>

            {state && state.status !== 'COMPLETED' && (
              <div className="flex items-start gap-3 rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-4 text-xs leading-5 text-(--text-muted)">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-(--accent)" aria-hidden="true" />
                <span>
                  Do not pay a second time for this purchase. If you paid and the status stays unconfirmed, contact support with the reference
                  above, or see your <Link to="/profile/payment-history" className="text-(--accent) underline underline-offset-4">payment history</Link>.
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {trx.visible && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.1 }}>
          <Card className="relative overflow-hidden rounded-[1.8rem] border-(--accent)/30 shadow-[0_24px_70px_var(--shadow)]">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(247,199,93,0.16),transparent_58%)]" />
            <CardContent className="relative space-y-4 p-6">
              <div className="flex items-start gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-(--accent)/30 bg-(--accent-soft) text-(--accent)">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-lg font-bold tracking-tight text-(--text-primary)">Already paid with bKash?</p>
                  <p className="mt-1.5 text-sm leading-6 text-(--text-muted)">
                    Enter the transaction ID from your bKash payment message. We check it with ZiniPay and activate Premium only after
                    ZiniPay confirms and consumes that transaction; the amount is checked against this purchase for you.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={trxReference}
                  onChange={(event) => {
                    setTrxReference(event.target.value)
                    // A new attempt, so the previous answer no longer describes what is in the field.
                    setTrxResult(null)
                    setTrxError(null)
                  }}
                  placeholder="e.g. 8N7A2K4L9M"
                  aria-label="bKash transaction ID"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-12 rounded-2xl border-(--border) bg-(--surface-soft)/60 font-mono tracking-[0.12em] uppercase sm:max-w-xs"
                />
                <Button className="h-12 rounded-2xl sm:w-auto" onClick={() => void submitTransactionReference()} disabled={!trx.canSubmit}>
                  {isVerifyingTrx ? 'Verifying…' : 'Verify transaction ID'}
                </Button>
              </div>

              {trx.outcome && (
                <div
                  className={cn(
                    'flex items-start gap-3 rounded-2xl border p-4 text-sm leading-6',
                    trx.outcome.tone === 'success' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
                    trx.outcome.tone === 'pending' && 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                    trx.outcome.tone === 'error' && 'border-(--danger)/30 bg-(--danger-soft) text-(--danger)',
                  )}
                >
                  {trx.outcome.tone === 'success' ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  ) : trx.outcome.tone === 'pending' ? (
                    <Clock3 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  )}
                  <span>{trx.outcome.message}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </motion.div>
  )
}
