import { useGetSystemLogsQuery } from '@/features/admin/system.api'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { format } from 'date-fns'
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/Pagination'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/Alert'
import { Terminal } from 'lucide-react'
import { motion } from 'framer-motion'

const getBadgeVariant = (level: string) => {
  switch (level.toLowerCase()) {
    case 'error':
      return 'destructive'
    case 'warn':
      return 'default' // Should be styled as yellow, but we'll use default for now
    case 'info':
      return 'secondary'
    default:
      return 'outline'
  }
}

export default function SystemLogsPage() {
  const [page, setPage] = useState(1)
  const { data, error, isLoading } = useGetSystemLogsQuery({ page, limit: 15 })

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && (!data || newPage <= data.meta.totalPages)) {
      setPage(newPage)
    }
  }

  if (isLoading) return <div className="rounded-2xl border border-border bg-surface-soft p-6 text-sm text-text-muted">Loading logs...</div>
  if (error)
    return (
      <Alert variant="destructive">
        <Terminal className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Failed to load system logs.</AlertDescription>
      </Alert>
    )

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} whileHover={{ y: -4 }}>
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><motion.span className="grid h-9 w-9 place-items-center rounded-xl bg-linear-to-br from-slate-500 to-slate-700 text-white" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><Terminal className="h-4 w-4" /></motion.span>System Logs</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Level</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  <Badge variant={getBadgeVariant(log.level)}>{log.level.toUpperCase()}</Badge>
                </TableCell>
                <TableCell className="font-mono">{log.message}</TableCell>
                <TableCell>{format(new Date(log.createdAt), 'PPpp')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data && data.meta.totalPages > 1 && (
          <Pagination className="mt-4">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious onClick={() => handlePageChange(page - 1)} />
              </PaginationItem>
              {[...Array(data.meta.totalPages)].map((_, i) => (
                <PaginationItem key={i}>
                  <PaginationLink isActive={page === i + 1} onClick={() => handlePageChange(i + 1)}>
                    {i + 1}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext onClick={() => handlePageChange(page + 1)} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </CardContent>
    </Card>
    </motion.div>
  )
}