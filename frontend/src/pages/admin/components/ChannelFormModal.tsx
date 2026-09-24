import { useState, useEffect } from 'react'
import { ImagePlus, LayoutList, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useCreateChannelMutation, useUpdateChannelMutation } from '../../../features/admin/channels.api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/Dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../../components/ui/Form'
import { Input } from '../../../components/ui/Input'
import { Button } from '../../../components/ui/Button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/Select'
import { Switch } from '../../../components/ui/Switch'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import type { Channel, ChannelCategory } from '../../../shared/types'
import type { MediaAsset } from '../../../features/events/events.api'
import { MediaLibraryModal } from './MediaLibraryModal'
const channelSchema = z.object({
  name: z.string().min(2),
  logo: z.any().optional(),
  url: z.string().url(),
  viewers: z.coerce.number().int().nonnegative().default(1280),
  categoryId: z.string().uuid(),
  isPremium: z.boolean(),
  status: z.string(),
})

interface ChannelFormModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onSuccess: () => void
  editingChannel: Channel | null
  categories: ChannelCategory[]
}

export function ChannelFormModal({ isOpen, onOpenChange, onSuccess, editingChannel, categories }: ChannelFormModalProps) {
  const [createChannel, { isLoading: isCreating }] = useCreateChannelMutation()
  const [updateChannel, { isLoading: isUpdating }] = useUpdateChannelMutation()
  const [uploadedLogoPreviewUrl, setUploadedLogoPreviewUrl] = useState<string | null>(null)
  const [isMediaLibraryOpen, setIsMediaLibraryOpen] = useState(false)

  const isMutating = isCreating || isUpdating
  const defaultValues = {
    name: editingChannel?.name ?? '',
    logo: undefined,
    url: editingChannel?.url ?? '',
    viewers: editingChannel?.viewers ?? 1280,
    categoryId: editingChannel?.categoryId ?? '',
    isPremium: editingChannel?.isPremium ?? false,
    status: editingChannel?.status ?? 'active',
  }

  const form = useForm({
    resolver: zodResolver(channelSchema),
    defaultValues,
  })

  const logoPreviewUrl = uploadedLogoPreviewUrl ?? editingChannel?.logo ?? null

  useEffect(() => {
    if (!isOpen) return

    form.reset({
      name: editingChannel?.name ?? '',
      logo: undefined,
      url: editingChannel?.url ?? '',
      viewers: editingChannel?.viewers ?? 1280,
      categoryId: editingChannel?.categoryId ?? '',
      isPremium: editingChannel?.isPremium ?? false,
      status: editingChannel?.status ?? 'active',
    })
  }, [editingChannel, form, isOpen])

  useEffect(() => {
    return () => {
      if (uploadedLogoPreviewUrl && uploadedLogoPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(uploadedLogoPreviewUrl)
      }
    }
  }, [uploadedLogoPreviewUrl])

  const handleOpenChange = (nextIsOpen: boolean) => {
    onOpenChange(nextIsOpen)

    if (!nextIsOpen) {
      setUploadedLogoPreviewUrl(null)
    }
  }

  const onSubmit = async (values: z.infer<typeof channelSchema>) => {
    const formData = new FormData()
    Object.entries(values).forEach(([key, value]) => {
      if (key === 'logo' && value instanceof FileList && value.length > 0) {
        formData.append('logo', value[0])
      } else if (key === 'logo' && typeof value === 'string' && value) {
        formData.append('logo', value)
      } else if (key !== 'logo' && value !== null && value !== undefined) {
        formData.append(key, String(value))
      }
    })

    const promise = editingChannel
      ? updateChannel({ id: editingChannel.id, formData }).unwrap()
      : createChannel(formData).unwrap()

    await toast.promise(promise, {
      loading: editingChannel ? 'Updating channel...' : 'Creating channel...',
      success: () => {
        onSuccess()
        return `Channel ${editingChannel ? 'updated' : 'created'}!`
      },
      error: `Failed to ${editingChannel ? 'update' : 'create'} channel.`,
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-2xl min-w-0 max-h-[calc(100dvh-1rem)] overflow-y-auto overflow-x-hidden sm:w-[calc(100%-2rem)]" onPointerDownOutside={(event) => { if ((event.target as HTMLElement).closest('[data-media-library-modal]')) event.preventDefault() }} onInteractOutside={(event) => { if ((event.target as HTMLElement).closest('[data-media-library-modal]')) event.preventDefault() }}>
        <DialogHeader>
          <DialogTitle>{editingChannel ? 'Edit Channel' : 'Add New Channel'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="min-w-0 space-y-6">
            <FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="min-h-11" /></FormControl><FormMessage /></FormItem>} />
            <FormField control={form.control} name="logo" render={({ field: { onChange } }) => (
              <FormItem>
                <FormLabel>Channel logo</FormLabel>
                <FormControl>
                  <div className="rounded-2xl border border-border bg-surface-soft/60 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface">
                        {logoPreviewUrl ? <img src={logoPreviewUrl.startsWith('blob:') ? logoPreviewUrl : buildCloudinaryUrl(logoPreviewUrl, { width: 128, height: 128, crop: 'fill' })} alt="Channel logo preview" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6 text-text-muted" />}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setIsMediaLibraryOpen(true)}><LayoutList className="mr-1 h-4 w-4" />Choose from library</Button>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text-primary hover:border-accent/50 hover:text-accent">
                          <ImagePlus className="h-4 w-4" />Upload logo
                          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setUploadedLogoPreviewUrl(URL.createObjectURL(file)); onChange(event.target.files) } event.currentTarget.value = '' }} />
                        </label>
                        {logoPreviewUrl && <Button type="button" variant="ghost" size="icon" onClick={() => { setUploadedLogoPreviewUrl(null); onChange(undefined) }} aria-label="Remove channel logo"><X className="h-4 w-4" /></Button>}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-text-muted">Choose a square PNG, JPG, or WebP logo.</p>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="url" render={({ field }) => <FormItem className="min-w-0"><FormLabel>Stream URL</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="min-h-11 min-w-0" /></FormControl><FormMessage /></FormItem>} />
            <FormField control={form.control} name="categoryId" render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <FormControl>
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
                    <SelectContent>
                      {categories.map(cat => <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex flex-col gap-4 rounded-3xl border border-border bg-surface-soft/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <FormField control={form.control} name="isPremium" render={({ field }) => (<FormItem className="flex items-center gap-2 space-y-0"><FormControl><Switch checked={field.value ?? false} onCheckedChange={(checked) => field.onChange(checked)} /></FormControl><FormLabel>Premium</FormLabel></FormItem>)} />
              <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Select value={field.value ?? 'active'} onValueChange={field.onChange}>
                    <SelectTrigger className="w-32"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </FormControl>
              </FormItem>
            )} />
            </div>
            <Button type="submit" disabled={isMutating} className="min-h-11 w-full sm:w-auto">{isMutating ? (editingChannel ? 'Updating...' : 'Creating...') : (editingChannel ? 'Update Channel' : 'Create Channel')}</Button>
          </form>
        </Form>
      </DialogContent>
      {isMediaLibraryOpen && <MediaLibraryModal mediaType="LOGO" onCancel={() => setIsMediaLibraryOpen(false)} onConfirm={(media: MediaAsset) => { form.setValue('logo', media.url, { shouldDirty: true }); setUploadedLogoPreviewUrl(media.url); setIsMediaLibraryOpen(false) }} />}
    </Dialog>
  )
}