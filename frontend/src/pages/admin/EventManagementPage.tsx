import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Edit, Eye, GripVertical, ImagePlus, LayoutList, Minus, Plus, Search, Trash2, UploadCloud, X } from 'lucide-react'
import { motion } from 'framer-motion'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import { useGetAdminChannelsQuery } from '../../features/admin/channels.api'
import { useGetMatchesQuery } from '../../features/matches/matches.api'
import { useCreateEventMutation, useDeleteEventMutation, useDeleteMediaMutation, useGetAdminEventsQuery, useGetMediaLibraryQuery, useLazyGetMediaUsageQuery, useReorderEventsMutation, useUpdateEventMutation, type EventDetail, type EventInput, type MediaAsset } from '../../features/events/events.api'
import { useUploadFilesMutation } from '../../features/admin/uploads.api'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Textarea } from '../../components/ui/Textarea'
import { Label } from '../../components/ui/Label'
import { Checkbox } from '../../components/ui/Checkbox'
import { DescriptionGenerator } from '../../components/ai/DescriptionGenerator'

const emptyForm: EventInput = { name: '', slug: '', description: '', logo: '', banner: '', status: 'ACTIVE', showInSidebar: false, sortOrder: 0, isPremium: false, channelIds: [], matchIds: [] }

const getCroppedBanner = async (imageSrc: string, cropArea: Area, fileName: string, fileType: string): Promise<File> => {
  const image = new Image()
  image.src = imageSrc
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Unable to load the selected image.'))
  })

  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 500
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to prepare the cropped image.')
  context.drawImage(image, cropArea.x, cropArea.y, cropArea.width, cropArea.height, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, fileType === 'image/png' ? 'image/png' : 'image/jpeg', 0.9))
  if (!blob) throw new Error('Unable to generate the cropped image.')
  const extension = fileType === 'image/png' ? 'png' : 'jpg'
  return new File([blob], `${fileName.replace(/\.[^.]+$/, '')}-banner.${extension}`, { type: blob.type })
}

const getEventMatchId = (entry: EventDetail['eventMatches'][number]): string => {
  if ('matchId' in entry) return String(entry.matchId)
  if ('match' in entry && entry.match && typeof entry.match === 'object' && 'id' in entry.match) return String(entry.match.id)
  return 'id' in entry ? entry.id : ''
}

