import { useState, useCallback } from 'react'
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import { useDebounce } from '../../hooks/useDebounce'
import { useEntityManagement } from '../../hooks/useEntityManagement'
import { z } from 'zod'
import { useCreateMatchMutation, useUpdateMatchMutation, useDeleteMatchMutation, } from '../../features/admin/adminMatches.api'

import { useGetMatchesQuery } from '../../features/matches/matches.api'
import { Card } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton' 
import { AlertCircle, PlusCircle, ArrowUp, ArrowDown, Star } from 'lucide-react'
import { buttonVariants } from '../../components/ui/button.variants'
import type { Match } from '../../features/matches/matches.types'
import { Stream } from '../../features/matches/matches.types' // Assuming Stream type is available
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/Dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/AlertDialog'
import { MatchRow } from './components/MatchRow'
import { Button } from '../../components/ui/Button'
import { CreateMatchForm, type CreateMatchFormValues } from './components/CreateMatchForm' // Changed import
import { MatchFilters } from './components/MatchFilters'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../../components/ui/Table'
import { PaginationControls } from '../../components/ui/PaginationControls'
import { useUploadFilesMutation } from '../../features/admin/uploads.api'

import { useNavigate } from 'react-router-dom' // Import useNavigate
import { motion } from 'framer-motion'
import { formatMatchDateTimeInput, parseMatchDateTime } from '../../utils/matchDateTime'

const matchFormSchemaBase = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters.'),
  homeTeamName: z.string().trim().max(120).nullable().optional().default(''),
  awayTeamName: z.string().trim().max(120).nullable().optional().default(''),
  homeTeamId: z.string().uuid().nullable().optional().or(z.literal('')),
  awayTeamId: z.string().uuid().nullable().optional().or(z.literal('')),
  homeTeamLogo: z.any().nullable().optional(),
  awayTeamLogo: z.any().nullable().optional(),
  kickoffDate: z.string().min(1, 'Kickoff date is required.'),
  kickoffTime: z.string().min(1, 'Kickoff time is required.'),
  sport: z.enum(['CRICKET', 'FOOTBALL', 'BASKETBALL', 'TENNIS', 'MOTORSPORTS', 'WWE']),
  expectedDurationMinutes: z.number().int().min(1).max(1440),
  expectedEndTime: z.string().optional(),
  autoFinish: z.boolean(),
  preStartEnabled: z.boolean().nullable(),
  preStartWindowMinutes: z.number().int().min(1).max(1440).nullable(),
  preStartVideoUrl: z.string().url().or(z.literal('')).default(''),
  premium: z.boolean(),
  status: z.enum(['UPCOMING', 'LIVE', 'FINISHED']),
  streams: z.array(
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).optional(),
      logo: z.string().nullable().optional().or(z.literal('')),
      sourceType: z.enum(['DIRECT_URL', 'CHANNEL']).default('DIRECT_URL'),
      channelId: z.string().nullable().optional().or(z.literal('')),
      primaryUrl: z.string().default(''),
      backupUrls: z.array(z.string()).optional(),
      quality: z.string().min(1, 'Quality is required').default('1080p'),
      status: z.enum(['READY', 'LIVE', 'OFFLINE', 'ERROR']).default('READY'),
      activationMode: z.enum(['AUTOMATIC', 'MANUAL']).default('AUTOMATIC'),
      activationOffsetMinutes: z.number().int().nonnegative().default(0),
    }),
  ).default([]),
})

const matchFormSchema = matchFormSchemaBase.refine(
  (values) => {
    return Boolean(parseMatchDateTime(values.kickoffDate, values.kickoffTime))
  },
  {
    path: ['kickoffTime'],
    message: 'Please enter a valid kickoff date and time.',
  },
)

const matchFormResolver: Resolver<CreateMatchFormValues> = async (values) => {
  const parsed = matchFormSchema.safeParse(values)

  if (parsed.success) {
    return {
      values: parsed.data,
      errors: {},
    }
  }

  const errors: FieldErrors<CreateMatchFormValues> = {}

  for (const issue of parsed.error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : 'root'
    errors[key as keyof CreateMatchFormValues] = {
      type: issue.code,
      message: issue.message,
    }
  }

  const fallbackValues: Record<string, never> = {}

  return {
    values: fallbackValues,
    errors,
  }
}

