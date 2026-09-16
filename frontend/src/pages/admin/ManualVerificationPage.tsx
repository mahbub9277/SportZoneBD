import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/Skeleton'
import { useGetPendingVerificationsQuery, useProcessVerificationMutation } from '../../features/admin/manualVerification.api'
import { Check, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'

export function ManualVerificationPage() {
  const { data: pendingPayments = [], isLoading, isError } = useGetPendingVerificationsQuery()
  const [processVerification, { isLoading: isProcessing }] = useProcessVerificationMutation()

  const handleProcess = async (paymentId: string, action: 'approve' | 'reject') => {
    const rejectionReason = action === 'reject' ? window.prompt('Reason for rejection:')?.trim() : undefined
    if (action === 'reject' && !rejectionReason) return
    try {
      await processVerification({ paymentId, action, rejectionReason }).unwrap()
      toast.success(`Payment has been ${action}d.`)
    } catch {
      toast.error(`Failed to ${action} the payment.`)
    }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} whileHover={{ y: -4 }}><Card className="border-brand-border bg-brand-surface/50 shadow-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl text-brand-text-primary"><motion.span className="grid h-9 w-9 place-items-center rounded-xl bg-linear-to-br from-emerald-500 to-teal-600 text-white" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><ShieldCheck className="h-5 w-5" /></motion.span>Manual Payment Verification</CardTitle>
          <p className="text-sm text-brand-text-muted">Review and process payments that require manual confirmation.</p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-232 w-full text-left">
              <thead className="border-b border-brand-border bg-brand-surface/70 text-xs font-semibold uppercase tracking-wider text-brand-text-muted">
                <tr>
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Plan</th>
                  <th className="px-6 py-4">Transaction ID</th>
                  <th className="px-6 py-4 text-right">Amount</th>
                  <th className="px-6 py-4 text-right">Date</th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-brand-border last:border-b-0">
                      <td className="px-6 py-4"><Skeleton className="h-5 w-32" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-20" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-28" /></td>
                      <td className="px-6 py-4 text-right"><Skeleton className="h-5 w-16 ml-auto" /></td>
                      <td className="px-6 py-4 text-right"><Skeleton className="h-5 w-28 ml-auto" /></td>
                      <td className="px-6 py-4 text-center"><Skeleton className="h-8 w-24 mx-auto" /></td>
                    </tr>
                  ))
                ) : isError ? (
                  <tr><td colSpan={6} className="p-6 text-center text-red-400">Failed to load pending payments.</td></tr>
                ) : pendingPayments.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-brand-text-muted">No payments are pending manual verification.</td></tr>
                ) : (
                  pendingPayments.map((payment) => (
                    <tr key={payment.id} className="border-b border-brand-border bg-brand-surface-soft/50 last:border-b-0">
                      <td className="px-6 py-4">
                        <div className="font-medium text-brand-text-primary">{payment.user.fullName}</div>
                        <div className="text-xs text-brand-text-muted">{payment.user.email}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-brand-text-secondary">{payment.subscriptionPlan?.name ?? 'Unknown plan'}</td>
                      <td className="px-6 py-4 font-mono text-xs text-brand-text-secondary">{payment.transactionId}</td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-brand-text-primary">{payment.amount} {payment.currency}</td>
                      <td className="px-6 py-4 text-right text-sm text-brand-text-muted">{new Date(payment.createdAt).toLocaleString()}</td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex justify-center gap-2">
                          <Button size="sm" variant="outline" className="border-green-500/50 text-green-400 hover:bg-green-500/10 hover:text-green-300" onClick={() => handleProcess(payment.id, 'approve')} disabled={isProcessing}>
                            <motion.span whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><Check size={16} /></motion.span>
                          </Button>
                          <Button size="sm" variant="outline" className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300" onClick={() => handleProcess(payment.id, 'reject')} disabled={isProcessing}>
                            <motion.span whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><X size={16} /></motion.span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card></motion.div>
    </motion.div>
  )
}