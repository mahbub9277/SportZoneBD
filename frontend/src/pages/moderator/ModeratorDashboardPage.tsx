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
  ShieldCheck,
  Sparkles,
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
  'payment.review.rechecked': 'Payment rechecked',
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
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative isolate overflow-hidden rounded-4xl border border-(--border) bg-linear-to-br from-sky-500/10 via-(--surface) to-indigo-500/10 p-5 shadow-sm sm:p-7"
      >
        <motion.div
          aria-hidden="true"
          className="absolute -right-10 -top-16 h-52 w-52 rounded-full bg-sky-500/10 blur-3xl"
          animate={{ x: [0, -10, 0], y: [0, 8, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <ShieldCheck className="pointer-events-none absolute -bottom-10 right-8 h-44 w-44 rotate-12 text-sky-500/5" aria-hidden="true" />
        <div className="relative flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-sky-500 to-indigo-500 text-white shadow-lg shadow-sky-500/20">
              <Sparkles className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <span className="mb-2 inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-300">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                Moderator workspace
              </span>
              <h1 className="text-2xl font-semibold tracking-tight text-(--text-primary) sm:text-3xl">{welcome.greeting}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-(--text-muted)">{welcome.text}</p>
            </div>
          </div>
          <motion.div
            whileHover={{ y: -2 }}
            className="flex shrink-0 items-center gap-3 rounded-2xl border border-(--border) bg-(--surface)/80 px-4 py-3 shadow-sm backdrop-blur"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-(--text-primary)">Your workspace</span>
              <span className="block text-xs text-(--text-muted)">{modules.length} modules available</span>
            </span>
          </motion.div>
        </div>
      </motion.section>

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
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.08 }}
          transition={{ duration: 0.4 }}
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {modules.map((module) => (
            <motion.div key={module.path} whileHover={{ y: -4, scale: 1.01 }} whileTap={{ scale: 0.99 }}>
              <Link
                to={`${base}/${module.path}`}
                className="group flex h-full items-center gap-4 rounded-3xl border border-(--border) bg-(--surface-soft)/70 p-5 shadow-sm transition-colors hover:border-(--accent)/50 hover:bg-(--surface)"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-(--accent)/20 to-(--accent)/5 text-(--accent) shadow-inner transition-transform group-hover:scale-105">
                  <DynamicIcon name={module.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-(--text-primary)">{module.label}</span>
                  <span className="mt-1 block text-xs text-(--text-muted)">Open module <span aria-hidden="true" className="ml-1 text-(--accent)">↗</span></span>
                </span>
              </Link>
            </motion.div>
          ))}
        </motion.section>
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
    <Card className="group h-full border-(--border) bg-linear-to-br from-(--surface) to-(--surface-soft)/50 shadow-sm transition-colors hover:border-(--accent)/50">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-(--text-primary)">{value}</p>
          {hint && <p className="mt-1 text-xs text-(--text-muted)">{hint}</p>}
        </div>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-(--accent)/10 text-(--accent) ring-1 ring-inset ring-(--accent)/10 transition-transform group-hover:scale-110">
          <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </span>
      </CardContent>
    </Card>
  )

  return to ? (
    <Link to={to} className="block h-full">
      <motion.div whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} className="h-full">{body}</motion.div>
    </Link>
  ) : body
}

function SummarySection({ summary, isLoading }: { summary?: ModerationSummary; isLoading: boolean }) {
  const base = useConsoleBase()

  if (isLoading && !summary) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.08 }}
        transition={{ duration: 0.4 }}
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-3xl" />)}
      </motion.section>
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
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.4 }}
      className="grid gap-4 lg:grid-cols-[2fr_1fr]"
    >
      <Card className="border-(--border) shadow-sm">
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
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-start justify-between gap-3 rounded-2xl border border-(--border) bg-(--surface-soft)/50 p-3 transition-colors hover:border-(--accent)/30"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
                  event.outcome === 'success' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
                }`}>
                  {event.outcome === 'success' ? <BadgeCheck className="h-4 w-4" aria-hidden="true" /> : <ShieldAlert className="h-4 w-4" aria-hidden="true" />}
                </span>
                <div className="min-w-0">
                <p className="truncate text-sm font-medium text-(--text-primary)">
                  {event.action ? ACTION_LABELS[event.action] ?? event.action : event.message}
                </p>
                <p className="mt-0.5 text-xs text-(--text-muted)">
                  {event.actorName ?? 'Unknown actor'} · {formatMoment(event.createdAt)}
                  {event.reason ? ` · ${event.reason}` : ''}
                </p>
              </div>
              </div>
              <Badge variant={event.outcome === 'success' ? 'success' : 'destructive'}>
                {event.outcome === 'success' ? 'OK' : 'Failed'}
              </Badge>
            </motion.div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-(--border) shadow-sm">
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
    </motion.section>
  )
}

export default ModeratorDashboardPage
