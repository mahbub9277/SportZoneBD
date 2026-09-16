import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Label } from '../../components/ui/Label'
import { Button } from '../../components/ui/Button'
import { motion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'
import { useGetAuditLogsQuery } from '@/features/admin/system.api'

export default function AuditLogsManagementPage() {
  const [filter, setFilter] = useState('')
  const { data, error, isLoading } = useGetAuditLogsQuery({ page: 1, limit: 15, search: filter || undefined })

  const filteredLogs = useMemo(() => {
    const entries = data?.items ?? []

    return entries.filter((entry) => {
      const searchable = [entry.level, entry.message, entry.createdAt, JSON.stringify(entry.meta ?? {})]
      return searchable.some((value) => value.toLowerCase().includes(filter.toLowerCase()))
    })
  }, [data, filter])

  if (isLoading) {
    return <div className="rounded-2xl border border-border bg-surface-soft p-6 text-sm text-text-muted">Loading audit logs...</div>
  }

  if (error) {
    return <div className="rounded-2xl border border-(--danger)/30 bg-(--danger-soft) p-4 text-sm text-(--danger)">Failed to load audit log feed.</div>
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <h1 className="flex items-center gap-2 text-3xl font-semibold text-(--text-primary)">
          <motion.span className="grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br from-emerald-500 to-teal-600 text-white" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><ShieldCheck className="h-5 w-5" /></motion.span>
          Audit Logs
        </h1>
        <p className="mt-1 text-(--text-muted)">Review recent system audit events and protected activity captured by the backend.</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} whileHover={{ y: -4 }}><Card className="p-6">
        <CardHeader>
          <CardTitle>Audit log search</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="audit-filter">Filter logs</Label>
            <Input id="audit-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Type level, message, or timestamp" />
          </div>
          <div className="flex items-end gap-3">
            <Button variant="secondary" onClick={() => setFilter('')}>Clear</Button>
          </div>
        </CardContent>
      </Card></motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} whileHover={{ y: -4 }}><Card className="border-(--border) bg-(--surface-soft)/70 p-6">
        <CardHeader>
          <CardTitle>Recent audit events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {filteredLogs.length === 0 ? (
            <p className="text-sm text-(--text-muted)">No matching audit events found.</p>
          ) : (
            filteredLogs.map((log) => (
              <div key={log.id} className="rounded-2xl border border-(--border) bg-(--surface)/80 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-(--text-primary)">{log.message}</p>
                    <p className="text-sm text-(--text-muted)">{log.level.toUpperCase()}</p>
                  </div>
                  <p className="text-sm text-(--text-muted)">{format(new Date(log.createdAt), 'PPpp')}</p>
                </div>
                <p className="mt-3 wrap-break-word text-sm text-(--text-muted)">Meta: {log.meta ? JSON.stringify(log.meta) : 'No metadata supplied'}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card></motion.div>
    </motion.div>
  )
}
