import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Label } from '../../components/ui/Label'
import { motion } from 'framer-motion'
import { Activity } from 'lucide-react'
import { useGetActivityLogsQuery } from '@/features/admin/system.api'

export default function ActivityLogsManagementPage() {
  const [search, setSearch] = useState('')
  const { data, error, isLoading } = useGetActivityLogsQuery({ page: 1, limit: 20, search: search || undefined })

  const filtered = useMemo(() => {
    const entries = data?.items ?? []

    return entries.filter((entry) => {
      const searchable = [entry.level, entry.message, entry.createdAt, JSON.stringify(entry.meta ?? {})]
      return searchable.some((value) => value.toLowerCase().includes(search.toLowerCase()))
    })
  }, [data, search])

  if (isLoading) {
    return <div className="rounded-2xl border border-border bg-surface-soft p-6 text-sm text-text-muted">Loading activity logs...</div>
  }

  if (error) {
    return <div className="rounded-2xl border border-(--danger)/30 bg-(--danger-soft) p-4 text-sm text-(--danger)">Failed to load activity logs.</div>
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <h1 className="flex items-center gap-2 text-3xl font-semibold text-(--text-primary)">
          <motion.span className="grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br from-blue-500 to-cyan-600 text-white" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><Activity className="h-5 w-5" /></motion.span>
          Activity Logs
        </h1>
        <p className="mt-1 text-(--text-muted)">Track recent system activity and administrative event history from the live backend.</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} whileHover={{ y: -4 }}>
      <Card className="p-6">
        <CardHeader>
          <CardTitle>Search activity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="activity-search">Search records</Label>
            <Input id="activity-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Level, message, or timestamp" />
          </div>
          <div className="flex items-end gap-3">
            <Button variant="secondary" onClick={() => setSearch('')}>Reset</Button>
          </div>
        </CardContent>
      </Card>
      </motion.div>

      <motion.div className="grid gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
        {filtered.length === 0 ? (
          <Card className="border-(--border) bg-(--surface-soft)/70 p-6">
            <CardContent>
              <p className="text-sm text-(--text-muted)">No activity matches your search.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((entry) => (
            <motion.div key={entry.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -3 }}>
            <Card className="border-(--border) bg-(--surface)/80 p-6">
              <CardHeader>
                <CardTitle>{entry.message}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-sm text-(--text-muted)">Level</p>
                    <p className="mt-1 font-medium text-(--text-primary)">{entry.level.toUpperCase()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-(--text-muted)">Meta</p>
                    <p className="mt-1 wrap-break-word font-medium text-(--text-primary)">{entry.meta ? JSON.stringify(entry.meta) : 'No metadata'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-(--text-muted)">Timestamp</p>
                    <p className="mt-1 font-medium text-(--text-primary)">{format(new Date(entry.createdAt), 'PPpp')}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            </motion.div>
          ))
        )}
      </motion.div>
    </motion.div>
  )
}
