import { useEffect, useState } from 'react'
import { ImagePlus, LayoutList, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useCreateCategoryMutation, useUpdateCategoryMutation } from '../../../features/admin/channels.api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/Dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../../components/ui/Form'
import { Input } from '../../../components/ui/Input'
import { Button } from '../../../components/ui/Button'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import type { ChannelCategory } from '../../../shared/types'
import type { MediaAsset } from '../../../features/events/events.api'
import { MediaLibraryModal } from './MediaLibraryModal'
import { DescriptionGenerator } from '../../../components/ai/DescriptionGenerator'

const categorySchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.'),
  description: z.string().optional(),
  image: z.any().optional(),
})

interface CategoryFormModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onSuccess: () => void
  editingCategory?: ChannelCategory | null
}

export function CategoryFormModal({ isOpen, onOpenChange, onSuccess, editingCategory = null }: CategoryFormModalProps) {
  const [createCategory, { isLoading: isCreating }] = useCreateCategoryMutation()
  const [updateCategory, { isLoading: isUpdating }] = useUpdateCategoryMutation()
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [isMediaLibraryOpen, setIsMediaLibraryOpen] = useState(false)

  const form = useForm({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '', description: '', image: undefined },
  })

  useEffect(() => {
    if (editingCategory) {
      form.reset({
        name: editingCategory.name ?? '',
        description: editingCategory.description ?? '',
        image: undefined,
      })
      setImagePreviewUrl(editingCategory.image ?? null)
      return
    }

    form.reset({ name: '', description: '', image: undefined })
    setImagePreviewUrl(null)
  }, [editingCategory, form, isOpen])

  useEffect(() => {
    return () => {
      if (imagePreviewUrl && imagePreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreviewUrl)
      }
    }
  }, [imagePreviewUrl])

  const onSubmit = async (values: z.infer<typeof categorySchema>) => {
    const formData = new FormData()
    formData.append('name', values.name)

    if (values.description) {
      formData.append('description', values.description)
    }

    if (values.image instanceof FileList && values.image.length > 0) {
      formData.append('image', values.image[0])
    } else if (typeof values.image === 'string' && values.image) {
      formData.append('image', values.image)
    }

    const promise = editingCategory
      ? updateCategory({ id: editingCategory.id, formData }).unwrap()
      : createCategory(formData).unwrap()

    await toast.promise(promise, {
      loading: editingCategory ? 'Updating category...' : 'Creating category...',
      success: () => {
        form.reset()
        setImagePreviewUrl(null)
        onSuccess()
        return `Category ${editingCategory ? 'updated' : 'created'}!`
      },
      error: `Failed to ${editingCategory ? 'update' : 'create'} category.`,
    })
  }

  const isMutating = isCreating || isUpdating

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-2xl min-w-0 max-h-[calc(100dvh-1rem)] overflow-y-auto overflow-x-hidden sm:w-[calc(100%-2rem)]" onPointerDownOutside={(event) => { if ((event.target as HTMLElement).closest('[data-media-library-modal]')) event.preventDefault() }} onInteractOutside={(event) => { if ((event.target as HTMLElement).closest('[data-media-library-modal]')) event.preventDefault() }}>
        <DialogHeader><DialogTitle>{editingCategory ? 'Edit Category' : 'Add New Category'}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="min-w-0 space-y-6">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ''} className="min-h-11" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-3"><FormLabel>Description</FormLabel><DescriptionGenerator entityType="CATEGORY" title={form.watch('name')} currentDescription={field.value ?? ''} context={{}} onGenerated={field.onChange} /></div>
                <FormControl><Input {...field} value={field.value ?? ''} className="min-h-11" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="image" render={({ field: { onChange } }) => (
              <FormItem>
                <FormControl>
                  <div className="rounded-2xl border border-border bg-surface-soft/60 p-4 shadow-sm">
                    <FormLabel>Category image</FormLabel>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface">
                        {imagePreviewUrl ? <img src={imagePreviewUrl.startsWith('blob:') ? imagePreviewUrl : buildCloudinaryUrl(imagePreviewUrl, { width: 160, height: 160, crop: 'fill' })} alt="Category preview" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6 text-text-muted" />}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setIsMediaLibraryOpen(true)}><LayoutList className="mr-1 h-4 w-4" />Choose from library</Button>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text-primary hover:border-accent/50 hover:text-accent"><ImagePlus className="h-4 w-4" />Upload image<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setImagePreviewUrl(URL.createObjectURL(file)); onChange(event.target.files) } event.currentTarget.value = '' }} /></label>
                        {imagePreviewUrl && <Button type="button" variant="ghost" size="icon" onClick={() => { setImagePreviewUrl(null); onChange(undefined) }} aria-label="Remove category image"><X className="h-4 w-4" /></Button>}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-text-muted">Choose a square PNG, JPG, or WebP image.</p>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" disabled={isMutating} className="min-h-11 w-full sm:w-auto">{isMutating ? (editingCategory ? 'Updating...' : 'Creating...') : (editingCategory ? 'Update Category' : 'Create Category')}</Button>
          </form>
        </Form>
      </DialogContent>
      {isMediaLibraryOpen && <MediaLibraryModal mediaType="LOGO" onCancel={() => setIsMediaLibraryOpen(false)} onConfirm={(media: MediaAsset) => { form.setValue('image', media.url, { shouldDirty: true }); setImagePreviewUrl(media.url); setIsMediaLibraryOpen(false) }} />}
    </Dialog>
  )
}