type MatchFormData = CreateMatchFormValues

export function MatchManagementPage() {
  const navigate = useNavigate(); // Initialize useNavigate
  const initialFilters = {
    searchTerm: '',
    statusFilter: 'All',
    sortOrder: 'asc' as 'asc' | 'desc',
    currentPage: 1,
    itemsPerPage: 10,
  }
  
  const [filters, setFilters] = useState(initialFilters)
  const debouncedSearchTerm = useDebounce(filters.searchTerm, 300);
  
  const { data, isLoading, isError } = useGetMatchesQuery({
    page: filters.currentPage,
    limit: filters.itemsPerPage,
    search: debouncedSearchTerm,
    status: filters.statusFilter === 'All' ? undefined : (filters.statusFilter as Match['status']),
    sort: `kickoffAt-${filters.sortOrder}`,
  });

  const form = useForm<CreateMatchFormValues>({
    resolver: matchFormResolver,
    defaultValues: {
      title: '',
      homeTeamName: '',
      awayTeamName: '',
      homeTeamId: null,
      awayTeamId: null,
      homeTeamLogo: null,
      awayTeamLogo: null,
      kickoffDate: '',
      kickoffTime: '',
      sport: 'CRICKET',
      expectedDurationMinutes: 240,
      expectedEndTime: '',
      autoFinish: false,
      preStartEnabled: null,
      preStartWindowMinutes: null,
      preStartVideoUrl: '',
      premium: false,
      status: 'UPCOMING',
      streams: [],
    },
  })
  const [uploadFiles, { isLoading: isUploadingStreamLogo }] = useUploadFilesMutation()
  const [uploadingStreamLogoIndex, setUploadingStreamLogoIndex] = useState<number | null>(null)

  const handleStreamLogoUpload = useCallback(async (streamIndex: number, file: File) => {
    setUploadingStreamLogoIndex(streamIndex)
    try {
      const result = await uploadFiles({ files: [file], folder: 'sportzone/stream-logos', mediaType: 'LOGO' }).unwrap()
      const logoUrl = result.uploads[0]?.url
      if (!logoUrl) throw new Error('Cloudinary did not return a logo URL.')
      form.setValue(`streams.${streamIndex}.logo`, logoUrl, { shouldDirty: true, shouldValidate: true })
    } catch {
      // The form remains unchanged when an upload fails.
    } finally {
      setUploadingStreamLogoIndex(null)
    }
  }, [form, uploadFiles])

  const entityToFormData = useCallback((match: Match): CreateMatchFormValues => {
    const kickoff = new Date(match.kickoffAt)
    return {
      title: match.title,
      homeTeamName: match.homeTeamName ?? '',
      awayTeamName: match.awayTeamName ?? '',
      homeTeamId: match.homeTeamId ?? match.homeTeam?.id ?? null,
      awayTeamId: match.awayTeamId ?? match.awayTeam?.id ?? null,
      homeTeamLogo: match.homeTeamLogo ?? null,
      awayTeamLogo: match.awayTeamLogo ?? null,
      kickoffDate: formatMatchDateTimeInput(match.kickoffAt).slice(0, 10),
      kickoffTime: formatMatchDateTimeInput(match.kickoffAt).slice(11, 16),
      sport: (match.sport as CreateMatchFormValues['sport']) ?? 'CRICKET',
      expectedDurationMinutes: match.expectedEndTime ? Math.max(1, Math.round((new Date(match.expectedEndTime).getTime() - kickoff.getTime()) / 60000)) : 120,
      expectedEndTime: formatMatchDateTimeInput(match.expectedEndTime),
      autoFinish: match.autoFinish ?? false,
      preStartEnabled: match.preStartEnabled ?? null,
      preStartWindowMinutes: match.preStartWindowMinutes ?? null,
      preStartVideoUrl: match.preStartVideoUrl ?? '',
      premium: !!match.premium,
      status: match.status,
      streams: (match.streams ?? []).map((stream: Stream) => ({
        id: stream.id,
        name: stream.name?.trim() || 'Main stream',
        logo: stream.logo ?? '',
        sourceType: stream.sourceType === 'CHANNEL' ? 'CHANNEL' : 'DIRECT_URL',
        channelId: stream.channelId ?? '',
        primaryUrl: stream.primaryUrl?.trim() || '',
        backupUrls: stream.backupUrl ? [stream.backupUrl.trim()] : [],
        quality: stream.quality?.trim() || '1080p',
        status: (stream.status as 'READY' | 'LIVE' | 'OFFLINE' | 'ERROR') ?? 'READY',
        activationMode: stream.activationMode === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC',
        activationOffsetMinutes: Number(stream.activationOffsetMinutes ?? 0),
      })),
    }
  }, [])

  const formDataToPayload = (values: CreateMatchFormValues) => {
    const formData = new FormData()
    const kickoffAt = parseMatchDateTime(values.kickoffDate, values.kickoffTime)
    const expectedEndTime = values.autoFinish && values.expectedEndTime?.trim()
      ? parseMatchDateTime(values.expectedEndTime.slice(0, 10), values.expectedEndTime.slice(11, 16)) ?? ''
      : ''
    if (!kickoffAt) throw new Error('Kickoff date and time must be valid Bangladesh local time.')

    const normalizedStreams = (values.streams ?? []).map((stream) => ({
      ...stream,
      sourceType: stream.sourceType ?? 'DIRECT_URL',
      channelId: stream.sourceType === 'CHANNEL' ? (stream.channelId ?? null) : null,
      activationMode: stream.activationMode ?? 'AUTOMATIC',
      activationOffsetMinutes: Number(stream.activationOffsetMinutes ?? 0),
      primaryUrl: stream.sourceType === 'CHANNEL' ? (stream.primaryUrl ?? '').trim() : (stream.primaryUrl ?? '').trim(),
      backupUrl: Array.isArray(stream.backupUrls) ? stream.backupUrls.find((url) => url?.trim()) ?? null : stream.backupUrls ?? null,
      backupUrls: undefined,
    }))

    Object.entries(values).forEach(([key, value]) => {
      if ((key === 'homeTeamLogo' || key === 'awayTeamLogo') && value instanceof File) {
        formData.append(key, value, value.name)
      } else if (key === 'streams' && Array.isArray(value)) {
        formData.append(key, JSON.stringify(normalizedStreams))
      } else if (key !== 'kickoffDate' && key !== 'kickoffTime' && key !== 'expectedEndTime' && key !== 'expectedDurationMinutes' && value !== null && value !== undefined) {
        formData.append(key, String(value))
      }
    })

    formData.append('kickoffAt', kickoffAt)
    formData.set('tournamentName', values.title.trim())
    formData.append('expectedEndTime', expectedEndTime)
    return formData
  }

  const {
    editingEntity: editingMatch,
    deletingEntity: deletingMatch,
    setDeletingEntity,
    isFormOpen,
    isMutating,
    handleOpenCreate,
    handleOpenEdit,
    handleCloseForm,
    handleSubmit,
    handleDeleteConfirm,
  } = useEntityManagement<Match, MatchFormData, FormData, { id: string; formData: FormData }>({
    entityName: 'Match',
    useCreateMutation: useCreateMatchMutation,
    useUpdateMutation: useUpdateMatchMutation,
    useDeleteMutation: useDeleteMatchMutation,
    form,
    entityToFormData,
    formDataToCreatePayload: formDataToPayload,
    formDataToUpdatePayload: (values, id) => ({
      id,
      formData: formDataToPayload(values),
    }),
  })

  const paginatedMatches = data?.items ?? [];
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div className="flex items-center justify-between" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div>
          <h1 className="text-3xl font-semibold text-(--text-primary)">Match Management</h1>
          <p className="mt-1 text-(--text-muted)">Create, edit, and manage all matches on the platform.</p>
        </div>
        <div className="flex gap-2"> {/* Added a div to group buttons */}
          <Button variant="outline" className="gap-2 border-(--accent)/40 text-(--accent) hover:border-(--accent) hover:bg-(--accent)/10" onClick={() => navigate('/admin/streams')}>
            Manage Stream URLs
          </Button>
          <Button className="gap-2 bg-(--accent) text-slate-950 hover:bg-(--accent-strong)" onClick={handleOpenCreate}>
            <motion.span whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><PlusCircle size={16} /></motion.span> Add Match
          </Button>
        </div>
      </motion.div>

      <MatchFilters
        searchTerm={filters.searchTerm}
        setSearchTerm={(value) => setFilters(prev => ({ ...prev, searchTerm: value, currentPage: 1 }))}
        statusFilter={filters.statusFilter}
        setStatusFilter={(value) => setFilters(prev => ({ ...prev, statusFilter: value, currentPage: 1 }))}
        setCurrentPage={(page) => setFilters(prev => ({ ...prev, currentPage: page }))}
      />

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}><Card className="overflow-hidden border-(--border) bg-(--surface)/70 shadow-[0_20px_60px_var(--shadow)]">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Match</TableHead>
                <TableHead>
                  <div className="flex items-center gap-2">
                    Kickoff Time
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFilters(prev => ({ ...prev, sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc' }))}>
                      <motion.span whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}>{filters.sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</motion.span>
                    </Button>
                  </div>
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead><Star size={14} className="mx-auto" /></TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <td colSpan={6}><Skeleton className="h-20 w-full" /></td>
                </TableRow>
              ))}
              {isError && (
                <tr><td colSpan={5} className="p-6 text-center text-red-400"><AlertCircle className="mx-auto mb-2" /> Could not load matches.</td></tr>
              )}
              {!isLoading && paginatedMatches.length > 0 && paginatedMatches.map(match => <MatchRow key={match.id} match={match} onEdit={handleOpenEdit} onDelete={setDeletingEntity} />)}
            </TableBody>
          </Table>
        </div>
        {!isLoading && paginatedMatches.length === 0 && (
          <div className="p-6 text-center text-(--text-muted)">No matches found.</div>
        )}
        <PaginationControls
          currentPage={filters.currentPage}
          totalPages={totalPages}
          itemsPerPage={filters.itemsPerPage}
          setCurrentPage={(page) => setFilters(prev => ({ ...prev, currentPage: page }))}
          setItemsPerPage={(limit) => setFilters(prev => ({ ...prev, itemsPerPage: limit, currentPage: 1 }))}
        />
      </Card></motion.div>


      {/* Unified Create/Edit Modal */}
      <Dialog open={isFormOpen} onOpenChange={(isOpen) => !isOpen && handleCloseForm()}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-2xl min-w-0 max-h-[calc(100dvh-1rem)] overflow-y-auto overflow-x-hidden sm:w-[calc(100%-2rem)]" onPointerDownOutside={(event) => { if ((event.target as HTMLElement).closest('[data-media-library-modal]')) event.preventDefault() }} onInteractOutside={(event) => { if ((event.target as HTMLElement).closest('[data-media-library-modal]')) event.preventDefault() }}>
          <DialogHeader>
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              {editingMatch ? 'Edit Match' : 'Create New Match'}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              {editingMatch
                ? `Update the details for "${editingMatch?.title}".`
                : 'Fill in the details to add a new match.'}
            </DialogDescription>
          </DialogHeader> 
          <CreateMatchForm form={form} onSubmit={handleSubmit} isLoading={isMutating || isUploadingStreamLogo} onStreamLogoUpload={handleStreamLogoUpload} uploadingStreamLogoIndex={uploadingStreamLogoIndex} showAiAutofill={!editingMatch} />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingMatch} onOpenChange={(isOpen) => !isOpen && setDeletingEntity(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete the match &quot;{deletingMatch?.title}&quot;. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className={buttonVariants({ variant: 'destructive' })}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}