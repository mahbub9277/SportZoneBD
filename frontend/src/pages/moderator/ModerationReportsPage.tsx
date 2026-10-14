import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, FileText, Filter, History, Inbox, Search, ShieldCheck } from 'lucide-react'
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
      <motion.header
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative isolate overflow-hidden rounded-4xl border border-(--border) bg-linear-to-br from-amber-500/10 via-(--surface) to-rose-500/10 p-5 shadow-sm sm:p-7"
      >
        <motion.div
          aria-hidden="true"
          className="absolute -right-12 -top-16 h-52 w-52 rounded-full bg-amber-500/10 blur-3xl"
          animate={{ x: [0, -8, 0], y: [0, 10, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <FileText className="pointer-events-none absolute -bottom-10 right-9 h-44 w-44 rotate-12 text-amber-500/5" aria-hidden="true" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-amber-500 to-rose-500 text-white shadow-lg shadow-amber-500/20">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <span className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Community care
              </span>
              <h1 className="text-2xl font-semibold tracking-tight text-(--text-primary) sm:text-3xl">Report queue</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-(--text-muted)">
                Review community reports, follow the recorded history and take the next permitted moderation action.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-(--border) bg-(--surface)/80 px-4 py-3 shadow-sm backdrop-blur">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-300">
              <Inbox className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-(--text-primary)">Review workspace</span>
              <span className="block text-xs text-(--text-muted)">{meta?.totalItems ?? 0} matching reports</span>
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
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <Filter className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base">Find a report</CardTitle>
            <p className="mt-0.5 text-xs text-(--text-muted)">Search and filter the queue to focus your review.</p>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-(--text-muted)" aria-hidden="true" />
            <Input
              aria-label="Search reports"
              className="pl-9"
              placeholder="Search summary, details or reporter"
              value={query}
              onChange={(event) => applyFilter(() => setQuery(event.target.value))}
            />
          </div>
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
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.08 }}
        transition={{ duration: 0.4 }}
        className="grid gap-4 lg:grid-cols-[1.4fr_1fr]"
      >
        <Card className="border-(--border) shadow-sm">
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-300">
                <FileText className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <CardTitle className="text-base">Reports</CardTitle>
                <p className="mt-0.5 text-xs text-(--text-muted)">Select a report to inspect its details.</p>
              </div>
            </div>
            <span className="rounded-full border border-(--border) bg-(--surface-soft) px-3 py-1 text-xs font-medium text-(--text-muted)">
              {meta ? `${meta.totalItems} total` : 'Loading'}
            </span>
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

            {reports.map((report, index) => (
              <motion.button
                key={report.id}
                type="button"
                onClick={() => setSelectedId(report.id)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: Math.min(index * 0.035, 0.2) }}
                whileHover={{ y: -1 }}
                className={cn(
                  'group w-full rounded-2xl border p-3 text-left shadow-sm transition-colors',
                  report.id === selectedId
                    ? 'border-(--accent)/60 bg-(--accent)/5 ring-1 ring-inset ring-(--accent)/15'
                    : 'border-(--border) bg-(--surface-soft)/40 hover:border-(--accent)/40 hover:bg-(--surface-soft)/80',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                      report.status === 'RESOLVED'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                        : report.status === 'CLOSED'
                          ? 'bg-slate-500/10 text-slate-500'
                          : report.status === 'IN_PROGRESS'
                            ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
                    }`}>
                      {report.status === 'RESOLVED' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-(--text-primary)">{report.summary}</p>
                    <p className="mt-0.5 text-xs text-(--text-muted)">
                      {report.category} Â· {report.user?.fullName ?? 'Unknown member'} Â· {formatMoment(report.createdAt)}
                    </p>
                    </div>
                  </div>
                  <Badge variant={statusBadgeVariant(report.status)}>{STATUS_LABELS[report.status]}</Badge>
                </div>
              </motion.button>
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
      </motion.section>

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
    <Card className="border-(--border) shadow-sm">
      <CardHeader className="flex-row items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
          <History className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <CardTitle className="text-base">Report details</CardTitle>
          <p className="mt-0.5 text-xs text-(--text-muted)">Context, decision history and available actions.</p>
        </div>
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
          {detail?.history.map((event, index) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, delay: Math.min(index * 0.04, 0.16) }}
              className="flex items-start gap-2 rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-2.5"
            >
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
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
            </motion.div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Allowed actions</p>
          {transitions.length === 0 && (
            <p className="text-xs text-(--text-muted)">No further action is available for this report from its current status.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {transitions.map((transition) => (
              <motion.div key={transition.status} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
                <Button
                  variant={transition.status === 'RESOLVED' ? 'default' : 'outline'}
                  title={transition.requiresReason ? 'A reason is required' : undefined}
                  onClick={() => onDecide(report, transition.status, transition.requiresReason)}
                >
                  {transition.status === 'RESOLVED' && <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                  {ACTION_LABELS[transition.status]}
                </Button>
              </motion.div>
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