export default function EventManagementPage() {
  const { data: eventData, isLoading } = useGetAdminEventsQuery()
  const { data: mediaLibrary, isLoading: isMediaLoading, isError: isMediaError } = useGetMediaLibraryQuery()
  const { data: channelData } = useGetAdminChannelsQuery()
  const events = useMemo(() => eventData ?? [], [eventData])
  const channels = useMemo(() => channelData ?? [], [channelData])
  const { data: matchData } = useGetMatchesQuery({ page: 1, limit: 100, sort: 'date-asc' })
  const matches = useMemo(() => matchData?.items ?? [], [matchData])
  const [createEvent, { isLoading: isCreating }] = useCreateEventMutation()
  const [updateEvent, { isLoading: isUpdating }] = useUpdateEventMutation()
  const [deleteEvent] = useDeleteEventMutation()
  const [reorderEvents, { isLoading: isReordering }] = useReorderEventsMutation()
  const [deleteMedia, { isLoading: isDeletingMedia }] = useDeleteMediaMutation()
  const [checkMediaUsage] = useLazyGetMediaUsageQuery()
  const [uploadFiles, { isLoading: isUploading }] = useUploadFilesMutation()
  const [form, setForm] = useState<EventInput>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [bannerPreview, setBannerPreview] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [bannerFile, setBannerFile] = useState<File | null>(null)
  const [channelSearch, setChannelSearch] = useState('')
  const [matchSearch, setMatchSearch] = useState('')
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [isCropping, setIsCropping] = useState(false)
  const [mediaType, setMediaType] = useState<'BANNER' | 'LOGO' | null>(null)
  const [mediaFilter, setMediaFilter] = useState<'ALL' | 'BANNER' | 'LOGO'>('ALL')
  const [mediaSearch, setMediaSearch] = useState('')
  const [pendingMedia, setPendingMedia] = useState<MediaAsset | null>(null)
  const [localEventOrder, setLocalEventOrder] = useState<EventDetail[]>([])
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null)
  const temporaryUrls = useRef(new Set<string>())

  const orderedEvents = useMemo(() => {
    if (localEventOrder.length > 0) {
      const localIds = new Set(localEventOrder.map((event) => event.id))
      if (events.length > 0 && events.every((event) => localIds.has(event.id))) {
        const byId = new Map(events.map((event) => [event.id, event]))
        return localEventOrder.map((event) => byId.get(event.id) ?? event)
      }
    }

    return [...events].sort((a, b) => a.sortOrder - b.sortOrder)
  }, [events, localEventOrder])

  const createPreviewUrl = (file: File) => {
    const url = URL.createObjectURL(file)
    temporaryUrls.current.add(url)
    return url
  }

  const revokePreviewUrl = (url: string | null) => {
    if (!url) return
    URL.revokeObjectURL(url)
    temporaryUrls.current.delete(url)
  }

  const selectedChannelIds = useMemo(() => new Set(form.channelIds), [form.channelIds])
  const filteredChannels = useMemo(() => {
    const query = channelSearch.trim().toLowerCase()
    return query ? channels.filter((channel) => channel.name.toLowerCase().includes(query)) : channels
  }, [channelSearch, channels])
  const filteredMatches = useMemo(() => {
    const query = matchSearch.trim().toLowerCase()
    return query ? matches.filter((match) => match.title.toLowerCase().includes(query)) : matches
  }, [matchSearch, matches])
  const activeEvents = events.filter((event) => event.status === 'ACTIVE').length
  const sidebarEvents = events.filter((event) => event.showInSidebar && event.status === 'ACTIVE').length
  const assignedChannels = new Set(events.flatMap((event) => event.eventChannels.map((entry) => 'channel' in entry ? entry.channel.id : 'channelId' in entry ? entry.channelId : entry.id))).size
  const setField = <K extends keyof EventInput>(key: K, value: EventInput[K]) => setForm((previous) => ({ ...previous, [key]: value }))
  const filteredMedia = useMemo(() => {
    const query = mediaSearch.trim().toLowerCase()
    return (mediaLibrary ?? []).filter((media) => (mediaFilter === 'ALL' || media.type === mediaFilter) && (!query || `${media.fileName ?? ''} ${media.publicId}`.toLowerCase().includes(query)))
  }, [mediaFilter, mediaLibrary, mediaSearch])

  const resetForm = () => {
    revokePreviewUrl(cropImageSrc)
    setForm(emptyForm)
    setEditingId(null)
    setLogoPreview(null)
    setBannerPreview(null)
    setLogoFile(null)
    setBannerFile(null)
    setChannelSearch('')
    setMatchSearch('')
    setCropImageSrc(null)
    setCropFile(null)
    setCroppedAreaPixels(null)
    setZoom(1)
    setMediaType(null)
    setPendingMedia(null)
  }

  const beginEdit = (event: EventDetail) => {
    setEditingId(event.id)
    setForm({ name: event.name, slug: event.slug, description: event.description ?? '', logo: event.logo ?? '', banner: event.banner ?? '', status: event.status, showInSidebar: event.showInSidebar, sortOrder: event.sortOrder, isPremium: event.isPremium, channelIds: event.eventChannels.map((entry) => 'channel' in entry ? entry.channel.id : 'channelId' in entry ? entry.channelId : entry.id), matchIds: event.eventMatches.map(getEventMatchId) })
    setLogoPreview(event.logo ?? null)
    setBannerPreview(event.banner ?? null)
    setLogoFile(null)
    setBannerFile(null)
    setChannelSearch('')
    setMatchSearch('')
    setPendingMedia(null)
  }

  const toggleEventState = async (event: EventDetail, field: 'status' | 'showInSidebar') => {
    const nextForm: EventInput = {
      name: event.name,
      slug: event.slug,
      description: event.description ?? '',
      logo: event.logo ?? '',
      banner: event.banner ?? '',
      status: field === 'status' ? event.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' : event.status,
      showInSidebar: field === 'showInSidebar' ? !event.showInSidebar : event.showInSidebar,
      sortOrder: event.sortOrder,
      isPremium: event.isPremium,
      channelIds: event.eventChannels.map((entry) => 'channel' in entry ? entry.channel.id : 'channelId' in entry ? entry.channelId : entry.id),
      matchIds: event.eventMatches.map(getEventMatchId),
    }
    try {
      await updateEvent({ id: event.id, data: nextForm }).unwrap()
      toast.success(field === 'status' ? `Event ${nextForm.status === 'ACTIVE' ? 'enabled' : 'disabled'}.` : `Sidebar visibility turned ${nextForm.showInSidebar ? 'on' : 'off'}.`)
    } catch { toast.error('Unable to update event settings.') }
  }

  const selectImage = (file: File, kind: 'logo' | 'banner') => {
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file.'); return }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be smaller than 5 MB.'); return }
    if (kind === 'banner') {
      revokePreviewUrl(cropImageSrc)
      setCropFile(file)
      setCropImageSrc(createPreviewUrl(file))
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setCroppedAreaPixels(null)
      return
    }
    if (logoPreview?.startsWith('blob:')) revokePreviewUrl(logoPreview)
    const preview = createPreviewUrl(file)
    setLogoFile(file)
    setLogoPreview(preview)
  }

  const cancelCrop = () => {
    revokePreviewUrl(cropImageSrc)
    setCropImageSrc(null)
    setCropFile(null)
    setCroppedAreaPixels(null)
    setZoom(1)
  }

  const confirmCrop = async () => {
    if (!cropImageSrc || !croppedAreaPixels || !cropFile) return
    setIsCropping(true)
    try {
      const croppedFile = await getCroppedBanner(cropImageSrc, croppedAreaPixels, cropFile.name, cropFile.type)
      const preview = createPreviewUrl(croppedFile)
      if (bannerPreview?.startsWith('blob:')) revokePreviewUrl(bannerPreview)
      setBannerFile(croppedFile)
      setBannerPreview(preview)
      cancelCrop()
    } catch {
      toast.error('Unable to crop this image. Please try another file.')
    } finally {
      setIsCropping(false)
    }
  }

  const openMediaLibrary = (type: 'BANNER' | 'LOGO') => {
    setMediaType(type)
    setMediaFilter(type)
    setMediaSearch('')
    setPendingMedia(null)
  }

  const confirmMediaSelection = () => {
    if (!mediaType || !pendingMedia) return
    if (mediaType === 'BANNER') {
      setBannerFile(null)
      setBannerPreview(pendingMedia.url)
      setField('banner', pendingMedia.url)
    } else {
      setLogoFile(null)
      setLogoPreview(pendingMedia.url)
      setField('logo', pendingMedia.url)
    }
    setMediaType(null)
    setPendingMedia(null)
  }

  const removeMediaReference = (type: 'BANNER' | 'LOGO') => {
    if (type === 'BANNER') {
      if (bannerPreview?.startsWith('blob:')) revokePreviewUrl(bannerPreview)
      setBannerFile(null)
      setBannerPreview(null)
      setField('banner', '')
    } else {
      if (logoPreview?.startsWith('blob:')) revokePreviewUrl(logoPreview)
      setLogoFile(null)
      setLogoPreview(null)
      setField('logo', '')
    }
  }

  useEffect(() => () => {
    temporaryUrls.current.forEach((url) => URL.revokeObjectURL(url))
    temporaryUrls.current.clear()
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const [logoUpload, bannerUpload] = await Promise.all([
        logoFile ? uploadFiles({ files: [logoFile], folder: 'sportzone/events', mediaType: 'LOGO' }).unwrap() : null,
        bannerFile ? uploadFiles({ files: [bannerFile], folder: 'sportzone/events', mediaType: 'BANNER' }).unwrap() : null,
      ])
      const nextForm = {
        ...form,
        logo: logoFile ? logoUpload?.uploads[0]?.url ?? form.logo : form.logo,
        banner: bannerFile ? bannerUpload?.uploads[0]?.url ?? form.banner : form.banner,
      }
      if (editingId) await updateEvent({ id: editingId, data: nextForm }).unwrap()
      else await createEvent({ ...nextForm, sortOrder: orderedEvents.length }).unwrap()
      toast.success(editingId ? 'Event updated successfully.' : 'Event created successfully.')
      resetForm()
    } catch { toast.error('Unable to save event.') }
  }

  const remove = async (id: string) => {
    if (!window.confirm('Delete this event? Assigned channels will remain available.')) return
    try { await deleteEvent(id).unwrap(); toast.success('Event deleted.') } catch { toast.error('Unable to delete event.') }
  }

  const moveEvent = async (targetEventId: string) => {
    if (!draggedEventId || draggedEventId === targetEventId || isReordering) return
    const previousOrder = orderedEvents
    const nextOrder = [...orderedEvents]
    const draggedIndex = nextOrder.findIndex((event) => event.id === draggedEventId)
    const targetIndex = nextOrder.findIndex((event) => event.id === targetEventId)
    if (draggedIndex < 0 || targetIndex < 0) return
    const [draggedEvent] = nextOrder.splice(draggedIndex, 1)
    nextOrder.splice(targetIndex, 0, draggedEvent)
    setLocalEventOrder(nextOrder.map((event, index) => ({ ...event, sortOrder: index })))
    setDraggedEventId(null)
    try {
      await reorderEvents(nextOrder.map((event, index) => ({ id: event.id, sortOrder: index }))).unwrap()
      toast.success('Event order updated.')
    } catch {
      setLocalEventOrder(previousOrder)
      toast.error('Unable to update event order.')
    }
  }

  const deleteLibraryMedia = async (media: MediaAsset) => {
    if (!window.confirm(`Delete ${media.fileName ?? 'this media'}?`)) return
    try {
      const usage = await checkMediaUsage(media.id).unwrap()
      if (usage.count > 0) {
        toast.warning(`This media is used by ${usage.count} event${usage.count === 1 ? '' : 's'}. Remove it from those events first.`)
        return
      }
      await deleteMedia(media.id).unwrap()
      toast.success('Media deleted.')
    } catch {
      toast.error('Media could not be deleted safely.')
    }
  }

  return (
    <motion.div className="w-full min-w-0 space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.header initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="flex items-center gap-3 text-3xl font-semibold text-text-primary"><span className="grid h-11 w-11 place-items-center rounded-xl bg-linear-to-br from-cyan-500 to-blue-600 text-white"><LayoutList className="h-5 w-5" /></span>Events</h1>
        <p className="mt-2 text-sm text-text-muted">Create dynamic sports pages, assign channels, and control sidebar visibility.</p>
      </motion.header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total events', value: events.length, tone: 'from-cyan-500 to-blue-600' },
          { label: 'Active', value: activeEvents, tone: 'from-emerald-500 to-teal-600' },
          { label: 'Visible in sidebar', value: sidebarEvents, tone: 'from-amber-400 to-orange-600' },
          { label: 'Assigned channels', value: assignedChannels, tone: 'from-violet-500 to-purple-600' },
        ].map((metric, index) => (
          <motion.div key={metric.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} whileHover={{ y: -3 }}>
            <Card className="border-border/60 bg-surface-soft/70 p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">{metric.label}</p><div className="mt-3 flex items-center justify-between"><span className="text-3xl font-semibold text-text-primary">{metric.value}</span><span className={`h-3 w-3 rounded-full bg-linear-to-br ${metric.tone}`} /></div></Card>
          </motion.div>
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="overflow-hidden border-border/70 bg-linear-to-br from-surface-soft/80 to-surface shadow-[0_24px_70px_var(--shadow)]">
          <CardHeader className="border-b border-border/50 bg-linear-to-r from-cyan-400/10 to-transparent"><CardTitle className="flex items-center gap-2">{editingId ? <Edit className="h-5 w-5 text-accent" /> : <Plus className="h-5 w-5 text-accent" />}{editingId ? 'Edit Event' : 'Create Event'}</CardTitle></CardHeader>
          <CardContent className="p-5 sm:p-7">
            <form onSubmit={submit} className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="event-name">Event name</Label><Input id="event-name" value={form.name} onChange={(e) => setField('name', e.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="event-slug">URL slug</Label><Input id="event-slug" value={form.slug} onChange={(e) => setField('slug', e.target.value)} placeholder="premier-league" required /></div>
              <div className="space-y-2 md:col-span-2"><div className="flex items-center justify-between gap-3"><Label htmlFor="event-description">Description</Label><DescriptionGenerator entityType="EVENT" title={form.name} currentDescription={form.description ?? ''} context={{ status: form.status, isPremium: form.isPremium, showInSidebar: form.showInSidebar }} onGenerated={(description) => setField('description', description)} /></div><Textarea id="event-description" value={form.description ?? ''} onChange={(e) => setField('description', e.target.value)} rows={3} /></div>

              <MediaPicker label="Event logo" icon={<UploadCloud className="h-5 w-5 text-accent" />} preview={logoPreview} previewClassName="h-20 w-20 object-contain" isUploading={isUploading} onSelect={(file) => selectImage(file, 'logo')} onLibrary={() => openMediaLibrary('LOGO')} onRemove={() => removeMediaReference('LOGO')} />
              <MediaPicker label="Event banner · 16:5 · 1600 × 500" icon={<ImagePlus className="h-5 w-5 text-accent" />} preview={bannerPreview} previewClassName="aspect-[16/5] w-full object-contain object-center" isUploading={isUploading} onSelect={(file) => selectImage(file, 'banner')} onDrop={(file) => selectImage(file, 'banner')} onLibrary={() => openMediaLibrary('BANNER')} onRemove={() => removeMediaReference('BANNER')} />
              <EventHeroPreview name={form.name} description={form.description ?? ''} logo={logoPreview} banner={bannerPreview} isPremium={form.isPremium} />

              <div className="space-y-2"><Label htmlFor="event-status">Status</Label><select id="event-status" value={form.status} onChange={(e) => setField('status', e.target.value as EventInput['status'])} className="flex h-10 w-full rounded-xl border border-border bg-surface-soft px-3 text-sm text-text-primary"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
              <div className="flex flex-wrap items-end gap-5"><label className="flex items-center gap-2 text-sm"><Checkbox checked={form.showInSidebar} onCheckedChange={(value) => setField('showInSidebar', value === true)} />Show in sidebar</label><label className="flex items-center gap-2 text-sm"><Checkbox checked={form.isPremium} onCheckedChange={(value) => setField('isPremium', value === true)} />Premium access</label></div>

              <div className="md:col-span-2"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><Label>Assigned channels</Label><div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" /><Input value={channelSearch} onChange={(e) => setChannelSearch(e.target.value)} placeholder="Search channels" className="pl-9" /></div></div><div className="mt-2 grid max-h-64 gap-2 overflow-y-auto rounded-2xl border border-border bg-background/20 p-3 sm:grid-cols-2 lg:grid-cols-3">{filteredChannels.length === 0 ? <p className="p-2 text-sm text-text-muted">No matching channels.</p> : filteredChannels.map((channel) => <label key={channel.id} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-sm text-text-muted transition hover:bg-surface-soft hover:text-text-primary"><Checkbox checked={selectedChannelIds.has(channel.id)} onCheckedChange={(value) => setField('channelIds', value === true ? [...form.channelIds, channel.id] : form.channelIds.filter((id) => id !== channel.id))} /><span className="truncate">{channel.name}</span></label>)}</div><p className="mt-2 text-xs text-text-muted">{form.channelIds.length} channel{form.channelIds.length === 1 ? '' : 's'} assigned</p></div>

              <div className="md:col-span-2"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><Label>Assigned matches</Label><div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" /><Input value={matchSearch} onChange={(e) => setMatchSearch(e.target.value)} placeholder="Search matches" className="pl-9" /></div></div><div className="mt-2 grid max-h-64 gap-2 overflow-y-auto rounded-2xl border border-border bg-background/20 p-3 sm:grid-cols-2">{filteredMatches.length === 0 ? <p className="p-2 text-sm text-text-muted">No matching matches.</p> : filteredMatches.map((match) => <label key={match.id} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-sm text-text-muted transition hover:bg-surface-soft hover:text-text-primary"><Checkbox checked={form.matchIds.includes(match.id)} onCheckedChange={(value) => setField('matchIds', value === true ? [...form.matchIds, match.id] : form.matchIds.filter((id) => id !== match.id))} /><span className="truncate">{match.title}</span></label>)}</div><p className="mt-2 text-xs text-text-muted">{form.matchIds.length} match{form.matchIds.length === 1 ? '' : 'es'} assigned</p></div>

              <div className="flex flex-wrap gap-2 md:col-span-2"><Button type="submit" disabled={isCreating || isUpdating || isUploading}><Plus className="mr-2 h-4 w-4" />{isCreating || isUpdating || isUploading ? 'Saving...' : editingId ? 'Save Changes' : 'Create Event'}</Button>{editingId && <Button type="button" variant="outline" onClick={resetForm}><X className="mr-2 h-4 w-4" />Cancel</Button>}</div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}><Card><CardHeader><CardTitle>Existing Events</CardTitle><p className="text-sm text-text-muted">Drag an event to change its sidebar order.</p></CardHeader><CardContent className="space-y-3">{isLoading ? <p className="text-sm text-text-muted">Loading events...</p> : orderedEvents.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-text-muted">No events created yet.</p> : orderedEvents.map((event) => <motion.div key={event.id} draggable={!isReordering} onDragStart={() => setDraggedEventId(event.id)} onDragEnd={() => setDraggedEventId(null)} onDragOver={(dragEvent) => dragEvent.preventDefault()} onDrop={() => void moveEvent(event.id)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -2 }} className={`flex cursor-grab flex-col gap-4 rounded-2xl border bg-surface-soft/60 p-4 transition-colors sm:flex-row sm:items-center sm:justify-between ${draggedEventId === event.id ? 'border-accent opacity-50' : 'border-border hover:border-accent/40'}`}><div className="flex min-w-0 items-center gap-3"><GripVertical className="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" /><div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface-soft">{event.logo ? <img src={buildCloudinaryUrl(event.logo, { width: 72, height: 72, crop: 'fill' })} alt="" className="h-full w-full object-contain p-1" /> : <LayoutList className="h-5 w-5 text-accent" />}</div><div className="min-w-0"><p className="truncate font-semibold text-text-primary">{event.name}</p><p className="truncate text-xs text-text-muted">/{event.slug} · position {event.sortOrder + 1} · {event.eventChannels.length} channels</p><div className="mt-2 flex flex-wrap gap-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${event.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'}`}>{event.status}</span><span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">Sidebar {event.showInSidebar ? 'ON' : 'OFF'}</span></div></div></div><div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => void toggleEventState(event, 'showInSidebar')}>{event.showInSidebar ? 'Hide sidebar' : 'Show sidebar'}</Button><Button variant="ghost" size="sm" onClick={() => void toggleEventState(event, 'status')}>{event.status === 'ACTIVE' ? 'Disable' : 'Enable'}</Button><Button variant="outline" size="sm" onClick={() => beginEdit(event)}><Edit className="mr-1 h-4 w-4" />Edit</Button><Button variant="outline" size="sm" onClick={() => window.open(`/events/${event.slug}`, '_blank')} aria-label={`Preview ${event.name}`}><Eye className="h-4 w-4" /></Button><Button variant="destructive" size="sm" onClick={() => void remove(event.id)}><Trash2 className="h-4 w-4" /></Button></div></motion.div>)}</CardContent></Card></motion.div>
      {cropImageSrc && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="banner-crop-title">
        <div className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl sm:max-h-[calc(100vh-3rem)]">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6"><div><h2 id="banner-crop-title" className="font-semibold text-text-primary">Crop event banner</h2><p className="text-xs text-text-muted">Adjust the focal area for the 16:5 banner. Final size: 1600 × 500px.</p></div><Button type="button" variant="ghost" size="sm" onClick={cancelCrop} aria-label="Close cropper"><X className="h-4 w-4" /></Button></div>
          <div className="relative mx-3 mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl bg-black sm:mx-6 sm:mt-5"><div className="relative h-[min(52vh,420px)] w-full"><Cropper image={cropImageSrc} crop={crop} zoom={zoom} aspect={16 / 5} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)} objectFit="contain" /></div></div>
          <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-6"><Minus className="h-4 w-4 text-text-muted" /><input aria-label="Banner zoom" type="range" min={1} max={3} step={0.1} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="min-w-40 flex-1 accent-(--accent)" /><Plus className="h-4 w-4 text-text-muted" /><div className="ml-auto flex gap-2"><Button type="button" variant="outline" onClick={cancelCrop} disabled={isCropping}>Cancel</Button><Button type="button" onClick={() => void confirmCrop()} disabled={isCropping || !croppedAreaPixels}>{isCropping ? 'Processing...' : 'Confirm Crop'}</Button></div></div>
            </div>
          </div>}
          {mediaType && <MediaLibraryModal mediaType={mediaType} filter={mediaFilter} search={mediaSearch} media={filteredMedia} selected={pendingMedia} isLoading={isMediaLoading} isError={isMediaError} isDeleting={isDeletingMedia} onFilterChange={setMediaFilter} onSearchChange={setMediaSearch} onSelect={setPendingMedia} onDelete={deleteLibraryMedia} onCancel={() => { setMediaType(null); setPendingMedia(null) }} onConfirm={confirmMediaSelection} />}
          </motion.div>
  )
}

