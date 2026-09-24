import { memo } from 'react'
import { Edit, MoreVertical, Trash2, Star } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui/DropdownMenu'
import type { Match } from '../../../features/matches/matches.types'
import { formatMatchKickoff } from '../../../utils/matchDateTime'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'

const teamLogoTransform = { width: 96, height: 96, crop: 'fill' as const, gravity: 'auto' as const, quality: 'auto' as const, format: 'auto' as const }

interface MatchRowProps {
  match: Match
  onEdit: (match: Match) => void
  onDelete: (match: Match) => void
}

export const MatchRow = memo(function MatchRow({ match, onEdit, onDelete }: MatchRowProps) {
  const getStatusClass = (status: Match['status']) => {
    switch (status.toUpperCase()) {
      case 'LIVE':
        return 'bg-red-500/20 text-red-400'
      case 'UPCOMING':
        return 'bg-yellow-500/20 text-yellow-400'
      case 'FINISHED':
        return 'bg-gray-500/20 text-gray-400'
      default:
        return 'bg-gray-500/20 text-gray-400'
    }
  }

  return (
    <tr className="h-16 border-b border-(--border)/80 transition-colors hover:bg-(--accent)/5">
      <td className="p-2 align-middle">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-28 shrink-0 items-center justify-center gap-1 rounded-xl border border-(--border) bg-(--surface-soft) px-1 text-[10px] font-bold text-(--text-muted)">
            {match.homeTeamLogo ? <img src={buildCloudinaryUrl(match.homeTeamLogo, teamLogoTransform)} alt="" className="h-8 w-8 rounded-full bg-surface object-cover" /> : <span>{match.homeTeamName?.slice(0, 2).toUpperCase() || 'T1'}</span>}
            <span className="text-(--accent)">VS</span>
            {match.awayTeamLogo ? <img src={buildCloudinaryUrl(match.awayTeamLogo, teamLogoTransform)} alt="" className="h-8 w-8 rounded-full bg-surface object-cover" /> : <span>{match.awayTeamName?.slice(0, 2).toUpperCase() || 'T2'}</span>}
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold text-(--text-primary)">{match.title}</div>
            <div className="flex min-w-0 items-center gap-2 text-xs text-(--text-muted)">
              <div className="flex shrink-0 items-center gap-1">
                {match.homeTeamLogo ? <img src={buildCloudinaryUrl(match.homeTeamLogo, { ...teamLogoTransform, width: 56, height: 56 })} alt="" className="h-5 w-5 rounded-full bg-surface object-cover" /> : <span className="grid h-5 w-5 place-items-center rounded-full bg-(--surface-soft) text-[8px] font-bold">{match.homeTeamName?.slice(0, 2).toUpperCase() || 'T1'}</span>}
                <span className="max-w-32 wrap-break-word">{match.homeTeamName || 'Team 1'}</span>
              </div>
              <span className="shrink-0 text-(--accent)">vs</span>
              <div className="flex min-w-0 items-center gap-1">
                {match.awayTeamLogo ? <img src={buildCloudinaryUrl(match.awayTeamLogo, { ...teamLogoTransform, width: 56, height: 56 })} alt="" className="h-5 w-5 rounded-full bg-surface object-cover" /> : <span className="grid h-5 w-5 place-items-center rounded-full bg-(--surface-soft) text-[8px] font-bold">{match.awayTeamName?.slice(0, 2).toUpperCase() || 'T2'}</span>}
                <span className="max-w-32 wrap-break-word">{match.awayTeamName || 'Team 2'}</span>
              </div>
            </div>
            <div className="truncate text-[10px] uppercase tracking-[0.08em] text-(--accent)">
              {match.sport || 'Sport review'}{match.tournamentName ? ` · ${match.tournamentName}` : ''}
            </div>
          </div>
        </div>
      </td>
      <td className="p-2 align-middle text-xs text-[#b9a786]">
        {formatMatchKickoff(match.kickoffAt)}
      </td>
      <td className="p-2 align-middle">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getStatusClass(match.status)}`}>
          {match.status}
        </span>
      </td>
      <td className="p-2 align-middle text-center">
        {match.premium ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-1 text-xs font-semibold text-yellow-400">
            <Star className="h-4 w-4 text-yellow-400 fill-yellow-400" /> Premium
          </span>
        ) : (
          <span className="text-xs text-(--text-muted)">—</span>
        )}
      </td>
      <td className="p-2 text-right align-middle">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical size={16} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(match)} className="gap-2"><Edit size={14} /> Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete(match)} className="gap-2 text-red-400 focus:bg-red-500/10 focus:text-red-400"><Trash2 size={14} /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  )
})