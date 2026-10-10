import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CreditCard, Search, ShieldCheck, Star } from 'lucide-react'

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
    <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
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
        <Button variant="outline" onClick={() => setExpanded((current) => !current)}>
          {expanded ? 'Hide payments' : 'Payment history'}
        </Button>
      </div>

      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <p className="text-(--text-muted)">Plan</p>
          <p className="font-medium text-(--text-primary)">
            {record.plan ? `${record.plan.name} (${record.plan.durationDays} days)` : 'Plan no longer available'}
          </p>
        </div>
        <div>
          <p className="text-(--text-muted)">Membership</p>
          <p className="font-medium text-(--text-primary)">
            {formatDate(record.membership.startedAt)} â†’ {formatDate(record.membership.expiresAt)}
          </p>
        </div>
        <div>
          <p className="text-(--text-muted)">Latest payment</p>
          <p className="font-medium text-(--text-primary)">
            {record.latestPayment
              ? `${record.latestPayment.amount} ${record.latestPayment.currency} Â· ${record.latestPayment.methodLabel}`
              : 'No payment recorded'}
          </p>
        </div>
        <div>
          <p className="text-(--text-muted)">Payment status</p>
          <p className="flex items-center gap-2">
            {record.latestPayment
              ? <Badge variant={PAYMENT_STATUS_VARIANT(record.latestPayment)}>{record.latestPayment.status}</Badge>
              : <span className="text-(--text-muted)">â€”</span>}
          </p>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
            Recent payments ({record.paymentSummary.recorded} shown Â· {record.paymentSummary.approved} approved Â·{' '}
            {record.paymentSummary.rejected} rejected)
          </p>
          {record.paymentHistory.length === 0 && (
            <p className="text-xs text-(--text-muted)">No payment record is linked to this membership.</p>
          )}
          {record.paymentHistory.map((payment) => (
            <div key={payment.id} className="rounded-2xl border border-(--border) p-3 text-xs">
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
            </div>
          ))}
        </div>
      )}
    </div>
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
      <div>
        <h1 className="text-2xl font-semibold text-(--text-primary) sm:text-3xl">Premium members</h1>
        <p className="mt-1 text-sm text-(--text-muted)">
          Read-only view of the subscriptions the platform has recorded, with the payments behind each one. Entitlement is
          decided by the subscription, never by a payment submission on its own.
        </p>
      </div>

      <Card className="border-(--border)">
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

      <Card className="border-(--border)">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Star className="h-4 w-4 text-(--accent)" aria-hidden="true" />
            Memberships
          </CardTitle>
          <span className="text-xs text-(--text-muted)">{meta ? `${meta.totalItems} records` : ''}</span>
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
    </motion.div>
  )
}

export default ModerationPremiumMembersPage
