import { useEffect, useMemo, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { PlusCircle, Trash2, ExternalLink, Edit, ImagePlus, Loader2, UploadCloud, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Label } from '../../components/ui/Label'
import { Switch } from '../../components/ui/Switch'
import { Textarea } from '../../components/ui/Textarea'
import { useGetAdvertisementsQuery, useCreateAdvertisementMutation, useUpdateAdvertisementMutation, useDeleteAdvertisementMutation, type Advertisement } from '../../features/admin/advertisements.api'
import { getErrorMessage } from '../../utils/get-error-message'
import { Skeleton } from '../../components/ui/Skeleton'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/AlertDialog'
import { useUploadFilesMutation } from '../../features/admin/uploads.api'
import { DescriptionGenerator } from '../../components/ai/DescriptionGenerator'
import { buildCloudinaryUrl } from '../../utils/cloudinary'

const defaultFormState = {
  title: '',
  description: '',
  link: '',
  imageUrl: '',
  facebookUrl: '',
  youtubeUrl: '',
  telegramUrl: '',
  instagramUrl: '',
  websiteUrl: '',
  isActive: true,
  placement: 'BOTH' as const,
  interstitialEnabled: true,
  durationSeconds: 10,
  unlockHours: 24 as const,
  priority: 0,
}
const emptyAdvertisements: Advertisement[] = []

async function normalizeImageFile(file: File) {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 300
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser cannot prepare this image for upload.')
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new Error('The advertisement image could not be prepared for upload.')
    return new File([blob], file.name.replace(/\.[^.]+$/i, '.jpg'), { type: 'image/jpeg', lastModified: file.lastModified })
  } finally {
    bitmap.close()
  }
}

