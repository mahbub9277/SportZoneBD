import { AlertCircle, CheckCircle2, Clock3, CreditCard, History, RefreshCw, Trash2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useClearPaymentHistoryMutation, useGetPaymentHistoryQuery } from '../features/payments/payment.api'
import { PageHero } from '../components/shared/PageHero'
import { Card, CardContent } from '../components/ui/Card'
import { Skeleton } from '../components/ui/Skeleton'
import { cn } from '../lib/utils'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/AlertDialog'

const getStatusClass = (status: string) => {
  switch (status.toLowerCase()) {
    case 'verified':
    case 'succeeded':
      return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
    case 'pending':
      return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
    case 'failed':
      return 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30'
    default:
      return 'bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/30'
  }
}

const formatAmount = (amount: number, currency: string) => {
  const safeCurrency = currency || 'BDT'

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount} ${safeCurrency}`
  }
}

export function PaymentHistoryPage() {
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const { data: payments, isLoading, isError, isFetching, refetch } = useGetPaymentHistoryQuery(undefined, {
    refetchOnFocus: true,
    refetchOnReconnect: true,
  })
  const [clearPaymentHistory, { isLoading: isClearing }] = useClearPaymentHistoryMutation()

  const totalSpent = payments?.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) ?? 0
  const successfulPayments = payments?.filter((payment) => ['verified', 'succeeded', 'approved'].includes(payment.status.toLowerCase())).length ?? 0

  const handleClearHistory = async () => {
    try {
      await clearPaymentHistory().unwrap()
      setIsClearDialogOpen(false)
    } catch {
      // The mutation error is surfaced by the API layer; keep the dialog open for retry.
    }
  }

  return (
    <div className="app-page space-y-3">
      <PageHero
        title="Payment History"
        description="Review your recent transactions and subscription payments."
        eyebrow="Account billing"
        icon={CreditCard}
      >
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => refetch()} disabled={isFetching} className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary transition hover:text-accent disabled:cursor-not-allowed disabled:opacity-60" aria-label="Refresh payment history">
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            {isFetching ? 'Refreshing' : 'Refresh'}
          </button>
          <button type="button" onClick={() => setIsClearDialogOpen(true)} disabled={!payments?.length || isClearing} className="inline-flex items-center gap-2 rounded-full border border-red-500/30 px-3 py-1.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Clear payment history">
            <Trash2 className="h-4 w-4" />
            Clear history
          </button>
        </div>
      </PageHero>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/20 bg-surface-soft/80 shadow-soft">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-text-muted">Transactions</p>
              <p className="mt-2 text-2xl font-bold text-text-primary">{payments?.length ?? 0}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/20 bg-surface-soft/80 shadow-soft">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-text-muted">Total spent</p>
              <p className="mt-2 text-2xl font-bold text-text-primary">{formatAmount(totalSpent, 'BDT')}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
              <Wallet className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/20 bg-surface-soft/80 shadow-soft">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-text-muted">Completed</p>
              <p className="mt-2 text-2xl font-bold text-text-primary">{successfulPayments}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-400">
              <Clock3 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden border-border/20 bg-surface/80 shadow-soft">
        <div className="overflow-x-auto">
          <div className="min-w-0 sm:min-w-160">
            <div className="hidden grid-cols-[minmax(220px,1.6fr)_minmax(100px,0.8fr)_minmax(120px,0.9fr)_minmax(180px,1.2fr)] gap-4 border-b border-border bg-surface-soft/60 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-muted sm:grid">
              <span>Description</span>
              <span className="text-right">Amount</span>
              <span className="text-center">Status</span>
              <span className="text-right">Date</span>
            </div>

            <div className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(220px,1.6fr)_minmax(100px,0.8fr)_minmax(120px,0.9fr)_minmax(180px,1.2fr)] sm:items-center">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-5 w-1/2 justify-self-end" />
                    <Skeleton className="h-6 w-20 justify-self-center" />
                    <Skeleton className="h-5 w-3/4 justify-self-end" />
                  </div>
                ))
              ) : isError ? (
                <div className="flex flex-col items-center gap-4 px-5 py-12 text-center text-red-400">
                  <AlertCircle className="h-10 w-10" />
                  <p className="font-semibold">Could not load payment history.</p>
                  <button type="button" onClick={() => refetch()} className="inline-flex items-center gap-2 rounded-full border border-current px-4 py-2 text-sm font-semibold transition hover:bg-red-500/10" disabled={isFetching}>
                    <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
                    Try again
                  </button>
                </div>
              ) : payments && payments.length > 0 ? (
                payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="grid gap-3 px-5 py-4 transition-all duration-200 hover:bg-surface-soft/60 sm:grid-cols-[minmax(220px,1.6fr)_minmax(100px,0.8fr)_minmax(120px,0.9fr)_minmax(180px,1.2fr)] sm:items-center"
                  >
                    <div className="space-y-1">
                      <p className="font-semibold text-text-primary">
                        {payment.subscriptionPlan?.name ?? 'General Payment'}
                      </p>
                      {payment.transactionId && <p className="break-all text-xs text-text-muted">Transaction: {payment.transactionId}</p>}
                      <p className="text-xs uppercase tracking-[0.18em] text-text-muted sm:hidden">Payment</p>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="font-mono text-sm text-text-primary">
                        {formatAmount(Number(payment.amount || 0), payment.currency || 'BDT')}
                      </span>
                    </div>

                    <div className="flex sm:justify-center">
                      <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize', getStatusClass(payment.status))}>
                        {payment.status}
                      </span>
                    </div>

                    <div className="text-left text-sm text-text-muted sm:text-right">
                      {new Date(payment.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center gap-4 px-5 py-12 text-center text-text-muted">
                  <History className="h-10 w-10" />
                  <p className="font-semibold text-text-primary">No payment history found.</p>
                  <p className="text-sm">Your transactions will appear here.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      <AlertDialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear payment history?</AlertDialogTitle>
            <AlertDialogDescription>
              This will hide all payment records from your history. Your payment and subscription records remain retained for account and audit purposes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearHistory} disabled={isClearing} className="gap-2 bg-red-600 hover:bg-red-700">
              <Trash2 className="h-4 w-4" />
              {isClearing ? 'Clearing...' : 'Clear history'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}