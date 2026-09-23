import { useMemo, useState } from 'react'
import { AlertTriangle, Bug, CheckCircle2, FileText, LifeBuoy, MessageSquareWarning, Send } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { useAppSelector } from '../app/hooks'
import { selectCurrentUser } from '../features/auth/authSlice'
import { useCreateReportMutation, useGetMyReportsQuery } from '../features/reports/reports.api'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { Textarea } from '../components/ui/Textarea'
import { DescriptionGenerator } from '../components/ai/DescriptionGenerator'

type ReportCategory = 'Bug' | 'Playback' | 'Payment' | 'Account' | 'Content'

interface UserReport {
  id: string
  category: ReportCategory
  summary: string
  details: string
  createdAt: string
  userName?: string
  userEmail?: string
}

const categoryOptions: Array<{ value: ReportCategory; label: string; icon: typeof Bug }> = [
  { value: 'Bug', label: 'Bug / crash', icon: Bug },
  { value: 'Playback', label: 'Stream / playback', icon: AlertTriangle },
  { value: 'Payment', label: 'Payment issue', icon: LifeBuoy },
  { value: 'Account', label: 'Account access', icon: MessageSquareWarning },
  { value: 'Content', label: 'Content issue', icon: CheckCircle2 },
]

export default function ReportsPage() {
  const user = useAppSelector(selectCurrentUser)
  const [category, setCategory] = useState<ReportCategory>('Bug')
  const [summary, setSummary] = useState('')
  const [details, setDetails] = useState('')
  const [createReport] = useCreateReportMutation()
  const { data: reportsData = [], isLoading } = useGetMyReportsQuery(undefined)

  const reports = useMemo<UserReport[]>(() => {
    return (reportsData ?? []).map((report) => ({
      id: report.id,
      category: report.category,
      summary: report.summary,
      details: report.details,
      createdAt: new Date(report.createdAt).toLocaleString(),
      userName: user?.fullName || 'Anonymous user',
      userEmail: user?.email || 'No email provided',
    }))
  }, [reportsData, user?.email, user?.fullName])

  const latestReports = useMemo(() => reports.slice(0, 4), [reports])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!summary.trim()) {
      toast.error('Please add a short summary before submitting your report.')
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
      toast.success('Your report has been submitted and saved to your account reports list.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to submit your report right now.')
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }} className="rounded-4xl border border-border bg-surface/70 p-6 shadow-[0_30px_80px_rgba(2,6,23,0.18)] backdrop-blur-md">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-text-primary">Report a problem</h1>
            <p className="mt-2 max-w-2xl text-sm text-text-muted">
              Tell us about bugs, buffering issues, payments, or account problems. Your report helps us fix production issues faster.
            </p>
          </div>
          <div className="rounded-full border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium text-accent shadow-glow">
            {isLoading ? 'Loading…' : `${reports.length} report${reports.length === 1 ? '' : 's'} saved`}
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.5 }} className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-border/60 bg-surface/75 p-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <motion.div className="p-1.5 bg-linear-to-br from-cyan-400 to-cyan-600 rounded-lg flex items-center justify-center" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}>
                <LifeBuoy className="h-4 w-4 text-white" />
              </motion.div>
              Submit a new report
            </CardTitle>
          </CardHeader>
          <CardContent>
            <fieldset>
              <legend className="mb-2 block text-sm font-medium text-text-primary">1. What problem are you having?</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {categoryOptions.map(({ value, label, icon: Icon }) => {
                const isActive = category === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCategory(value)}
                    aria-pressed={isActive}
                    className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-left text-sm transition ${
                      isActive ?
                        'border-accent/40 bg-accent/10 text-accent' :
                        'border-border bg-surface-soft/70 text-text-muted hover:text-text-primary'
                    }`}
                  >
                    <motion.div whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}>
                      <Icon className="h-4 w-4" />
                    </motion.div>
                    {label}
                  </button>
                )
              })}
              </div>
              <p className="mt-2 text-xs text-text-muted">Selected: <span className="font-semibold text-accent">{categoryOptions.find((option) => option.value === category)?.label}</span></p>
            </fieldset>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="report-summary">2. Short summary</Label>
                <Input
                  id="report-summary"
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="Example: Live stream freezes during matches"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-details">3. What happened?</Label>
                <DescriptionGenerator entityType="REPORT" title={summary || category} context={{ category, details, page: window.location.pathname }} onGenerated={setDetails} />
                <Textarea
                  id="report-details"
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  placeholder="Please add the problem details, steps to reproduce, or device info."
                  rows={5}
                />
              </div>

              <div className="rounded-2xl border border-border bg-surface-soft/70 p-4 text-sm text-text-muted">
                Report will be saved for your account and can be reviewed by the support team.
              </div>

              <Button type="submit" className="gap-2" disabled={!summary.trim()}>
                <Send className="h-4 w-4" />
                Submit report
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-surface/75 p-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-accent" />
              Your recent reports
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latestReports.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-surface-soft/60 p-6 text-sm text-text-muted">
                No reports yet. Submit your first issue to help us improve the platform.
              </div>
            ) : (
              <div className="space-y-3">
                {latestReports.map((report) => (
                  <div key={report.id} className="rounded-2xl border border-border bg-surface-soft/80 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">{report.category}</span>
                      <span className="text-xs text-text-muted">{report.createdAt}</span>
                    </div>
                    <p className="mt-3 font-semibold text-text-primary">{report.summary}</p>
                    <p className="mt-2 text-sm text-text-muted">{report.details}</p>
                    <p className="mt-3 text-xs text-text-muted">{report.userName} • {report.userEmail}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
