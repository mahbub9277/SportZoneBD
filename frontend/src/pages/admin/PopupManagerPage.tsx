import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { PlusCircle, Trash2, Edit, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Label } from '../../components/ui/Label'
import { Textarea } from '../../components/ui/Textarea'
import { Switch } from '../../components/ui/Switch'
import { useGetPopupsQuery, useCreatePopupMutation, useUpdatePopupMutation, useDeletePopupMutation, type Popup } from '../../features/admin/popups.api.ts'
import { getErrorMessage } from '../../utils/get-error-message'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { Skeleton } from '../../components/ui/Skeleton'
import { useUploadFilesMutation } from '../../features/admin/uploads.api'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/AlertDialog'
import { DescriptionGenerator } from '../../components/ai/DescriptionGenerator'

const emptyPopup = { title: '', message: '', isActive: true, imageUrl: '', link: '' }

export default function PopupManagerPage() {
  const [form, setForm] = useState<Omit<Popup, 'id' | 'createdAt'>>(emptyPopup)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null)
  const selectedImagePreviewUrl = useMemo(
    () => selectedImageFile ? URL.createObjectURL(selectedImageFile) : null,
    [selectedImageFile],
  )
  const [uploadedImagePreviewUrl, setUploadedImagePreviewUrl] = useState<string | null>(null)
  const [imageUploadedAt, setImageUploadedAt] = useState<string | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)

  const { data: popups = [], isLoading: isLoadingPopups } = useGetPopupsQuery()
  const [createPopup, { isLoading: isCreating }] = useCreatePopupMutation()
  const [updatePopup, { isLoading: isUpdating }] = useUpdatePopupMutation()
  const [deletePopup] = useDeletePopupMutation()
  const [uploadFiles] = useUploadFilesMutation()

  const isLoading = isCreating || isUpdating
  const isFormValid = Boolean(form.title.trim() && form.message.trim())
  const previewImageUrl = selectedImagePreviewUrl || uploadedImagePreviewUrl || (form.imageUrl ? buildCloudinaryUrl(form.imageUrl) : null)

  const clearPopupImage = () => {
    setSelectedImageFile(null)
    setUploadedImagePreviewUrl(null)
    setImageUploadedAt(null)
    setForm((current) => ({ ...current, imageUrl: '' }))
  }

  const normalizePopupPayload = (payload: typeof form) => ({
    ...payload,
    title: payload.title.trim(),
    message: payload.message.trim(),
    imageUrl: payload.imageUrl?.trim() ? payload.imageUrl.trim() : null,
    link: payload.link?.trim() ? payload.link.trim() : null,
  })

  const handleUploadImage = async () => {
    if (!selectedImageFile) {
      toast.error('Select an image file first.')
      return
    }

    setIsUploadingImage(true)

    try {
      const result = await uploadFiles({ files: [selectedImageFile], folder: 'sportzone/popups' }).unwrap()
      const uploadedFile = result.uploads[0]
      const deliveryUrl = uploadedFile?.url

      if (!uploadedFile?.publicId || !deliveryUrl) {
        throw new Error('Upload succeeded but returned incomplete image data.')
      }

      setForm((current) => ({ ...current, imageUrl: deliveryUrl }))
      setUploadedImagePreviewUrl(deliveryUrl)
      setImageUploadedAt(new Date().toLocaleString())
      setSelectedImageFile(null)
      toast.success('Image uploaded and attached to popup.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Image upload failed.')
    } finally {
      setIsUploadingImage(false)
    }
  }

  useEffect(() => {
    return () => {
      if (selectedImagePreviewUrl) URL.revokeObjectURL(selectedImagePreviewUrl)
    }
  }, [selectedImagePreviewUrl])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const payload = normalizePopupPayload(form)
    if (!payload.title || !payload.message) return

    const promise = editingId
      ? updatePopup({ id: editingId, ...payload }).unwrap()
      : createPopup(payload).unwrap()

    toast.promise(promise, {
      loading: editingId ? 'Updating popup...' : 'Creating popup...',
      success: (data) => {
        setForm(emptyPopup)
        setEditingId(null)
        setSelectedImageFile(null)
        setUploadedImagePreviewUrl(null)
        setImageUploadedAt(null)
        return `Popup "${data.title}" ${editingId ? 'updated' : 'created'} successfully!`
      },
      error: (err) => getErrorMessage(err)
    })
  }

  const handleDelete = (id: string) => {
    setDeletingId(id)
  }

  const handleDeleteConfirm = () => {
    if (!deletingId) return
    toast.promise(deletePopup(deletingId).unwrap(), {
      loading: 'Deleting popup...',
      success: () => {
        setDeletingId(null)
        return 'Popup deleted successfully.'
      },
      error: (err) => getErrorMessage(err),
    })
  }

  const handleEdit = (popup: Popup) => {
    setEditingId(popup.id)
    setForm({
      title: popup.title,
      message: popup.message,
      isActive: popup.isActive,
      imageUrl: popup.imageUrl ?? '',
      link: popup.link ?? '',
    })
    setSelectedImageFile(null)
    setUploadedImagePreviewUrl(popup.imageUrl ? buildCloudinaryUrl(popup.imageUrl) : null)
    setImageUploadedAt(null)
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}>
          <div className="flex items-center gap-3">
            <motion.div className="p-2 bg-linear-to-br from-indigo-500 to-indigo-600 rounded-lg" whileHover={{ scale: 1.1 }}>
            <UploadCloud className="h-5 w-5 text-white" />
            </motion.div>
            <div>
          <h1 className="text-3xl font-semibold text-(--text-primary)">Popup Manager</h1>
          <p className="mt-1 text-(--text-muted)">Create and manage popup messages for the application.</p>
            </div>
          </div>
        </motion.div>
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
        <Button onClick={() => {
          setForm(emptyPopup)
          setEditingId(null)
          setSelectedImageFile(null)
          setUploadedImagePreviewUrl(null)
          setImageUploadedAt(null)
        }} variant="outline" className="gap-2">
          <PlusCircle className="h-4 w-4" /> New popup
        </Button>
        </motion.div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
      <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)] p-6">
        <motion.form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.1, delayChildren: 0.2 }}>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="popup-title">Popup title</Label>
              <Input
                id="popup-title"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Update available"
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3"><Label htmlFor="popup-message">Message</Label><DescriptionGenerator entityType="POPUP" title={form.title} currentDescription={form.message} context={{ isActive: form.isActive, link: form.link, hasImage: Boolean(form.imageUrl) }} onGenerated={(message) => setForm((previous) => ({ ...previous, message }))} /></div>
              <Textarea
                id="popup-message"
                rows={4}
                value={form.message}
                onChange={(event) => setForm({ ...form, message: event.target.value })}
                placeholder="Your subscription has been renewed successfully."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="popup-image-file">Popup image (Optional)</Label>
              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  id="popup-image-file"
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  onChange={(event) => {
                    setSelectedImageFile(event.target.files?.[0] ?? null)
                    setUploadedImagePreviewUrl(null)
                    setImageUploadedAt(null)
                  }}
                />
                <Button
                  type="button"
                  onClick={handleUploadImage}
                  disabled={!selectedImageFile || isUploadingImage}
                  isLoading={isUploadingImage}
                  className="gap-2 whitespace-nowrap"
                >
                  <UploadCloud className="h-4 w-4" />
                  {isUploadingImage ? 'Uploading...' : 'Upload image'}
                </Button>
              </div>
              {(selectedImagePreviewUrl || form.imageUrl) && (
                <div className="rounded-2xl border border-(--border) bg-(--surface)/80 p-3">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-(--text-primary)">Image preview</p>
                    <Button type="button" variant="ghost" size="sm" onClick={clearPopupImage}>
                      Remove image
                    </Button>
                  </div>
                  {selectedImagePreviewUrl ? (
                    <img src={selectedImagePreviewUrl} alt="Selected preview" className="mt-2 h-32 w-full rounded-xl object-cover" />
                  ) : (
                    <>
                      {uploadedImagePreviewUrl && imageUploadedAt && (
                        <p className="text-sm text-(--text-muted)">Uploaded at {imageUploadedAt}</p>
                      )}
                      <img src={uploadedImagePreviewUrl ?? buildCloudinaryUrl(form.imageUrl)} alt="Popup image preview" className="mt-2 h-32 w-full rounded-xl object-cover" />
                    </>
                  )}
                </div>
              )}

              <div className="rounded-3xl border border-(--border) bg-(--surface-soft)/80 p-4 shadow-sm">
                <p className="text-sm font-semibold text-(--text-primary)">Live popup preview</p>
                <div className="mt-3 space-y-3">
                  <div className="rounded-3xl border border-(--border) bg-(--surface) p-4 shadow-inner">
                    {previewImageUrl ? (
                      <img src={previewImageUrl} alt="Preview" className="mb-3 h-40 w-full rounded-2xl object-cover" />
                    ) : (
                      <div className="mb-3 flex h-40 items-center justify-center rounded-2xl border border-dashed border-(--border) bg-(--surface)/90 text-sm text-(--text-muted)">No image selected</div>
                    )}
                    <div className="space-y-1">
                      <p className="wrap-break-word text-lg font-semibold text-(--text-primary)">{form.title || 'Popup title'}</p>
                      <p className="text-sm text-(--text-muted)">{form.message || 'Popup message will appear here.'}</p>
                      {form.link && (
                        <a href={form.link} target="_blank" rel="noreferrer" className="inline-flex rounded-full bg-brand-primary/10 px-3 py-1 text-xs font-medium text-brand-primary hover:bg-brand-primary/15">
                          Open link
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="popup-link">Link URL (Optional)</Label>
              <Input
                id="popup-link"
                value={form.link ?? ''}
                onChange={(event) => setForm({ ...form, link: event.target.value })}
                placeholder="https://example.com/more-info"
              />
            </div>
          </div>
          <div className="space-y-4 rounded-3xl border border-(--border) bg-(--surface)/50 p-4">
            <div className="grid gap-2">
              <Label htmlFor="popup-active">Active</Label>
              <div className="flex items-center gap-3">
                <Switch id="popup-active" checked={form.isActive} onCheckedChange={(checked) => setForm({ ...form, isActive: checked })} />
                <span className="text-sm text-(--text-muted)">{form.isActive ? 'Popup will show to users' : 'Popup is disabled'}</span>
              </div>
            </div>
            <Button type="submit" className="w-full" isLoading={isLoading} disabled={!isFormValid || isLoading}>
              {editingId ? 'Update Popup' : 'Save Popup'}
            </Button>
            {editingId && (
              <Button type="button" variant="ghost" className="w-full" onClick={() => {
                setEditingId(null)
                setForm(emptyPopup)
              }}>
                Cancel Edit
              </Button>
            )}
          </div>
        </motion.form>
      </Card>
      </motion.div>

      {isLoadingPopups ? (
        <motion.div className="grid gap-4 lg:grid-cols-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </motion.div>
      ) : popups.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="border border-(--border) bg-red-500/10 p-6 text-center text-red-400\">
          No popups have been configured yet. Add a popup to manage platform announcements.
        </Card>
        </motion.div>
      ) : (
        <motion.div className="grid gap-4 lg:grid-cols-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.1 }}>
          {popups.map((popup, index) => (
            <motion.div key={popup.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
            <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface) p-0\">
              <CardHeader className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>{popup.title}</CardTitle>
                  <p className="text-sm text-(--text-muted)">{popup.isActive ? 'Active' : 'Inactive'}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(popup)} aria-label="Edit popup">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(popup.id)} aria-label="Delete popup">
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-(--text-muted)">{popup.message}</p>
                {popup.imageUrl && <img src={buildCloudinaryUrl(popup.imageUrl)} alt={popup.title} className="h-32 w-full rounded-lg object-cover" />}
              </CardContent>
            </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      <AlertDialog open={!!deletingId} onOpenChange={(isOpen) => !isOpen && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete the popup. This cannot be undone.
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