export default function AdvertisementsManagementPage() {
  const [form, setForm] = useState<Omit<Advertisement, 'id'>>(defaultFormState)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingAd, setDeletingAd] = useState<Advertisement | null>(null)
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null)
  const [uploadedImagePreviewUrl, setUploadedImagePreviewUrl] = useState<string | null>(null)
  const selectedImagePreviewUrl = useMemo(() => selectedImageFile ? URL.createObjectURL(selectedImageFile) : null, [selectedImageFile])
  const previewImageUrl = selectedImagePreviewUrl || uploadedImagePreviewUrl || (form.imageUrl ? buildCloudinaryUrl(form.imageUrl) : null)
  const isFormValid = Boolean(form.title.trim() && form.link.trim())

  const advertisementsQuery = useGetAdvertisementsQuery()
  const advertisements = advertisementsQuery.data ?? emptyAdvertisements
  const { isLoading: isLoadingAds, isError: isAdsError } = advertisementsQuery
  const [createAdvertisement, { isLoading: isCreating }] = useCreateAdvertisementMutation()
  const [updateAdvertisement, { isLoading: isUpdating }] = useUpdateAdvertisementMutation()
  const [deleteAdvertisement] = useDeleteAdvertisementMutation()
  const [uploadFiles, { isLoading: isUploadingImage }] = useUploadFilesMutation()

  const isLoading = isCreating || isUpdating;

  const handleToggleActive = useCallback(async (ad: Advertisement) => {
    try {
      await updateAdvertisement({ id: ad.id, isActive: !ad.isActive }).unwrap()
      toast.success(`${ad.title} is now ${!ad.isActive ? 'active' : 'off'}.`)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }, [updateAdvertisement])

  const clearAdvertisementImage = useCallback(() => {
    setSelectedImageFile(null)
    setUploadedImagePreviewUrl(null)
    setForm((current) => ({ ...current, imageUrl: '' }))
  }, [])

  const handleCancel = useCallback(() => {
    setForm(defaultFormState);
    setEditingId(null);
    setSelectedImageFile(null)
    setUploadedImagePreviewUrl(null)
  }, []);

  useEffect(() => () => {
    if (selectedImagePreviewUrl) URL.revokeObjectURL(selectedImagePreviewUrl)
  }, [selectedImagePreviewUrl])

  const handleImageSelection = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file.')
      return
    }
    setSelectedImageFile(file)
  }, [])

  const handleImageUpload = useCallback(async () => {
    if (!selectedImageFile) {
      toast.error('Select an image file first.')
      return
    }
    try {
      const normalizedFile = await normalizeImageFile(selectedImageFile)
      const result = await uploadFiles({ files: [normalizedFile], folder: 'sportzone/advertisements', mediaType: 'BANNER' }).unwrap()
      const uploadedUrl = result.uploads[0]?.url
      if (!uploadedUrl) throw new Error('Upload succeeded but no image URL was returned.')
      setForm((current) => ({ ...current, imageUrl: uploadedUrl }))
      setUploadedImagePreviewUrl(uploadedUrl)
      setSelectedImageFile(null)
      toast.success('Advertisement image uploaded.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Advertisement image upload failed.')
    }
  }, [selectedImageFile, uploadFiles])

  const normalizeAdvertisementPayload = useCallback((payload: typeof form) => ({
    ...payload,
    title: payload.title.trim(),
    description: payload.description?.trim() ? payload.description.trim() : null,
    link: payload.link.trim(),
    imageUrl: payload.imageUrl?.trim() ? payload.imageUrl.trim() : null,
    facebookUrl: payload.facebookUrl?.trim() ? payload.facebookUrl.trim() : null,
    youtubeUrl: payload.youtubeUrl?.trim() ? payload.youtubeUrl.trim() : null,
    telegramUrl: payload.telegramUrl?.trim() ? payload.telegramUrl.trim() : null,
    instagramUrl: payload.instagramUrl?.trim() ? payload.instagramUrl.trim() : null,
    websiteUrl: payload.websiteUrl?.trim() ? payload.websiteUrl.trim() : null,
  }), [])

  const handleSubmit = useCallback((event: React.FormEvent) => {
    event.preventDefault()

    const payload = normalizeAdvertisementPayload(form)

    if (!payload.title || !payload.link) {
      toast.error('Title and target URL are required.')
      return
    }

    const promise = editingId
      ? updateAdvertisement({ id: editingId, ...payload }).unwrap()
      : createAdvertisement(payload).unwrap();

    toast.promise(
      promise,
      {
        loading: editingId ? 'Updating advertisement...' : 'Creating advertisement...',
        success: (data) => {
          handleCancel();
          return `Advertisement "${data.title}" ${editingId ? 'updated' : 'created'} successfully!`
        },
        error: (err) => getErrorMessage(err),
      },
    );
  }, [editingId, form, updateAdvertisement, createAdvertisement, handleCancel, normalizeAdvertisementPayload]);

  const handleEdit = useCallback((ad: Advertisement) => {
    setEditingId(ad.id);
    setForm({ title: ad.title, description: ad.description ?? '', link: ad.link, imageUrl: ad.imageUrl, facebookUrl: ad.facebookUrl ?? '', youtubeUrl: ad.youtubeUrl ?? '', telegramUrl: ad.telegramUrl ?? '', instagramUrl: ad.instagramUrl ?? '', websiteUrl: ad.websiteUrl ?? '', isActive: ad.isActive, placement: ad.placement ?? 'BOTH', interstitialEnabled: ad.interstitialEnabled ?? true, durationSeconds: ad.durationSeconds ?? 10, unlockHours: ad.unlockHours === 12 ? 12 : 24, priority: ad.priority ?? 0 });
    setSelectedImageFile(null)
    setUploadedImagePreviewUrl(ad.imageUrl ?? null)
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!deletingAd) return
    const promise = deleteAdvertisement(deletingAd.id).unwrap();
    toast.promise(promise, {
      loading: 'Deleting advertisement...',
      success: () => {
        setDeletingAd(null)
        return 'Advertisement deleted.'
      },
      error: (err) => getErrorMessage(err),
    });
  }, [deletingAd, deleteAdvertisement]);

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}>
          <div className="flex items-center gap-3">
            <motion.div className="p-2 bg-linear-to-br from-cyan-500 to-cyan-600 rounded-lg" whileHover={{ scale: 1.1 }}>
            <ExternalLink className="h-5 w-5 text-white" />
            </motion.div>
            <div>
          <h1 className="text-3xl font-semibold text-(--text-primary)">Advertisements</h1>
          <p className="mt-1 text-(--text-muted)">Create and manage app campaigns.</p>
            </div>
          </div>
        </motion.div>
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
        <Button onClick={handleCancel} variant="outline" className="gap-2">
          <PlusCircle className="h-4 w-4" /> New advertisement
        </Button>
        </motion.div>
      </motion.div>
 
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
      <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)] p-6">
        <motion.form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.1, delayChildren: 0.2 }}>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="ad-title">Title</Label>
              <Input
                id="ad-title"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Weekend match promotion"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ad-link">Target URL</Label>
              <Input
                id="ad-link"
                value={form.link}
                onChange={(event) => setForm({ ...form, link: event.target.value })}
                placeholder="https://example.com/promo"
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3"><Label htmlFor="ad-description">Description</Label><DescriptionGenerator entityType="ADVERTISEMENT" title={form.title} currentDescription={form.description ?? ''} context={{ placement: form.placement, status: form.isActive ? 'ACTIVE' : 'INACTIVE' }} onGenerated={(description) => setForm((previous) => ({ ...previous, description }))} /></div>
              <Textarea id="ad-description" value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={5000} rows={4} placeholder="Share the sponsor message and offer details." className="min-h-24" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ad-image">Advertisement image</Label>
              <div className="rounded-2xl border border-(--border) bg-(--surface-soft) p-3">
                {(selectedImagePreviewUrl || uploadedImagePreviewUrl || form.imageUrl) && <div className="relative mb-3 overflow-hidden rounded-xl border border-(--border)"><img src={previewImageUrl || ''} alt="Advertisement preview" className="aspect-4/1 w-full object-cover" /><button type="button" onClick={clearAdvertisementImage} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white hover:bg-black" aria-label="Remove advertisement image"><X className="h-4 w-4" /></button></div>}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label htmlFor="ad-image-file" className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--border) bg-(--surface) px-3 py-2 text-sm font-medium text-(--text-primary) transition hover:border-(--accent) hover:text-(--accent)"><ImagePlus className="h-4 w-4" />Choose image</label>
                  <input id="ad-image-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageSelection} className="sr-only" />
                  <Button type="button" variant="outline" onClick={() => void handleImageUpload()} disabled={!selectedImageFile || isUploadingImage} className="gap-2">{isUploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}{isUploadingImage ? 'Uploading...' : 'Upload image'}</Button>
                </div>
                <p className="mt-2 text-xs text-(--text-muted)">{selectedImageFile ? selectedImageFile.name : form.imageUrl ? '1200 x 300 banner attached.' : 'Optional: choose and upload a 1200 x 300 banner.'}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="ad-placement">Placement</Label><select id="ad-placement" value={form.placement} onChange={(event) => setForm({ ...form, placement: event.target.value as typeof form.placement })} className="h-10 rounded-xl border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"><option value="BOTH">Match + Channel</option><option value="MATCH">Match</option><option value="CHANNEL">Channel</option><option value="FULL_PAGE">Full page</option></select></div>
              <div className="grid gap-2"><Label htmlFor="ad-duration">Countdown (seconds)</Label><Input id="ad-duration" type="number" min={3} max={120} value={form.durationSeconds} onChange={(event) => setForm({ ...form, durationSeconds: Number(event.target.value) })} /></div>
              <div className="grid gap-2"><Label htmlFor="ad-unlock">Unlock duration</Label><select id="ad-unlock" value={form.unlockHours} onChange={(event) => setForm({ ...form, unlockHours: Number(event.target.value) === 12 ? 12 : 24 })} className="h-10 rounded-xl border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"><option value={12}>12 hours</option><option value={24}>24 hours</option></select></div>
              <div className="grid gap-2"><Label htmlFor="ad-priority">Priority</Label><Input id="ad-priority" type="number" min={0} max={1000} value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })} /></div>
            </div>
            <div className="grid gap-2">
              <Label>Optional social links</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={form.facebookUrl ?? ''} onChange={(event) => setForm({ ...form, facebookUrl: event.target.value })} placeholder="Facebook URL" aria-label="Facebook URL" />
                <Input value={form.youtubeUrl ?? ''} onChange={(event) => setForm({ ...form, youtubeUrl: event.target.value })} placeholder="YouTube URL" aria-label="YouTube URL" />
                <Input value={form.telegramUrl ?? ''} onChange={(event) => setForm({ ...form, telegramUrl: event.target.value })} placeholder="Telegram URL" aria-label="Telegram URL" />
                <Input value={form.instagramUrl ?? ''} onChange={(event) => setForm({ ...form, instagramUrl: event.target.value })} placeholder="Instagram URL" aria-label="Instagram URL" />
                <Input value={form.websiteUrl ?? ''} onChange={(event) => setForm({ ...form, websiteUrl: event.target.value })} placeholder="Website URL" aria-label="Website URL" />
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-3xl border border-(--border) bg-(--surface)/50 p-4">
            <div className="grid gap-2">
              <Label htmlFor="ad-active">Active</Label>
              <div className="flex items-center gap-3">
                <Switch
                  id="ad-active"
                  checked={form.isActive}
                  onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
                />
                <span className="text-sm text-(--text-muted)">{form.isActive ? 'Visible in the app' : 'Hidden from users'}</span>
              </div>
            </div>
            <div className="flex items-center gap-3"><Switch checked={form.interstitialEnabled} onCheckedChange={(checked) => setForm({ ...form, interstitialEnabled: checked })} /><span className="text-sm text-(--text-muted)">{form.interstitialEnabled ? 'Interstitial enabled' : 'Interstitial disabled'}</span></div>
            <Button type="submit" isLoading={isLoading} disabled={!isFormValid || isLoading}>
              {editingId ? 'Update Advertisement' : 'Save Advertisement'}
            </Button>
            {editingId && (
              <Button
                type="button" variant="ghost" onClick={handleCancel}>
                Cancel Edit
              </Button>
            )}
          </div>
        </motion.form>
      </Card>
      </motion.div>

      {isLoadingAds ? (
        <motion.div className="grid gap-4 lg:grid-cols-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </motion.div>
      ) : isAdsError ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="border border-(--border) bg-red-500/10 p-6 text-center text-red-400">
          Unable to load advertisements. Please refresh and try again.
        </Card>
        </motion.div>
      ) : (
        <motion.div className="grid gap-4 lg:grid-cols-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.1 }}>
          {advertisements.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="border border-(--border) bg-red-500/10 p-6 text-center text-red-400">
            No advertisements created yet.
          </Card>
          </motion.div>
          ) : (
            advertisements.map((ad, index) => (
            <motion.div key={ad.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
            <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface) p-6\">
              <CardHeader className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">{ad.title}</CardTitle>
                  <p className={ad.isActive ? 'text-sm text-emerald-500' : 'text-sm text-(--text-muted)'}>{ad.isActive ? 'Active and visible' : 'Off for users'}</p>
                </div>
                <div className="flex gap-1">
                  <Switch checked={ad.isActive} onCheckedChange={() => void handleToggleActive(ad)} disabled={isUpdating} aria-label={ad.isActive ? 'Turn advertisement off' : 'Turn advertisement on'} />
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(ad)} aria-label="Edit advertisement">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeletingAd(ad)} aria-label="Delete advertisement">
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="wrap-break-word text-sm text-(--text-muted)">Link: <a className="text-(--accent) underline" href={ad.link} target="_blank" rel="noreferrer">{ad.link}</a></p>
                {ad.imageUrl && (
                  <img src={ad.imageUrl} alt={ad.title} className="max-h-56 w-full rounded-2xl border border-(--border) object-cover" onError={(event) => { event.currentTarget.style.display = 'none' }} />
                )}
                <Button asChild variant="outline" size="sm">
                  <a href={ad.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2">
                    View destination <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </CardContent>
            </Card>
            </motion.div>
            ))
          )}
        </motion.div>
      )}

      <AlertDialog open={!!deletingAd} onOpenChange={(isOpen) => !isOpen && setDeletingAd(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Advertisement?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the advertisement &quot;{deletingAd?.title}&quot;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}
