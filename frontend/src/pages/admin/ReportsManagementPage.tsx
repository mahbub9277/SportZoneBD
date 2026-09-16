import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Bug, CheckCircle2, FileSearch, LifeBuoy, MessageSquareWarning, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Label } from '../../components/ui/Label'
import { Textarea } from '../../components/ui/Textarea'
import { useGetDashboardStatsQuery, useGetChartDataQuery } from '../../features/admin/admin.api'
import { useCreateReportMutation, useGetAdminReportsQuery, useUpdateReportStatusMutation, type ReportCategory, type ReportItem, type ReportStatus } from '../../features/reports/reports.api'
import { useDebounce } from '../../hooks/useDebounce'
import { DescriptionGenerator } from '../../components/ai/DescriptionGenerator'

interface DashboardReportItem {
  id: string
  name: string
  category: string
  status: string
}

const reportCategoryOptions: Array<{ value: ReportCategory; label: string; icon: typeof Bug }> = [
  { value: 'Bug', label: 'Bug / crash', icon: Bug },
  { value: 'Playback', label: 'Stream / playback', icon: AlertTriangle },
  { value: 'Payment', label: 'Payment issue', icon: LifeBuoy },
  { value: 'Account', label: 'Account access', icon: MessageSquareWarning },
  { value: 'Content', label: 'Content issue', icon: CheckCircle2 },
]
const emptyReports: ReportItem[] = []

