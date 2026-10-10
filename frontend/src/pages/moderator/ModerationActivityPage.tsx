import { useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, Clock, Info, MonitorPlay } from 'lucide-react'
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
      <div>
        <h1 className="text-2xl font-semibold text-(--text-primary) sm:text-3xl">Activity and history</h1>
        <p className="mt-1 text-sm text-(--text-muted)">
          What was done in the moderation console, by whom, and when â€” read from the audit records the backend writes for
          each action. Audit records cannot be edited or deleted from the console.
        </p>
      </div>

      <Card className="border-(--border)">
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
          <Input
            aria-label="Search events"
            placeholder="Search the recorded action"
            value={search}
            onChange={(event) => applyFilter(() => setSearch(event.target.value))}
          />
        </CardContent>
      </Card>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-(--border)">
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Events</p>
              <p className="mt-1 text-2xl font-semibold text-(--text-primary)">{summary.totalItems}</p>
            </CardContent>
          </Card>
          <Card className="border-(--border)">
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Succeeded</p>
              <p className="mt-1 text-2xl font-semibold text-(--text-primary)">{summary.successCount}</p>
            </CardContent>
          </Card>
          <Card className="border-(--border)">
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Failed</p>
              <p className="mt-1 text-2xl font-semibold text-(--text-primary)">{summary.failureCount}</p>
            </CardContent>
          </Card>
          <Card className="border-(--border)">
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
        </div>
      )}

      <Card className="border-(--border)">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Audit events</CardTitle>
          <Activity className="h-4 w-4 text-(--text-muted)" aria-hidden="true" />
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

          {events.map((event) => (
            <div key={event.id} className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-(--text-primary)">
                  {event.action ? ACTION_LABELS[event.action] ?? event.action : event.message}
                </p>
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
            </div>
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

      <Card className="border-(--border)">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Session activity</CardTitle>
          <select
            aria-label="Whose sessions"
            value={sessionModeratorId}
            onChange={(event) => setSessionModeratorId(event.target.value)}
            className="h-9 rounded-md border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"
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
              <div className="rounded-2xl border border-(--border) p-3">
                <p className="text-xs text-(--text-muted)">Sessions</p>
                <p className="text-lg font-semibold text-(--text-primary)">{sessions.summary.sessionCount}</p>
              </div>
              <div className="rounded-2xl border border-(--border) p-3">
                <p className="text-xs text-(--text-muted)">Recorded session time</p>
                <p className="text-lg font-semibold text-(--text-primary)">{formatDuration(sessions.summary.totalDurationMs)}</p>
              </div>
              <div className="rounded-2xl border border-(--border) p-3">
                <p className="text-xs text-(--text-muted)">Estimated active time</p>
                <p className="text-lg font-semibold text-(--text-primary)">{formatDuration(sessions.summary.totalActiveMs)}</p>
              </div>
              <div className="rounded-2xl border border-(--border) p-3">
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

          {sessions?.items.map((session) => (
            <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-(--border) p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-(--text-primary)">{session.moderator.fullName}</p>
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
            </div>
          ))}
        </CardContent>
      </Card>
    </motion.div>
  )
}

export default ModerationActivityPage
