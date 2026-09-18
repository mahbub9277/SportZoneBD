/* eslint-disable react-hooks/set-state-in-effect */
import type { ElementType } from 'react'
import { useEffect, useState } from 'react'
import { Users, DollarSign, BarChart, TrendingUp, ShieldCheck, Activity, ArrowUpRight, ArrowDownLeft, Target, Zap, CheckCircle2, MousePointerClick, Eye, Timer } from 'lucide-react'
import { motion } from 'framer-motion'
import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Bar,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { useGetDashboardStatsQuery, useGetChartDataQuery, useGetRecentUsersQuery, useGetAdvertisementAnalyticsQuery } from '../../features/admin/admin.api'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/Avatar'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { Badge } from '../../shared/ui/Badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/Tabs'
import { formatCurrency } from '../../lib/utils'
import { useSocket, type StreamHealthSummary as SocketStreamHealthSummary } from '../../hooks/useSocket'
import { useGetStreamHealthHistoryQuery, useGetStreamHealthSummaryQuery, type StreamHealthSummary } from '../../features/analytics/analytics.api'

const DASHBOARD_QUERY_OPTIONS = {
  refetchOnFocus: false,
  refetchOnReconnect: false,
} as const

const StatCard = ({ title, value, icon: Icon, isLoading, delay = 0, trend }: { title: string; value: string | number; icon: ElementType; isLoading: boolean; delay?: number; trend?: 'up' | 'down' | 'neutral' }) => (
  <motion.div
    initial={{ opacity: 0, y: 20, scale: 0.95 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ delay, duration: 0.4, type: 'spring', stiffness: 100 }}
    whileHover={{ y: -8, transition: { duration: 0.2 } }}
  >
    <Card className="relative overflow-hidden rounded-2xl border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-[0.15em] text-(--text-muted)">{title}</CardTitle>
        <motion.div
          className="grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br from-(--accent) to-(--accent)/80 text-white shadow-[0_4px_16px_rgba(0,0,0,0.2)]"
          whileHover={{ scale: 1.15, rotate: 5 }}
          whileTap={{ scale: 0.9 }}
        >
          <Icon className="h-5 w-5" />
        </motion.div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <Skeleton className="h-10 w-28" />
        ) : (
          <>
            <motion.div
              className="text-3xl font-semibold text-(--text-primary)"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: delay + 0.2, duration: 0.3 }}
            >
              {value}
            </motion.div>
            {trend && (
              <motion.div
                className={`flex items-center gap-1 text-xs font-medium ${
                  trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-gray-500'
                }`}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: delay + 0.3, duration: 0.3 }}
              >
                {trend === 'up' && <ArrowUpRight className="h-4 w-4" />}
                {trend === 'down' && <ArrowDownLeft className="h-4 w-4" />}
                <span>{trend === 'up' ? '+12%' : trend === 'down' ? '-5%' : 'Stable'}</span>
              </motion.div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  </motion.div>
)

