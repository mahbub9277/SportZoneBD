import { useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, CalendarDays, CheckCircle2, Clock, Filter, Info, MonitorPlay, Search, ShieldCheck, Users, XCircle } from 'lucide-react'
import {
  useGetModerationActivityQuery,
  useGetModerationAuditOptionsQuery,
  useGetModerationSessionsQuery,
} from '../../features/moderation/moderation.api'
import { useDebounce } from '../../hooks/useDebounce'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Skeleton } from '../../components/ui/Skeleton'

const ACTION_LABELS: Record<string, string> = {
  'report.status.updated': 'Report status updated',
  'payment.review.approved': 'Manual payment approved',
  'payment.review.rejected': 'Manual payment rejected',
  'payment.review.rechecked': 'Payment rechecked with the provider',
  'push.campaign.sent': 'Push campaign',
  'email.campaign.sent': 'Email campaign',
}

const END_SOURCE_LABELS: Record<string, string> = {
  logout: 'Signed out',
  expiry: 'Session expired',
  idle: 'Idle (estimated)',
  active: 'Still signed in',
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'â€”'
  const minutes = Math.round(ms / 60000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

function formatMoment(value: string | null): string {
  if (!value) return 'â€”'
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function ModerationActivityPage() {
  const [page, setPage] = useState(1)
  const [scope, setScope] = useState<'me' | 'all'>('me')
  const [actorId, setActorId] = useState('')
  const [action, setAction] = useState('')
  const [outcome, setOutcome] = useState<'' | 'success' | 'failure'>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [sessionModeratorId, setSessionModeratorId] = useState('')
  const debouncedSearch = useDebounce(search, 350)

  const optionsQuery = useGetModerationAuditOptionsQuery()
  const activityQuery = useGetModerationActivityQuery({
    page,
    limit: 20,
    scope,
    ...(actorId ? { actorId } : {}),
    ...(action ? { action } : {}),
    ...(outcome ? { outcome } : {}),
    ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to).toISOString() } : {}),
  })

  const sessionsQuery = useGetModerationSessionsQuery(
    sessionModeratorId ? { moderatorId: sessionModeratorId } : {},
  )

  const events = activityQuery.data?.items ?? []
  const summary = activityQuery.data?.summary
  const sessions = sessionsQuery.data

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
        className="relative isolate overflow-hidden rounded-[2rem] border border-(--border) bg-linear-to-br from-violet-500/10 via-(--surface) to-sky-500/10 p-5 shadow-sm sm:p-7"
      >
        <motion.div
          aria-hidden="true"
          className="absolute -right-12 -top-20 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl"
          animate={{ x: [0, -8, 0], y: [0, 10, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <Activity className="pointer-events-none absolute -bottom-9 right-8 h-40 w-40 rotate-6 text-violet-500/5" aria-hidden="true" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-violet-500 to-indigo-500 text-white shadow-lg shadow-violet-500/20">
              <Activity className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <span className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Immutable audit trail
              </span>
              <h1 className="text-2xl font-semibold tracking-tight text-(--text-primary) sm:text-3xl">Activity and history</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-(--text-muted)">
                What was done in the moderation console, by whom, and when — recorded by the backend and not editable from this console.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-(--border) bg-(--surface)/80 px-4 py-3 shadow-sm backdrop-blur">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
              <Users className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-(--text-primary)">{scope === 'me' ? 'Personal activity' : 'Team activity'}</span>
              <span className="block text-xs text-(--text-muted)">{events.length} events on this page</span>
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
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
            <Filter className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base">Filter the audit trail</CardTitle>
            <p className="mt-0.5 text-xs text-(--text-muted)">Narrow the records by moderator, action, outcome or date.</p>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          <select
            aria-label="Whose activity"
            value={scope}
            onChange={(event) => applyFilter(() => setScope(event.target.value as 'me' | 'all'))}
            className="h-10 rounded-md border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"
          >
            <option value="me">My activity</option>
            <option value="all">All moderators</option>
          </select>

          <select
            aria-label="Filter by moderator"
            value={actorId}
            onChange={(event) => applyFilter(() => setActorId(event.target.value))}
            className="h-10 rounded-md border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"
          >
            <option value="">All moderators</option>
            {(optionsQuery.data?.moderators ?? []).map((moderator) => (
              <option key={moderator.id} value={moderator.id}>{moderator.fullName}</option>
            ))}
          </select>

          <select
            aria-label="Filter by action"
            value={action}
            onChange={(event) => applyFilter(() => setAction(event.target.value))}
            className="h-10 rounded-md border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"
          >
            <option value="">All actions</option>
            {(optionsQuery.data?.actions ?? []).map((option) => (
              <option key={option.value} value={option.value}>{ACTION_LABELS[option.value] ?? option.label}</option>
            ))}
          </select>

          <select
            aria-label="Filter by outcome"
            value={outcome}
            onChange={(event) => applyFilter(() => setOutcome(event.target.value as '' | 'success' | 'failure'))}
            className="h-10 rounded-md border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"
          >
            <option value="">Any outcome</option>
            <option value="success">Succeeded</option>
            <option value="failure">Failed</option>
          </select>

          <Input
            aria-label="From date"
            type="date"
            value={from}
            onChange={(event) => applyFilter(() => setFrom(event.target.value))}
          />
          <Input
            aria-label="To date"
            type="date"
            value={to}
            onChange={(event) => applyFilter(() => setTo(event.target.value))}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-(--text-muted)" aria-hidden="true" />
            <Input
              aria-label="Search events"
              className="pl-9"
              placeholder="Search the recorded action"
              value={search}
              onChange={(event) => applyFilter(() => setSearch(event.target.value))}
            />
          </div>
        </CardContent>
      </Card>
      </motion.section>

      {summary && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.08 }}
          transition={{ duration: 0.4 }}
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          <Card className="group border-(--border) shadow-sm transition hover:border-sky-500/40">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Events</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-(--text-primary)">{summary.totalItems}</p>
                </div>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-500/10 text-sky-600 transition-transform group-hover:scale-110 dark:text-sky-300">
                  <Activity className="h-5 w-5" aria-hidden="true" />
                </span>
              </div>
            </CardContent>
          </Card>
          <Card className="group border-(--border) shadow-sm transition hover:border-emerald-500/40">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Succeeded</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-(--text-primary)">{summary.successCount}</p>
                </div>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 transition-transform group-hover:scale-110 dark:text-emerald-300">
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                </span>
              </div>
            </CardContent>
          </Card>
          <Card className="group border-(--border) shadow-sm transition hover:border-rose-500/40">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Failed</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-(--text-primary)">{summary.failureCount}</p>
                </div>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-500/10 text-rose-600 transition-transform group-hover:scale-110 dark:text-rose-300">
                  <XCircle className="h-5 w-5" aria-hidden="true" />
                </span>
              </div>
            </CardContent>
          </Card>
          <Card className="border-(--border) shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">By action</p>
              <ul className="mt-2 space-y-1 text-xs text-(--text-muted)">
                {summary.byAction.filter((entry) => entry.count > 0).map((entry) => (
                  <li key={entry.action} className="flex items-center justify-between gap-2">
                    <span className="truncate">{ACTION_LABELS[entry.action] ?? entry.label}</span>
                    <span className="font-medium text-(--text-primary)">{entry.count}</span>
                  </li>
                ))}
                {summary.byAction.every((entry) => entry.count === 0) && <li>No events for these filters.</li>}
              </ul>
            </CardContent>
          </Card>
        </motion.section>
      )}

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.08 }}
        transition={{ duration: 0.4 }}
      >
      <Card className="border-(--border) shadow-sm">
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-base">Audit events</CardTitle>
              <p className="mt-0.5 text-xs text-(--text-muted)">Recent actions and their recorded outcomes.</p>
            </div>
          </div>
          <span className="rounded-full border border-(--border) bg-(--surface-soft) px-3 py-1 text-xs font-medium text-(--text-muted)">
            Page {page}
          </span>
        </CardHeader>
        <CardContent className="space-y-2">
          {activityQuery.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16 rounded-2xl" />)}
            </div>
          )}

          {activityQuery.isError && (
            <div className="rounded-2xl border border-(--border) p-4 text-sm text-(--text-muted)">
              Activity could not be loaded.
              <Button variant="outline" className="ml-3" onClick={() => void activityQuery.refetch()}>Retry</Button>
            </div>
          )}

          {!activityQuery.isLoading && !activityQuery.isError && events.length === 0 && (
            <p className="rounded-2xl border border-(--border) p-6 text-sm text-(--text-muted)">
              No moderation action matches these filters yet.
            </p>
          )}

          {events.map((event, index) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index * 0.035, 0.2) }}
              className="group rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3 transition-colors hover:border-(--accent)/35 hover:bg-(--surface-soft)/70"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                    event.outcome === 'success' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
                  }`}>
                    {event.outcome === 'success' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
                  </span>
                  <p className="truncate text-sm font-medium text-(--text-primary)">
                    {event.action ? ACTION_LABELS[event.action] ?? event.action : event.message}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={event.outcome === 'success' ? 'success' : 'destructive'}>
                    {event.outcome === 'success' ? 'Succeeded' : 'Failed'}
                  </Badge>
                  <span className="text-xs text-(--text-muted)">{formatMoment(event.createdAt)}</span>
                </div>
              </div>
              <p className="mt-1 text-xs text-(--text-muted)">
                {event.actorName ?? event.actorId ?? 'unknown actor'}
                {event.entityType ? ` Â· ${event.entityType}` : ''}
                {event.entityId ? ` ${event.entityId.slice(0, 8)}â€¦` : ''}
                {event.requestId ? ` Â· request ${event.requestId.slice(0, 8)}` : ''}
              </p>
              {(event.before || event.after) && (
                <p className="mt-1 font-mono text-xs text-(--text-secondary)">
                  {event.before ? JSON.stringify(event.before) : 'â€”'} â†’ {event.after ? JSON.stringify(event.after) : 'â€”'}
                </p>
              )}
              {event.reason && <p className="mt-1 text-xs text-(--text-secondary)">Reason: {event.reason}</p>}
            </motion.div>
          ))}

          {summary && summary.totalItems > 20 && (
            <div className="flex items-center justify-between gap-2 pt-2">
              <span className="text-xs text-(--text-muted)">
                Page {page} of {Math.max(1, Math.ceil(summary.totalItems / 20))}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={page >= Math.ceil(summary.totalItems / 20)}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
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
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-base">Session activity</CardTitle>
              <p className="mt-0.5 text-xs text-(--text-muted)">Recorded sign-ins and estimated active time.</p>
            </div>
          </div>
          <select
            aria-label="Whose sessions"
            value={sessionModeratorId}
            onChange={(event) => setSessionModeratorId(event.target.value)}
            className="h-9 rounded-xl border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
          >
            <option value="">My sessions</option>
            {(optionsQuery.data?.moderators ?? []).map((moderator) => (
              <option key={moderator.id} value={moderator.id}>{moderator.fullName}</option>
            ))}
          </select>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2 rounded-2xl bg-(--surface-soft)/60 p-3 text-xs text-(--text-muted)">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p>
              Session time comes from the sign-in records themselves. Active time stops counting 30 minutes
              ({(sessions?.idleTimeoutMs ?? 0) / 60000} minutes) after the last recorded activity, so a tab left open
              overnight is not counted as work. Sessions with no recorded end are marked as estimates. Time spent per
              action is not measured and is not shown.
            </p>
          </div>

          {sessions && (
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3">
                <p className="text-xs text-(--text-muted)">Sessions</p>
                <p className="text-lg font-semibold text-(--text-primary)">{sessions.summary.sessionCount}</p>
              </div>
              <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3">
                <p className="text-xs text-(--text-muted)">Recorded session time</p>
                <p className="text-lg font-semibold text-(--text-primary)">{formatDuration(sessions.summary.totalDurationMs)}</p>
              </div>
              <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3">
                <p className="text-xs text-(--text-muted)">Estimated active time</p>
                <p className="text-lg font-semibold text-(--text-primary)">{formatDuration(sessions.summary.totalActiveMs)}</p>
              </div>
              <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3">
                <p className="text-xs text-(--text-muted)">Last activity</p>
                <p className="text-sm font-medium text-(--text-primary)">{formatMoment(sessions.summary.lastSeenAt)}</p>
              </div>
            </div>
          )}

          {sessionsQuery.isLoading && <Skeleton className="h-20 rounded-2xl" />}

          {!sessionsQuery.isLoading && (sessions?.items.length ?? 0) === 0 && (
            <p className="rounded-2xl border border-(--border) p-6 text-sm text-(--text-muted)">
              No session has been recorded in the last 30 days.
            </p>
          )}

          {sessions?.items.map((session, index) => (
            <motion.div
              key={session.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index * 0.035, 0.2) }}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-(--border) bg-(--surface-soft)/30 p-3 transition-colors hover:border-(--accent)/30"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-(--text-primary)">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-300">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  {session.moderator.fullName}
                </p>
                <p className="text-xs text-(--text-muted)">
                  {formatMoment(session.startedAt)} â†’ {formatMoment(session.endedAt)} Â·{' '}
                  {END_SOURCE_LABELS[session.endSource] ?? session.endSource}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-(--text-muted)">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  Session {formatDuration(session.durationMs)}
                </span>
                <span className="flex items-center gap-1 text-(--text-secondary)">
                  <MonitorPlay className="h-3.5 w-3.5" aria-hidden="true" />
                  Active â‰ˆ {formatDuration(session.activeMs)}
                </span>
                {session.isEstimated && <Badge variant="secondary">Estimated</Badge>}
              </div>
            </motion.div>
          ))}
        </CardContent>
      </Card>
      </motion.section>
    </motion.div>
  )
}

export default ModerationActivityPage
