/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  GripVertical,
  ImagePlus,
  Images,
  Loader2,
  Plus,
  Search,
  Trash2,
  UploadCloud,
  Video,
  X,
} from 'lucide-react'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Textarea } from '@/components/ui/Textarea'
import { Checkbox } from '@/components/ui/Checkbox'
import { Badge } from '@/components/ui/Badge'
import { DescriptionGenerator } from '@/components/ai/DescriptionGenerator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/AlertDialog'
import { useMediaUploadProgress } from '@/hooks/useMediaUploadProgress'
import { UploadProgress } from '@/components/ui/UploadProgress'
import { useCreateBannerMutation, useDeleteBannerMutation, useGetAdminBannersQuery, useReorderBannersMutation, useUpdateBannerMutation, type Banner } from '@/features/admin/banners.api'
import {
  BANNER_FIELD_LIMITS,
  bannerDisplayName,
  bannerFormFromRecord,
  bannerStatusLabel,
  buildBannerPayload,
  emptyBannerForm,
  filterBanners,
  hasBannerFormErrors,
  moveBannerBy,
  nextDisplayOrder,
  validateBannerForm,
  type BannerFormErrors,
  type BannerFormState,
  type BannerStatusFilter,
} from '@/features/admin/bannerPresentation'
import { buildBannerPreviewArtwork } from '@/features/home/bannerRenditions'
import { buildCloudinaryUrl } from '@/utils/cloudinary'
import { isSupportedImageMimeType } from '@/utils/prepareUploadImage'
import { cn } from '@/lib/utils'

const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const MAX_VIDEO_SIZE = 100 * 1024 * 1024

type MediaInfo = { file: File; previewUrl: string; width: number; height: number }

const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

const cropBannerImage = async (source: string, area: Area, fileName: string) => {
  const image = new Image()
  image.src = source
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Unable to prepare the banner image.')) })
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 500
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to prepare the banner image.')
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) throw new Error('Unable to create the resized banner image.')
  return new File([blob], `${fileName.replace(/\.[^.]+$/, '')}-banner.jpg`, { type: 'image/jpeg' })
}

function readMediaInfo(file: File): Promise<MediaInfo> {
  const previewUrl = URL.createObjectURL(file)
  const isVideo = file.type.startsWith('video/')
  return new Promise((resolve, reject) => {
    const element = isVideo ? document.createElement('video') : new Image()
    const fail = () => {
      URL.revokeObjectURL(previewUrl)
      reject(new Error(isVideo ? 'This video could not be read. Choose an MP4, WebM, or MOV file.' : 'The selected file dimensions could not be read.'))
    }
    if (element instanceof HTMLVideoElement) {
      element.preload = 'metadata'
      // Video elements never fire `load`, so metadata has to be read from `loadedmetadata`.
      element.onloadedmetadata = () => {
        if (!element.videoWidth || !element.videoHeight) {
          fail()
          return
        }
        resolve({ file, previewUrl, width: element.videoWidth, height: element.videoHeight })
      }
    } else {
      element.onload = () => resolve({ file, previewUrl, width: element.naturalWidth, height: element.naturalHeight })
    }
    element.onerror = fail
    element.src = previewUrl
  })
}

/** A small, labelled block of form fields, so the long form reads as sections instead of one grid. */
function FormSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-(--border)/60 bg-(--surface-soft)/30 p-4 sm:p-5">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-(--text-muted)">{title}</h3>
        <p className="mt-1 text-xs text-(--text-muted)/80">{description}</p>
      </div>
      {children}
    </section>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs font-medium text-(--danger)" role="alert">{message}</p>
}

function BannerStatusPill({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]',
        isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-(--surface-strong) text-(--text-muted)',
      )}
    >
      {isActive ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : <EyeOff className="h-3 w-3" aria-hidden="true" />}
      {isActive ? 'Active' : 'Inactive'}
    </span>
  )
}