function EventHeroPreview({ name, description, logo, banner, isPremium }: { name: string; description: string; logo: string | null; banner: string | null; isPremium: boolean }) {
  return <div className="md:col-span-2"><Label>Live Event Hero Preview</Label><div className="relative mt-2 aspect-16/5 min-h-40 w-full overflow-hidden rounded-xl border border-white/10 bg-linear-to-br from-surface-soft via-surface to-accent/10"><img src={banner ? (banner.startsWith('blob:') ? banner : buildCloudinaryUrl(banner, { width: 1600, height: 500, crop: 'fill', gravity: 'center' })) : '/placeholder-image.svg'} alt="" className="absolute inset-0 h-full w-full object-contain object-center" /><div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/40 to-transparent" aria-hidden="true" /><div className="absolute bottom-3 left-3 right-3 flex min-w-0 items-center gap-3 text-white md:bottom-5 md:left-5 md:right-5 md:gap-4"><div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/45 drop-shadow-[0_3px_10px_rgba(0,0,0,0.65)] md:h-16 md:w-16">{logo ? <img src={logo.startsWith('blob:') ? logo : buildCloudinaryUrl(logo, { width: 128, height: 128, crop: 'fit' })} alt="" className="h-full w-full object-contain p-1" /> : <LayoutList className="h-6 w-6" />}</div><div className="min-w-0 flex-1 drop-shadow-[0_3px_10px_rgba(0,0,0,0.8)]"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white md:text-xs">Sports event {isPremium && <span className="text-yellow-300">· Premium</span>}</p><p className="truncate text-lg font-bold md:text-2xl">{name || 'Event title'}</p>{description && <p className="line-clamp-1 text-xs text-gray-200 md:text-sm">{description}</p>}</div></div></div></div>
}

