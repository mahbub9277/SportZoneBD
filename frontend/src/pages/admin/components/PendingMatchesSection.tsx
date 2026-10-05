import { useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { AlertCircle, Check, Clock, Loader2, SearchX, Sparkles, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card'
import { Skeleton } from '../../../components/ui/Skeleton'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Input } from '../../../components/ui/Input'
import { PaginationControls } from '../../../components/ui/PaginationControls'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/AlertDialog'
import { buttonVariants } from '../../../components/ui/button.variants'
import { useDebounce } from '../../../hooks/useDebounce'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import { formatMatchKickoffDate, formatMatchKickoffTime } from '../../../utils/matchDateTime'
import {
  useAcceptPendingMatchMutation,
  useGetAdminPendingMatchesQuery,
  useRejectPendingMatchMutation,
  type PendingMatch,
} from '../../../features/admin/adminPendingMatches.api'

const PROVIDER_LABELS: Record<string, string> = {
  FOOTBALL_DATA: 'Football Data',
  CRICKET_DATA: 'Cricket Data',
}

const formatLabel = (value: string) =>
  value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

const getProviderLabel = (providerFixtureKey?: string | null) => {
  const prefix = providerFixtureKey?.split(':')[0]?.trim()
  if (!prefix) return 'Unknown source'
  return PROVIDER_LABELS[prefix] ?? formatLabel(prefix)
}

const teamLogoTransform = { width: 48, height: 48, crop: 'fit' as const }

export function PendingMatchesSection() {
  const [page, setPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(5)
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const [rejectingMatch, setRejectingMatch] = useState<PendingMatch | null>(null)
  const [activeAction, setActiveAction] = useState<{ id: string; type: 'accept' | 'reject' } | null>(null)

  const { data, isLoading, isError } = useGetAdminPendingMatchesQuery({
    page,
    limit: itemsPerPage,
    search: debouncedSearchTerm,
  })
  const [acceptPendingMatch, { isLoading: isAccepting }] = useAcceptPendingMatchMutation()
  const [rejectPendingMatch, { isLoading: isRejecting }] = useRejectPendingMatchMutation()

  const pendingMatches = data?.items ?? []
  const totalPages = data?.meta?.totalPages ?? 1
  const isMutating = isAccepting || isRejecting || activeAction !== null

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setPage(1)
  }

  const handleAccept = async (match: PendingMatch) => {
    setActiveAction({ id: match.id, type: 'accept' })
    try {
      await acceptPendingMatch(match.id).unwrap()
      toast.success(`"${match.title}" accepted and published.`)
    } catch {
      toast.error('Failed to accept match.')
    } finally {
      setActiveAction(null)
    }
  }

  const handleRejectConfirm = async () => {
    if (!rejectingMatch) return
    const match = rejectingMatch
    setActiveAction({ id: match.id, type: 'reject' })
    try {
      await rejectPendingMatch(match.id).unwrap()
      toast.success('Match rejected and removed from the pending queue.')
      setRejectingMatch(null)
    } catch {
      toast.error('Failed to reject match.')
    } finally {
      setActiveAction(null)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.4 }}>
      <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
        <CardHeader className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-linear-to-br from-amber-500 to-amber-600 p-2">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-2xl text-brand-text-primary">Pending Matches</CardTitle>
              <p className="text-sm text-brand-text-muted">Automatically discovered matches awaiting admin review.</p>
            </div>
          </div>
          <Input
            placeholder="Search pending matches..."
            value={searchTerm}
            onChange={(event) => handleSearchChange(event.target.value)}
            className="h-10 w-full py-2 pr-4 text-sm sm:max-w-xs"
          />
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-3xl w-full text-left">
              <thead className="border-b border-(--border) bg-linear-to-r from-(--surface)/70 to-(--surface)/40 text-xs font-semibold uppercase tracking-wider text-brand-text-muted">
                <tr>
                  <th className="px-4 py-4 sm:px-6">Match</th>
                  <th className="px-4 py-4 sm:px-6">Scheduled</th>
                  <th className="px-4 py-4 sm:px-6">Source</th>
                  <th className="px-4 py-4 text-center sm:px-6">Status</th>
                  <th className="px-4 py-4 text-center sm:px-6">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-(--border) last:border-b-0">
                      <td className="px-4 py-4 sm:px-6"><Skeleton className="h-5 w-48" /></td>
                      <td className="px-4 py-4 sm:px-6"><Skeleton className="h-5 w-32" /></td>
                      <td className="px-4 py-4 sm:px-6"><Skeleton className="h-5 w-24" /></td>
                      <td className="px-4 py-4 text-center sm:px-6"><Skeleton className="mx-auto h-6 w-24" /></td>
                      <td className="px-4 py-4 text-center sm:px-6"><Skeleton className="mx-auto h-9 w-36" /></td>
                    </tr>
                  ))
                ) : isError ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-red-400">
                      <AlertCircle className="mx-auto mb-2" /> Failed to load pending matches.
                    </td>
                  </tr>
                ) : pendingMatches.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-brand-text-muted">
                      <SearchX className="mx-auto mb-2 h-6 w-6" />
                      {debouncedSearchTerm ? 'No pending matches match your search.' : 'No pending matches awaiting review.'}
                    </td>
                  </tr>
                ) : (
                  pendingMatches.map((match, idx) => (
                    <motion.tr
                      key={match.id}
                      className="border-b border-(--border) bg-linear-to-r from-(--surface-soft)/30 to-transparent transition-colors last:border-b-0 hover:bg-linear-to-r hover:from-(--surface-soft)/50 hover:to-transparent/30"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.06 }}
                    >
                      <td className="px-4 py-4 align-top font-medium text-brand-text-primary sm:px-6">
                        <div className="min-w-56 space-y-2">
                          <div className="wrap-break-word">{match.title}</div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-brand-text-muted">
                            <Badge variant="secondary" className="px-2 py-0.5 text-[10px] uppercase tracking-wide">
                              {match.sport ? formatLabel(match.sport) : 'Sport unknown'}
                            </Badge>
                            <span className="wrap-break-word">{match.tournamentName || match.competition?.name || 'Competition not set'}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-brand-text-muted">
                            {match.homeTeamLogo ? (
                              <img src={buildCloudinaryUrl(match.homeTeamLogo, teamLogoTransform)} alt="" className="h-6 w-6 rounded-full bg-(--surface-soft) object-contain" />
                            ) : (
                              <span className="grid h-6 w-6 place-items-center rounded-full bg-(--surface-soft) text-[8px] font-bold">{match.homeTeamName?.slice(0, 2).toUpperCase() || 'T1'}</span>
                            )}
                            <span className="max-w-32 wrap-break-word">{match.homeTeamName || 'Home team'}</span>
                            <span className="text-(--accent)">vs</span>
                            {match.awayTeamLogo ? (
                              <img src={buildCloudinaryUrl(match.awayTeamLogo, teamLogoTransform)} alt="" className="h-6 w-6 rounded-full bg-(--surface-soft) object-contain" />
                            ) : (
                              <span className="grid h-6 w-6 place-items-center rounded-full bg-(--surface-soft) text-[8px] font-bold">{match.awayTeamName?.slice(0, 2).toUpperCase() || 'T2'}</span>
                            )}
                            <span className="max-w-32 wrap-break-word">{match.awayTeamName || 'Away team'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top text-sm text-brand-text-secondary sm:px-6">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <Clock className="h-4 w-4 shrink-0 text-(--accent)" />
                            {formatMatchKickoffDate(match.kickoffAt)}
                          </div>
                          <div className="pl-6 text-xs text-brand-text-muted">{formatMatchKickoffTime(match.kickoffAt)}</div>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top sm:px-6">
                        <div className="space-y-1">
                          <Badge variant="outline" className="px-2 py-0.5 text-[10px] uppercase tracking-wide">
                            {getProviderLabel(match.providerFixtureKey)}
                          </Badge>
                          <div className="max-w-40 truncate text-xs text-brand-text-muted" title={match.providerFixtureKey ?? undefined}>
                            {match.providerFixtureKey || 'No fixture key'}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center align-top sm:px-6">
                        <div className="flex flex-col items-center gap-2">
                          <span className="inline-block rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-400">{match.status}</span>
                          <Badge variant="outline" className="gap-1 px-2 py-0.5 text-[10px] text-brand-text-muted">
                            <Sparkles className="h-3 w-3" /> Auto-discovered
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center align-top sm:px-6">
                        <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
                          <Button size="sm" className="gap-1.5" onClick={() => handleAccept(match)} disabled={isMutating}>
                            {activeAction?.type === 'accept' && activeAction.id === match.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 border-rose-500/40 text-rose-400 hover:border-rose-500 hover:bg-rose-500/10 hover:text-rose-300"
                            onClick={() => setRejectingMatch(match)}
                            disabled={isMutating}
                          >
                            <X className="h-3.5 w-3.5" />
                            Reject
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            itemsPerPage={itemsPerPage}
            setCurrentPage={setPage}
            setItemsPerPage={setItemsPerPage}
          />
        </CardContent>
      </Card>

      <AlertDialog open={!!rejectingMatch} onOpenChange={(isOpen) => { if (!isOpen && !isRejecting) setRejectingMatch(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this auto-discovered match?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{rejectingMatch?.title}&quot; will be removed from the pending queue permanently and will not be recreated automatically. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRejecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleRejectConfirm()
              }}
              disabled={isRejecting}
              className={buttonVariants({ variant: 'destructive' })}
            >
              {isRejecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}