/** The artwork an admin can check before saving, at the three ratios the homepage actually renders. */
function BannerPreviewDialog({ banner, onClose }: { banner: Banner | null; onClose: () => void }) {
  const artwork = buildBannerPreviewArtwork(banner?.imageUrl ?? banner?.posterUrl)

  return (
    <AlertDialog open={!!banner} onOpenChange={(open) => { if (!open) onClose() }}>
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{banner ? bannerDisplayName(banner) : 'Banner preview'}</AlertDialogTitle>
          <AlertDialogDescription>
            How this artwork is cropped on each device. The same file is served at a width and ratio per device, so a phone
            never downloads the desktop artwork.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4">
          {artwork ? (
            <>
              <figure className="space-y-1">
                <figcaption className="text-xs font-semibold text-(--text-muted)">Desktop · 16:5 (unchanged)</figcaption>
                <img src={artwork.desktop} alt="" className="w-full rounded-xl border border-(--border) bg-black object-cover" style={{ aspectRatio: '16 / 5' }} loading="lazy" decoding="async" />
              </figure>
              <div className="grid gap-4 sm:grid-cols-2">
                <figure className="space-y-1">
                  <figcaption className="text-xs font-semibold text-(--text-muted)">Tablet · 12:5</figcaption>
                  <img src={artwork.tablet} alt="" className="w-full rounded-xl border border-(--border) bg-black object-cover" style={{ aspectRatio: '12 / 5' }} loading="lazy" decoding="async" />
                </figure>
                <figure className="space-y-1">
                  <figcaption className="text-xs font-semibold text-(--text-muted)">Mobile · 5:2</figcaption>
                  <img src={artwork.mobile} alt="" className="w-full rounded-xl border border-(--border) bg-black object-cover" style={{ aspectRatio: '5 / 2' }} loading="lazy" decoding="async" />
                </figure>
              </div>
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-(--border) p-6 text-center text-sm text-(--text-muted)">This banner has no artwork.</p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogAction>Close</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function BannerManagementPage() {
  const { data: banners = [], isLoading, isError, refetch, isFetching } = useGetAdminBannersQuery()
  const [createBanner, { isLoading: isCreating }] = useCreateBannerMutation()
  const [updateBanner, { isLoading: isUpdating }] = useUpdateBannerMutation()
  const [deleteBanner] = useDeleteBannerMutation()
  const [reorderBanners, { isLoading: isReordering }] = useReorderBannersMutation()
  const { upload: uploadFiles, progress: uploadProgress, isUploading } = useMediaUploadProgress()
  const [editing, setEditing] = useState<Banner | null>(null)
  const [form, setForm] = useState<BannerFormState>(emptyBannerForm)
  const [errors, setErrors] = useState<BannerFormErrors>({})
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null)
  const [posterInfo, setPosterInfo] = useState<MediaInfo | null>(null)
  const [orderedBanners, setOrderedBanners] = useState<Banner[]>([])
  const [draggedBannerId, setDraggedBannerId] = useState<string | null>(null)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [isCropping, setIsCropping] = useState(false)
  const [previewBanner, setPreviewBanner] = useState<Banner | null>(null)
  const [bannerToDelete, setBannerToDelete] = useState<Banner | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<BannerStatusFilter>('ALL')
  const isSaving = isCreating || isUpdating
  const selectedMediaUrl = mediaInfo?.previewUrl || (form.type === 'VIDEO' ? form.videoUrl : form.imageUrl)
  const selectedPosterUrl = posterInfo?.previewUrl || form.posterUrl
  const visibleBanners = useMemo(() => filterBanners(orderedBanners, { query: search, status: statusFilter }), [orderedBanners, search, statusFilter])
  const mediaDimensions = useMemo(() => mediaInfo ? `${mediaInfo.width} x ${mediaInfo.height}px · ${formatBytes(mediaInfo.file.size)}` : null, [mediaInfo])

  useEffect(() => {
    setOrderedBanners((current) => {
      if (
        current.length === banners.length &&
        current.every((banner, index) => {
          const next = banners[index]
          return Boolean(next) && banner.id === next.id && banner.displayOrder === next.displayOrder
        })
      ) {
        return current
      }

      return banners.map((banner) => ({ ...banner }))
    })
  }, [banners])

  useEffect(() => () => {
    if (mediaInfo) URL.revokeObjectURL(mediaInfo.previewUrl)
    if (posterInfo) URL.revokeObjectURL(posterInfo.previewUrl)
  }, [mediaInfo, posterInfo])

  const setField = <K extends keyof BannerFormState>(name: K, value: BannerFormState[K]) => {
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => {
      if (Object.keys(current).length === 0) return current
      const next = { ...current }
      delete next[name as keyof BannerFormErrors]
      return next
    })
  }

  const reset = () => {
    if (cropImageSrc) URL.revokeObjectURL(cropImageSrc)
    setCropImageSrc(null)
    setCropFile(null)
    setEditing(null)
    setForm(emptyBannerForm)
    setErrors({})
    setMediaInfo(null)
    setPosterInfo(null)
  }

  const startCreate = () => {
    reset()
    document.getElementById('banner-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const edit = (banner: Banner) => {
    setEditing(banner)
    setForm(bannerFormFromRecord(banner))
    setErrors({})
    setMediaInfo(null)
    setPosterInfo(null)
    document.getElementById('banner-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** Sends a new order for the whole list; rolls the UI back when the API refuses. */
  const persistOrder = async (nextOrder: Banner[]) => {
    const previousOrder = orderedBanners
    setOrderedBanners(nextOrder)
    try {
      await reorderBanners(nextOrder.map((banner, index) => ({ id: banner.id, displayOrder: index }))).unwrap()
      toast.success('Banner order updated.')
    } catch {
      setOrderedBanners(previousOrder)
      toast.error('Could not update banner order.')
    }
  }

  const moveBanner = (targetBannerId: string) => {
    if (!draggedBannerId || draggedBannerId === targetBannerId || isReordering) return
    const nextOrder = [...orderedBanners]
    const draggedIndex = nextOrder.findIndex((banner) => banner.id === draggedBannerId)
    const targetIndex = nextOrder.findIndex((banner) => banner.id === targetBannerId)
    if (draggedIndex < 0 || targetIndex < 0) return
    const [draggedBanner] = nextOrder.splice(draggedIndex, 1)
    nextOrder.splice(targetIndex, 0, draggedBanner)
    setDraggedBannerId(null)
    void persistOrder(nextOrder.map((banner, index) => ({ ...banner, displayOrder: index })))
  }

  const moveByButton = (bannerId: string, direction: -1 | 1) => {
    if (isReordering) return
    const nextOrder = moveBannerBy(orderedBanners, bannerId, direction)
    if (nextOrder) void persistOrder(nextOrder)
  }

  /** Activation is a single-field update, so it never touches the rest of the banner. */
  const toggleActive = async (banner: Banner) => {
    try {
      await updateBanner({ id: banner.id, isActive: !banner.isActive }).unwrap()
      toast.success(banner.isActive ? 'Banner deactivated.' : 'Banner activated.')
    } catch {
      toast.error('Could not change this banner’s visibility.')
    }
  }

  const confirmDelete = async () => {
    const banner = bannerToDelete
    if (!banner) return
    setIsDeleting(true)
    const previousOrder = orderedBanners
    setOrderedBanners((current) => current.filter((item) => item.id !== banner.id))
    try {
      await deleteBanner(banner.id).unwrap()
      if (editing?.id === banner.id) reset()
      setBannerToDelete(null)
      toast.success('Banner deleted.')
    } catch {
      // The row is still there on the server, so it comes back instead of vanishing from the list.
      setOrderedBanners(previousOrder)
      toast.error('Banner could not be deleted.')
    } finally {
      setIsDeleting(false)
    }
  }

  const selectMedia = async (file: File, kind: 'media' | 'poster') => {
    const isVideo = file.type.startsWith('video/')
    if (kind === 'media' && form.type === 'IMAGE' && !isSupportedImageMimeType(file.type)) {
      toast.error('Choose a JPG, PNG, or WebP image.')
      return
    }
    if (kind === 'media' && form.type === 'VIDEO' && !isVideo) {
      toast.error('Choose an MP4, WebM, or MOV video.')
      return
    }
    if (kind === 'poster' && !isSupportedImageMimeType(file.type)) { toast.error('Poster must be a JPG, PNG, or WebP image.'); return }
    const limit = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE
    if (file.size > limit) { toast.error(`This file is too large. Maximum is ${isVideo ? '100 MB' : '10 MB'}.`); return }
    if (kind === 'media' && form.type === 'IMAGE') {
      if (cropImageSrc) URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(URL.createObjectURL(file))
      setCropFile(file)
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setCroppedAreaPixels(null)
      return
    }
    try {
      const info = await readMediaInfo(file)
      if (kind === 'poster') setPosterInfo(info)
      else setMediaInfo(info)
      toast.success('Media selected. Review the preview, then upload it.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not preview media.') }
  }

  const confirmBannerCrop = async () => {
    if (!cropImageSrc || !cropFile || !croppedAreaPixels) return
    setIsCropping(true)
    try {
      const resizedFile = await cropBannerImage(cropImageSrc, croppedAreaPixels, cropFile.name)
      const info = await readMediaInfo(resizedFile)
      setMediaInfo(info)
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
      setCropFile(null)
      toast.success('Banner resized to 1600 x 500px. Review it, then upload.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not resize the banner.') }
    finally { setIsCropping(false) }
  }

  const uploadMedia = async (kind: 'media' | 'poster') => {
    const info = kind === 'poster' ? posterInfo : mediaInfo
    if (!info) { toast.error(`Choose a ${kind === 'poster' ? 'poster image' : form.type === 'IMAGE' ? 'banner photo' : 'banner video'} first.`); return }
    try {
      const result = await uploadFiles({ files: [info.file], folder: 'sportzone/banners', mediaType: 'BANNER' })
      const url = result.uploads[0]?.url
      if (!url) throw new Error('Upload succeeded but no media URL was returned.')
      if (kind === 'poster') setField('posterUrl', url)
      else {
        setForm((current) => ({ ...current, imageUrl: form.type === 'IMAGE' ? url : '', videoUrl: form.type === 'VIDEO' ? url : '' }))
        setErrors((current) => ({ ...current, media: undefined }))
      }
      toast.success(`${kind === 'poster' ? 'Poster' : form.type === 'IMAGE' ? 'Image' : 'Video'} uploaded.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Media upload failed.') }
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isSaving || isUploading) return

    const validation = validateBannerForm(form)
    if (hasBannerFormErrors(validation)) {
      setErrors(validation)
      toast.error('Check the highlighted fields before saving.')
      return
    }

    setErrors({})
    try {
      const payload = buildBannerPayload(form, {
        isEditing: Boolean(editing),
        displayOrder: nextDisplayOrder(orderedBanners),
      })
      if (editing) await updateBanner({ id: editing.id, ...payload }).unwrap()
      else await createBanner(payload).unwrap()
      toast.success(editing ? 'Banner updated.' : 'Banner created.')
      reset()
    } catch { toast.error('Could not save banner.') }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-(--text-primary) sm:text-3xl">
            <Images className="h-6 w-6 text-(--accent)" aria-hidden="true" />
            Banner Management
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-(--text-muted)">
            The hero banners shown on the homepage. One artwork per banner is served at the width and crop each device
            needs; the desktop hero is unchanged.
          </p>
        </div>
        <Button onClick={startCreate} className="gap-2">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New banner
        </Button>
      </header>

      <Card id="banner-form">
        <CardHeader>
          <CardTitle>{editing ? `Edit banner · ${bannerDisplayName(editing)}` : 'Create banner'}</CardTitle>
          <p className="text-sm text-(--text-muted)">Fields marked with a limit are enforced by the server too.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4" noValidate>
            <FormSection title="Content" description="The text shown over the artwork. Every field is optional: a banner without a title renders as artwork only.">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="banner-title">Title <span className="text-(--text-muted)/70">({BANNER_FIELD_LIMITS.title} max)</span></Label>
                  <Input id="banner-title" value={form.title} onChange={(event) => setField('title', event.target.value)} aria-invalid={Boolean(errors.title)} />
                  <FieldError message={errors.title} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="banner-badge">Badge <span className="text-(--text-muted)/70">({BANNER_FIELD_LIMITS.badge} max)</span></Label>
                  <Input id="banner-badge" value={form.badge} onChange={(event) => setField('badge', event.target.value)} aria-invalid={Boolean(errors.badge)} />
                  <FieldError message={errors.badge} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Label htmlFor="banner-subtitle">Subtitle</Label>
                    <DescriptionGenerator
                      entityType="BANNER"
                      title={form.title}
                      subtitle={form.subtitle}
                      currentDescription={form.subtitle}
                      context={{ badge: form.badge, type: form.type }}
                      onGenerated={(description) => setField('subtitle', description)}
                    />
                  </div>
                  <Textarea id="banner-subtitle" value={form.subtitle} onChange={(event) => setField('subtitle', event.target.value)} rows={3} aria-invalid={Boolean(errors.subtitle)} />
                  <FieldError message={errors.subtitle} />
                </div>
              </div>
            </FormSection>

            <FormSection title="Artwork" description="Images are cropped to 1600 × 500 px (16:5) for the desktop hero. Phones and tablets receive a cropped rendition of the same upload.">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="banner-type">Type</Label>
                  <Select
                    value={form.type}
                    onValueChange={(value) => {
                      setMediaInfo(null)
                      setForm((current) => ({ ...current, type: value as Banner['type'], imageUrl: '', videoUrl: '' }))
                      setErrors((current) => ({ ...current, media: undefined }))
                    }}
                  >
                    <SelectTrigger id="banner-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IMAGE">Image banner</SelectItem>
                      <SelectItem value="VIDEO">Video banner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="banner-media-file">{form.type === 'IMAGE' ? 'Banner photo' : 'Banner video'}</Label>
                  <div className="rounded-xl border border-(--border) bg-(--surface-soft) p-3">
                    {selectedMediaUrl && (
                      <div className="relative mb-3 overflow-hidden rounded-lg border border-(--border) bg-black">
                        {form.type === 'IMAGE' ? (
                          <img src={selectedMediaUrl} alt="Selected banner artwork" className="w-full object-contain" style={{ aspectRatio: '16 / 5' }} />
                        ) : (
                          <video src={selectedMediaUrl} controls className="aspect-video w-full object-contain" poster={selectedPosterUrl || undefined} />
                        )}
                        <button type="button" onClick={() => { setMediaInfo(null); setForm((current) => ({ ...current, imageUrl: '', videoUrl: '' })) }} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white transition hover:bg-black/85" aria-label="Remove banner media"><X className="h-4 w-4" aria-hidden="true" /></button>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="banner-media-file" className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-sm font-medium transition hover:border-(--accent)/50">
                        <ImagePlus className="h-4 w-4" aria-hidden="true" />
                        {selectedMediaUrl ? 'Replace' : 'Choose'} {form.type === 'IMAGE' ? 'photo' : 'video'}
                      </label>
                      <input id="banner-media-file" type="file" accept={form.type === 'IMAGE' ? 'image/png,image/jpeg,image/webp' : 'video/mp4,video/webm,video/quicktime'} onChange={(event) => { const file = event.target.files?.[0]; if (file) void selectMedia(file, 'media'); event.currentTarget.value = '' }} className="sr-only" />
                      <Button type="button" variant="outline" onClick={() => void uploadMedia('media')} disabled={!mediaInfo || isUploading} className="gap-2">
                        {isUploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UploadCloud className="h-4 w-4" aria-hidden="true" />}
                        {isUploading ? 'Uploading…' : 'Upload'}
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-(--text-muted)">
                      Recommended: {form.type === 'IMAGE' ? '1600 × 500 px (16:5), maximum 10 MB' : 'a wide source such as 2560 × 800 or wider, maximum 100 MB'}
                      {mediaDimensions ? ` · Selected: ${mediaDimensions}` : ''}
                      {(form.type === 'IMAGE' && form.imageUrl) || (form.type === 'VIDEO' && form.videoUrl) ? ' · Uploaded' : ''}
                    </p>
                    <UploadProgress update={uploadProgress.update} error={uploadProgress.error} className="mt-2" />
                    <FieldError message={errors.media} />
                  </div>
                </div>
              </div>

              {form.type === 'VIDEO' && (
                <div className="space-y-2">
                  <Label htmlFor="banner-poster-file">Video poster photo (optional)</Label>
                  <div className="rounded-xl border border-(--border) bg-(--surface-soft) p-3">
                    {selectedPosterUrl && <img src={selectedPosterUrl} alt="Selected poster" className="w-full rounded-lg object-contain sm:max-w-xs" style={{ aspectRatio: '16 / 5' }} />}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <label htmlFor="banner-poster-file" className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-sm font-medium transition hover:border-(--accent)/50">
                        <ImagePlus className="h-4 w-4" aria-hidden="true" />
                        {selectedPosterUrl ? 'Replace poster' : 'Choose poster'}
                      </label>
                      <input id="banner-poster-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void selectMedia(file, 'poster'); event.currentTarget.value = '' }} className="sr-only" />
                      <Button type="button" variant="outline" onClick={() => void uploadMedia('poster')} disabled={!posterInfo || isUploading} className="gap-2">
                        <UploadCloud className="h-4 w-4" aria-hidden="true" />
                        Upload poster
                      </Button>
                    </div>
                    <UploadProgress update={uploadProgress.update} error={uploadProgress.error} className="mt-2" />
                  </div>
                </div>
              )}
            </FormSection>

            <FormSection title="Link and visibility" description="A banner with a link is clickable everywhere and keyboard-focusable.">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="banner-cta-text">Button label (optional)</Label>
                  <Input id="banner-cta-text" value={form.ctaText} onChange={(event) => setField('ctaText', event.target.value)} aria-invalid={Boolean(errors.ctaText)} />
                  <FieldError message={errors.ctaText} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="banner-link">Banner link (optional)</Label>
                  <Input id="banner-link" placeholder="https://example.com/match or /watch/123" value={form.ctaUrl} onChange={(event) => setField('ctaUrl', event.target.value)} aria-invalid={Boolean(errors.ctaUrl)} aria-describedby="banner-link-hint" />
                  <p id="banner-link-hint" className="text-xs text-(--text-muted)">Users can click anywhere on the banner to open this link. An in-app path such as <code>/watch/123</code> works too.</p>
                  <FieldError message={errors.ctaUrl} />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="banner-active" checked={form.isActive} onCheckedChange={(value) => setField('isActive', Boolean(value))} />
                  <Label htmlFor="banner-active">Active (visible on the homepage)</Label>
                </div>
                {editing && <p className="text-xs text-(--text-muted)">Position {form.displayOrder + 1} — drag or use the arrows in the list to reorder.</p>}
              </div>
            </FormSection>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={isSaving || isUploading} className="gap-2">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                {isSaving ? 'Saving…' : editing ? 'Save changes' : 'Create banner'}
              </Button>
              {editing && <Button type="button" variant="outline" onClick={reset}>Cancel</Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      {cropImageSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="banner-crop-title">
          <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-(--border) bg-(--surface) shadow-2xl">
            <div className="flex items-center justify-between border-b border-(--border) p-4">
              <div>
                <h2 id="banner-crop-title" className="font-semibold text-(--text-primary)">Resize banner image</h2>
                <p className="text-xs text-(--text-muted)">Crop to the 16:5 banner ratio. Final upload: 1600 × 500 px.</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => { URL.revokeObjectURL(cropImageSrc); setCropImageSrc(null); setCropFile(null) }} aria-label="Close cropper"><X className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
            <div className="relative h-[min(60vh,480px)] bg-black">
              <Cropper image={cropImageSrc} crop={crop} zoom={zoom} aspect={16 / 5} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)} objectFit="contain" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <label className="text-xs text-(--text-muted)" htmlFor="banner-zoom">Zoom</label>
                <input id="banner-zoom" type="range" min={1} max={3} step={0.05} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="min-w-0 flex-1 accent-(--accent)" />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => { URL.revokeObjectURL(cropImageSrc); setCropImageSrc(null); setCropFile(null) }}>Cancel</Button>
                <Button type="button" onClick={() => void confirmBannerCrop()} disabled={isCropping} className="gap-2">
                  {isCropping && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {isCropping ? 'Resizing…' : 'Use this crop'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Existing banners</CardTitle>
              <p className="text-sm text-(--text-muted)">Drag a banner, or use the arrows, to change the order shown on the homepage.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--text-muted)" aria-hidden="true" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search banners" aria-label="Search banners" className="w-52 pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as BannerStatusFilter)}>
                <SelectTrigger className="w-36" aria-label="Filter by status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All banners</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} className="gap-2">
                {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Skeleton className="h-48 rounded-2xl" />
              <Skeleton className="h-48 rounded-2xl" />
              <Skeleton className="h-48 rounded-2xl" />
            </div>
          ) : isError ? (
            <div className="rounded-2xl border border-(--danger)/40 bg-(--danger)/10 p-6 text-center" role="alert">
              <p className="text-sm font-medium text-(--text-primary)">Banners could not be loaded.</p>
              <p className="mt-1 text-xs text-(--text-muted)">Check your connection and try again.</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>Try again</Button>
            </div>
          ) : orderedBanners.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-(--border) p-8 text-center">
              <Images className="mx-auto h-8 w-8 text-(--text-muted)" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-(--text-primary)">No hero banners yet.</p>
              <p className="mt-1 text-xs text-(--text-muted)">Create one and it appears on the homepage immediately.</p>
              <Button type="button" onClick={startCreate} className="mt-4 gap-2"><Plus className="h-4 w-4" aria-hidden="true" />Create the first banner</Button>
            </div>
          ) : visibleBanners.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-(--border) p-6 text-center text-sm text-(--text-muted)">
              No banners match this search or filter.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleBanners.map((banner, index) => {
                const position = orderedBanners.findIndex((item) => item.id === banner.id)
                return (
                  <li
                    key={banner.id}
                    draggable={!isReordering}
                    onDragStart={() => setDraggedBannerId(banner.id)}
                    onDragEnd={() => setDraggedBannerId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => moveBanner(banner.id)}
                    className={cn(
                      'flex flex-col overflow-hidden rounded-2xl border bg-linear-to-br from-(--surface-soft)/70 via-(--surface-soft)/40 to-(--surface) transition',
                      draggedBannerId === banner.id ? 'border-(--accent) opacity-60' : 'border-(--border) hover:border-(--accent)/50',
                    )}
                  >
                    <div className="relative bg-black/40">
                      {banner.type === 'VIDEO' && banner.videoUrl ? (
                        <video src={banner.videoUrl} poster={banner.posterUrl || undefined} className="w-full object-cover" style={{ aspectRatio: '16 / 5' }} muted playsInline preload="metadata" aria-label={`Preview of ${bannerDisplayName(banner)}`} />
                      ) : banner.imageUrl ? (
                        <img src={buildCloudinaryUrl(banner.imageUrl, { width: 480, crop: 'fill', gravity: 'center' })} alt="" className="w-full object-cover" style={{ aspectRatio: '16 / 5' }} loading="lazy" decoding="async" />
                      ) : (
                        <div className="grid w-full place-items-center text-(--text-muted)" style={{ aspectRatio: '16 / 5' }}><Video className="h-6 w-6" aria-hidden="true" /></div>
                      )}
                      <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">#{position + 1}</span>
                    </div>
                    <div className="flex flex-1 flex-col gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-(--text-primary)">{bannerDisplayName(banner)}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <BannerStatusPill isActive={banner.isActive} />
                          <Badge variant="outline" className="text-[10px] uppercase tracking-[0.12em]">{banner.type === 'VIDEO' ? 'Video' : 'Image'}</Badge>
                        </div>
                      </div>
                      <div className="mt-auto flex flex-wrap gap-1.5">
                        <Button type="button" size="sm" variant="outline" onClick={() => edit(banner)} aria-label={`Edit ${bannerDisplayName(banner)}`}><Edit3 className="h-3.5 w-3.5" aria-hidden="true" /><span className="ml-1">Edit</span></Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setPreviewBanner(banner)} aria-label={`Preview ${bannerDisplayName(banner)}`}><Eye className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => void toggleActive(banner)} aria-label={banner.isActive ? `Deactivate ${bannerDisplayName(banner)}` : `Activate ${bannerDisplayName(banner)}`} title={bannerStatusLabel(banner)}>
                          {banner.isActive ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => moveByButton(banner.id, -1)} disabled={isReordering || index === 0} aria-label={`Move ${bannerDisplayName(banner)} earlier`}><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => moveByButton(banner.id, 1)} disabled={isReordering || index === visibleBanners.length - 1} aria-label={`Move ${bannerDisplayName(banner)} later`}><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                        <Button type="button" size="sm" variant="ghost" className="text-(--danger) hover:bg-(--danger)/10" onClick={() => setBannerToDelete(banner)} aria-label={`Delete ${bannerDisplayName(banner)}`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                        <span className="ml-auto grid place-items-center px-1 text-(--text-muted)" aria-hidden="true"><GripVertical className="h-4 w-4" /></span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <BannerPreviewDialog banner={previewBanner} onClose={() => setPreviewBanner(null)} />

      <AlertDialog open={!!bannerToDelete} onOpenChange={(open) => { if (!open) setBannerToDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this banner?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{bannerToDelete ? bannerDisplayName(bannerToDelete) : ''}&rdquo; will be removed from the homepage and its
              unused artwork will be cleaned up. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()} disabled={isDeleting} className="bg-red-600 hover:bg-red-700">
              {isDeleting ? 'Deleting…' : 'Delete banner'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default BannerManagementPage
