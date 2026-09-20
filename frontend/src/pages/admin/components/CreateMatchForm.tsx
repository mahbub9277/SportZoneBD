import { useEffect, useMemo, useState } from 'react'
import { useFieldArray, type UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../../components/ui/Form'
import { Input } from '../../../components/ui/Input'
import { Button } from '../../../components/ui/Button'
import { Checkbox } from '../../../components/ui/Checkbox'
import { ImagePlus, Loader2, PlusCircle, MinusCircle, X, ChevronDown, Sparkles } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/Select'
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/Popover'
import { useGetAdminChannelsQuery } from '../../../features/admin/channels.api'
import { useLazySearchTeamsQuery, type TeamSearchResult } from '../../../features/admin/admin.api'
import type { MediaAsset } from '../../../features/events/events.api'
import { MediaLibraryModal } from './MediaLibraryModal'
import { useParseMatchMutation, type ParsedMatchDetails } from '../../../features/ai/ai.api'
import { formatMatchDateTimeInput, parseMatchDateTime } from '../../../utils/matchDateTime'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import { useDebounce } from '../../../hooks/useDebounce'

// This type is now comprehensive, matching MatchManagementPage.tsx's schema
export type CreateMatchFormValues = {
  title: string
  homeTeamName?: string | null
  awayTeamName?: string | null
  homeTeamId?: string | null
  awayTeamId?: string | null
  homeTeamLogo?: File | string | null
  awayTeamLogo?: File | string | null
  kickoffDate: string
  kickoffTime: string
  sport: 'CRICKET' | 'FOOTBALL' | 'BASKETBALL' | 'TENNIS' | 'MOTORSPORTS' | 'WWE'
  expectedDurationMinutes: number
  expectedEndTime?: string
  autoFinish: boolean
  preStartEnabled: boolean | null
  preStartWindowMinutes: number | null
  preStartVideoUrl: string
  premium: boolean
  status: 'UPCOMING' | 'LIVE' | 'FINISHED'
  streams?: {
    id?: string
    name?: string
    logo?: string | null
    sourceType: 'DIRECT_URL' | 'CHANNEL'
    channelId?: string | null
    primaryUrl: string
    backupUrls?: string[]
    quality: string
    status: 'READY' | 'LIVE' | 'OFFLINE' | 'ERROR'
    activationMode: 'AUTOMATIC' | 'MANUAL'
    activationOffsetMinutes: number
  }[]
}

const flatFormItemClass = 'space-y-2 border-0 bg-transparent p-0 shadow-none hover:shadow-none sm:p-0'
const sectionClass = 'min-w-0 space-y-4 rounded-3xl border border-(--border)/80 bg-linear-to-br from-(--surface-soft)/85 via-(--surface-soft)/55 to-(--surface) p-4 shadow-[0_18px_45px_rgba(2,6,23,0.12)] sm:p-5'
const inputClass = 'min-h-11 border-(--border) bg-(--surface)/75 shadow-inner shadow-black/5 transition-colors placeholder:text-(--text-muted)/70 focus:border-(--accent)/60 focus:ring-2 focus:ring-(--accent)/15'

function useLogoPreview(value: File | string | null | undefined) {
  const preview = useMemo(() => {
    if (value instanceof File) return URL.createObjectURL(value)
    return typeof value === 'string' && value ? buildCloudinaryUrl(value) : null
  }, [value])

  useEffect(() => {
    if (value instanceof File && preview) return () => URL.revokeObjectURL(preview)
  }, [preview, value])

  return preview
}

function TeamNameField({ form, nameField, idField, logoField, label, placeholder, disabled }: { form: UseFormReturn<CreateMatchFormValues>; nameField: 'homeTeamName' | 'awayTeamName'; idField: 'homeTeamId' | 'awayTeamId'; logoField: 'homeTeamLogo' | 'awayTeamLogo'; label: string; placeholder: string; disabled: boolean }) {
  const [searchTeams, { data: results = [], isFetching }] = useLazySearchTeamsQuery()
  const [isOpen, setIsOpen] = useState(false)
  const name = form.watch(nameField) ?? ''
  const selectedId = form.watch(idField) ?? ''
  const debouncedName = useDebounce(name, 300)

  useEffect(() => {
    if (debouncedName.trim().length < 2 || selectedId) return
    void searchTeams(debouncedName.trim())
  }, [debouncedName, searchTeams, selectedId])

  const selectTeam = (team: TeamSearchResult) => {
    form.setValue(nameField, team.name, { shouldDirty: true, shouldValidate: true })
    form.setValue(idField, team.id, { shouldDirty: true, shouldValidate: true })
    form.setValue(logoField, team.logoUrl ?? '', { shouldDirty: true, shouldValidate: true })
    setIsOpen(false)
  }

  return (
    <FormField control={form.control} name={nameField} render={({ field }) => (
      <FormItem className={flatFormItemClass}>
        <FormLabel>{label}</FormLabel>
        <div className="relative">
          <FormControl><Input placeholder={placeholder} className="min-h-11" {...field} value={field.value ?? ''} disabled={disabled} onFocus={() => setIsOpen(true)} onChange={(event) => { field.onChange(event); form.setValue(idField, null); form.setValue(logoField, null); setIsOpen(true) }} /></FormControl>
          {isOpen && name.trim().length >= 2 && !selectedId && <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl">
            {isFetching && <p className="px-3 py-2 text-xs text-text-muted">Searching teams...</p>}
            {!isFetching && results.length === 0 && <p className="px-3 py-2 text-xs text-text-muted">No existing team found. Upload a new logo below.</p>}
            {!isFetching && results.map((team) => <button key={`${team.id ?? team.normalizedName}`} type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-soft" onMouseDown={(event) => event.preventDefault()} onClick={() => selectTeam(team)}>
              {team.logoUrl ? <img src={buildCloudinaryUrl(team.logoUrl, { width: 64, height: 64, crop: 'fit', quality: 'auto', format: 'auto' })} alt="" className="h-8 w-8 rounded-md object-contain" /> : <span className="grid h-8 w-8 place-items-center rounded-md bg-surface-soft text-xs">{team.name.slice(0, 2).toUpperCase()}</span>}
              <span className="min-w-0"><span className="block truncate text-sm text-text-primary">{team.name}</span><span className="block text-[11px] text-text-muted">Existing team</span></span>
            </button>)}
          </div>}
        </div>
        {selectedId && <p className="text-xs text-success">Using existing team logo</p>}
        <FormMessage />
      </FormItem>
    )} />
  )
}

interface CreateMatchFormProps {
  form: UseFormReturn<CreateMatchFormValues>
  onSubmit: (values: CreateMatchFormValues) => void
  isLoading: boolean
  onStreamLogoUpload?: (streamIndex: number, file: File) => void
  uploadingStreamLogoIndex?: number | null
  showAiAutofill?: boolean
}

interface StreamCardProps {
  form: UseFormReturn<CreateMatchFormValues>
  streamIndex: number
  isLoading: boolean
  removeStream: (index: number) => void
  onLogoUpload?: (file: File) => void
  isUploadingLogo?: boolean
}

function StreamCard({ form, streamIndex, isLoading, removeStream, onLogoUpload, isUploadingLogo = false }: StreamCardProps) {
  const logo = form.watch(`streams.${streamIndex}.logo`)
  const sourceType = form.watch(`streams.${streamIndex}.sourceType`) ?? 'DIRECT_URL'
  const selectedChannelId = form.watch(`streams.${streamIndex}.channelId`) ?? ''
  const [channelSearch, setChannelSearch] = useState('')
  const [channelPickerOpen, setChannelPickerOpen] = useState(false)
  const [isMediaLibraryOpen, setIsMediaLibraryOpen] = useState(false)
  const { data: adminChannels = [] } = useGetAdminChannelsQuery(undefined)
  const filteredChannels = adminChannels.filter((channel) => {
    const search = channelSearch.trim().toLowerCase()
    if (!search) return true
    return channel.name.toLowerCase().includes(search) || channel.id.toLowerCase().includes(search)
  })
  const selectedChannel = adminChannels.find((channel) => channel.id === selectedChannelId)
  const { fields: backupUrlFields, append: appendBackupUrl, remove: removeBackupUrl } = useFieldArray({
    control: form.control,
    name: `streams.${streamIndex}.backupUrls` as never,
  })

  return (
    <div className="mb-4 w-full min-w-0 space-y-4 rounded-3xl border border-(--border)/80 bg-linear-to-br from-(--surface-soft) to-(--surface) p-4 shadow-[0_16px_40px_rgba(2,6,23,0.12)] sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField control={form.control} name={`streams.${streamIndex}.name`} render={({ field }) => (
          <FormItem><FormLabel>Channel name</FormLabel><FormControl><Input placeholder="Sportzfy Sports HD" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name={`streams.${streamIndex}.logo`} render={({ field }) => (
          <FormItem><FormLabel>Channel logo</FormLabel><FormControl><div className="flex items-center gap-2">
            {logo ? <img src={logo} alt="Channel logo preview" className="h-10 w-10 rounded-lg border border-border object-cover" /> : <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground"><ImagePlus className="h-4 w-4" /></div>}
            <Button type="button" variant="outline" size="sm" onClick={() => setIsMediaLibraryOpen(true)} disabled={isLoading}><ImagePlus className="h-4 w-4" />Library</Button>
            {onLogoUpload && <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text-primary hover:border-accent/40 hover:text-accent">
              {isUploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              {isUploadingLogo ? 'Uploading...' : logo ? 'Change' : 'Upload'}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={isUploadingLogo} onChange={(event) => { const file = event.target.files?.[0]; if (file) onLogoUpload(file); event.currentTarget.value = '' }} />
            </label>}
            {logo && <Button type="button" variant="ghost" size="icon" onClick={() => field.onChange('')} aria-label="Remove channel logo"><X className="h-4 w-4" /></Button>}
          </div></FormControl><FormMessage /></FormItem>
        )} />
      </div>
      <FormField
        control={form.control}
        name={`streams.${streamIndex}.sourceType`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Source Type</FormLabel>
            <Select onValueChange={field.onChange} value={field.value ?? 'DIRECT_URL'} disabled={isLoading}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select source type" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="DIRECT_URL">Direct URL</SelectItem>
                <SelectItem value="CHANNEL">Existing Channel</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {sourceType === 'CHANNEL' ? (
        <FormField control={form.control} name={`streams.${streamIndex}.channelId`} render={({ field }) => (
          <FormItem>
            <FormLabel>Existing Channel</FormLabel>
            <Popover open={channelPickerOpen} onOpenChange={setChannelPickerOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-between" disabled={isLoading}>
                  <span className="truncate text-left">{selectedChannel ? selectedChannel.name : 'Select channel'}</span>
                  <ChevronDown className="h-4 w-4 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(420px,90vw)] p-2" align="start">
                <div className="space-y-2">
                  <Input
                    placeholder="Search channels by name or ID"
                    value={channelSearch}
                    onChange={(event) => setChannelSearch(event.target.value)}
                    className="h-9"
                  />
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {filteredChannels.length > 0 ? filteredChannels.map((channel) => (
                      <button
                        key={channel.id}
                        type="button"
                        className="flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left hover:border-accent/40 hover:bg-accent/5"
                        onClick={() => {
                          field.onChange(channel.id)
                          setChannelPickerOpen(false)
                          setChannelSearch('')
                          if (!form.getValues(`streams.${streamIndex}.name`) || form.getValues(`streams.${streamIndex}.name`) === 'Main stream') {
                            form.setValue(`streams.${streamIndex}.name`, channel.name, { shouldDirty: true, shouldValidate: true })
                          }
                        }}
                      >
                        {channel.logo ? (
                          <img src={channel.logo} alt={channel.name} className="h-9 w-9 rounded-md object-cover" />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                            {channel.name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-text-primary">{channel.name}</div>
                          <div className="truncate text-xs text-text-muted">{channel.id}</div>
                        </div>
                      </button>
                    )) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-text-muted">
                        No matching channels found.
                      </div>
                    )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            {selectedChannel && (
              <p className="mt-2 text-xs text-text-muted">Selected: {selectedChannel.name}</p>
            )}
            <FormMessage />
          </FormItem>
        )} />
      ) : (
        <FormField control={form.control} name={`streams.${streamIndex}.primaryUrl`} render={({ field }) => (
          <FormItem><FormLabel>Primary URL</FormLabel><FormControl><Input placeholder="Primary Stream URL" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField control={form.control} name={`streams.${streamIndex}.quality`} render={({ field }) => (
          <FormItem><FormLabel>Quality (e.g., 1080p)</FormLabel><FormControl><Input placeholder="e.g., 1080p" {...field} /></FormControl><FormMessage /></FormItem>
        )} />

        <FormField
          control={form.control}
          name={`streams.${streamIndex}.activationMode`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Activation Mode</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? 'AUTOMATIC'} disabled={isLoading}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select activation mode" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="AUTOMATIC">Automatic</SelectItem>
                  <SelectItem value="MANUAL">Manual</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField control={form.control} name={`streams.${streamIndex}.activationOffsetMinutes`} render={({ field }) => (
        <FormItem>
          <FormLabel>Activation Offset (minutes)</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={0}
              step={1}
              value={field.value ?? 0}
              onChange={(event) => field.onChange(Number(event.target.value) || 0)}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )} />

      <FormField
        control={form.control}
        name={`streams.${streamIndex}.status`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Stream Status</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select stream status" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="READY">Ready</SelectItem>
                <SelectItem value="LIVE">Live</SelectItem>
                <SelectItem value="OFFLINE">Offline</SelectItem>
                <SelectItem value="ERROR">Error</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <div>
        <h4 className="mb-2 text-md font-semibold">Backup URLs</h4>
        {backupUrlFields.map((backupField, backupIndex) => (
          <div key={backupField.id} className="mb-2 flex items-center gap-2">
            <FormField control={form.control} name={`streams.${streamIndex}.backupUrls.${backupIndex}`} render={({ field }) => (
              <FormItem className="min-w-0 grow">
                <FormControl><Input placeholder="Backup Stream URL" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="button" variant="outline" size="icon" onClick={() => removeBackupUrl(backupIndex)} disabled={isLoading}>
              <MinusCircle size={16} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => appendBackupUrl('' as never)}
          disabled={isLoading}
          className="mt-2"
        >
          <PlusCircle size={16} className="mr-2" /> Add Backup URL
        </Button>
      </div>

      <Button type="button" variant="destructive" size="sm" onClick={() => removeStream(streamIndex)} className="w-full" disabled={isLoading}>
        Remove Stream
      </Button>
      {isMediaLibraryOpen && <MediaLibraryModal mediaType="LOGO" onCancel={() => setIsMediaLibraryOpen(false)} onConfirm={(media: MediaAsset) => { form.setValue(`streams.${streamIndex}.logo`, media.url, { shouldDirty: true, shouldValidate: true }); setIsMediaLibraryOpen(false) }} />}
    </div>
  )
}

function MatchAutofill({ form, append, disabled }: { form: UseFormReturn<CreateMatchFormValues>; append: (value: NonNullable<CreateMatchFormValues['streams']>[number]) => void; disabled: boolean }) {
  const [input, setInput] = useState('')
  const [lastResult, setLastResult] = useState<ParsedMatchDetails | null>(null)
  const [reviewCount, setReviewCount] = useState(0)
  const [parseMatch, { isLoading }] = useParseMatchMutation()

  const getAiErrorMessage = (error: unknown) => {
    if (!error || typeof error !== 'object') return 'AI match detection failed. Please try again.'
    const apiError = error as { data?: { message?: unknown }; error?: { message?: unknown } }
    const message = apiError.data?.message ?? apiError.error?.message
    return typeof message === 'string' && message.trim()
      ? message
      : 'AI match detection failed. Please try again.'
  }

  const setUntouchedValue = <T extends keyof CreateMatchFormValues>(name: T, value: CreateMatchFormValues[T], allowDefault = false) => {
    if (form.getFieldState(name).isDirty) return false
    const current = form.getValues(name)
    if (!allowDefault && typeof current === 'string' && current.trim()) return false
    form.setValue(name as never, value as never, { shouldDirty: true, shouldValidate: true })
    return true
  }

  const applyResult = (result: ParsedMatchDetails) => {
    let applied = 0
    let skipped = 0
    let needsReview = 0
    let streamUrlPreserved = false
    const applySuggestion = <T extends keyof CreateMatchFormValues>(name: T, value: CreateMatchFormValues[T] | null, confidence: 'high' | 'medium' | 'low' | undefined, allowDefault = false) => {
      if (value === null || value === undefined || confidence === 'low') {
        if (value !== null && value !== undefined && confidence === 'low') needsReview += 1
        return
      }
      if (setUntouchedValue(name, value, allowDefault)) applied += 1
    }
    applySuggestion('title', result.title, result.confidence.title)
    applySuggestion('homeTeamName', result.homeTeamName, result.confidence.homeTeamName)
    applySuggestion('awayTeamName', result.awayTeamName, result.confidence.awayTeamName)
    applySuggestion('homeTeamLogo', result.homeTeamLogo, result.confidence.homeTeamLogo)
    applySuggestion('awayTeamLogo', result.awayTeamLogo, result.confidence.awayTeamLogo)
    applySuggestion('sport', result.sport, result.confidence.sport, true)
    applySuggestion('kickoffDate', result.kickoffDate, result.confidence.kickoffDate)
    applySuggestion('kickoffTime', result.kickoffTime, result.confidence.kickoffTime)
    applySuggestion('expectedDurationMinutes', result.expectedDurationMinutes, result.confidence.expectedDurationMinutes, true)
    applySuggestion('autoFinish', result.autoFinish, result.confidence.autoFinish, true)
    applySuggestion('preStartEnabled', result.preStartEnabled, result.confidence.preStartEnabled, true)
    applySuggestion('preStartWindowMinutes', result.preStartWindowMinutes, result.confidence.preStartWindowMinutes, true)

    const streams = form.getValues('streams') ?? []
    if (result.primaryStreamUrl || result.quality) {
      if (streams.length === 0) {
        append({
          name: 'Main stream',
          logo: '',
          sourceType: 'DIRECT_URL',
          channelId: '',
          primaryUrl: result.primaryStreamUrl ?? '',
          backupUrls: [],
          quality: result.quality || '1080p',
          status: 'READY',
          activationMode: 'AUTOMATIC',
          activationOffsetMinutes: 0,
        })
        applied += 1
      } else {
        const firstStream = streams[0]
        if (result.primaryStreamUrl) {
          if (firstStream.primaryUrl?.trim() || form.getFieldState('streams.0.primaryUrl').isDirty) {
            skipped += 1
            streamUrlPreserved = true
          }
          else {
            form.setValue('streams.0.primaryUrl', result.primaryStreamUrl, { shouldDirty: true, shouldValidate: true })
            applied += 1
          }
        }
        if (result.quality && !form.getFieldState('streams.0.quality').isDirty) {
          form.setValue('streams.0.quality', result.quality, { shouldDirty: true, shouldValidate: true })
          applied += 1
        }
      }
    }

    setReviewCount(needsReview)
    toast.success(`AI applied ${applied} trusted match field${applied === 1 ? '' : 's'}.`)
    if (needsReview > 0) toast.warning(`${needsReview} low-confidence suggestion${needsReview === 1 ? '' : 's'} needs manual review.`)
    if (skipped > 0) toast.info(`${skipped} existing field${skipped === 1 ? '' : 's'} stayed unchanged.`)
    if (streamUrlPreserved) toast.warning('AI found a different stream URL, but your existing URL was preserved.')
    if (result.warnings.length > 0) toast.info(result.warnings[0])
  }

  const handleParse = async () => {
    const trimmedInput = input.trim()
    if (!trimmedInput) {
      toast.error('Paste or describe the match before using AI autofill.')
      return
    }
    try {
      const result = await parseMatch({ input: trimmedInput }).unwrap()
      setLastResult(result)
      applyResult(result)
    } catch (error) {
      toast.error(getAiErrorMessage(error))
    }
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-accent/35 bg-linear-to-br from-accent/12 via-surface-soft/90 to-surface p-4 shadow-[0_18px_50px_rgba(2,6,23,0.16)] ring-1 ring-accent/10 sm:p-5">
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-accent/10 blur-3xl" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="relative min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/15 text-accent"><Sparkles className="h-4 w-4" /></span> AI Match Assistant</div>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-text-muted">Describe teams, competition, sport, date, and kickoff time in English, Bangla, Banglish, or mixed language. AI suggests fields for your review and never saves the match.</p>
        </div>
        <span className="relative self-start rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">Admin assistant</span>
      </div>
      <div className="relative mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
        <Input value={input} onChange={(event) => setInput(event.target.value)} maxLength={2000} aria-label="Describe match for AI autofill" placeholder="আজ Real Madrid vs Barcelona football রাত 11:30 La Liga" disabled={disabled || isLoading} className="min-h-11 min-w-0 bg-background/35 pr-4" />
        <Button type="button" onClick={() => void handleParse()} disabled={disabled || isLoading} className="min-h-11 shrink-0 gap-2 px-5 shadow-md shadow-accent/10 sm:min-w-40">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {isLoading ? 'Autofilling...' : 'Autofill with AI'}
        </Button>
      </div>
      {lastResult && !isLoading && (
        <div className="relative mt-3 flex flex-col gap-2 rounded-xl border border-border/70 bg-background/25 px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success-soft text-success">✓</span><div className="min-w-0"><p className="truncate text-text-secondary">Suggestion applied{lastResult.title ? ` for ${lastResult.title}` : ''}. Review before saving.</p><div className="mt-2 flex flex-wrap gap-1.5"><span className="rounded-full border border-border bg-surface-soft px-2 py-1 text-[10px] text-text-muted">{lastResult.homeTeamName || 'Team 1 unresolved'}</span><span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] text-accent">{lastResult.sport || 'Sport review'}</span><span className="rounded-full border border-border bg-surface-soft px-2 py-1 text-[10px] text-text-muted">{lastResult.awayTeamName || 'Team 2 unresolved'}</span></div></div></div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-text-muted"><span>{lastResult.timezone}</span>{lastResult.kickoffDate && lastResult.kickoffTime && <span>{lastResult.kickoffDate} {lastResult.kickoffTime}</span>}{lastResult.expectedDurationMinutes && <span>{lastResult.expectedDurationMinutes} min</span>}{reviewCount > 0 && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-warning">{reviewCount} manual review{reviewCount === 1 ? '' : 's'}</span>}{lastResult.warnings.length > 0 && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-warning">{lastResult.warnings.length} review note{lastResult.warnings.length === 1 ? '' : 's'}</span>}</div>
        </div>
      )}
    </section>
  )
}

export function CreateMatchForm({ form, onSubmit, isLoading, onStreamLogoUpload, uploadingStreamLogoIndex, showAiAutofill = false }: CreateMatchFormProps) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'streams',
  })
  const selectedSport = form.watch('sport')
  const expectedDuration = form.watch('expectedDurationMinutes')
  const preStartEnabled = form.watch('preStartEnabled') !== false
  const kickoffDate = form.watch('kickoffDate')
  const kickoffTime = form.watch('kickoffTime')
  const homeTeamLogo = form.watch('homeTeamLogo')
  const awayTeamLogo = form.watch('awayTeamLogo')
  const homeLogoPreview = useLogoPreview(homeTeamLogo)
  const awayLogoPreview = useLogoPreview(awayTeamLogo)
  const schedulePreview = kickoffDate && kickoffTime
    ? new Date(`${kickoffDate}T${kickoffTime}`).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : 'Add a date and time to preview the schedule.'

  useEffect(() => {
    if (!form.watch('autoFinish') || !kickoffDate || !kickoffTime) return
    const kickoffAt = parseMatchDateTime(kickoffDate, kickoffTime)
    const duration = Number(expectedDuration)
    if (!kickoffAt || !Number.isFinite(duration) || duration < 1) return
    const expectedEnd = new Date(new Date(kickoffAt).getTime() + duration * 60_000)
    const nextExpectedEnd = formatMatchDateTimeInput(expectedEnd.toISOString())
    if (nextExpectedEnd && form.getValues('expectedEndTime') !== nextExpectedEnd) {
      form.setValue('expectedEndTime', nextExpectedEnd, { shouldDirty: true, shouldValidate: true })
    }
  }, [expectedDuration, kickoffDate, kickoffTime, form])

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="w-full min-w-0 space-y-5 overflow-x-hidden pb-2 sm:space-y-6">
        {showAiAutofill && <MatchAutofill form={form} append={append} disabled={isLoading} />}
        <FormField control={form.control} name="title" render={({ field }) => (
          <FormItem className={flatFormItemClass}><FormLabel className="text-base font-semibold">Match title / competition</FormLabel><FormControl><Input placeholder="e.g., La Liga or UEFA Champions League" className={inputClass} {...field} /></FormControl><p className="text-xs text-text-muted">Use the competition name when known; otherwise enter a clear match title.</p><FormMessage /></FormItem>
        )} />

        <section className={sectionClass}>
          <div className="mb-4 flex flex-col gap-3 border-b border-border/60 pb-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-text-primary">Teams</h3>
              <p className="mt-1 text-xs text-text-muted">Set the two competing sides and optionally attach each logo.</p>
            </div>
            <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Team 1 vs Team 2</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TeamNameField form={form} nameField="homeTeamName" idField="homeTeamId" logoField="homeTeamLogo" label="Team 1 name" placeholder="e.g., Bangladesh" disabled={isLoading} />
            <TeamNameField form={form} nameField="awayTeamName" idField="awayTeamId" logoField="awayTeamLogo" label="Team 2 name" placeholder="e.g., India" disabled={isLoading} />
            <FormField control={form.control} name="homeTeamLogo" render={({ field }) => (
              <FormItem className={flatFormItemClass}>
                <FormLabel>Team 1 logo</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-3">
                    {homeLogoPreview ? <img src={homeLogoPreview} alt="Team 1 logo preview" className="h-11 w-11 rounded-xl border border-(--accent)/40 bg-surface-soft object-cover" /> : <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground"><ImagePlus className="h-4 w-4" /></div>}
                    <Input
                      type="file"
                      accept="image/*"
                      disabled={isLoading}
                      className="min-h-11 text-sm"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null
                        field.onChange(file)
                      }}
                    />
                    {field.value instanceof File ? <span className="text-xs text-accent">Selected · uploads on save</span> : typeof field.value === 'string' && field.value && <span className="text-xs text-success">Existing logo reused</span>}
                    {field.value && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => field.onChange(null)}>Clear</Button>
                    )}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="awayTeamLogo" render={({ field }) => (
              <FormItem className={flatFormItemClass}>
                <FormLabel>Team 2 logo</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-3">
                    {awayLogoPreview ? <img src={awayLogoPreview} alt="Team 2 logo preview" className="h-11 w-11 rounded-xl border border-(--accent)/40 bg-surface-soft object-cover" /> : <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground"><ImagePlus className="h-4 w-4" /></div>}
                    <Input
                      type="file"
                      accept="image/*"
                      disabled={isLoading}
                      className="min-h-11 text-sm"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null
                        field.onChange(file)
                      }}
                    />
                    {field.value instanceof File ? <span className="text-xs text-accent">Selected · uploads on save</span> : typeof field.value === 'string' && field.value && <span className="text-xs text-success">Existing logo reused</span>}
                    {field.value && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => field.onChange(null)}>Clear</Button>
                    )}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </section>

        <section className={sectionClass}>
          <div className="mb-4 flex flex-col gap-3 border-b border-border/60 pb-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-text-primary">Match setup</h3><p className="mt-1 text-xs text-text-muted">Set the sport and lifecycle estimate.</p></div><div className="flex items-center gap-2"><span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Required</span><span className="rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">{selectedSport} · {expectedDuration || 0} min</span></div></div>
          <div className="grid gap-4 sm:grid-cols-2">
          <FormField control={form.control} name="sport" render={({ field }) => (
            <FormItem className={flatFormItemClass}><FormLabel>Sport</FormLabel><Select onValueChange={field.onChange} value={field.value} disabled={isLoading}><FormControl><SelectTrigger className="min-h-11"><SelectValue placeholder="Select sport" /></SelectTrigger></FormControl><SelectContent>{['FOOTBALL', 'CRICKET', 'BASKETBALL', 'TENNIS', 'MOTORSPORTS', 'WWE'].map((sport) => <SelectItem key={sport} value={sport}>{sport.charAt(0) + sport.slice(1).toLowerCase()}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="expectedDurationMinutes" render={({ field }) => (
            <FormItem className={flatFormItemClass}><FormLabel>Expected duration</FormLabel><FormControl><Input type="number" min={1} max={1440} step={1} className="min-h-11" {...field} onChange={(event) => field.onChange(Number(event.target.value) || 1)} /></FormControl><p className="text-xs leading-5 text-text-muted">Planning hint only; it does not confirm the match has finished.</p><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="autoFinish" render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3 border-0 bg-transparent p-0 shadow-none hover:shadow-none sm:col-span-2 sm:p-0"><FormControl><Checkbox className="mt-1" checked={field.value} onCheckedChange={field.onChange} disabled={isLoading} /></FormControl><div><FormLabel>Allow automatic finish</FormLabel><p className="mt-1 text-xs leading-5 text-text-muted">Disable for extended or uncertain matches such as cricket and tennis.</p></div></FormItem>
          )} />
          </div>
        </section>

        <section className={sectionClass}>
          <div className="flex flex-col gap-3 border-b border-border/60 pb-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-text-primary">Pre-start broadcast</h3><p className="mt-1 text-xs leading-5 text-text-muted">The placeholder appears before kickoff and switches to the player as soon as a real stream is available.</p></div><span className={`self-start rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${preStartEnabled ? 'bg-success-soft text-success' : 'bg-surface text-text-muted'}`}>{preStartEnabled ? 'Enabled' : 'Disabled'}</span></div>
          <FormField control={form.control} name="preStartEnabled" render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3 border-0 bg-transparent p-0 shadow-none hover:shadow-none sm:p-0"><FormControl><Checkbox className="mt-1" checked={field.value !== false} onCheckedChange={(value) => field.onChange(Boolean(value))} disabled={isLoading} /></FormControl><div><FormLabel>Show “Match Starts Soon”</FormLabel><p className="mt-1 text-xs leading-5 text-text-muted">Turn this off to disable the placeholder for this match.</p></div></FormItem>
          )} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="preStartWindowMinutes" render={({ field }) => (
              <FormItem className={flatFormItemClass}><FormLabel>Placeholder lead time</FormLabel><FormControl><Input type="number" min={1} max={1440} step={1} value={field.value ?? ''} placeholder="Use global default" className="min-h-11" onChange={(event) => field.onChange(event.target.value ? Number(event.target.value) : null)} /></FormControl><p className="text-xs text-text-muted">Minutes before kickoff.</p><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="preStartVideoUrl" render={({ field }) => (
              <FormItem className={flatFormItemClass}><FormLabel>Background video URL</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="Use global default" className="min-h-11" /></FormControl><FormMessage /></FormItem>
            )} />
          </div>
        </section>

        <section className={sectionClass}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-text-primary">Kickoff schedule</h3>
              <p className="text-xs text-text-muted">Use your local time. The server stores the exact timestamp.</p>
            </div>
            <div className="flex flex-col items-start gap-1 sm:items-end"><span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Date and time</span><span className="text-xs text-text-muted">{schedulePreview}</span></div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="kickoffDate" render={({ field }) => (
              <FormItem><FormLabel>Date</FormLabel><FormControl><Input type="date" required {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="kickoffTime" render={({ field }) => (
              <FormItem><FormLabel>Time</FormLabel><FormControl><Input type="time" step={60} required {...field} /></FormControl><FormMessage /></FormItem>
            )} />
          </div>
          <FormField control={form.control} name="expectedEndTime" render={({ field }) => (
            <FormItem><FormLabel>Expected End (optional)</FormLabel><FormControl><Input type="datetime-local" {...field} /></FormControl><p className="text-xs text-text-muted">The match may continue beyond this time. Manual finish remains authoritative.</p><FormMessage /></FormItem>
          )} />
        </section>

        <section className="grid gap-4 rounded-3xl border border-(--border)/80 bg-linear-to-br from-(--surface-soft)/85 to-(--surface) p-4 shadow-[0_18px_45px_rgba(2,6,23,0.12)] sm:grid-cols-2 sm:p-5">
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem className={flatFormItemClass}>
              <FormLabel>Match Status</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a status" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="UPCOMING">Upcoming</SelectItem>
                  <SelectItem value="LIVE">Live</SelectItem>
                  <SelectItem value="FINISHED">Finished</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="premium"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between border-0 bg-transparent p-0 shadow-none hover:shadow-none sm:p-0">
              <div className="space-y-0.5 pr-4">
                <FormLabel>Premium Match?</FormLabel>
                <p className="text-sm text-text-muted">Only accessible to premium users.</p>
              </div>
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={isLoading} />
              </FormControl>
              </FormItem>
            )}
          />
        </section>

        <div>
          <div className="mb-3 flex flex-col gap-2 border-b border-border/70 pb-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-text-primary">Streams</h3><p className="mt-1 text-xs text-text-muted">Add direct URLs or connect an existing channel.</p></div><span className="text-xs text-text-muted">Optional</span></div>
          {fields.map((streamField, streamIndex) => (
            <StreamCard
              key={streamField.id}
              form={form}
              streamIndex={streamIndex}
              isLoading={isLoading}
              removeStream={remove}
              onLogoUpload={onStreamLogoUpload ? (file) => onStreamLogoUpload(streamIndex, file) : undefined}
              isUploadingLogo={uploadingStreamLogoIndex === streamIndex}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => append({
              name: 'Main stream',
              logo: '',
              sourceType: 'DIRECT_URL',
              channelId: '',
              primaryUrl: '',
              backupUrls: [],
              quality: '1080p',
              status: 'READY',
              activationMode: 'AUTOMATIC',
              activationOffsetMinutes: 0,
            })}
            disabled={isLoading}
            className="mt-3 min-h-10 border-(--accent)/35 text-(--accent) hover:border-(--accent) hover:bg-(--accent)/10"
          >
            <PlusCircle size={16} className="mr-2" /> Add Stream
          </Button>
        </div>
        <div className="border-t border-border/70 pt-5">
        <Button type="submit" isLoading={isLoading} className="min-h-12 w-full rounded-2xl bg-accent text-slate-950 shadow-[0_12px_30px_rgba(247,199,93,0.18)] hover:bg-accent-strong" disabled={isLoading}>
          <span>{isLoading ? 'Saving...' : 'Save Match'}</span>
        </Button>
        <p className="mt-2 text-center text-xs text-text-muted">Review the schedule, access, and stream details before saving.</p>
        </div>
      </form>
    </Form>
  )
}