export default function ReportsManagementPage() {
  const [query, setQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState<ReportCategory | 'ALL'>('ALL')
  const [filterStatus, setFilterStatus] = useState<ReportStatus | 'ALL'>('ALL')
  const debouncedQuery = useDebounce(query, 300)
  const [category, setCategory] = useState<ReportCategory>('Bug')
  const [summary, setSummary] = useState('')
  const [details, setDetails] = useState('')
  const { data: dashboardData, isLoading: isLoadingStats } = useGetDashboardStatsQuery()
  const { data: chartData, isLoading: isLoadingChart } = useGetChartDataQuery()
  const reportsQuery = useGetAdminReportsQuery({
    ...(filterCategory !== 'ALL' ? { category: filterCategory } : {}),
    ...(filterStatus !== 'ALL' ? { status: filterStatus } : {}),
    ...(debouncedQuery.trim() ? { search: debouncedQuery.trim() } : {}),
  })
  const adminReports = reportsQuery.data ?? emptyReports
  const { isLoading: isLoadingReports, isError: isReportsError } = reportsQuery
  const [createReport, { isLoading: isCreating }] = useCreateReportMutation()
  const [updateReportStatus, { isLoading: isUpdatingStatus }] = useUpdateReportStatusMutation()

  const reports = useMemo<DashboardReportItem[]>(() => {
    const revenueMonths = chartData?.revenue?.length ?? 0
    const reportList: DashboardReportItem[] = [
      {
        id: 'dashboard-stats',
        name: 'Admin dashboard summary',
        category: 'Analytics',
        status: `Revenue data: ${revenueMonths} month${revenueMonths === 1 ? '' : 's'}`,
      },
      {
        id: 'revenue',
        name: 'Revenue snapshot',
        category: 'Finance',
        status: `$${(dashboardData?.totalRevenue ?? 0).toLocaleString()}`,
      },
      {
        id: 'users',
        name: 'User activity overview',
        category: 'Users',
        status: `${dashboardData?.totalUsers ?? 0} total users`,
      },
      {
        id: 'payments',
        name: 'Pending payment status',
        category: 'Payments',
        status: `${dashboardData?.pendingPayments ?? 0} awaiting review`,
      },
    ]

    return reportList
  }, [chartData, dashboardData])

  const normalizedQuery = query.trim().toLowerCase()
  const filteredSnapshot = reports.filter((report) =>
    report.name.toLowerCase().includes(normalizedQuery) || report.category.toLowerCase().includes(normalizedQuery),
  )
  const filteredReports = adminReports
  const reportCounts = adminReports.reduce<Record<ReportStatus, number>>((counts, report) => {
    counts[report.status] += 1
    return counts
  }, { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 })

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!summary.trim()) {
      toast.error('Please add a short summary so the team can act on it.')
      return
    }

    try {
      await createReport({
        category,
        summary: summary.trim(),
        details: details.trim() || 'No extra details provided.',
      }).unwrap()

      setSummary('')
      setDetails('')
      setCategory('Bug')
      toast.success('Report submitted and added to the admin queue.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to submit report right now.')
    }
  }

  const handleStatusUpdate = async (reportId: string, nextStatus: ReportStatus) => {
    try {
      await updateReportStatus({ id: reportId, status: nextStatus }).unwrap()
      toast.success('Report status updated.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update report status.')
    }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <h1 className="text-3xl font-semibold text-(--text-primary)">Reports &amp; support</h1>
        <p className="mt-1 text-(--text-muted)">A lightweight reporting hub for users to flag issues, bugs, and product problems quickly.</p>
      </motion.div>

      <motion.div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, staggerChildren: 0.1 }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)] p-6">
          <CardHeader>
            <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }}>
            <CardTitle className="flex items-center gap-2">
              <motion.div className="p-2 bg-linear-to-br from-blue-500 to-blue-600 rounded-lg" whileHover={{ scale: 1.1 }}>
              <LifeBuoy className="h-5 w-5 text-white" />
              </motion.div>
              Report a problem
            </CardTitle>
            </motion.div>
            <p className="mt-2 text-sm text-(--text-muted)">Only signed-in users can submit reports. Admins can review and update them here.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {reportCategoryOptions.map(({ value, label, icon: Icon }) => {
                const isActive = category === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCategory(value)}
                    className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition ${
                      isActive
                        ? 'border-(--accent)/40 bg-(--accent)/12 text-(--accent)'
                        : 'border-(--border) bg-(--surface-soft)/70 text-(--text-muted) hover:text-(--text-primary)'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                )
              })}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="report-summary">Short summary</Label>
                <Input
                  id="report-summary"
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="Example: video keeps buffering during live matches"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-details">What happened?</Label>
                <DescriptionGenerator entityType="REPORT" title={summary || category} currentDescription={details} context={{ category, details, page: '/admin/reports' }} onGenerated={setDetails} />
                <Textarea
                  id="report-details"
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  placeholder="Add extra details, steps to reproduce, device, or screen capture notes."
                  rows={4}
                />
              </div>
              <Button type="submit" className="gap-2" disabled={isCreating}>
                <Send className="h-4 w-4" />
                {isCreating ? 'Sending...' : 'Send report'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="p-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileSearch className="h-5 w-5 text-accent" />Live admin snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="report-search">Search submitted reports</Label>
              <Input id="report-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search category, summary, details, or user" />
              <div className="grid gap-2 sm:grid-cols-2">
                <select aria-label="Filter by problem type" value={filterCategory} onChange={(event) => setFilterCategory(event.target.value as ReportCategory | 'ALL')} className="rounded-xl border border-(--border) bg-(--surface-soft) px-3 py-2 text-sm text-(--text-primary)">
                  <option value="ALL">All problem types</option>
                  {reportCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select aria-label="Filter by report status" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as ReportStatus | 'ALL')} className="rounded-xl border border-(--border) bg-(--surface-soft) px-3 py-2 text-sm text-(--text-primary)">
                  <option value="ALL">All statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </div>
            </div>

            <div className="space-y-3">
              {isLoadingStats || isLoadingChart ? (
                <p className="text-sm text-(--text-muted)">Loading report data…</p>
              ) : filteredSnapshot.map((report) => (
                <div key={report.id} className="rounded-2xl border border-(--border) bg-(--surface-soft)/80 p-4">
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-(--text-primary)">{report.name}</p>
                      <p className="text-sm text-(--text-muted)">{report.category}</p>
                    </div>
                    <span className="w-fit max-w-full wrap-break-word rounded-full bg-(--accent)/10 px-3 py-1 text-xs font-medium text-(--accent)">{report.status}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
              {(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as ReportStatus[]).map((status) => (
                <div key={status} className="rounded-xl border border-(--border) bg-(--surface-soft)/70 px-2 py-3">
                  <p className="font-semibold text-(--text-primary)">{reportCounts[status]}</p>
                  <p className="mt-1 text-(--text-muted)">{status.replace('_', ' ')}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
      <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold text-(--text-primary)">Recent user reports</h2>
            <p className="mt-1 text-sm text-(--text-muted)">Support issues are collected here so the production team can triage and fix them faster.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => toast.success('A report export draft is ready for the support team.')}>Export queue</Button>
            <Button className="w-full sm:w-auto" onClick={() => toast.success('Support checklist updated for the next review round.')}>Review now</Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {isLoadingReports ? (
            <p className="text-sm text-(--text-muted)">Loading submitted reports...</p>
          ) : isReportsError ? (
            <p className="text-sm text-red-400">Unable to load submitted reports. Please refresh and try again.</p>
          ) : adminReports.length === 0 ? (
            <p className="text-sm text-(--text-muted)">No submitted reports yet.</p>
          ) : filteredReports.length === 0 ? (
            <p className="text-sm text-(--text-muted)">No reports match your search.</p>
          ) : filteredReports.map((report) => (
            <div key={report.id} className="rounded-2xl border border-(--border) bg-(--surface) p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-(--accent)/10 px-3 py-1 text-xs font-medium text-(--accent)">{report.category}</span>
                <span className="text-xs text-(--text-muted)">{new Date(report.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-3 font-semibold text-(--text-primary)">{report.summary}</p>
              <p className="mt-2 text-sm text-(--text-muted)">{report.details}</p>
              {report.user && <p className="mt-3 text-xs text-(--text-muted)">{report.user.fullName || report.user.email}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium uppercase tracking-wide text-(--text-muted)" htmlFor={`status-${report.id}`}>
                  Status
                </label>
                <select
                  id={`status-${report.id}`}
                  value={report.status}
                  onChange={(event) => handleStatusUpdate(report.id, event.target.value as ReportStatus)}
                  disabled={isUpdatingStatus}
                  className="rounded-full border border-(--border) bg-(--surface-soft) px-3 py-1.5 text-sm text-(--text-primary)"
                >
                  <option value="OPEN">Open</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      </Card>
      </motion.div>

      </motion.div>
    </motion.div>
  )
}
