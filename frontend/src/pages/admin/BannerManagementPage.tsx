import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Edit3, GripVertical, ImagePlus, Loader2, Plus, Trash2, UploadCloud, Video, X } from 'lucide-react'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Textarea } from '@/components/ui/Textarea'
import { Checkbox } from '@/components/ui/Checkbox'
import { DescriptionGenerator } from '@/components/ai/DescriptionGenerator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { useUploadFilesMutation } from '@/features/admin/uploads.api'
import { useCreateBannerMutation, useDeleteBannerMutation, useGetAdminBannersQuery, useReorderBannersMutation, useUpdateBannerMutation, type Banner } from '@/features/admin/banners.api'

const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const MAX_VIDEO_SIZE = 100 * 1024 * 1024
const emptyForm = { title: '', subtitle: '', type: 'IMAGE' as Banner['type'], imageUrl: '', videoUrl: '', posterUrl: '', badge: '', ctaUrl: '', displayOrder: 0, isActive: true }
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
  return new Promise((resolve, reject) => {
    const element = file.type.startsWith('video/') ? document.createElement('video') : new Image()
    if (element instanceof HTMLVideoElement) element.preload = 'metadata'
    element.onload = () => resolve({ file, previewUrl, width: element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth, height: element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight })
    element.onerror = () => { URL.revokeObjectURL(previewUrl); reject(new Error('The selected file dimensions could not be read.')) }
    element.src = previewUrl
  })
}