function MediaPicker({ label, icon, preview, previewClassName, isUploading, onSelect, onDrop, onLibrary, onRemove }: { label: string; icon: React.ReactNode; preview: string | null; previewClassName: string; isUploading: boolean; onSelect: (file: File) => void; onDrop?: (file: File) => void; onLibrary: () => void; onRemove: () => void }) {
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file && onDrop) onDrop(file)
  }

  return <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-2xl backdrop-blur-xl" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}><Label>{label}</Label><div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={onLibrary}><LayoutList className="mr-1 h-4 w-4" />Select from Library</Button><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-accent/40 bg-surface-soft/60 px-3 py-2 text-sm text-text-muted transition hover:border-accent hover:text-text-primary">{icon}{isUploading ? 'Uploading...' : 'Upload New Image'}<input type="file" accept="image/*" className="sr-only" disabled={isUploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) onSelect(file); e.target.value = '' }} /></label>{preview && <Button type="button" variant="ghost" size="sm" onClick={onRemove}><Trash2 className="mr-1 h-4 w-4" />Remove</Button>}</div>{preview && <img src={preview.startsWith('blob:') ? preview : buildCloudinaryUrl(preview)} alt={`${label} preview`} className={`mt-3 rounded-xl border border-border bg-surface-soft p-1 ${previewClassName}`} />}<p className="mt-2 text-xs text-text-muted">Choose an existing asset or upload a new one.</p></div>
}

