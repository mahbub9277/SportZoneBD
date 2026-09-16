import { useState, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/Select'
import { useDebounce } from '../../hooks/useDebounce'
import { Check, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Skeleton } from '../../components/ui/Skeleton'
import { useGetAdminPaymentsQuery, useProcessAdminPaymentMutation, type AdminPayment } from '../../features/admin/adminPayments.api'
import { cn } from '../../lib/utils'
import { motion } from 'framer-motion'
import { Receipt } from 'lucide-react'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from '../../components/ui/Pagination'

const getStatusClass = (status: string) => {
  switch (status.toLowerCase()) {
    case 'verified':
    case 'succeeded':
    case 'approved':
      return 'bg-green-500/20 text-green-400'
    case 'pending':
    case 'pending_review':
      return 'bg-yellow-500/20 text-yellow-400'
    case 'failed':
      return 'bg-red-500/20 text-red-400'
    default:
      return 'bg-gray-500/20 text-gray-400'
  }
}

export function PaymentsManagementPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const debouncedSearchTerm = useDebounce(searchTerm, 500)

  const { data, isLoading, isError } = useGetAdminPaymentsQuery({
    page: currentPage,
    search: debouncedSearchTerm,
    status: statusFilter === 'all' ? undefined : statusFilter,
  })
  const [processPayment, { isLoading: isProcessing }] = useProcessAdminPaymentMutation()
  const payments = data?.items ?? []
  const totalPages = data?.meta?.totalPages ?? 1
  const currentPageSafe = Math.min(Math.max(currentPage, 1), totalPages)

  const handleProcessPayment = async (payment: AdminPayment, action: 'approve' | 'reject') => {
    const actionLabel = action === 'approve' ? 'approve' : 'reject'
    if (!window.confirm(`Are you sure you want to ${actionLabel} this payment?`)) return

    try {
      await processPayment({ id: payment.id, action }).unwrap()
      toast.success(`Payment ${action === 'approve' ? 'approved' : 'rejected'} successfully.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to ${actionLabel} payment.`)
    }
  }

  const handlePageChange = useCallback((page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }, [totalPages])

  const paginationItems = useMemo(() => {
    const items: (number | '...')[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) items.push(i)
    } else {
      items.push(1)
      if (currentPage > 3) items.push('...')

      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)

      for (let i = start; i <= end; i++) {
        items.push(i)
      }

      if (currentPage < totalPages - 2) items.push('...')
      items.push(totalPages)
    }
    return items
  }, [currentPage, totalPages])

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} whileHover={{ y: -4 }}><Card className="rounded-[1.8rem] border border-(--border) bg-[radial-gradient(circle_at_top_left,rgba(247,199,93,0.16),transparent_35%),var(--surface)] p-5 shadow-[0_30px_90px_var(--shadow)] sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="w-full flex-1">
            <p className="text-sm uppercase tracking-[0.28em] text-yellow-300/80">Payments hub</p>
            <h2 className="mt-2 flex items-center gap-2 text-3xl font-semibold text-(--text-primary)"><motion.span whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><Receipt className="h-6 w-6 text-(--accent)" /></motion.span>Transaction management</h2>
            <p className="mt-2 text-sm leading-6 text-(--text-muted)">Search, filter, and review all payments from a premium admin console.</p>
          </div>
          <div className="grid w-full gap-3 sm:grid-cols-2 md:w-auto md:grid-cols-none md:flex md:items-center md:gap-3">
            <div className="relative w-full md:w-80">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" size={18} />
              <Input
                placeholder="Search users, emails, or amounts"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                  setCurrentPage(1)
                }}
                className="pl-12"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setCurrentPage(1) }}>
              <SelectTrigger className="w-full rounded-2xl border border-(--border) bg-(--surface-soft) px-4 py-3 text-sm text-(--text-primary) md:w-64">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="verified">Verified</SelectItem>
                <SelectItem value="pending_review">Pending review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card></motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} whileHover={{ y: -4 }}><Card className="border-brand-border bg-brand-surface/50 shadow-xl">
        <CardHeader>
          <CardTitle className="text-2xl text-brand-text-primary">Payment Transactions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-208 w-full text-left">
              <thead className="border-b border-white/10 bg-slate-950/90 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Plan / Description</th>
                  <th className="px-6 py-4 text-right">Amount</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-right">Date</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-brand-border last:border-b-0">
                      <td className="px-6 py-4"><Skeleton className="h-5 w-32" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-24" /></td>
                      <td className="px-6 py-4 text-right"><Skeleton className="h-5 w-16 ml-auto" /></td>
                      <td className="px-6 py-4 text-center"><Skeleton className="h-6 w-20 mx-auto" /></td>
                      <td className="px-6 py-4 text-right"><Skeleton className="h-5 w-28 ml-auto" /></td>
                      <td className="px-6 py-4 text-right"><Skeleton className="ml-auto h-8 w-24" /></td>
                    </tr>
                  ))
                ) : isError ? (
                  <tr><td colSpan={6} className="p-6 text-center text-red-400">Failed to load payments.</td></tr>
                ) : payments.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-brand-text-muted">No payments found.</td></tr>
                ) : (
                  payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-brand-border bg-brand-surface-soft/50 last:border-b-0">
                      <td className="px-6 py-4">
                        <div className="font-medium text-brand-text-primary">{payment.user.fullName}</div>
                        <div className="text-xs text-brand-text-muted">{payment.user.email}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-200">{payment.subscriptionPlan?.name ?? 'General Payment'}</td>
                      <td className="px-6 py-4 text-right font-semibold text-white">{payment.amount} {payment.currency}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={cn('rounded-full px-3 py-1.5 text-xs font-semibold uppercase', getStatusClass(payment.status))}>
                          {payment.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-slate-400">{new Date(payment.createdAt).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right">
                        {payment.status.toUpperCase() === 'PENDING_REVIEW' ? (
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => handleProcessPayment(payment, 'approve')} disabled={isProcessing} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Approve payment from ${payment.user.fullName}`}>
                              <Check className="h-3.5 w-3.5" /> Approve
                            </button>
                            <button type="button" onClick={() => handleProcessPayment(payment, 'reject')} disabled={isProcessing} className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Reject payment from ${payment.user.fullName}`}>
                              <X className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-brand-text-muted">No action</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="border-t border-brand-border p-4">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious onClick={() => handlePageChange(currentPageSafe - 1)} disabled={currentPageSafe === 1} />
                  </PaginationItem>
                  {paginationItems.map((item, index) => (
                    <PaginationItem key={index}>
                      {item === '...' ? (
                        <PaginationEllipsis />
                      ) : (
                        <PaginationLink
                          onClick={() => handlePageChange(item as number)}
                          isActive={currentPageSafe === item}
                        >
                          {item}
                        </PaginationLink>
                      )}
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext onClick={() => handlePageChange(currentPageSafe + 1)} disabled={currentPageSafe === totalPages} />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card></motion.div>
    </motion.div>
  )
}