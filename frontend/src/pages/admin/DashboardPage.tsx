import { memo, useEffect, useState, type ElementType } from 'react'
import { Users, Swords, DollarSign, Radio, Clock3, Sparkles, ShieldCheck, TrendingUp, Zap, AlertCircle, Activity, CheckCircle2, XCircle, Clock, Gauge } from 'lucide-react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  LineChart,
  YAxis,
  Tooltip,
  Bar,
  XAxis,
  Line,
  Legend,
  CartesianGrid,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { useGetDashboardStatsQuery, useGetChartDataQuery, useGetRecentUsersQuery } from '../../features/admin/admin.api'
import { useGetAutomationStatusQuery, useGetAutomationMetricsQuery, useTriggerManualSyncMutation } from '../../features/admin/adminAutomation.api' 
import { useRealtimeAutomationUpdates } from '../../features/admin/useRealtimeAutomationUpdates'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { formatCurrency } from '../../lib/utils'
import { useSocket } from '../../hooks/useSocket'
import { useGetStreamHealthSummaryQuery } from '../../features/analytics/analytics.api'

const DASHBOARD_QUERY_OPTIONS = {
  refetchOnFocus: true,
  refetchOnReconnect: true,
} as const

const StatCard = memo(function StatCard({ title, value, icon: Icon, isLoading, delay = 0 }: { title: string; value: string | number; icon: ElementType; isLoading: boolean; delay?: number }) {
  return (
  <motion.div
    initial={{ opacity: 0, y: 20, scale: 0.95 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ delay, duration: 0.4, type: 'spring', stiffness: 100 }}
    whileHover={{ y: -5, transition: { duration: 0.2 } }}
  >
    <Card className="relative overflow-hidden rounded-[1.75rem] border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/80 to-(--surface) shadow-[0_30px_70px_var(--shadow)] before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_top_left,rgba(247,199,93,0.1),transparent_40%)]">
      <CardHeader className="flex items-center justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-sm font-semibold uppercase tracking-[0.22em] text-(--text-muted)">{title}</CardTitle>
        </div>
        <motion.div
          className="grid h-11 w-11 place-items-center rounded-2xl bg-linear-to-br from-(--accent) to-(--accent)/80 text-white shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
          whileHover={{ scale: 1.1, rotate: 5 }}
          whileTap={{ scale: 0.95 }}
        >
          <Icon className="h-5 w-5" />
        </motion.div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-14 w-32" />
        ) : (
          <motion.div
            className="text-3xl font-semibold text-(--text-primary) sm:text-4xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: delay + 0.2, duration: 0.3 }}
          >
            {value}
          </motion.div>
        )}
      </CardContent>
    </Card>
  </motion.div>
  )
})

const OverviewCard = memo(function OverviewCard({ title, value, label, icon: Icon, delay = 0 }: { title: string; value: string; label: string; icon: ElementType; delay?: number }) {
  return (
  <motion.div
    initial={{ opacity: 0, x: -20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay, duration: 0.4 }}
    whileHover={{ scale: 1.02 }}
  >
    <Card className="rounded-[1.75rem] border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface) p-4 shadow-[0_30px_70px_var(--shadow)] hover:border-(--accent)/50 transition-all">
      <CardHeader className="flex items-center justify-between pb-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-(--text-muted)">{title}</p>
          <p className="text-xs text-(--text-muted)">{label}</p>
        </div>
        <motion.span
          className="grid h-11 w-11 place-items-center rounded-2xl bg-linear-to-br from-(--accent)/20 to-(--accent)/5 text-(--accent)"
          whileHover={{ scale: 1.15, rotate: -5 }}
        >
          <Icon className="h-5 w-5" />
        </motion.span>
      </CardHeader>
      <CardContent>
        <motion.div
          className="text-3xl font-semibold text-(--text-primary)"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: delay + 0.2, duration: 0.3 }}
        >
          {value}
        </motion.div>
      </CardContent>
    </Card>
  </motion.div>
  )
})

