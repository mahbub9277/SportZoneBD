import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Radio, Play, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { useGetAdminLiveMatchesQuery, useUpdateMatchStatusMutation, useExtendMatchMutation } from '../../features/admin/adminLiveMatches.api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/Select'
import { buildCloudinaryUrl } from '../../utils/cloudinary'

export function LiveMatchesManagementPage() {
  const { data, isLoading, isError } = useGetAdminLiveMatchesQuery({})
  const [updateStatus, { isLoading: isUpdating }] = useUpdateMatchStatusMutation()
  const [extendMatch, { isLoading: isExtending }] = useExtendMatchMutation()
  const liveMatches = data?.items ?? []

  const handleStatusChange = async (matchId: string, status: 'UPCOMING' | 'LIVE' | 'FINISHED') => {
    try {
      await updateStatus({ id: matchId, status }).unwrap()
      toast.success('Match status updated successfully!')
    } catch {
      toast.error('Failed to update match status.')
    }
  }

  const handleExtend = async (matchId: string) => {
    try { await extendMatch({ id: matchId, minutes: 30 }).unwrap(); toast.success('Expected end extended by 30 minutes.') } catch { toast.error('Failed to extend match.') }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }}>
        <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
          <CardHeader>
            <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15, duration: 0.4 }}>
              <div className="flex items-center gap-3">
                <motion.div className="p-2 bg-linear-to-br from-red-500 to-red-600 rounded-lg" whileHover={{ scale: 1.1 }}>
                  <Radio className="h-5 w-5 text-white animate-pulse" />
                </motion.div>
                <div>
                  <CardTitle className="text-2xl text-brand-text-primary">Live Matches</CardTitle>
                  <p className="text-sm text-brand-text-muted">Monitor and manage all currently live matches.</p>
                </div>
              </div>
            </motion.div>
          </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-136 w-full text-left">
              <thead className="border-b border-brand-border bg-brand-surface/70 text-xs font-semibold uppercase tracking-wider text-brand-text-muted">
                <tr>
                  <th className="px-6 py-4">Match</th>
                  <th className="px-6 py-4 text-center">Current Status</th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <motion.tr key={i} className="border-b border-(--border) last:border-b-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-48" /></td>
                      <td className="px-6 py-4 text-center"><Skeleton className="h-6 w-20 mx-auto" /></td>
                      <td className="px-6 py-4 text-center"><Skeleton className="h-8 w-32 mx-auto" /></td>
                    </motion.tr>
                  ))
                ) : isError ? (
                  <tr><td colSpan={4} className="p-6 text-center text-red-400">Failed to load live matches.</td></tr>
                ) : liveMatches.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-center text-brand-text-muted">No matches are currently live.</td></tr>
                ) : (
                  <motion.tbody>
                    {liveMatches.map((match, idx) => (
                      <motion.tr
                        key={match.id}
                        className="border-b border-(--border) bg-linear-to-r from-(--surface-soft)/30 to-transparent hover:bg-linear-to-r hover:from-(--surface-soft)/50 hover:to-transparent/30 transition-colors last:border-b-0"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.06 }}
                        whileHover={{ scale: 1.01 }}
                      >
                        <td className="px-6 py-4 font-medium text-brand-text-primary">
                          <div className="min-w-48 space-y-2">
                            <div className="flex items-center gap-2 wrap-break-word"><Play className="h-4 w-4 shrink-0 text-red-500 animate-pulse" />{match.title}</div>
                            <div className="flex items-center gap-2 text-xs text-brand-text-muted">
                              {match.homeTeamLogo ? <img src={buildCloudinaryUrl(match.homeTeamLogo, { width: 48, height: 48, crop: 'fit' })} alt="" className="h-6 w-6 rounded-full bg-(--surface-soft) object-contain" /> : <span className="grid h-6 w-6 place-items-center rounded-full bg-(--surface-soft) text-[8px] font-bold">{match.homeTeamName?.slice(0, 2).toUpperCase() || 'T1'}</span>}
                              <span className="max-w-32 wrap-break-word">{match.homeTeamName || 'Team 1'}</span>
                              <span className="text-(--accent)">vs</span>
                              {match.awayTeamLogo ? <img src={buildCloudinaryUrl(match.awayTeamLogo, { width: 48, height: 48, crop: 'fit' })} alt="" className="h-6 w-6 rounded-full bg-(--surface-soft) object-contain" /> : <span className="grid h-6 w-6 place-items-center rounded-full bg-(--surface-soft) text-[8px] font-bold">{match.awayTeamName?.slice(0, 2).toUpperCase() || 'T2'}</span>}
                              <span className="max-w-32 wrap-break-word">{match.awayTeamName || 'Team 2'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <motion.span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold uppercase text-red-400 inline-block" whileHover={{ scale: 1.05 }}>
                            {match.status}
                          </motion.span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <div className="flex items-center justify-center gap-2">
                            <button type="button" onClick={() => handleExtend(match.id)} disabled={isExtending} className="inline-flex items-center gap-1 rounded-lg border border-(--accent)/50 px-3 py-2 text-xs font-medium text-(--accent) hover:border-(--accent)" title="Extend expected end by 30 minutes"><Plus className="h-3.5 w-3.5" />30 min</button>
                            <Select onValueChange={(value) => handleStatusChange(match.id, value as 'UPCOMING' | 'LIVE' | 'FINISHED')} disabled={isUpdating}>
                              <SelectTrigger className="w-40 bg-linear-to-r from-(--accent)/20 to-(--accent)/10 border-2 border-(--accent)/50 hover:border-(--accent)">
                                <SelectValue placeholder="Change Status" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="FINISHED">Mark as Finished</SelectItem>
                              </SelectContent>
                            </Select>
                            </div>
                          </motion.div>
                        </td>
                      </motion.tr>
                    ))}
                  </motion.tbody>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </motion.div>
    </motion.div>
  )
}