export default function AnalyticsPage() {
  const [adPeriod, setAdPeriod] = useState('1')
  const { data, isLoading } = useGetDashboardStatsQuery(undefined, DASHBOARD_QUERY_OPTIONS)
  const { data: chartData, isLoading: isChartLoading } = useGetChartDataQuery(undefined, DASHBOARD_QUERY_OPTIONS)
  const { data: recentUsers, isLoading: areRecentUsersLoading } = useGetRecentUsersQuery(undefined, DASHBOARD_QUERY_OPTIONS)
  const { data: adAnalytics, isLoading: isAdAnalyticsLoading } = useGetAdvertisementAnalyticsQuery(adPeriod, DASHBOARD_QUERY_OPTIONS)
  const { adminSocket } = useSocket()
  const { data: streamHealth, isLoading: isStreamHealthLoading } = useGetStreamHealthSummaryQuery()
  const { data: streamHistory = [], isLoading: isStreamHistoryLoading } = useGetStreamHealthHistoryQuery(60)
  const [socketStreamHealth, setSocketStreamHealth] = useState<StreamHealthSummary | undefined>(undefined)
  const liveStreamHealth = streamHealth ?? socketStreamHealth

  useEffect(() => {
    if (!adminSocket) return
    const handleHealth = (payload: SocketStreamHealthSummary) => setSocketStreamHealth(payload)
    adminSocket.on('analytics:stream-health', handleHealth)
    return () => { adminSocket.off('analytics:stream-health', handleHealth) }
  }, [adminSocket])

  const revenueValue = typeof data?.totalRevenue === 'number' ? formatCurrency(data.totalRevenue) : formatCurrency(0)
  const chartSeries = chartData?.revenue ?? []
  const userSeries = chartData?.userSignups ?? []
  const recentUsersList = recentUsers ?? []
  const totalSignups = userSeries.reduce((sum, item) => sum + item.count, 0)
  const averageSignups = userSeries.length ? Math.round(totalSignups / userSeries.length) : 0
  const monthsActive = chartSeries.length
  const bestMonth = chartSeries.reduce((best, item) => (item.total > best.total ? item : best), { month: 'N/A', total: 0 })

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
        >
          <motion.p
            className="text-sm uppercase tracking-[0.24em] text-(--accent) font-semibold"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.4 }}
          >
            Analytics center
          </motion.p>
          <motion.h1
            className="text-3xl font-semibold text-(--text-primary) sm:text-4xl mt-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            Revenue and growth insights
          </motion.h1>
          <motion.p
            className="max-w-2xl text-sm leading-7 text-(--text-muted) mt-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25, duration: 0.4 }}
          >
            Deep dive into business trends, user acquisition, and revenue performance to make faster decisions.
          </motion.p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          className="flex flex-wrap items-center gap-3"
        >
          <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
            <Badge tone="green">Live data</Badge>
          </motion.div>
          <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
            <Badge tone="gold">Revenue trend</Badge>
          </motion.div>
        </motion.div>
      </motion.div>

      <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
        <Card className="overflow-hidden border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/85 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
          <CardHeader className="border-b border-(--border)/70 bg-linear-to-r from-(--surface-soft)/70 via-(--surface-soft)/40 to-transparent pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-linear-to-br from-(--accent) to-(--accent)/70 text-white shadow-[0_8px_24px_rgba(124,92,255,0.35)]">
                <Activity className="h-4 w-4" />
              </span>
              Stream Quality &amp; Player Telemetry
            </CardTitle>
            <p className="text-sm text-(--text-muted)">Live playback health from active player sessions.</p>
          </CardHeader>
          <CardContent className="space-y-6 px-4 pb-5 pt-5 sm:px-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <MetricPill tone="accent" label="Health" value={liveStreamHealth?.healthPercentage == null ? 'No Active Viewers' : `${liveStreamHealth.healthPercentage}%`} />
              <MetricPill tone="blue" label="Active viewers" value={liveStreamHealth?.totalActiveViewers ?? 0} />
              <MetricPill tone="green" label="Healthy" value={liveStreamHealth?.healthyViewers ?? 0} />
              <MetricPill tone="amber" label="Buffering" value={liveStreamHealth?.bufferingViewers ?? 0} />
              <MetricPill tone="red" label="Errors" value={liveStreamHealth?.errorViewers ?? 0} />
            </div>
            {isStreamHistoryLoading ? <Skeleton className="h-64 w-full" /> : <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3"><ResponsiveContainer width="100%" height={260}><LineChart data={streamHistory}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="timestamp" tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} stroke="var(--text-muted)" /><YAxis allowDecimals={false} stroke="var(--text-muted)" /><Tooltip contentStyle={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--text-primary)' }} labelFormatter={(value) => new Date(Number(value)).toLocaleString()} /><Legend wrapperStyle={{ color: 'var(--text-muted)', paddingTop: '10px' }} /><Line type="monotone" dataKey="activeViewers" stroke="var(--accent)" strokeWidth={3} dot={false} name="Active viewers" /><Line type="monotone" dataKey="bufferingViewers" stroke="#f59e0b" strokeWidth={2.5} dot={false} name="Buffering" /><Line type="monotone" dataKey="errorViewers" stroke="#ef4444" strokeWidth={2.5} dot={false} name="Errors" /></LineChart></ResponsiveContainer></div>}
            <div className="overflow-hidden rounded-2xl border border-(--border) bg-(--surface-soft)/40">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-(--border) bg-(--surface-soft)/70 text-xs uppercase tracking-[0.16em] text-(--text-muted)">
                  <tr>
                    <th className="px-3 py-3">Stream identity</th>
                    <th className="px-3 py-3">Errors</th>
                    <th className="px-3 py-3">Active viewers</th>
                  </tr>
                </thead>
                <tbody>{(liveStreamHealth?.topErroredStreams ?? []).map((stream) => <tr key={stream.resource} className="border-b border-(--border)/60 transition-colors hover:bg-(--surface-soft)/80"><td className="max-w-140 truncate px-3 py-2.5 text-(--text-primary)">{stream.resource}</td><td className="px-3 py-2.5 text-red-300">{stream.errorCount}</td><td className="px-3 py-2.5 text-(--text-muted)">{stream.activeViewers}</td></tr>)}{!isStreamHealthLoading && (liveStreamHealth?.topErroredStreams ?? []).length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-(--text-muted)">No errored streams in the active window.</td></tr>}</tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </motion.section>

      <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28, duration: 0.45 }} className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--accent)">Advertisement performance</p><h2 className="mt-1 text-2xl font-semibold text-(--text-primary)">Sponsor reach and unlock activity</h2></div>
          <select value={adPeriod} onChange={(event) => setAdPeriod(event.target.value)} className="h-10 rounded-xl border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)" aria-label="Advertisement reporting period">
            <option value="1">Last 1 month</option><option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="9">Last 9 months</option><option value="12">Last 12 months</option><option value="all">All time</option>
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Ad impressions" value={adAnalytics?.impressions ?? 0} icon={Eye} isLoading={isAdAnalyticsLoading} delay={0.1} />
          <StatCard title="Watch clicks" value={adAnalytics?.watchClicks ?? 0} icon={MousePointerClick} isLoading={isAdAnalyticsLoading} delay={0.15} />
          <StatCard title="Completed sessions" value={adAnalytics?.sessionsCompleted ?? 0} icon={CheckCircle2} isLoading={isAdAnalyticsLoading} delay={0.2} trend="up" />
          <StatCard title="Unique users" value={adAnalytics?.uniqueUsers ?? 0} icon={Users} isLoading={isAdAnalyticsLoading} delay={0.25} />
        </div>
        <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface)"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Timer className="h-5 w-5 text-(--accent)" />Audience and session status</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3"><MetricPill label="Standard activity" value={adAnalytics?.standardEvents ?? 0} /><MetricPill label="Premium activity" value={adAnalytics?.premiumEvents ?? 0} /><MetricPill label="Guest activity" value={adAnalytics?.guestEvents ?? 0} /><MetricPill label="Started" value={adAnalytics?.sessionsStarted ?? 0} /><MetricPill label="Cancelled" value={adAnalytics?.sessionsCancelled ?? 0} /><MetricPill label="Total events" value={adAnalytics?.totalEvents ?? 0} /></CardContent></Card>
      </motion.section>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard title="Total Revenue" value={revenueValue} icon={DollarSign} isLoading={isLoading} delay={0.1} trend="up" />
        <StatCard title="Total Users" value={data?.totalUsers ?? 0} icon={Users} isLoading={isLoading} delay={0.15} trend="up" />
        <StatCard title="Premium Users" value={data?.premiumUsers ?? 0} icon={ShieldCheck} isLoading={isLoading} delay={0.2} trend="up" />
        <StatCard title="Successful Payments" value={data?.successfulPayments ?? 0} icon={TrendingUp} isLoading={isLoading} delay={0.25} trend="up" />
        <StatCard title="Avg Daily Signups" value={averageSignups} icon={Users} isLoading={isChartLoading} delay={0.3} trend="neutral" />
        <StatCard title="Best Month" value={bestMonth.month ?? 'N/A'} icon={BarChart} isLoading={isChartLoading} delay={0.35} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="grid gap-6 xl:grid-cols-[1.6fr_0.9fr]"
      >
        <motion.div whileHover={{ y: -5 }} transition={{ type: 'spring', stiffness: 300 }}>
          <Card className="min-h-0 xl:min-h-140 border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface)">
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.4 }}
              >
                <CardTitle className="text-xl flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-(--accent)" />
                  Trend Explorer
                </CardTitle>
                <p className="text-sm text-(--text-muted)">Switch between revenue and user growth views.</p>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5, duration: 0.4 }}
                className="flex items-center gap-2 text-sm text-(--text-muted)"
              >
                <ShieldCheck className="h-4 w-4 text-(--accent)" />
                <span>Secure dashboard metrics</span>
              </motion.div>
            </CardHeader>

            <CardContent>
              <Tabs defaultValue="revenue" className="w-full">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.55, duration: 0.4 }}
                >
                  <TabsList className="grid w-full grid-cols-2 bg-(--surface-soft)">
                    <TabsTrigger
                      value="revenue"
                      className="relative data-[state=active]:bg-linear-to-r data-[state=active]:from-(--accent) data-[state=active]:to-(--accent)/80 data-[state=active]:text-white transition-all rounded-lg"
                    >
                      <BarChart className="mr-2 h-4 w-4" />
                      Revenue
                    </TabsTrigger>
                    <TabsTrigger
                      value="users"
                      className="relative data-[state=active]:bg-linear-to-r data-[state=active]:from-(--accent) data-[state=active]:to-(--accent)/80 data-[state=active]:text-white transition-all rounded-lg"
                    >
                      <Users className="mr-2 h-4 w-4" />
                      User growth
                    </TabsTrigger>
                  </TabsList>
                </motion.div>

                <TabsContent value="revenue" className="mt-4">
                  {isChartLoading ? (
                    <Skeleton className="h-80 w-full" />
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.6, duration: 0.4 }}
                    >
                      <ResponsiveContainer width="100%" height={320} minWidth={0}>
                        <RechartsBarChart data={chartSeries}>
                          <defs>
                            <linearGradient id="colorBar" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.9} />
                              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.3} />
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
                          <Legend wrapperStyle={{ color: 'var(--text-muted)', paddingTop: '20px' }} />
                          <Bar dataKey="total" name="Revenue" fill="url(#colorBar)" radius={[8, 8, 0, 0]} />
                        </RechartsBarChart>
                      </ResponsiveContainer>
                    </motion.div>
                  )}
                </TabsContent>

                <TabsContent value="users" className="mt-4">
                  {isChartLoading ? (
                    <Skeleton className="h-80 w-full" />
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.6, duration: 0.4 }}
                    >
                      <ResponsiveContainer width="100%" height={320} minWidth={0}>
                        <LineChart data={userSeries} margin={{ left: -12, right: -12, top: 20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="4 4" stroke="var(--border)" />
                          <XAxis dataKey="day" fontSize={12} tickLine={false} axisLine={false} stroke="var(--text-muted)" />
                          <YAxis fontSize={12} tickLine={false} axisLine={false} stroke="var(--text-muted)" />
                          <Tooltip
                            contentStyle={{
                              background: 'var(--surface-strong)',
                              border: '1px solid var(--border)',
                              borderRadius: '12px',
                            }}
                          />
                          <Legend wrapperStyle={{ color: 'var(--text-muted)', paddingTop: '20px' }} />
                          <Line
                            type="monotone"
                            dataKey="count"
                            name="Signups"
                            stroke="var(--accent)"
                            strokeWidth={3}
                            dot={{ fill: 'var(--accent)', r: 5 }}
                            activeDot={{ r: 7 }}
                            isAnimationActive
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </motion.div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.45, duration: 0.4 }}
          className="space-y-6"
        >
          <motion.div whileHover={{ y: -5 }} transition={{ type: 'spring', stiffness: 300 }}>
            <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface)">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Target className="h-5 w-5 text-(--accent)" />
                  Key insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5, duration: 0.3 }}
                  className="rounded-2xl border border-(--border) bg-linear-to-br from-(--surface-soft)/50 to-(--surface-soft)/30 p-4 hover:border-(--accent) transition-colors"
                  whileHover={{ scale: 1.02 }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wider font-semibold text-(--accent)">Revenue peak</p>
                      <p className="mt-2 text-2xl font-semibold text-(--text-primary)">{bestMonth.month}</p>
                      <p className="mt-1 text-xs text-(--text-muted)">Highest monthly revenue recorded.</p>
                    </div>
                    <ArrowUpRight className="h-5 w-5 text-green-500 shrink-0" />
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.55, duration: 0.3 }}
                  className="rounded-2xl border border-(--border) bg-linear-to-br from-(--surface-soft)/50 to-(--surface-soft)/30 p-4 hover:border-(--accent) transition-colors"
                  whileHover={{ scale: 1.02 }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wider font-semibold text-(--accent)">Average signups</p>
                      <p className="mt-2 text-2xl font-semibold text-(--text-primary)">{averageSignups}</p>
                      <p className="mt-1 text-xs text-(--text-muted)">Daily signup momentum over the current window.</p>
                    </div>
                    <Users className="h-5 w-5 text-blue-500 shrink-0" />
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6, duration: 0.3 }}
                  className="rounded-2xl border border-(--border) bg-linear-to-br from-(--surface-soft)/50 to-(--surface-soft)/30 p-4 hover:border-(--accent) transition-colors"
                  whileHover={{ scale: 1.02 }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wider font-semibold text-(--accent)">Revenue confidence</p>
                      <p className="mt-2 text-2xl font-semibold text-(--text-primary)">{monthsActive} months</p>
                      <p className="mt-1 text-xs text-(--text-muted)">Data covers the last year of reporting.</p>
                    </div>
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                  </div>
                </motion.div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div whileHover={{ y: -5 }} transition={{ type: 'spring', stiffness: 300 }}>
            <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface)">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-(--accent) animate-pulse" />
                  Recent sign-ups
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {areRecentUsersLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Skeleton key={index} className="h-14 w-full" />
                    ))}
                  </div>
                ) : recentUsersList.length > 0 ? (
                  <motion.div className="space-y-3">
                    {recentUsersList.slice(0, 5).map((user, index) => (
                      <motion.div
                        key={user.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.65 + index * 0.06 }}
                        className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-(--border) bg-linear-to-r from-(--surface-soft)/50 to-transparent p-3 sm:p-4 hover:border-(--accent) transition-colors"
                        whileHover={{ x: 3 }}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <motion.div
                            whileHover={{ scale: 1.1 }}
                            className="relative shrink-0"
                          >
                            <Avatar>
                              <AvatarImage src={buildCloudinaryUrl(user.avatar)} alt={user.fullName || user.email || ''} />
                              <AvatarFallback>{(user.fullName || user.email || '?').charAt(0).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <motion.div
                              className="absolute inset-0 rounded-full border border-(--accent)"
                              initial={{ opacity: 0 }}
                              whileHover={{ opacity: 1 }}
                            />
                          </motion.div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-(--text-primary)">{user.fullName || user.email}</p>
                            <p className="truncate text-xs text-(--text-muted)">{user.email}</p>
                          </div>
                        </div>
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ delay: 0.65 + index * 0.06 + 0.1 }}
                          className="shrink-0"
                        >
                          <Badge tone="gold">Recent</Badge>
                        </motion.div>
                      </motion.div>
                    ))}
                  </motion.div>
                ) : (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-sm text-(--text-muted) text-center py-6"
                  >
                    No recent sign-ups available.
                  </motion.p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.85, duration: 0.5 }}
        whileHover={{ y: -2 }}
      >
        <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface)">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-(--accent)" />
              Analytics notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {[
                'Revenue is updated from your admin dashboard API and reflects real backend totals.',
                'Use the user growth tab to compare daily acquisition trends and identify signup spikes.',
                'For deeper operational control, return to the dashboard overview and review live matches and pending payments.',
              ].map((note, index) => (
                <motion.li
                  key={index}
                  initial={{ opacity: 0, x: -15 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.9 + index * 0.08 }}
                  className="flex items-start gap-3 group"
                >
                  <motion.span
                    className="mt-1 h-2.5 w-2.5 rounded-full bg-linear-to-br from-(--accent) to-(--accent)/60 shrink-0 shadow-[0_2px_8px_var(--accent)]"
                    whileHover={{ scale: 1.3, rotate: 180 }}
                  />
                  <span className="text-sm text-(--text-muted) group-hover:text-(--text-primary) transition-colors leading-6">
                    {note}
                  </span>
                </motion.li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}

function MetricPill({ label, value, tone = 'neutral' }: { label: string; value: number | string; tone?: 'neutral' | 'accent' | 'blue' | 'green' | 'amber' | 'red' }) {
  const tones = {
    neutral: {
      container: 'border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface-soft)/60',
      label: 'text-(--text-muted)',
      value: 'text-(--text-primary)',
    },
    accent: {
      container: 'border-(--accent)/40 bg-linear-to-br from-(--accent)/10 via-(--surface-soft) to-(--surface-soft)',
      label: 'text-(--accent)',
      value: 'text-(--text-primary)',
    },
    blue: {
      container: 'border-sky-400/30 bg-linear-to-br from-sky-500/10 via-(--surface-soft) to-(--surface-soft)',
      label: 'text-sky-300',
      value: 'text-(--text-primary)',
    },
    green: {
      container: 'border-emerald-400/30 bg-linear-to-br from-emerald-500/10 via-(--surface-soft) to-(--surface-soft)',
      label: 'text-emerald-300',
      value: 'text-(--text-primary)',
    },
    amber: {
      container: 'border-amber-400/30 bg-linear-to-br from-amber-500/10 via-(--surface-soft) to-(--surface-soft)',
      label: 'text-amber-300',
      value: 'text-(--text-primary)',
    },
    red: {
      container: 'border-red-400/30 bg-linear-to-br from-red-500/10 via-(--surface-soft) to-(--surface-soft)',
      label: 'text-red-300',
      value: 'text-(--text-primary)',
    },
  }

  const palette = tones[tone]

  return (
    <div className={`rounded-2xl border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] ${palette.container}`}>
      <p className={`text-xs uppercase tracking-[0.14em] ${palette.label}`}>{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${palette.value}`}>{value}</p>
    </div>
  )
}