const AdminDashboardPage = () => {
  const { data, isLoading } = useGetDashboardStatsQuery(undefined, DASHBOARD_QUERY_OPTIONS)
  const { adminSocket } = useSocket()
  const [liveViewerCount, setLiveViewerCount] = useState(0)
  const { data: streamHealth } = useGetStreamHealthSummaryQuery()
  const [liveStreamHealth, setLiveStreamHealth] = useState(streamHealth)
  const { data: chartData, isLoading: isChartLoading } = useGetChartDataQuery(undefined, DASHBOARD_QUERY_OPTIONS)
  const { data: recentUsers, isLoading: areRecentUsersLoading } = useGetRecentUsersQuery(undefined, DASHBOARD_QUERY_OPTIONS)
  const { data: automationStatus, isLoading: isAutomationStatusLoading } = useGetAutomationStatusQuery(undefined)
  const { data: automationMetrics, isLoading: isAutomationMetricsLoading } = useGetAutomationMetricsQuery(undefined)
  const [triggerManualSync, { isLoading: isSyncLoading }] = useTriggerManualSyncMutation()
  useRealtimeAutomationUpdates() // Handles all socket events and cache updates

  useEffect(() => {
    const nextCount = Number(data?.totalLiveViewers)
    if (Number.isFinite(nextCount) && nextCount >= 0) setLiveViewerCount(Math.floor(nextCount))
  }, [data?.totalLiveViewers])

  useEffect(() => {
    if (!adminSocket) return
    const handleLiveViewersUpdate = (payload: { totalLiveViewers: number }) => {
      const nextCount = Number(payload?.totalLiveViewers)
      if (Number.isFinite(nextCount) && nextCount >= 0) setLiveViewerCount(Math.floor(nextCount))
    }
    adminSocket.on('liveViewersUpdate', handleLiveViewersUpdate)
    return () => {
      adminSocket.off('liveViewersUpdate', handleLiveViewersUpdate)
    }
  }, [adminSocket])

  useEffect(() => setLiveStreamHealth(streamHealth), [streamHealth])
  useEffect(() => {
    if (!adminSocket) return
    const handleHealth = (payload: NonNullable<typeof streamHealth>) => { setLiveStreamHealth(payload) }
    adminSocket.on('analytics:stream-health', handleHealth)
    return () => { adminSocket.off('analytics:stream-health', handleHealth) }
  }, [adminSocket])

  const revenueValue = typeof data?.totalRevenue === 'number' ? formatCurrency(data.totalRevenue) : formatCurrency(0)
  const recentUsersList = recentUsers ?? []
  const chartSeries = chartData?.revenue ?? []
  const matchHealth = data?.liveMatches ? 'Stable' : 'Attention'
  const paymentSuccessRate = data?.totalTransactions
    ? `${Math.round(((data.successfulPayments ?? 0) / data.totalTransactions) * 100)}%`
    : 'N/A'

  const automationStatusColor = automationStatus?.status === 'IDLE' ? 'bg-green-500' : automationStatus?.status === 'RUNNING' ? 'bg-blue-500' : automationStatus?.status === 'ERROR' ? 'bg-red-500' : 'bg-yellow-500'
  const automationLogCount = automationStatus?.logs?.length ?? 0
  const automationTotalRuns = automationMetrics?.totalRuns ?? 0
  const automationSuccessfulRuns = automationMetrics?.successfulRuns ?? 0
  const automationSuccessRate = automationTotalRuns > 0
    ? `${Math.round((automationSuccessfulRuns / automationTotalRuns) * 100)}%`
    : 'N/A'

  const handleManualSync = async () => {
    try {
      await triggerManualSync().unwrap()
    } catch (error) {
      console.error('Failed to trigger manual sync:', error)
    }
  }

  return (
    <div className="space-y-8">
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="rounded-4xl border border-(--border) bg-[radial-gradient(circle_at_top_left,rgba(247,199,93,0.16),transparent_45%),linear-gradient(180deg,var(--surface-soft),var(--surface))] p-5 shadow-[0_40px_120px_var(--shadow)] sm:p-8 lg:p-10"
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="max-w-2xl space-y-4"
          >
            <motion.div
              className="inline-flex items-center gap-2 rounded-full bg-yellow-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-yellow-200 shadow-sm shadow-yellow-400/10"
              whileHover={{ scale: 1.05 }}
            >
              <Sparkles className="h-4 w-4 text-yellow-300 animate-pulse" />
              Premium Admin
            </motion.div>
            <motion.h1
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="text-3xl font-semibold tracking-tight text-(--text-primary) sm:text-5xl"
            >
              Operations dashboard
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="max-w-2xl text-sm leading-7 text-(--text-muted) sm:text-base sm:leading-8"
            >
              A powerful premium admin experience for monitoring platform health, revenue growth, and real-time match activity.
            </motion.p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-wrap gap-3"
          >
            <Button asChild className="rounded-full px-6 py-3 text-sm font-semibold hover:shadow-lg transition-all">
              <Link to="/admin/analytics">Open analytics</Link>
            </Button>
            <Button variant="secondary" asChild className="rounded-full px-6 py-3 text-sm font-semibold hover:shadow-lg transition-all">
              <Link to="/admin/storage">Storage</Link>
            </Button>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          <StatCard title="Total Revenue" value={revenueValue} icon={DollarSign} isLoading={isLoading} delay={0.1} />
          <StatCard title="Total Users" value={data?.totalUsers ?? 0} icon={Users} isLoading={isLoading} delay={0.15} />
          <StatCard title="Live Matches" value={data?.liveMatches ?? 0} icon={Radio} isLoading={isLoading} delay={0.2} />
          <StatCard title="Live Viewers" value={liveViewerCount} icon={Users} isLoading={isLoading} delay={0.25} />
          <StatCard title="Stream Health" value={liveStreamHealth?.healthPercentage == null ? 'No Active Viewers' : `${liveStreamHealth.healthPercentage}%`} icon={Activity} isLoading={!liveStreamHealth && isLoading} delay={0.3} />
          <StatCard title="Pending Payments" value={data?.pendingPayments ?? 0} icon={Clock3} isLoading={isLoading} delay={0.25} />
          <StatCard title="Active Subscriptions" value={data?.activeSubscriptions ?? 0} icon={ShieldCheck} isLoading={isLoading} delay={0.3} />
          <StatCard title="Premium Users" value={data?.premiumUsers ?? 0} icon={Users} isLoading={isLoading} delay={0.35} />
          <StatCard title="Successful Payments" value={data?.successfulPayments ?? 0} icon={TrendingUp} isLoading={isLoading} delay={0.4} />
          <StatCard title="Total Transactions" value={data?.totalTransactions ?? 0} icon={DollarSign} isLoading={isLoading} delay={0.45} />
          <StatCard title="Rejected Payments" value={data?.rejectedPayments ?? 0} icon={AlertCircle} isLoading={isLoading} delay={0.5} />
        </motion.div>
      </motion.section>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]"
      >
        <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface)">
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <Activity className="h-5 w-5 text-(--accent) animate-pulse" />
                Live activity
              </CardTitle>
              <p className="text-sm text-(--text-muted)">Current platform operations and user flow.</p>
            </div>
            <motion.div
              className="flex items-center gap-2 rounded-full border border-(--border) bg-(--surface-soft) px-3 py-2 text-sm text-(--text-muted)"
              whileHover={{ scale: 1.05 }}
            >
              <ShieldCheck className="h-4 w-4 text-(--accent)" />
              Verified
            </motion.div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <OverviewCard title="Match health" value={matchHealth} label="Live session count" icon={Swords} delay={0.5} />
              <OverviewCard title="Security alerts" value="Low" label="No critical issues" icon={ShieldCheck} delay={0.55} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <OverviewCard title="Payment success" value={paymentSuccessRate} label="Successful transactions" icon={TrendingUp} delay={0.6} />
              <OverviewCard title="System status" value="Online" label="All services running" icon={Sparkles} delay={0.65} />
            </div>
          </CardContent>
        </Card>

        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5, duration: 0.4 }}
        >
          <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface)">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-(--accent)" />
                Quick actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <motion.div
                className="rounded-3xl border border-(--border) bg-linear-to-br from-(--surface-soft)/50 to-(--surface-soft)/30 p-4"
                whileHover={{ scale: 1.02, borderColor: 'var(--accent)' }}
              >
                <p className="text-sm text-(--text-muted)">Review pending payments</p>
                <motion.p
                  className="mt-2 text-2xl font-semibold text-(--text-secondary) flex items-center gap-2"
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                >
                  <Clock className="h-4 w-4 text-(--accent)" />
                  {data?.pendingPayments ?? 0}
                </motion.p>
              </motion.div>
              <motion.div
                className="rounded-3xl border border-(--border) bg-linear-to-br from-(--surface-soft)/50 to-(--surface-soft)/30 p-4"
                whileHover={{ scale: 1.02, borderColor: 'var(--accent)' }}
              >
                <p className="text-sm text-(--text-muted)">Open matches in progress</p>
                <motion.p
                  className="mt-2 text-2xl font-semibold text-(--text-secondary) flex items-center gap-2"
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                >
                  <Radio className="h-4 w-4 text-red-500 animate-pulse" />
                  {data?.liveMatches ?? 0}
                </motion.p>
              </motion.div>
              <motion.div
                className="rounded-3xl border border-(--border) bg-linear-to-br from-(--surface-soft)/50 to-(--surface-soft)/30 p-4"
                whileHover={{ scale: 1.02, borderColor: 'var(--accent)' }}
              >
                <p className="text-sm text-(--text-muted)">Automation logs</p>
                <motion.div
                  className="mt-2 text-2xl font-semibold text-(--text-secondary) flex items-center gap-2"
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                >
                  <Gauge className="h-4 w-4 text-(--accent)" />
                  {isAutomationStatusLoading ? <Skeleton className="h-8 w-12" /> : automationLogCount}
                </motion.div>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Automation Status Section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className="grid gap-6 lg:grid-cols-3"
      >
        <motion.div whileHover={{ y: -5 }} transition={{ type: 'spring', stiffness: 300 }}>
          <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft)/80 via-(--surface-soft)/40 to-(--surface)">
            <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5 text-(--accent)" />
                  Automation status
                </CardTitle>
                <p className="text-sm text-(--text-muted)">Match discovery and stream sync</p>
              </div>
              {!isAutomationStatusLoading && (
                <motion.div
                  className={`h-3 w-3 rounded-full ${automationStatusColor}`}
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                />
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {isAutomationStatusLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                <>
                  <motion.div
                    className="rounded-2xl border border-(--border) bg-linear-to-br from-(--surface-soft)/40 to-(--surface-soft)/10 p-4"
                    whileHover={{ borderColor: 'var(--accent)' }}
                  >
                    <p className="text-xs uppercase tracking-wider text-(--text-muted)">Current status</p>
                    <motion.p
                      className="mt-2 text-xl font-semibold text-(--text-primary) capitalize flex items-center gap-2"
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                    >
                      {automationStatus?.status === 'IDLE' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                      {automationStatus?.status === 'RUNNING' && <Activity className="h-5 w-5 text-blue-500 animate-pulse" />}
                      {automationStatus?.status === 'ERROR' && <XCircle className="h-5 w-5 text-red-500" />}
                      {automationStatus?.status === 'PAUSED' && <Clock className="h-5 w-5 text-yellow-500" />}
                      {automationStatus?.status || 'IDLE'}
                    </motion.p>
                  </motion.div>
                  <motion.div
                    className="rounded-2xl border border-(--border) bg-linear-to-br from-(--surface-soft)/40 to-(--surface-soft)/10 p-4"
                    whileHover={{ borderColor: 'var(--accent)' }}
                  >
                    <p className="text-xs uppercase tracking-wider text-(--text-muted)">Last run</p>
                    <p className="mt-2 text-sm text-(--text-secondary)">
                      {automationStatus?.lastRunAt
                        ? new Date(automationStatus.lastRunAt).toLocaleString()
                        : 'Never'}
                    </p>
                  </motion.div>
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Button
                      onClick={handleManualSync}
                      disabled={isSyncLoading}
                      className="w-full rounded-full bg-linear-to-r from-(--accent) to-(--accent)/80 hover:shadow-lg transition-all"
                    >
                      <Zap className="mr-2 h-4 w-4" />
                      {isSyncLoading ? 'Running...' : 'Trigger manual sync'}
                    </Button>
                  </motion.div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div whileHover={{ y: -5 }} transition={{ type: 'spring', stiffness: 300 }}>
          <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft)/80 via-(--surface-soft)/40 to-(--surface)">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Gauge className="h-5 w-5 text-(--accent)" />
                24h metrics
              </CardTitle>
              <p className="text-sm text-(--text-muted)">Automation performance · live backend metrics</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {isAutomationMetricsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                </div>
              ) : (
                <>
                  <motion.div
                    className="flex items-center justify-between rounded-2xl border border-(--border) bg-linear-to-r from-(--surface-soft)/50 to-transparent p-3 hover:border-(--accent) transition-colors"
                    whileHover={{ x: 5 }}
                  >
                    <span className="text-sm text-(--text-muted)">Runs completed</span>
                    <span className="font-semibold text-(--text-primary) flex items-center gap-1">
                      <Gauge className="h-4 w-4 text-cyan-500" />
                      {automationTotalRuns}
                    </span>
                  </motion.div>
                  <motion.div
                    className="flex items-center justify-between rounded-2xl border border-(--border) bg-linear-to-r from-green-500/10 to-transparent p-3 hover:border-green-500/50 transition-colors"
                    whileHover={{ x: 5 }}
                  >
                    <span className="text-sm text-(--text-muted)">Successful</span>
                    <span className="font-semibold text-green-400 flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4" />
                      {automationSuccessfulRuns}
                    </span>
                  </motion.div>
                  <motion.div
                    className="flex items-center justify-between rounded-2xl border border-(--border) bg-linear-to-r from-red-500/10 to-transparent p-3 hover:border-red-500/50 transition-colors"
                    whileHover={{ x: 5 }}
                  >
                    <span className="text-sm text-(--text-muted)">Failed</span>
                    <span className="font-semibold text-red-400 flex items-center gap-1">
                      <XCircle className="h-4 w-4" />
                      {automationMetrics?.failedRuns ?? 0}
                    </span>
                  </motion.div>
                  <motion.div
                    className="flex items-center justify-between rounded-2xl border border-(--border) bg-linear-to-r from-(--accent)/10 to-transparent p-3 hover:border-(--accent) transition-colors"
                    whileHover={{ x: 5 }}
                  >
                    <span className="text-sm text-(--text-muted)">Success rate</span>
                    <span className="font-semibold text-(--text-primary)">{automationSuccessRate}</span>
                  </motion.div>
                  <motion.div
                    className="flex items-center justify-between rounded-2xl border border-(--border) bg-linear-to-r from-(--surface-soft)/50 to-transparent p-3 hover:border-(--accent) transition-colors"
                    whileHover={{ x: 5 }}
                  >
                    <span className="text-sm text-(--text-muted)">Matches created</span>
                    <span className="font-semibold text-(--text-primary) flex items-center gap-1">
                      <Swords className="h-4 w-4 text-orange-500" />
                      {automationMetrics?.matchesCreatedLast24h ?? 0}
                    </span>
                  </motion.div>
                  <motion.div
                    className="flex items-center justify-between rounded-2xl border border-(--border) bg-linear-to-r from-(--surface-soft)/50 to-transparent p-3 hover:border-(--accent) transition-colors"
                    whileHover={{ x: 5 }}
                  >
                    <span className="text-sm text-(--text-muted)">Streams validated</span>
                    <span className="font-semibold text-(--text-primary) flex items-center gap-1">
                      <Radio className="h-4 w-4 text-red-500" />
                      {automationMetrics?.streamsValidatedLast24h ?? 0}
                    </span>
                  </motion.div>
                  <div className="flex items-center justify-between border-t border-(--border) pt-3 text-xs text-(--text-muted)">
                    <span>Last run</span>
                    <span>{automationMetrics?.lastRunAt ? new Date(automationMetrics.lastRunAt).toLocaleString() : 'No recorded run'}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div whileHover={{ y: -5 }} transition={{ type: 'spring', stiffness: 300 }}>
          <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft)/80 via-(--surface-soft)/40 to-(--surface)">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-(--accent)" />
                Recent logs
              </CardTitle>
              <p className="text-sm text-(--text-muted)">Last automation actions</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {isAutomationStatusLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                </div>
              ) : automationStatus?.logs && automationStatus.logs.length > 0 ? (
                <motion.div className="space-y-2">
                  {automationStatus.logs.slice(0, 5).map((log, index) => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={`rounded-2xl border border-(--border) p-3 ${
                        log.status === 'SUCCESS'
                          ? 'bg-linear-to-r from-green-500/10 to-transparent hover:border-green-500/50'
                          : 'bg-linear-to-r from-red-500/10 to-transparent hover:border-red-500/50'
                      } transition-colors`}
                      whileHover={{ x: 3 }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-xs font-medium uppercase tracking-wider text-(--text-muted)">{log.action.replace(/_/g, ' ')}</p>
                          <p className="mt-1 text-xs text-(--text-secondary)">
                            {log.summary || (log.status === 'SUCCESS' ? 'Completed' : log.status.toLowerCase())}
                          </p>
                        </div>
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ delay: index * 0.05 + 0.1 }}
                        >
                          {log.status === 'SUCCESS' && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                          {log.status === 'FAILED' && <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                        </motion.div>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <p className="text-sm text-(--text-muted)">No logs yet</p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}
        className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]"
      >
        <motion.div whileHover={{ y: -5 }} transition={{ type: 'spring', stiffness: 300 }}>
          <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface)">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-(--accent)" />
                Revenue overview
              </CardTitle>
              <p className="text-xs text-(--text-muted) mt-1">High & Low value trend analysis</p>
            </CardHeader>
            <CardContent>
              {isChartLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartSeries}>
                    <defs>
                      <linearGradient id="colorHigh" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorLow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} stroke="var(--text-muted)" />
                    <YAxis
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => formatCurrency(Number(value))}
                      stroke="var(--text-muted)"
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--surface-strong)',
                        border: '1px solid var(--border)',
                        borderRadius: '12px',
                      }}
                      formatter={(value) => formatCurrency(Number(value))}
                    />
                    <Legend wrapperStyle={{ paddingTop: '20px' }} />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="var(--accent)"
                      strokeWidth={2.5}
                      dot={{ fill: 'var(--accent)', r: 5 }}
                      activeDot={{ r: 7 }}
                      name="Average"
                      isAnimationActive
                    />
                    <Line
                      type="monotone"
                      dataKey="high"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      dot={{ fill: '#8b5cf6', r: 4 }}
                      activeDot={{ r: 6 }}
                      name="High"
                      isAnimationActive
                      strokeDasharray="5 5"
                    />
                    <Line
                      type="monotone"
                      dataKey="low"
                      stroke="#ec4899"
                      strokeWidth={2}
                      dot={{ fill: '#ec4899', r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Low"
                      isAnimationActive
                      strokeDasharray="5 5"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div whileHover={{ y: -5 }} transition={{ type: 'spring', stiffness: 300 }}>
          <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface)">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-(--accent)" />
                Recent sign-ups
              </CardTitle>
              <p className="text-xs text-(--text-muted) mt-1">Latest user registrations</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {areRecentUsersLoading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))
              ) : recentUsersList.length > 0 ? (
                <motion.div className="space-y-3">
                  {recentUsersList.slice(0, 5).map((user, index) => (
                    <motion.div
                      key={user.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.08 }}
                      className="flex items-center justify-between gap-4 rounded-2xl border border-(--border) bg-linear-to-r from-(--surface-soft)/50 to-transparent p-3 hover:border-(--accent) transition-colors"
                      whileHover={{ x: 5 }}
                    >
                      <div className="flex items-center gap-3">
                        <motion.div
                          className="relative"
                          whileHover={{ scale: 1.1 }}
                        >
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={buildCloudinaryUrl(user.avatar)} alt={user.fullName || user.email || ''} />
                            <AvatarFallback className="text-xs font-semibold">
                              {(user.fullName || user.email || '?').charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <motion.div
                            className="absolute inset-0 rounded-full border border-(--accent)"
                            initial={{ opacity: 0 }}
                            whileHover={{ opacity: 1 }}
                          />
                        </motion.div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-(--text-primary) truncate">{user.fullName || user.email}</p>
                          <p className="text-xs text-(--text-muted) truncate">{user.email}</p>
                        </div>
                      </div>
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: index * 0.08 + 0.1 }}
                        className="shrink-0"
                      >
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      </motion.div>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <p className="text-sm text-(--text-muted) text-center py-8">No recent sign-ups yet.</p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </div>
  )
}

export default AdminDashboardPage