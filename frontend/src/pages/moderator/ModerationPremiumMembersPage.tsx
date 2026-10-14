import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, ChevronDown, ChevronUp, Clock3, CreditCard, Search, ShieldCheck, Star, UserRound, Users, WalletCards } from 'lucide-react'

import { useGetPremiumMembersQuery, type PremiumMemberRecord } from '../../features/moderation/moderation.api'
import { useDebounce } from '../../hooks/useDebounce'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Skeleton } from '../../components/ui/Skeleton'
import { PaginationControls } from '../../components/ui/PaginationControls'

/**
 * Premium members, read-only.
 *
 * The membership state is the platform's own entitlement rule â€” an active, unexpired subscription â€” and the
 * payments are shown as the history behind it. A submitted payment never makes anyone premium here, and
 * nothing on this page can change a price, a plan or an entitlement.
 */

const PAYMENT_STATUS_VARIANT = (payment: { isVerifiedPayment: boolean; isUnsuccessfulPayment: boolean }) =>
  payment.isVerifiedPayment ? 'success' : payment.isUnsuccessfulPayment ? 'destructive' : 'secondary'

function formatMoment(value: string | null): string {
  if (!value) return 'â€”'
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatDate(value: string | null): string {
  if (!value) return 'â€”'
  return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function MemberRow({ record }: { record: PremiumMemberRecord }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      className="group rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-4 shadow-sm transition-colors hover:border-(--accent)/30 hover:bg-(--surface-soft)/70"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <UserRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-(--text-primary)">
            {record.member.fullName ?? 'Unnamed member'}
            {record.membership.isActive
              ? <Badge variant="success">Premium active</Badge>
              : <Badge variant="secondary">{record.membership.status.toLowerCase()}</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-(--text-muted)">
            {record.member.email ?? 'no email on record'} Â· account {record.member.id.slice(0, 8)}â€¦
          </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => setExpanded((current) => !current)} className="inline-flex items-center gap-2">
          <WalletCards className="h-4 w-4" aria-hidden="true" />
          {expanded ? 'Hide payments' : 'Payment history'}
          {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>

      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-(--border) bg-(--surface)/60 p-3">
          <p className="flex items-center gap-1.5 text-(--text-muted)"><Star className="h-3.5 w-3.5" aria-hidden="true" />Plan</p>
          <p className="font-medium text-(--text-primary)">
            {record.plan ? `${record.plan.name} (${record.plan.durationDays} days)` : 'Plan no longer available'}
          </p>
        </div>
        <div className="rounded-xl border border-(--border) bg-(--surface)/60 p-3">
          <p className="flex items-center gap-1.5 text-(--text-muted)"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Membership</p>
          <p className="font-medium text-(--text-primary)">
            {formatDate(record.membership.startedAt)} â†’ {formatDate(record.membership.expiresAt)}
          </p>
        </div>
        <div className="rounded-xl border border-(--border) bg-(--surface)/60 p-3">
          <p className="flex items-center gap-1.5 text-(--text-muted)"><CreditCard className="h-3.5 w-3.5" aria-hidden="true" />Latest payment</p>
          <p className="font-medium text-(--text-primary)">
            {record.latestPayment
              ? `${record.latestPayment.amount} ${record.latestPayment.currency} Â· ${record.latestPayment.methodLabel}`
              : 'No payment recorded'}
          </p>
        </div>
        <div className="rounded-xl border border-(--border) bg-(--surface)/60 p-3">
          <p className="flex items-center gap-1.5 text-(--text-muted)"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Payment status</p>
          <p className="flex items-center gap-2">
            {record.latestPayment
              ? <Badge variant={PAYMENT_STATUS_VARIANT(record.latestPayment)}>{record.latestPayment.status}</Badge>
              : <span className="text-(--text-muted)">â€”</span>}
          </p>
        </div>
      </div>

      {expanded && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-4 space-y-3 border-t border-(--border) pt-4"
        >
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
            <WalletCards className="h-4 w-4" aria-hidden="true" />
            Recent payments ({record.paymentSummary.recorded} shown Â· {record.paymentSummary.approved} approved Â·{' '}
            {record.paymentSummary.rejected} rejected)
          </p>
          {record.paymentHistory.length === 0 && (
            <p className="text-xs text-(--text-muted)">No payment record is linked to this membership.</p>
          )}
          {record.paymentHistory.map((payment, index) => (
            <motion.div
              key={payment.id}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, delay: Math.min(index * 0.04, 0.16) }}
              className="rounded-2xl border border-(--border) bg-(--surface)/70 p-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-(--text-primary)">
                  {payment.amount} {payment.currency} Â· {payment.methodLabel}
                </span>
                <Badge variant={PAYMENT_STATUS_VARIANT(payment)}>{payment.status}</Badge>
              </div>
              <p className="mt-1 text-(--text-muted)">
                Reference {payment.transactionId} Â· recorded {formatMoment(payment.createdAt)}
              </p>
              <p className="text-(--text-muted)">
                {payment.isVerifiedPayment
                  ? `Verified${payment.reviewedAt ? ` by a reviewer on ${formatMoment(payment.reviewedAt)}` : ''}`
                  : payment.isUnsuccessfulPayment
                    ? `Not successful${payment.rejectionReason ? ` Â· ${payment.rejectionReason}` : ''}`
                    : 'Awaiting review'}
              </p>
            </motion.div>
          ))}
        </motion.div>
      )}
    </motion.div>
  )
}

