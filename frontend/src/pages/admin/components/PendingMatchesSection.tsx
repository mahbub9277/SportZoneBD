import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { AlertCircle, CalendarDays, Check, CheckCheck, Clock, Loader2, RefreshCw, SearchX, Sparkles, X, XCircle } from 'lucide-react'
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
import { resolveTeamLogoUrl } from '../../../utils/teamLogo'
import { formatMatchKickoffDate, formatMatchKickoffTime } from '../../../utils/matchDateTime'
import { describePendingDateFilter, resolvePendingDateFilter, type PendingQuickRange } from '../../../utils/pendingDateFilter'
import { prunePendingSelection, setVisibleSelection, summarizePendingSelection, togglePendingSelection } from '../../../utils/pendingSelection'
import {
  useAcceptPendingMatchMutation,
  useBulkAcceptPendingMatchesMutation,
  useBulkRejectPendingMatchesMutation,
  useGetAdminPendingMatchesQuery,
  useRejectPendingMatchMutation,
  type PendingBulkReviewResult,
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

/** The per-item outcome of a bulk review, described the way a reviewer needs to read it. */
const describeBulkResult = (result: PendingBulkReviewResult, decision: 'accept' | 'reject') => {
  const parts: string[] = []
  if (decision === 'accept') {
    if (result.accepted > 0) parts.push(`${result.accepted} approved`)
  } else if (result.rejected > 0) {
    parts.push(`${result.rejected} rejected`)
  }
  if (result.alreadyProcessed > 0) parts.push(`${result.alreadyProcessed} already reviewed`)
  if (result.ineligible > 0) parts.push(`${result.ineligible} already started`)
  if (result.missing > 0) parts.push(`${result.missing} no longer present`)
  if (result.failed > 0) parts.push(`${result.failed} failed`)
  const changed = decision === 'accept' ? result.accepted : result.rejected
  return {
    changed,
    message: parts.length > 0 ? parts.join(' Â· ') : 'Nothing to change',
  }
}

export function PendingMatchesSection() {
  const [page, setPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(5)
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const [rejectingMatch, setRejectingMatch] = useState<PendingMatch | null>(null)
  const [activeAction, setActiveAction] = useState<{ id: string; type: 'accept' | 'reject' } | null>(null)

  const [quickRange, setQuickRange] = useState<PendingQuickRange>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [rawSelection, setRawSelection] = useState<Set<string>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState<'accept' | 'reject' | null>(null)

  const dateFilter = resolvePendingDateFilter({ quick: quickRange, from: fromDate, to: toDate })
  const dateFilterError = dateFilter.ok ? null : dateFilter.message
  const kickoffFrom = dateFilter.ok ? dateFilter.kickoffFrom ?? undefined : undefined
  const kickoffTo = dateFilter.ok ? dateFilter.kickoffTo ?? undefined : undefined

  const { data, isLoading, isFetching, isError, refetch } = useGetAdminPendingMatchesQuery({
    page,
    limit: itemsPerPage,
    search: debouncedSearchTerm,
    kickoffFrom,
    kickoffTo,
  })
  const [acceptPendingMatch, { isLoading: isAccepting }] = useAcceptPendingMatchMutation()
  const [rejectPendingMatch, { isLoading: isRejecting }] = useRejectPendingMatchMutation()
  const [bulkAccept, { isLoading: isBulkAccepting }] = useBulkAcceptPendingMatchesMutation()
  const [bulkReject, { isLoading: isBulkRejecting }] = useBulkRejectPendingMatchesMutation()

  const pendingMatches = useMemo(() => data?.items ?? [], [data])
  const totalPages = data?.meta?.totalPages ?? 1
  const totalItems = data?.meta?.totalItems ?? 0
  const isMutating = isAccepting || isRejecting || isBulkAccepting || isBulkRejecting || activeAction !== null

  const visibleIds = useMemo(() => pendingMatches.map((match) => match.id), [pendingMatches])
  // A new filter, a new page or a refresh can retire rows: the effective selection is reduced to what is
  // really on screen, so a bulk action can never cover a fixture the reviewer can no longer see.
  const selectedIds = useMemo(() => prunePendingSelection(rawSelection, visibleIds), [rawSelection, visibleIds])
  const selection = summarizePendingSelection(selectedIds, visibleIds)

  const resetToList = () => setPage(1)

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    resetToList()
  }

  const handleQuickRange = (range: PendingQuickRange) => {
    setQuickRange(range)
    if (range !== 'all') {
      setFromDate('')
      setToDate('')
    }
    resetToList()
  }

  const handleClearFilters = () => {
    setSearchTerm('')
    setQuickRange('all')
    setFromDate('')
    setToDate('')
    resetToList()
  }

  const hasActiveFilters = Boolean(debouncedSearchTerm) || quickRange !== 'all' || Boolean(fromDate) || Boolean(toDate)

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

  const handleBulkConfirm = async () => {
    if (!confirmBulk || selectedIds.size === 0) return
    const ids = [...selectedIds]
    const decision = confirmBulk
    try {
      const result = decision === 'accept' ? await bulkAccept(ids).unwrap() : await bulkReject(ids).unwrap()
      const { changed, message } = describeBulkResult(result, decision)
      if (changed > 0 && result.failed === 0 && result.missing === 0) toast.success(message)
      else if (changed > 0) toast.warning(message)
      else toast.info(message)
      setRawSelection(new Set())
      setConfirmBulk(null)
    } catch {
      toast.error(decision === 'accept' ? 'Bulk accept failed.' : 'Bulk reject failed.')
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.4 }}>
      <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
        <CardHeader className="flex flex-col items-stretch justify-between gap-4 lg:flex-row lg:items-start">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-linear-to-br from-amber-500 to-amber-600 p-2">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-2xl text-brand-text-primary">Pending Matches</CardTitle>
              <p className="text-sm text-brand-text-muted">Automatically discovered matches awaiting admin review.</p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 lg:max-w-3xl">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                placeholder="Search team, competition or fixture id..."
                value={searchTerm}
                onChange={(event) => handleSearchChange(event.target.value)}
                className="h-10 w-full py-2 text-sm sm:flex-1"
                aria-label="Search pending matches by team, competition or provider fixture id"
              />
              <Button type="button" variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => void refetch()} disabled={isFetching}>
                {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh
              </Button>
            </div>

            {/* Date filter: quick days first, then an explicit range. Everything resolves to real kickoff
                instants and is applied by the API, not to the rows already on screen. */}
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick date filters">
                {(['today', 'tomorrow', 'all'] as const).map((range) => (
                  <Button
                    key={range}
                    type="button"
                    size="sm"
                    variant={quickRange === range ? 'default' : 'outline'}
                    aria-pressed={quickRange === range}
                    className="h-9"
                    onClick={() => handleQuickRange(range)}
                  >
                    {range === 'today' ? 'Today' : range === 'tomorrow' ? 'Tomorrow' : 'All upcoming'}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="flex items-center gap-1.5 text-xs text-brand-text-muted">
                  <CalendarDays className="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" />
                  From
                  <Input
                    type="date"
                    value={fromDate}
                    max={toDate || undefined}
                    onChange={(event) => { setFromDate(event.target.value); setQuickRange('all'); resetToList() }}
                    className="h-9 w-38 py-1 text-xs"
                    aria-label="Filter pending matches from this kickoff date"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-brand-text-muted">
                  To
                  <Input
                    type="date"
                    value={toDate}
                    min={fromDate || undefined}
                    onChange={(event) => { setToDate(event.target.value); setQuickRange('all'); resetToList() }}
                    className="h-9 w-38 py-1 text-xs"
                    aria-label="Filter pending matches up to this kickoff date"
                  />
                </label>
                {hasActiveFilters && (
                  <Button type="button" size="sm" variant="ghost" className="h-9 gap-1.5" onClick={handleClearFilters}>
                    <XCircle className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <p className="text-xs text-brand-text-muted" aria-live="polite">
              <span className="font-semibold text-brand-text-secondary">{totalItems}</span> pending fixture{totalItems === 1 ? '' : 's'}
              {' Â· kickoff '}
              {describePendingDateFilter({ quick: quickRange, from: fromDate, to: toDate })}
              {selection.count > 0 ? ` Â· ${selection.count} selected` : ''}
              {dateFilterError ? ` Â· ${dateFilterError}` : ''}
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {selection.count > 0 && (
            <div className="flex flex-col gap-2 border-b border-(--border) bg-(--surface-soft)/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <span className="text-sm font-medium text-brand-text-secondary">
                {selection.count} fixture{selection.count === 1 ? '' : 's'} selected
                {selection.allVisibleSelected ? ' (all rows on this page)' : ''}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="gap-1.5" onClick={() => setConfirmBulk('accept')} disabled={isMutating}>
                  <CheckCheck className="h-3.5 w-3.5" />
                  Accept selected
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-rose-500/40 text-rose-400 hover:border-rose-500 hover:bg-rose-500/10 hover:text-rose-300"
                  onClick={() => setConfirmBulk('reject')}
                  disabled={isMutating}
                >
                  <X className="h-3.5 w-3.5" />
                  Reject selected
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRawSelection(new Set())} disabled={isMutating}>
                  Clear selection
                </Button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-3xl w-full text-left">
              <thead className="border-b border-(--border) bg-linear-to-r from-(--surface)/70 to-(--surface)/40 text-xs font-semibold uppercase tracking-wider text-brand-text-muted">
                <tr>
                  <th className="w-10 px-4 py-4 sm:px-6">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-(--accent)"
                      checked={selection.allVisibleSelected}
                      ref={(node) => { if (node) node.indeterminate = selection.someVisibleSelected }}
                      onChange={(event) => setRawSelection((current) => setVisibleSelection(current, visibleIds, event.target.checked))}
                      disabled={visibleIds.length === 0}
                      aria-label={selection.allVisibleSelected ? 'Clear selection for the rows on this page' : 'Select every row on this page'}
                    />
                  </th>
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
                      <td className="px-4 py-4 sm:px-6"><Skeleton className="h-4 w-4" /></td>
                      <td className="px-4 py-4 sm:px-6"><Skeleton className="h-5 w-48" /></td>
                      <td className="px-4 py-4 sm:px-6"><Skeleton className="h-5 w-32" /></td>
                      <td className="px-4 py-4 sm:px-6"><Skeleton className="h-5 w-24" /></td>
                      <td className="px-4 py-4 text-center sm:px-6"><Skeleton className="mx-auto h-6 w-24" /></td>
                      <td className="px-4 py-4 text-center sm:px-6"><Skeleton className="mx-auto h-9 w-36" /></td>
                    </tr>
                  ))
                ) : isError ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-red-400">
                      <AlertCircle className="mx-auto mb-2" />
                      <p>Failed to load pending matches.</p>
                      <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void refetch()}>
                        Try again
                      </Button>
                    </td>
                  </tr>
                ) : pendingMatches.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-brand-text-muted">
                      <SearchX className="mx-auto mb-2 h-6 w-6" />
                      {hasActiveFilters ? 'No pending matches match the current filters.' : 'No pending matches awaiting review.'}
                    </td>
                  </tr>
                ) : (
                  pendingMatches.map((match, idx) => {
                    // A logo the project may not hotlink resolves to null, so the row keeps its initials fallback.
                    const homeLogo = resolveTeamLogoUrl(match.homeTeamLogo, teamLogoTransform)
                    const awayLogo = resolveTeamLogoUrl(match.awayTeamLogo, teamLogoTransform)
                    return (
                      <motion.tr
                        key={match.id}
                        className={`border-b border-(--border) transition-colors last:border-b-0 hover:bg-linear-to-r hover:from-(--surface-soft)/50 hover:to-transparent/30 ${selectedIds.has(match.id) ? 'bg-(--surface-soft)/60' : 'bg-linear-to-r from-(--surface-soft)/30 to-transparent'}`}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.06 }}
                      >
                        <td className="px-4 py-4 align-top sm:px-6">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 accent-(--accent)"
                            checked={selectedIds.has(match.id)}
                            onChange={(event) => setRawSelection((current) => togglePendingSelection(current, match.id, event.target.checked))}
                            disabled={isMutating}
                            aria-label={`Select ${match.title}`}
                          />
                        </td>
                        <td className="px-4 py-4 align-top font-medium text-brand-text-primary sm:px-6">
                          <div className="min-w-56 space-y-2">
                            <div className="wrap-break-word">{match.title}</div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-brand-text-muted">
                              <Badge variant="secondary" className="px-2 py-0.5 text-[10px] uppercase tracking-wide">
                                {match.sport ? formatLabel(match.sport) : 'Sport unknown'}
                              </Badge>
                              <span className="wrap-break-word">{match.tournamentName || match.competition?.name || 'Competition not set'}{match.round != null ? ` Â· Round ${match.round}` : ''}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-brand-text-muted">
                              {homeLogo ? (
                                <img src={homeLogo} alt="" className="h-6 w-6 rounded-full bg-(--surface-soft) object-contain" />
                              ) : (
                                <span className="grid h-6 w-6 place-items-center rounded-full bg-(--surface-soft) text-[8px] font-bold">{match.homeTeamName?.slice(0, 2).toUpperCase() || 'T1'}</span>
                              )}
                              <span className="max-w-32 wrap-break-word">{match.homeTeamName || 'Home team'}</span>
                              <span className="text-(--accent)">vs</span>
                              {awayLogo ? (
                                <img src={awayLogo} alt="" className="h-6 w-6 rounded-full bg-(--surface-soft) object-contain" />
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
                    )
                  })
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

      <AlertDialog open={!!confirmBulk} onOpenChange={(isOpen) => { if (!isOpen && !isBulkAccepting && !isBulkRejecting) setConfirmBulk(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmBulk === 'accept' ? `Approve ${selection.count} pending fixture${selection.count === 1 ? '' : 's'}?` : `Reject ${selection.count} pending fixture${selection.count === 1 ? '' : 's'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmBulk === 'accept'
                ? `The selected ${selection.count} fixture${selection.count === 1 ? '' : 's'} will be published as upcoming matches. Fixtures that are no longer pending, or whose kickoff has already started, are skipped and reported back to you.`
                : `The selected ${selection.count} fixture${selection.count === 1 ? '' : 's'} will be rejected permanently and will not be recreated automatically. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkAccepting || isBulkRejecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleBulkConfirm()
              }}
              disabled={isBulkAccepting || isBulkRejecting}
              className={confirmBulk === 'reject' ? buttonVariants({ variant: 'destructive' }) : undefined}
            >
              {isBulkAccepting || isBulkRejecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {confirmBulk === 'accept' ? `Approve ${selection.count}` : `Reject ${selection.count}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
