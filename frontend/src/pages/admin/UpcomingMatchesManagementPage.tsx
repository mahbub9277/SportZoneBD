import { useState } from 'react'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { motion } from 'framer-motion'
import { Calendar, Clock, PlusCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { useGetAdminUpcomingMatchesQuery, useCreateMatchMutation } from '../../features/admin/adminUpcomingMatches.api'
import { useUpdateMatchStatusMutation } from '../../features/admin/adminLiveMatches.api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button' 
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '../../components/ui/Dialog'
import { CreateMatchForm, type CreateMatchFormValues } from './components/CreateMatchForm'
import { useUploadFilesMutation } from '../../features/admin/uploads.api'
import { formatMatchKickoff, parseMatchDateTime } from '../../utils/matchDateTime'
import { buildCloudinaryUrl } from '../../utils/cloudinary'

export function UpcomingMatchesManagementPage() {
  const { data, isLoading, isError } = useGetAdminUpcomingMatchesQuery({})
  const [updateStatus, { isLoading: isUpdating }] = useUpdateMatchStatusMutation()
  const [createMatch, { isLoading: isCreating }] = useCreateMatchMutation()
  const [uploadFiles, { isLoading: isUploadingStreamLogo }] = useUploadFilesMutation()

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [uploadingStreamLogoIndex, setUploadingStreamLogoIndex] = useState<number | null>(null)

  const upcomingMatches = data?.items ?? []
  
  const form = useForm<CreateMatchFormValues>({
    defaultValues: {
      title: '',
      kickoffDate: '', // New field
      kickoffTime: '', // New field
      sport: 'CRICKET',
      expectedDurationMinutes: 240,
      expectedEndTime: '',
      autoFinish: false,
      preStartEnabled: null,
      preStartWindowMinutes: null,
      preStartVideoUrl: '',
      premium: false, // New field
      status: 'UPCOMING', // New field
      streams: [], // Initialize streams
    },
  })

  const handleCreateMatch = async (values: CreateMatchFormValues) => {
    const formData = new FormData()
    const kickoffAt = parseMatchDateTime(values.kickoffDate, values.kickoffTime)
    if (!kickoffAt) {
      toast.error('Kickoff date and time must be valid Bangladesh local time.')
      return
    }

    Object.entries(values).forEach(([key, value]) => { 
      if (key === 'streams' && Array.isArray(value)) {
        formData.append(key, JSON.stringify(value));
      } else if (value instanceof File) {
        formData.append(key, value, value.name)
      } else if (key !== 'expectedDurationMinutes' && key !== 'expectedEndTime' && value !== undefined && value !== null) {
        formData.append(key, value.toString())
      }
    })
    formData.append('kickoffAt', kickoffAt)
    formData.set('tournamentName', values.title.trim())
    if (values.autoFinish && values.expectedEndTime?.trim()) {
      const expectedEndTime = parseMatchDateTime(values.expectedEndTime.slice(0, 10), values.expectedEndTime.slice(11, 16))
      if (expectedEndTime) formData.append('expectedEndTime', expectedEndTime)
    }

    try {
      await createMatch(formData).unwrap()
      toast.success('Match created successfully!')
      setIsCreateModalOpen(false)
      form.reset(); // Reset form after successful creation
    } catch {
      toast.error('Failed to create match.')
    }
  }

  const handleStreamLogoUpload = async (streamIndex: number, file: File) => {
    setUploadingStreamLogoIndex(streamIndex)
    try {
      const result = await uploadFiles({ files: [file], folder: 'sportzone/stream-logos', mediaType: 'LOGO' }).unwrap()
      const logoUrl = result.uploads[0]?.url
      if (!logoUrl) throw new Error('Cloudinary did not return a logo URL.')
      form.setValue(`streams.${streamIndex}.logo`, logoUrl, { shouldDirty: true, shouldValidate: true })
      toast.success('Stream logo uploaded.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Stream logo upload failed.')
    } finally {
      setUploadingStreamLogoIndex(null)
    }
  }

  const handleStatusChange = async (matchId: string, status: 'UPCOMING' | 'LIVE' | 'FINISHED') => {
    try {
      await updateStatus({ id: matchId, status }).unwrap()
      toast.success('Match status updated successfully!')
    } catch {
      toast.error('Failed to update match status.')
    }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }}>
        <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
          <CardHeader className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
            <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15, duration: 0.4 }}>
              <div className="flex items-center gap-3">
                <motion.div className="p-2 bg-linear-to-br from-blue-500 to-blue-600 rounded-lg" whileHover={{ scale: 1.1 }}>
                  <Calendar className="h-5 w-5 text-white" />
                </motion.div>
                <div>
                  <CardTitle className="text-2xl text-brand-text-primary">Upcoming Matches</CardTitle>
                  <p className="text-sm text-brand-text-muted">Manage all scheduled upcoming matches.</p>
                </div>
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15, duration: 0.4 }}>
              <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
                <DialogTrigger asChild>
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Button className="bg-linear-to-r from-(--accent) to-(--accent)/80 hover:from-(--accent)/90 hover:to-(--accent)/70 shadow-lg">
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Create Match
                    </Button>
                  </motion.div>
                </DialogTrigger>
                <DialogContent className="w-[calc(100%-1rem)] max-w-2xl min-w-0 max-h-[calc(100dvh-1rem)] overflow-y-auto overflow-x-hidden bg-linear-to-br from-(--surface-soft) to-(--surface) sm:w-[calc(100%-2rem)]">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-bold text-brand-text-primary">Create New Match</DialogTitle>
                    <DialogDescription className="text-sm text-brand-text-muted">Fill in the details to add a new match.</DialogDescription>
                  </DialogHeader>
                  <CreateMatchForm form={form} onSubmit={handleCreateMatch} isLoading={isCreating || isUploadingStreamLogo} onStreamLogoUpload={handleStreamLogoUpload} uploadingStreamLogoIndex={uploadingStreamLogoIndex} showAiAutofill />
                </DialogContent>
              </Dialog>
            </motion.div>
          </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-2xl w-full text-left">
              <thead className="border-b border-(--border) bg-linear-to-r from-(--surface)/70 to-(--surface)/40 text-xs font-semibold uppercase tracking-wider text-brand-text-muted">
                <tr>
                  <th className="px-6 py-4">Match</th>
                  <th className="px-6 py-4">Kick-off Time</th>
                  <th className="px-6 py-4 text-center">Current Status</th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <motion.tr key={i} className="border-b border-(--border) last:border-b-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-48" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-32" /></td>
                      <td className="px-6 py-4 text-center"><Skeleton className="h-6 w-20 mx-auto" /></td>
                      <td className="px-6 py-4 text-center"><Skeleton className="h-8 w-32 mx-auto" /></td>
                    </motion.tr>
                  ))
                ) : isError ? (
                  <tr><td colSpan={4} className="p-6 text-center text-red-400">Failed to load upcoming matches.</td></tr>
                ) : upcomingMatches.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-center text-brand-text-muted">No matches are currently scheduled.</td></tr>
                ) : (
                  <motion.tbody>
                    {upcomingMatches.map((match, idx) => (
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
                            <div className="wrap-break-word">{match.title}</div>
                            <div className="flex items-center gap-2 text-xs text-brand-text-muted">
                              {match.homeTeamLogo ? <img src={buildCloudinaryUrl(match.homeTeamLogo, { width: 48, height: 48, crop: 'fit' })} alt="" className="h-6 w-6 rounded-full bg-(--surface-soft) object-contain" /> : <span className="grid h-6 w-6 place-items-center rounded-full bg-(--surface-soft) text-[8px] font-bold">{match.homeTeamName?.slice(0, 2).toUpperCase() || 'T1'}</span>}
                              <span className="max-w-32 wrap-break-word">{match.homeTeamName || 'Team 1'}</span>
                              <span className="text-(--accent)">vs</span>
                              {match.awayTeamLogo ? <img src={buildCloudinaryUrl(match.awayTeamLogo, { width: 48, height: 48, crop: 'fit' })} alt="" className="h-6 w-6 rounded-full bg-(--surface-soft) object-contain" /> : <span className="grid h-6 w-6 place-items-center rounded-full bg-(--surface-soft) text-[8px] font-bold">{match.awayTeamName?.slice(0, 2).toUpperCase() || 'T2'}</span>}
                              <span className="max-w-32 wrap-break-word">{match.awayTeamName || 'Team 2'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-brand-text-secondary flex items-center gap-2">
                          <Clock className="h-4 w-4 text-(--accent)" />
                          {formatMatchKickoff(match.kickoffAt)}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <motion.span className="rounded-full bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-400 inline-block" whileHover={{ scale: 1.05 }}>
                            {match.status}
                          </motion.span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Select onValueChange={(value) => handleStatusChange(match.id, value as 'UPCOMING' | 'LIVE' | 'FINISHED')} disabled={isUpdating}>
                              <SelectTrigger className="w-40 bg-linear-to-r from-(--accent)/20 to-(--accent)/10 border-2 border-(--accent)/50 hover:border-(--accent)">
                                <SelectValue placeholder="Change Status" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="LIVE">Set to LIVE</SelectItem>
                                <SelectItem value="FINISHED">Finish Match</SelectItem>
                              </SelectContent>
                            </Select>
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