export function ModerationPremiumMembersPage() {
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const debouncedSearch = useDebounce(search, 350)

  const membersQuery = useGetPremiumMembersQuery({
    page,
    limit,
    ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    ...(status ? { status } : {}),
  })
  const members = useMemo(() => membersQuery.data?.items ?? [], [membersQuery.data])
  const meta = membersQuery.data?.meta

  /** Every filter change returns to the first page, because the old page may no longer exist. */
  const applyFilter = (apply: () => void) => {
    apply()
    setPage(1)
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      <motion.header
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative isolate overflow-hidden rounded-4xl border border-(--border) bg-linear-to-br from-amber-500/10 via-(--surface) to-orange-500/10 p-5 shadow-sm sm:p-7"
      >
        <motion.div
          aria-hidden="true"
          className="absolute -right-12 -top-16 h-52 w-52 rounded-full bg-amber-500/10 blur-3xl"
          animate={{ x: [0, -8, 0], y: [0, 10, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <Star className="pointer-events-none absolute -bottom-10 right-9 h-44 w-44 rotate-12 text-amber-500/5" aria-hidden="true" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/20">
              <Star className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <span className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Read-only insights
              </span>
              <h1 className="text-2xl font-semibold tracking-tight text-(--text-primary) sm:text-3xl">Premium members</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-(--text-muted)">
                Review recorded subscriptions and payment history. Entitlement is decided by the subscription, never by a payment submission alone.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-(--border) bg-(--surface)/80 px-4 py-3 shadow-sm backdrop-blur">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
              <Users className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-(--text-primary)">{meta?.totalItems ?? '—'} records</span>
              <span className="block text-xs text-(--text-muted)">Premium memberships</span>
            </span>
          </div>
        </div>
      </motion.header>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.08 }}
        transition={{ duration: 0.4 }}
      >
      <Card className="border-(--border) shadow-sm">
        <CardHeader className="flex-row items-center gap-3 pb-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
            <Search className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base">Find members</CardTitle>
            <p className="mt-0.5 text-xs text-(--text-muted)">Search accounts or filter by membership status.</p>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-(--text-muted)" aria-hidden="true" />
            <Input
              aria-label="Search members"
              className="pl-9"
              placeholder="Search by name or email"
              value={search}
              onChange={(event) => applyFilter(() => setSearch(event.target.value))}
            />
          </div>
          <select
            aria-label="Filter by membership status"
            value={status}
            onChange={(event) => applyFilter(() => setStatus(event.target.value))}
            className="h-10 rounded-md border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"
          >
            <option value="">All memberships</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRED">Expired</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </CardContent>
      </Card>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.08 }}
        transition={{ duration: 0.4 }}
      >
      <Card className="border-(--border) shadow-sm">
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
              <Star className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-base">Memberships</CardTitle>
              <p className="mt-0.5 text-xs text-(--text-muted)">Subscription state and related payment records.</p>
            </div>
          </div>
          <span className="rounded-full border border-(--border) bg-(--surface-soft) px-3 py-1 text-xs font-medium text-(--text-muted)">
            {meta ? `${meta.totalItems} records` : 'Loading'}
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          {membersQuery.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}
            </div>
          )}

          {membersQuery.isError && (
            <div className="rounded-2xl border border-(--border) p-4 text-sm text-(--text-muted)">
              Premium members could not be loaded.
              <Button variant="outline" className="ml-3" onClick={() => void membersQuery.refetch()}>Retry</Button>
            </div>
          )}

          {!membersQuery.isLoading && !membersQuery.isError && members.length === 0 && (
            <div className="flex flex-col items-start gap-2 rounded-2xl border border-(--border) p-6">
              <CreditCard className="h-5 w-5 text-(--text-muted)" aria-hidden="true" />
              <p className="text-sm font-medium text-(--text-primary)">No membership matches these filters</p>
              <p className="text-xs text-(--text-muted)">
                Members appear here once a subscription exists on their account.
              </p>
            </div>
          )}

          {members.map((record) => <MemberRow key={record.subscriptionId} record={record} />)}

          {meta && meta.totalPages > 1 && (
            <PaginationControls
              currentPage={meta.currentPage}
              totalPages={meta.totalPages}
              itemsPerPage={meta.itemsPerPage}
              setCurrentPage={setPage}
              setItemsPerPage={setLimit}
            />
          )}

          <p className="flex items-start gap-2 pt-1 text-xs text-(--text-muted)">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Read-only: this view cannot change a price, a plan, an entitlement or a payment record.
          </p>
        </CardContent>
      </Card>
      </motion.section>
    </motion.div>
  )
}

export default ModerationPremiumMembersPage
