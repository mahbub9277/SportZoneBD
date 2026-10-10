import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, FileText, History, Inbox } from 'lucide-react'
import { toast } from 'sonner'

import {
  useGetModerationReportsQuery,
  useGetReportDetailQuery,
  useUpdateReportStatusMutation,
  type ReportCategory,
  type ReportItem,
  type ReportStatus,
} from '../../features/reports/reports.api'
import { useDebounce } from '../../hooks/useDebounce'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Skeleton } from '../../components/ui/Skeleton'
import { PaginationControls } from '../../components/ui/PaginationControls'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/AlertDialog'
import { cn } from '../../lib/utils'

const STATUS_LABELS: Record<ReportStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}

/**
 * What each move means in the vocabulary of the data model.
 *
 * The model has four statuses and no separate escalation state, so the moderation console names the moves
 * honestly: picking a report up is `IN_PROGRESS`, resolving it is `RESOLVED`, and dismissing it is closing
 * it with the reason the backend requires. Nothing here pretends to be a state the database cannot hold.
 */
const ACTION_LABELS: Record<ReportStatus, string> = {
  OPEN: 'Reopen',
  IN_PROGRESS: 'Take on',
  RESOLVED: 'Resolve',
  CLOSED: 'Dismiss and close',
}

const CATEGORIES: ReportCategory[] = ['Bug', 'Playback', 'Payment', 'Account', 'Content']

const statusBadgeVariant = (status: ReportStatus) =>
  status === 'RESOLVED' ? 'success' : status === 'CLOSED' ? 'secondary' : status === 'IN_PROGRESS' ? 'default' : 'destructive'

