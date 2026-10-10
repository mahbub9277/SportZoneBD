import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Activity,
  BadgeCheck,
  BellRing,
  ClipboardList,
  Clock,
  FileText,
  Mail,
  Receipt,
  ShieldAlert,
  Star,
  TrendingUp,
} from 'lucide-react'

import { useAppSelector } from '../../app/hooks'
import { selectCurrentUser } from '../../features/auth/authSlice'
import { getUserPermissions } from '../../features/auth/roleExperience'
import { useGetModerationSummaryQuery, type ModerationSummary } from '../../features/moderation/moderation.api'
import { buildWelcomeMessage } from '../../features/moderation/welcome'
import { useConsoleBase } from '../../features/console/consoleBase'
import { selectConsoleModules } from '../../features/console/config/consoleNav.config'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Skeleton } from '../../components/ui/Skeleton'
import { DynamicIcon } from '../../components/DynamicIcon'

/** Durations are shown as hours and minutes, never as a productivity score. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const minutes = Math.round(ms / 60000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

function formatMoment(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const ACTION_LABELS: Record<string, string> = {
  'report.status.updated': 'Report updated',
  'payment.review.approved': 'Payment approved',
  'payment.review.rejected': 'Payment rejected',
  'push.campaign.sent': 'Push campaign',
  'email.campaign.sent': 'Email campaign',
}

export function ModeratorDashboardPage() {
  const user = useAppSelector(selectCurrentUser)
  const base = useConsoleBase()
  const permissions = getUserPermissions(user)
  const modules = selectConsoleModules(permissions)
  const { data, isLoading, isError, refetch } = useGetModerationSummaryQuery()
  const welcome = buildWelcomeMessage({ displayName: user?.fullName })

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      <Card className="overflow-hidden border-(--border)">
        <CardContent className="flex flex-col gap-2 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-(--text-muted)">Moderator console</p>
          <h1 className="text-2xl font-semibold text-(--text-primary) sm:text-3xl">{welcome.greeting}</h1>
          <p className="max-w-3xl text-sm text-(--text-muted)">{welcome.text}</p>
        </CardContent>
      </Card>

      {isError ? (
        <Card className="border-(--border)">
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-500/15 text-amber-500">
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-(--text-primary)">Summary unavailable</h2>
              <p className="mt-1 text-sm text-(--text-muted)">
                Your moderation figures could not be loaded. Nothing is shown rather than a number that might be wrong.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-full border border-(--border) px-4 py-2 text-sm font-medium text-(--text-primary) hover:bg-(--surface-soft)"
            >
              Try again
            </button>
          </CardContent>
        </Card>
      ) : (
        <>
          <SummarySection summary={data} isLoading={isLoading} />
          <RecentActivity summary={data} isLoading={isLoading} />
        </>
      )}

      {modules.length === 0 ? (
        <Card className="border-(--border) p-6">
          <CardContent className="flex flex-col items-start gap-3 p-0">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-500/15 text-amber-500">
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-(--text-primary)">No modules assigned</h2>
              <p className="mt-1 max-w-2xl text-sm text-(--text-muted)">
                Your moderator account does not currently have any modules assigned. Ask an administrator to review your
                role permissions.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => (
            <motion.div key={module.path} whileHover={{ y: -4 }}>
              <Link
                to={`${base}/${module.path}`}
                className="flex h-full items-center gap-4 rounded-3xl border border-(--border) bg-(--surface-soft)/70 p-5 transition hover:border-(--accent)/40 hover:bg-(--surface)"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-(--accent)/15 text-(--accent)">
                  <DynamicIcon name={module.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-(--text-primary)">{module.label}</span>
                  <span className="block text-xs text-(--text-muted)">Open module</span>
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

interface SummaryCardProps {
  label: string
  value: string | number
  hint?: string
  icon: typeof FileText
  to?: string
}

function SummaryCard({ label, value, hint, icon: Icon, to }: SummaryCardProps) {
  const body = (
    <Card className="h-full border-(--border) transition hover:border-(--accent)/40">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-(--text-primary)">{value}</p>
          {hint && <p className="mt-1 text-xs text-(--text-muted)">{hint}</p>}
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-(--accent)/15 text-(--accent)">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </CardContent>
    </Card>
  )

  return to ? <Link to={to} className="block h-full">{body}</Link> : body
}

function SummarySection({ summary, isLoading }: { summary?: ModerationSummary; isLoading: boolean }) {
  const base = useConsoleBase()

  if (isLoading && !summary) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-3xl" />)}
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        label="Reports awaiting action"
        value={summary?.reports.awaitingAction ?? 0}
        hint={`${summary?.reports.resolved ?? 0} resolved · ${summary?.reports.closed ?? 0} closed`}
        icon={FileText}
        to={`${base}/reports`}
      />
      <SummaryCard
        label="Reports resolved by me"
        value={summary?.reports.resolvedByMe ?? 0}
        hint="Last 30 days"
        icon={BadgeCheck}
        to={`${base}/activity`}
      />
      <SummaryCard
        label="Payments awaiting review"
        value={summary?.payments.awaitingReview ?? 0}
        hint={`${summary?.payments.approvedTotal ?? 0} approved in total`}
        icon={Receipt}
        to={`${base}/payment-review`}
      />
      <SummaryCard
        label="Payments reviewed by me"
        value={summary?.payments.reviewedByMe ?? 0}
        hint={`${summary?.payments.rejectedTotal ?? 0} rejected in total`}
        icon={ClipboardList}
        to={`${base}/activity`}
      />
      <SummaryCard
        label="Active premium members"
        value={summary?.premium.activeMembers ?? 0}
        hint={`${summary?.premium.expiringWithin7Days ?? 0} expiring within 7 days`}
        icon={Star}
        to={`${base}/premium-members`}
      />
      <SummaryCard
        label="Push campaigns"
        value={summary?.campaigns.pushCampaigns ?? 0}
        hint={`${summary?.campaigns.pushQueuedRecipients ?? 0} recipients queued${
          summary?.campaigns.countIsCapped ? ' (most recent campaigns)' : ''
        }`}
        icon={BellRing}
        to={`${base}/push-campaigns`}
      />
      <SummaryCard
        label="Email campaigns"
        value={summary?.campaigns.emailCampaigns ?? 0}
        hint={`${summary?.campaigns.emailsSent ?? 0} accepted · ${summary?.campaigns.emailsFailed ?? 0} failed${
          summary?.campaigns.countIsCapped ? ' (most recent campaigns)' : ''
        }`}
        icon={Mail}
        to={`${base}/email-campaigns`}
      />
      <SummaryCard
        label="My recorded actions"
        value={summary?.activity.recordedActions ?? 0}
        hint={`Sessions: ${summary?.activity.sessionCount ?? 0}`}
        icon={Activity}
        to={`${base}/activity`}
      />
    </div>
  )
}

function RecentActivity({ summary, isLoading }: { summary?: ModerationSummary; isLoading: boolean }) {
  const activity = summary?.activity

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card className="border-(--border)">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Recent moderation actions</CardTitle>
          <TrendingUp className="h-4 w-4 text-(--text-muted)" aria-hidden="true" />
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && !summary && <Skeleton className="h-24 rounded-2xl" />}
          {!isLoading && (summary?.recentEvents.length ?? 0) === 0 && (
            <p className="text-sm text-(--text-muted)">
              No moderation actions were recorded in the last 30 days. New actions appear here as soon as they are made.
            </p>
          )}
          {summary?.recentEvents.map((event) => (
            <div key={event.id} className="flex items-start justify-between gap-3 rounded-2xl border border-(--border) bg-(--surface-soft)/50 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-(--text-primary)">
                  {event.action ? ACTION_LABELS[event.action] ?? event.action : event.message}
                </p>
                <p className="mt-0.5 text-xs text-(--text-muted)">
                  {event.actorName ?? 'Unknown actor'} · {formatMoment(event.createdAt)}
                  {event.reason ? ` · ${event.reason}` : ''}
                </p>
              </div>
              <Badge variant={event.outcome === 'success' ? 'success' : 'destructive'}>
                {event.outcome === 'success' ? 'OK' : 'Failed'}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-(--border)">
        <CardHeader>
          <CardTitle className="text-base">Session activity (30 days)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-(--text-muted)">Sessions</span>
            <span className="font-medium text-(--text-primary)">{activity?.sessionCount ?? 0}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-(--text-muted)">Recorded session time</span>
            <span className="font-medium text-(--text-primary)">{formatDuration(activity?.totalSessionMs ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-(--text-muted)">Estimated active time</span>
            <span className="font-medium text-(--text-primary)">{formatDuration(activity?.estimatedActiveMs ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-(--text-muted)">Last recorded activity</span>
            <span className="font-medium text-(--text-primary)">{formatMoment(activity?.lastSeenAt ?? null)}</span>
          </div>
          <div className="rounded-2xl bg-(--surface-soft)/60 p-3 text-xs text-(--text-muted)">
            <p className="flex items-center gap-2 font-medium text-(--text-primary)">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              What these numbers mean
            </p>
            <p className="mt-1">
              Session time is measured from real session records. Active time stops counting 30 minutes after the last
              recorded activity, so an abandoned tab is not counted as work.
              {(activity?.estimatedSessionCount ?? 0) > 0
                ? ` ${activity?.estimatedSessionCount} session(s) have no recorded end yet, so their time is an estimate.`
                : ''}
            </p>
            <p className="mt-1">
              How long each action took is not measured, so no per-action duration is shown.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default ModeratorDashboardPage
