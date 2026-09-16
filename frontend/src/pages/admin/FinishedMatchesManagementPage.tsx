import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { useGetAdminFinishedMatchesQuery } from '../../features/admin/adminFinishedMatches.api'
import { Button } from '../../components/ui/Button'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Trophy } from 'lucide-react'

type FinishedMatchTimestamp = string | null | undefined

function formatFinishedAt(finishedAt: FinishedMatchTimestamp) {
  return typeof finishedAt === 'string' && finishedAt
    ? new Date(finishedAt).toLocaleString()
    : 'N/A'
}

export function FinishedMatchesManagementPage() {
  const { data, isLoading, isError } = useGetAdminFinishedMatchesQuery({})
  const finishedMatches = data?.items ?? []
  const navigate = useNavigate()

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} whileHover={{ y: -4 }}><Card className="border-brand-border bg-brand-surface/50 shadow-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl text-brand-text-primary"><motion.span className="grid h-9 w-9 place-items-center rounded-xl bg-linear-to-br from-amber-500 to-orange-600 text-white" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><Trophy className="h-5 w-5" /></motion.span>Finished Matches</CardTitle>
          <p className="text-sm text-brand-text-muted">Review completed matches during the 15-minute retention window.</p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-136 w-full text-left">
              <thead className="border-b border-brand-border bg-brand-surface/70 text-xs font-semibold uppercase tracking-wider text-brand-text-muted">
                <tr>
                  <th className="px-6 py-4">Match</th>
                  <th className="px-6 py-4 text-right">Finished At</th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-brand-border last:border-b-0">
                      <td className="px-6 py-4"><Skeleton className="h-5 w-48" /></td>
                      <td className="px-6 py-4 text-right"><Skeleton className="h-5 w-28 ml-auto" /></td>
                      <td className="px-6 py-4 text-center"><Skeleton className="h-8 w-24 mx-auto" /></td>
                    </tr>
                  ))
                ) : isError ? (
                  <tr><td colSpan={4} className="p-6 text-center text-red-400">Failed to load finished matches.</td></tr>
                ) : finishedMatches.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-center text-brand-text-muted">No matches have finished yet.</td></tr>
                ) : (
                  finishedMatches.map((match) => (
                    <tr key={match.id} className="border-b border-brand-border bg-brand-surface-soft/50 last:border-b-0">
                      <td className="px-6 py-4 font-medium text-brand-text-primary">{match.title}</td>
                      <td className="px-6 py-4 text-right text-sm text-brand-text-muted">{formatFinishedAt(match.finishedAt)}</td>
                      <td className="px-6 py-4 text-center">
                        <Button variant="outline" size="sm" onClick={() => navigate(`/admin/matches/${match.id}`)}>View Details</Button>
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