function formatMoment(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

interface PendingDecision {
  report: ReportItem
  status: ReportStatus
  requiresReason: boolean
  reason: string
}

export function ModerationReportsPage() {
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ReportCategory | 'ALL'>('ALL')
  const [status, setStatus] = useState<ReportStatus | 'ALL'>('ALL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingDecision | null>(null)
  const [updateStatus, { isLoading: isUpdating }] = useUpdateReportStatusMutation()
  const debouncedQuery = useDebounce(query, 350)

  const reportsQuery = useGetModerationReportsQuery({
    page,
    limit,
    ...(category !== 'ALL' ? { category } : {}),
    ...(status !== 'ALL' ? { status } : {}),
    ...(debouncedQuery.trim() ? { search: debouncedQuery.trim() } : {}),
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to).toISOString() } : {}),
  })
  const reports = useMemo(() => reportsQuery.data?.items ?? [], [reportsQuery.data])
  const meta = reportsQuery.data?.meta

  /**
   * The report being read.
   *
   * Derived rather than stored: the selection is the report the moderator picked when it is still on the
   * page, and otherwise the first one, so a filter change can never leave the detail panel empty.
   */
  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedId) ?? reports[0] ?? null,
    [reports, selectedId],
  )

  /** Every filter change returns to the first page, because the old page may no longer exist. */
  const applyFilter = (apply: () => void) => {
    apply()
    setPage(1)
  }

  /**
   * Commits a decision the moderator confirmed.
   *
   * The reason is sent only when the moderator wrote one; the backend decides whether it was required, so
   * a missing note is refused there rather than assumed to be fine here.
   */
  const confirmDecision = async () => {
    if (!pending) return
    try {
      await updateStatus({
        id: pending.report.id,
        status: pending.status,
        ...(pending.reason.trim() ? { reason: pending.reason.trim() } : {}),
      }).unwrap()
      toast.success(`Report moved to ${STATUS_LABELS[pending.status]}.`)
      setPending(null)
    } catch (error) {
      const message = (error as { data?: { message?: string } })?.data?.message
        ?? (error instanceof Error ? error.message : 'The report could not be updated.')
      toast.error(message)
    }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      <div>
        <h1 className="text-2xl font-semibold text-(--text-primary) sm:text-3xl">Report queue</h1>
        <p className="mt-1 text-sm text-(--text-muted)">
          Every report the community submitted, with the moderation actions recorded against it. Actions are attributed to
          the signed-in moderator and cannot be edited afterwards.
        </p>
      </div>

      <Card className="border-(--border)">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Input
            aria-label="Search reports"
            placeholder="Search summary, details or reporter"
            value={query}
            onChange={(event) => applyFilter(() => setQuery(event.target.value))}
          />
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(event) => applyFilter(() => setCategory(event.target.value as ReportCategory | 'ALL'))}
            className="h-10 rounded-md border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"
          >
            <option value="ALL">All categories</option>
            {CATEGORIES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => applyFilter(() => setStatus(event.target.value as ReportStatus | 'ALL'))}
            className="h-10 rounded-md border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"
          >
            <option value="ALL">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label="From date"
              type="date"
              value={from}
              onChange={(event) => applyFilter(() => setFrom(event.target.value))}
            />
            <Input
              aria-label="To date"
              value={to}
              type="date"
              onChange={(event) => applyFilter(() => setTo(event.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="border-(--border)">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Reports</CardTitle>
            <span className="text-xs text-(--text-muted)">{meta ? `${meta.totalItems} total` : ''}</span>
          </CardHeader>
          <CardContent className="space-y-2">
            {reportsQuery.isLoading && (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-2xl" />)}
              </div>
            )}

            {reportsQuery.isError && (
              <div className="flex items-start gap-3 rounded-2xl border border-(--border) p-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-(--text-primary)">Reports could not be loaded</p>
                  <p className="text-xs text-(--text-muted)">Check your permissions, or try again in a moment.</p>
                  <Button variant="outline" className="mt-2" onClick={() => void reportsQuery.refetch()}>Retry</Button>
                </div>
              </div>
            )}

            {!reportsQuery.isLoading && !reportsQuery.isError && reports.length === 0 && (
              <div className="flex flex-col items-start gap-2 rounded-2xl border border-(--border) p-6">
                <Inbox className="h-5 w-5 text-(--text-muted)" aria-hidden="true" />
                <p className="text-sm font-medium text-(--text-primary)">Nothing matches these filters</p>
                <p className="text-xs text-(--text-muted)">Reports will appear here as soon as members submit them.</p>
              </div>
            )}

            {reports.map((report) => (
              <button
                key={report.id}
                type="button"
                onClick={() => setSelectedId(report.id)}
                className={cn(
                  'w-full rounded-2xl border p-3 text-left transition',
                  report.id === selectedId
                    ? 'border-(--accent) bg-(--surface-soft)'
                    : 'border-(--border) bg-(--surface-soft)/40 hover:border-(--accent)/40',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-(--text-primary)">{report.summary}</p>
                    <p className="mt-0.5 text-xs text-(--text-muted)">
                      {report.category} Â· {report.user?.fullName ?? 'Unknown member'} Â· {formatMoment(report.createdAt)}
                    </p>
                  </div>
                  <Badge variant={statusBadgeVariant(report.status)}>{STATUS_LABELS[report.status]}</Badge>
                </div>
              </button>
            ))}

            {meta && meta.totalPages > 1 && (
              <PaginationControls
                currentPage={meta.currentPage}
                totalPages={meta.totalPages}
                itemsPerPage={meta.itemsPerPage}
                setCurrentPage={setPage}
                setItemsPerPage={setLimit}
              />
            )}
          </CardContent>
        </Card>

        <ReportDetailPanel
          report={selectedReport}
          onDecide={(report, nextStatus, requiresReason) => setPending({ report, status: nextStatus, requiresReason, reason: '' })}
        />
      </div>

      <AlertDialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? `Move this report to ${STATUS_LABELS[pending.status]}?` : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              The action is recorded with your moderator account, the reportâ€™s previous status and the time it happened.
              {pending?.requiresReason ? ' A short reason is required and is shown in the report history.' : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pending?.requiresReason && (
            <Input
              aria-label="Reason"
              placeholder="Why is this report being closed?"
              value={pending.reason}
              maxLength={500}
              onChange={(event) => setPending({ ...pending, reason: event.target.value })}
            />
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isUpdating || Boolean(pending?.requiresReason && !pending.reason.trim())}
              onClick={(event) => {
                event.preventDefault()
                void confirmDecision()
              }}
            >
              {isUpdating ? 'Savingâ€¦' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}

interface ReportDetailPanelProps {
  report: ReportItem | null
  onDecide: (report: ReportItem, status: ReportStatus, requiresReason: boolean) => void
}

function ReportDetailPanel({ report, onDecide }: ReportDetailPanelProps) {
  const detailQuery = useGetReportDetailQuery(report?.id ?? '', { skip: !report })
  const detail = detailQuery.data
  const transitions = detail?.allowedTransitions ?? report?.allowedTransitions ?? []

  if (!report) {
    return (
      <Card className="border-(--border)">
        <CardContent className="flex flex-col items-start gap-2 p-6">
          <FileText className="h-5 w-5 text-(--text-muted)" aria-hidden="true" />
          <p className="text-sm font-medium text-(--text-primary)">Select a report</p>
          <p className="text-xs text-(--text-muted)">Its details and previous moderation actions are shown here.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-(--border)">
      <CardHeader>
        <CardTitle className="text-base">Report details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-(--text-primary)">{report.summary}</p>
            <Badge variant={statusBadgeVariant(report.status)}>{STATUS_LABELS[report.status]}</Badge>
          </div>
          <p className="text-xs text-(--text-muted)">
            {report.category} Â· submitted by {report.user?.fullName ?? 'unknown'} ({report.user?.email ?? 'no address'}) on{' '}
            {formatMoment(report.createdAt)}
          </p>
        </div>

        <p className="whitespace-pre-wrap rounded-2xl bg-(--surface-soft)/60 p-3 text-sm text-(--text-secondary)">
          {report.details}
        </p>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Recorded actions</p>
          {detailQuery.isLoading && <Skeleton className="h-14 rounded-2xl" />}
          {!detailQuery.isLoading && (detail?.history.length ?? 0) === 0 && (
            <p className="text-xs text-(--text-muted)">No moderation action has been recorded on this report yet.</p>
          )}
          {detail?.history.map((event) => (
            <div key={event.id} className="flex items-start gap-2 rounded-2xl border border-(--border) p-2.5">
              <History className="mt-0.5 h-3.5 w-3.5 text-(--text-muted)" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-(--text-primary)">
                  {event.before?.status ?? 'â€”'} â†’ {event.after?.status ?? 'â€”'}
                  <span className="ml-2 font-normal text-(--text-muted)">{event.actorName ?? event.actorId ?? 'unknown'}</span>
                </p>
                <p className="text-xs text-(--text-muted)">
                  {formatMoment(event.createdAt)}
                  {event.reason ? ` Â· ${event.reason}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Allowed actions</p>
          {transitions.length === 0 && (
            <p className="text-xs text-(--text-muted)">No further action is available for this report from its current status.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {transitions.map((transition) => (
              <Button
                key={transition.status}
                variant={transition.status === 'RESOLVED' ? 'default' : 'outline'}
                title={transition.requiresReason ? 'A reason is required' : undefined}
                onClick={() => onDecide(report, transition.status, transition.requiresReason)}
              >
                {ACTION_LABELS[transition.status]}
              </Button>
            ))}
          </div>
          <p className="text-xs text-(--text-muted)">
            The backend refuses a move that is not shown here, so two moderators cannot resolve the same report twice.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export default ModerationReportsPage