export function BannerManagementPage() {
  const { data: banners = [], isLoading } = useGetAdminBannersQuery()
  const [createBanner, { isLoading: isCreating }] = useCreateBannerMutation()
  const [updateBanner, { isLoading: isUpdating }] = useUpdateBannerMutation()
  const [deleteBanner] = useDeleteBannerMutation()
  const [reorderBanners, { isLoading: isReordering }] = useReorderBannersMutation()
  const [uploadFiles, { isLoading: isUploading }] = useUploadFilesMutation()
  const [editing, setEditing] = useState<Banner | null>(null)
  const [form, setForm] = useState(emptyForm)
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
  const isSaving = isCreating || isUpdating
  const selectedMediaUrl = mediaInfo?.previewUrl || (form.type === 'VIDEO' ? form.videoUrl : form.imageUrl)
  const selectedPosterUrl = posterInfo?.previewUrl || form.posterUrl

  useEffect(() => {
    setOrderedBanners(banners)
  }, [banners])

  useEffect(() => () => {
    if (mediaInfo) URL.revokeObjectURL(mediaInfo.previewUrl)
    if (posterInfo) URL.revokeObjectURL(posterInfo.previewUrl)
  }, [mediaInfo, posterInfo])

  const setField = (name: string, value: string | number | boolean) => setForm((current) => ({ ...current, [name]: value }))
  const reset = () => { if (cropImageSrc) URL.revokeObjectURL(cropImageSrc); setCropImageSrc(null); setCropFile(null); setEditing(null); setForm(emptyForm); setMediaInfo(null); setPosterInfo(null) }

  const edit = (banner: Banner) => {
    setEditing(banner)
    setForm({ title: banner.title, subtitle: banner.subtitle ?? '', type: banner.type, imageUrl: banner.imageUrl ?? '', videoUrl: banner.videoUrl ?? '', posterUrl: banner.posterUrl ?? '', badge: banner.badge ?? '', ctaUrl: banner.ctaUrl ?? '', displayOrder: banner.displayOrder, isActive: banner.isActive })
    setMediaInfo(null)
    setPosterInfo(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const moveBanner = async (targetBannerId: string) => {
    if (!draggedBannerId || draggedBannerId === targetBannerId || isReordering) return
    const previousOrder = orderedBanners
    const nextOrder = [...orderedBanners]
    const draggedIndex = nextOrder.findIndex((banner) => banner.id === draggedBannerId)
    const targetIndex = nextOrder.findIndex((banner) => banner.id === targetBannerId)
    if (draggedIndex < 0 || targetIndex < 0) return
    const [draggedBanner] = nextOrder.splice(draggedIndex, 1)
    nextOrder.splice(targetIndex, 0, draggedBanner)
    setOrderedBanners(nextOrder.map((banner, index) => ({ ...banner, displayOrder: index })))
    setDraggedBannerId(null)
    try {
      await reorderBanners(nextOrder.map((banner, index) => ({ id: banner.id, displayOrder: index }))).unwrap()
      toast.success('Banner order updated.')
    } catch {
      setOrderedBanners(previousOrder)
      toast.error('Could not update banner order.')
    }
  }

  const removeBanner = async (banner: Banner) => {
    if (!window.confirm(`Delete "${banner.title}"?`)) return
    const previousOrder = orderedBanners
    setOrderedBanners((current) => current.filter((item) => item.id !== banner.id))
    if (editing?.id === banner.id) reset()
    try {
      await deleteBanner(banner.id).unwrap()
      toast.success('Banner deleted.')
    } catch {
      setOrderedBanners(previousOrder)
      toast.error('Banner could not be deleted.')
    }
  }

  const selectMedia = async (file: File, kind: 'media' | 'poster') => {
    const isVideo = file.type.startsWith('video/')
    if (kind === 'media' && ((form.type === 'IMAGE' && !file.type.startsWith('image/')) || (form.type === 'VIDEO' && !isVideo))) {
      toast.error(`Choose a ${form.type === 'IMAGE' ? 'JPG, PNG, or WebP image' : 'MP4, WebM, or MOV video'}.`)
      return
    }
    if (kind === 'poster' && !file.type.startsWith('image/')) { toast.error('Poster must be an image.'); return }
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
      const result = await uploadFiles({ files: [info.file], folder: 'sportzone/banners', mediaType: 'BANNER' }).unwrap()
      const url = result.uploads[0]?.url
      if (!url) throw new Error('Upload succeeded but no media URL was returned.')
      if (kind === 'poster') setForm((current) => ({ ...current, posterUrl: url }))
      else setForm((current) => ({ ...current, imageUrl: form.type === 'IMAGE' ? url : '', videoUrl: form.type === 'VIDEO' ? url : '' }))
      toast.success(`${kind === 'poster' ? 'Poster' : form.type === 'IMAGE' ? 'Image' : 'Video'} uploaded.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Media upload failed.') }
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if ((form.type === 'IMAGE' && !form.imageUrl) || (form.type === 'VIDEO' && !form.videoUrl)) { toast.error(`Upload a ${form.type === 'IMAGE' ? 'banner image' : 'banner video'} first.`); return }
    try {
      const payload = { ...form, displayOrder: editing ? form.displayOrder : orderedBanners.length, subtitle: form.subtitle || null, imageUrl: form.imageUrl || null, videoUrl: form.videoUrl || null, posterUrl: form.posterUrl || null, badge: form.badge || null, ctaUrl: form.ctaUrl || null }
      if (editing) await updateBanner({ id: editing.id, ...payload }).unwrap()
      else await createBanner(payload).unwrap()
      toast.success(editing ? 'Banner updated.' : 'Banner created.')
      reset()
    } catch { toast.error('Could not save banner.') }
  }

  const mediaDimensions = useMemo(() => mediaInfo ? `${mediaInfo.width} x ${mediaInfo.height}px · ${formatBytes(mediaInfo.file.size)}` : null, [mediaInfo])

  return <div className="space-y-6">
    <Card><CardHeader><CardTitle>{editing ? 'Edit Banner' : 'Create Banner'}</CardTitle></CardHeader><CardContent><form onSubmit={save} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="banner-title">Title</Label><Input id="banner-title" value={form.title} onChange={(e) => setField('title', e.target.value)} required /></div>
      <div className="space-y-2"><Label htmlFor="banner-badge">Badge</Label><Input id="banner-badge" value={form.badge} onChange={(e) => setField('badge', e.target.value)} /></div>
      <div className="space-y-2 md:col-span-2"><div className="flex items-center justify-between gap-3"><Label htmlFor="banner-subtitle">Subtitle</Label><DescriptionGenerator entityType="BANNER" title={form.title} subtitle={form.subtitle} currentDescription={form.subtitle} context={{ badge: form.badge, type: form.type }} onGenerated={(description) => setField('subtitle', description)} /></div><Textarea id="banner-subtitle" value={form.subtitle} onChange={(e) => setField('subtitle', e.target.value)} rows={3} /></div>
      <div className="space-y-2"><Label>Type</Label><Select value={form.type} onValueChange={(value) => { setField('type', value); setMediaInfo(null); setForm((current) => ({ ...current, type: value as Banner['type'], imageUrl: '', videoUrl: '' })) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="IMAGE">Image banner</SelectItem><SelectItem value="VIDEO">Video banner</SelectItem></SelectContent></Select></div>
      <div className="space-y-2 md:col-span-2"><Label>{form.type === 'IMAGE' ? 'Banner photo' : 'Banner video'}</Label><div className="rounded-xl border border-border bg-surface-soft p-3">{selectedMediaUrl && <div className="relative mb-3 overflow-hidden rounded-lg border border-border bg-black">{form.type === 'IMAGE' ? <img src={selectedMediaUrl} alt="Banner preview" className="aspect-16/5 w-full object-contain" /> : <video src={selectedMediaUrl} controls className="aspect-video w-full object-contain" poster={selectedPosterUrl || undefined} />}<button type="button" onClick={() => { setMediaInfo(null); setForm((current) => ({ ...current, imageUrl: '', videoUrl: '' })) }} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white" aria-label="Remove banner media"><X className="h-4 w-4" /></button></div>}<div className="flex flex-wrap items-center gap-2"><label htmlFor="banner-media-file" className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium"><ImagePlus className="h-4 w-4" />Choose {form.type === 'IMAGE' ? 'photo' : 'video'}</label><input id="banner-media-file" type="file" accept={form.type === 'IMAGE' ? 'image/png,image/jpeg,image/webp' : 'video/mp4,video/webm,video/quicktime'} onChange={(e) => { const file = e.target.files?.[0]; if (file) void selectMedia(file, 'media'); e.currentTarget.value = '' }} className="sr-only" /><Button type="button" variant="outline" onClick={() => void uploadMedia('media')} disabled={!mediaInfo || isUploading} className="gap-2">{isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}Upload</Button></div><p className="mt-2 text-xs text-text-muted">Recommended: {form.type === 'IMAGE' ? '1600 x 500 px, maximum 10 MB' : '1920 x 1080 px, maximum 100 MB'}{mediaDimensions ? ` · Selected: ${mediaDimensions}` : ''}{form.type === 'IMAGE' && form.imageUrl || form.type === 'VIDEO' && form.videoUrl ? ' · Uploaded' : ''}</p></div></div>
      {form.type === 'VIDEO' && <div className="space-y-2 md:col-span-2"><Label>Video poster photo (optional)</Label><div className="rounded-xl border border-border bg-surface-soft p-3">{selectedPosterUrl && <img src={selectedPosterUrl} alt="Video poster preview" className="aspect-video max-h-48 w-full rounded-lg object-contain" />}<div className="mt-3 flex flex-wrap gap-2"><label htmlFor="banner-poster-file" className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium"><ImagePlus className="h-4 w-4" />Choose poster</label><input id="banner-poster-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (file) void selectMedia(file, 'poster'); e.currentTarget.value = '' }} className="sr-only" /><Button type="button" variant="outline" onClick={() => void uploadMedia('poster')} disabled={!posterInfo || isUploading} className="gap-2"><UploadCloud className="h-4 w-4" />Upload poster</Button></div></div></div>}
      <div className="space-y-2 md:col-span-2"><Label htmlFor="banner-link">Banner link (optional)</Label><Input id="banner-link" type="url" placeholder="https://example.com/match" value={form.ctaUrl} onChange={(e) => setField('ctaUrl', e.target.value)} /><p className="text-xs text-text-muted">Users can click anywhere on the banner to open this link.</p></div>
      <label className="flex items-center gap-2"><Checkbox checked={form.isActive} onCheckedChange={(value) => setField('isActive', Boolean(value))} />Active</label>
      <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={isSaving || isUploading}><Plus className="mr-2 h-4 w-4" />{isSaving ? 'Saving...' : editing ? 'Save changes' : 'Create banner'}</Button>{editing && <Button type="button" variant="outline" onClick={reset}>Cancel</Button>}</div>
    </form></CardContent></Card>
    {cropImageSrc && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="banner-crop-title"><div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"><div className="flex items-center justify-between border-b border-border p-4"><div><h2 id="banner-crop-title" className="font-semibold text-text-primary">Resize banner image</h2><p className="text-xs text-text-muted">Crop to the required 16:5 banner ratio. Final upload: 1600 x 500px.</p></div><Button type="button" variant="ghost" size="sm" onClick={() => { URL.revokeObjectURL(cropImageSrc); setCropImageSrc(null); setCropFile(null) }} aria-label="Close cropper"><X className="h-4 w-4" /></Button></div><div className="relative h-[min(60vh,480px)] bg-black"><Cropper image={cropImageSrc} crop={crop} zoom={zoom} aspect={16 / 5} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)} objectFit="contain" /></div><div className="flex flex-wrap items-center gap-3 p-4"><label className="text-xs text-text-muted" htmlFor="banner-zoom">Zoom</label><input id="banner-zoom" type="range" min={1} max={3} step={0.1} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="min-w-40 flex-1 accent-(--accent)" /><div className="ml-auto flex gap-2"><Button type="button" variant="outline" onClick={() => { URL.revokeObjectURL(cropImageSrc); setCropImageSrc(null); setCropFile(null) }} disabled={isCropping}>Cancel</Button><Button type="button" onClick={() => void confirmBannerCrop()} disabled={isCropping || !croppedAreaPixels}>{isCropping ? 'Resizing...' : 'Use resized banner'}</Button></div></div></div></div>}
    <Card><CardHeader><CardTitle>Existing banners</CardTitle><p className="text-sm text-text-muted">Drag a banner to change its display order.</p></CardHeader><CardContent className="space-y-3">{isLoading ? <div className="h-20 animate-pulse rounded-xl bg-surface-soft" /> : orderedBanners.length === 0 ? <p className="text-sm text-text-muted">No hero banners yet.</p> : orderedBanners.map((banner) => <div key={banner.id} draggable={!isReordering} onDragStart={() => setDraggedBannerId(banner.id)} onDragEnd={() => setDraggedBannerId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => void moveBanner(banner.id)} className={`flex cursor-grab flex-col gap-3 rounded-xl border p-4 transition sm:flex-row sm:items-center sm:justify-between ${draggedBannerId === banner.id ? 'border-accent opacity-50' : 'border-border hover:border-accent/60'}`}><div className="flex items-center gap-3"><GripVertical className="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />{banner.type === 'VIDEO' && banner.videoUrl ? <video src={banner.videoUrl} poster={banner.posterUrl || undefined} className="h-14 w-24 rounded-lg object-cover" /> : banner.imageUrl ? <img src={banner.imageUrl} alt="" className="h-14 w-24 rounded-lg object-cover" /> : <div className="grid h-14 w-24 place-items-center rounded-lg bg-surface-soft"><Video className="h-5 w-5 text-text-muted" /></div>}<div><p className="font-semibold text-text-primary">{banner.title}</p><p className="text-xs text-text-muted">{banner.type} · position {banner.displayOrder + 1} · {banner.isActive ? 'Active' : 'Inactive'}</p></div></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => edit(banner)}><Edit3 className="mr-1 h-4 w-4" />Edit</Button><Button size="sm" variant="destructive" onClick={() => void removeBanner(banner)}><Trash2 className="mr-1 h-4 w-4" />Delete</Button></div></div>)}</CardContent></Card>
  </div>
}
export default BannerManagementPage