function MediaLibraryModal({ mediaType, filter, search, media, selected, isLoading, isError, isDeleting, onFilterChange, onSearchChange, onSelect, onDelete, onCancel, onConfirm }: { mediaType: 'BANNER' | 'LOGO'; filter: 'ALL' | 'BANNER' | 'LOGO'; search: string; media: MediaAsset[]; selected: MediaAsset | null; isLoading: boolean; isError: boolean; isDeleting: boolean; onFilterChange: (filter: 'ALL' | 'BANNER' | 'LOGO') => void; onSearchChange: (value: string) => void; onSelect: (media: MediaAsset) => void; onDelete: (media: MediaAsset) => Promise<void>; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="media-library-title"><div className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900/95 shadow-2xl sm:max-h-[calc(100vh-3rem)]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4 sm:p-6"><div><h2 id="media-library-title" className="text-xl font-semibold text-text-primary">Media Library</h2><p className="text-xs text-text-muted">Select a {mediaType.toLowerCase()} for this event.</p></div><Button type="button" variant="ghost" size="sm" onClick={onCancel} aria-label="Close media library"><X className="h-4 w-4" /></Button></div><div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:p-6"><div className="flex gap-2"><Button type="button" size="sm" variant={filter === 'ALL' ? 'default' : 'outline'} onClick={() => onFilterChange('ALL')}>All</Button><Button type="button" size="sm" variant={filter === 'BANNER' ? 'default' : 'outline'} onClick={() => onFilterChange('BANNER')}>Banners</Button><Button type="button" size="sm" variant={filter === 'LOGO' ? 'default' : 'outline'} onClick={() => onFilterChange('LOGO')}>Logos</Button></div><Input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search filename or public ID" className="sm:ml-auto sm:max-w-xs" /></div><div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{isLoading ? <p className="py-12 text-center text-sm text-text-muted">Loading media library...</p> : isError ? <p className="py-12 text-center text-sm text-red-300">Unable to load the media library.</p> : media.length === 0 ? <p className="py-12 text-center text-sm text-text-muted">No matching media found.</p> : <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{media.map((item) => <div key={item.id} className={`group relative overflow-hidden rounded-2xl border bg-surface-soft/60 p-2 transition ${selected?.id === item.id ? 'border-accent ring-2 ring-accent/40' : 'border-white/10 hover:border-accent/50'}`}><button type="button" className="block w-full text-left" onClick={() => onSelect(item)} aria-label={`Select ${item.fileName ?? item.type.toLowerCase()}`}><img src={buildCloudinaryUrl(item.url, { width: 500, height: item.type === 'BANNER' ? 125 : 500, crop: 'fill' })} alt={item.fileName ?? item.type} className={`w-full rounded-xl object-cover ${item.type === 'BANNER' ? 'aspect-4/1' : 'aspect-square'}`} />{selected?.id === item.id && <span className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-full bg-accent text-white"><span aria-hidden="true">&#10003;</span></span>}<p className="mt-2 truncate text-xs font-medium text-text-primary">{item.fileName ?? item.type}</p><p className="text-[10px] uppercase tracking-wider text-text-muted">{item.type}</p></button><Button type="button" variant="ghost" size="sm" className="absolute bottom-1 right-1" onClick={() => void onDelete(item)} disabled={isDeleting} aria-label={`Delete ${item.fileName ?? 'media'}`}><Trash2 className="h-3.5 w-3.5 text-red-300" /></Button></div>)}</div>}</div><div className="flex justify-end gap-2 border-t border-white/10 p-4 sm:p-6"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="button" onClick={onConfirm} disabled={!selected}>Confirm Selection</Button></div></div></div>
}
