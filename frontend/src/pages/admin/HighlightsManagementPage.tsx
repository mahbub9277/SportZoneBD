import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Label } from '../../components/ui/Label'
import { useGetAdminHighlightsQuery, useCreateHighlightMutation, useDeleteHighlightMutation } from '../../features/admin/adminHighlights.api'
import { Skeleton } from '../../components/ui/Skeleton'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { useUploadFilesMutation } from '../../features/admin/uploads.api'
import type { Highlight } from '../../features/admin/adminHighlights.api'

const emptyHighlights: Highlight[] = []
const MAX_HIGHLIGHT_VIDEO_BYTES = 300 * 1024 * 1024

export function HighlightsManagementPage() {
  const highlightsQuery = useGetAdminHighlightsQuery({})
  const highlights = highlightsQuery.data?.items ?? emptyHighlights
  const { isLoading: isLoadingHighlights, isError: isHighlightsError } = highlightsQuery
  const [createHighlight, { isLoading: isCreating }] = useCreateHighlightMutation()
  const [deleteHighlight, { isLoading: isDeleting }] = useDeleteHighlightMutation()
  const [uploadFiles, { isLoading: isUploadingThumbnail }] = useUploadFilesMutation()

  const [selectedThumbnailFile, setSelectedThumbnailFile] = useState<File | null>(null)
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null)
  const [isUploadingVideo, setIsUploadingVideo] = useState(false)
  const selectedThumbnailPreviewUrl = useMemo(
    () => selectedThumbnailFile ? URL.createObjectURL(selectedThumbnailFile) : null,
    [selectedThumbnailFile],
  )

  const [form, setForm] = useState({
    title: '',
    url: '',
    thumbnail: '',
    duration: '',
    category: '',
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleThumbnailUpload = async (file: File) => {
    if (!file) return

    try {
      const result = await uploadFiles({ files: [file], folder: 'sportzone/highlights' }).unwrap()
      const uploadedUrl = result.uploads[0]?.url

      if (!uploadedUrl) {
        throw new Error('Upload succeeded but the highlight image URL was not returned.')
      }

      setForm((prev) => ({ ...prev, thumbnail: uploadedUrl }))
      setSelectedThumbnailFile(null)
      toast.success('Highlight thumbnail uploaded successfully.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Thumbnail upload failed.')
    }
  }

  const handleVideoUpload = async (file: File) => {
    if (!file) return
    if (file.size > MAX_HIGHLIGHT_VIDEO_BYTES) {
      toast.error('Highlight videos must be 300 MB or smaller.')
      setSelectedVideoFile(null)
      return
    }
    setIsUploadingVideo(true)
    try {
      const result = await uploadFiles({ files: [file], folder: 'sportzone/highlights', mediaType: 'VIDEO' }).unwrap()
      const uploadedUrl = result.uploads[0]?.url
      if (!uploadedUrl) throw new Error('Upload succeeded but the highlight video URL was not returned.')
      setForm((prev) => ({ ...prev, url: uploadedUrl }))
      setSelectedVideoFile(null)
      toast.success('Highlight video uploaded successfully.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Video upload failed.')
    } finally {
      setIsUploadingVideo(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!window.confirm(`Create the highlight "${form.title || 'Untitled highlight'}"?`)) {
      return
    }

    try {
      await createHighlight({
        ...form,
        thumbnail: form.thumbnail || null,
        duration: form.duration || null,
        category: form.category || null,
      }).unwrap()
      toast.success('New highlight created!')
      setForm({ title: '', url: '', thumbnail: '', duration: '', category: '' })
      setSelectedThumbnailFile(null)
      setSelectedVideoFile(null)
    } catch {
      toast.error('Failed to create highlight.')
    }
  }

  const handleDelete = async (id: string, title: string) => {
    const confirmed = window.confirm(`Delete the highlight "${title}"? This action cannot be undone.`)

    if (!confirmed) {
      return
    }

    try {
      await deleteHighlight(id).unwrap()
      toast.success('Highlight has been deleted.')
    } catch {
      toast.error('Failed to delete highlight.')
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-brand-border bg-brand-surface/50 p-6 shadow-xl">
        <CardHeader>
          <CardTitle className="text-2xl text-brand-text-primary">Create Highlight</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" value={form.title} onChange={handleInputChange} placeholder="e.g., Amazing Goal by..." required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="video-upload">Highlight video</Label>
              <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/60 p-3">
                <Input
                  id="video-upload"
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
                  disabled={isUploadingVideo}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null
                    setSelectedVideoFile(file)
                    event.currentTarget.value = ''
                  }}
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!selectedVideoFile || isUploadingVideo}
                    isLoading={isUploadingVideo}
                    onClick={() => {
                      if (selectedVideoFile) {
                        void handleVideoUpload(selectedVideoFile)
                      }
                    }}
                  >
                    {isUploadingVideo ? 'Uploading...' : 'Upload video'}
                  </Button>
                  {selectedVideoFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedVideoFile(null)}
                      disabled={isUploadingVideo}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-xs text-text-muted">Choose a video file first, then click Upload video.</p>
                {selectedVideoFile && <p className="mt-1 truncate text-xs text-accent">Selected: {selectedVideoFile.name}</p>}
              </div>
              <Input id="url" name="url" type="url" value={form.url} onChange={handleInputChange} placeholder="https://youtube.com/watch?v=..." required={!isUploadingVideo} />
              {form.url && <p className="truncate text-xs text-success">Video source ready.</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="thumbnail-upload">Highlight thumbnail</Label>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  id="thumbnail-upload"
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null
                    setSelectedThumbnailFile(file)
                    event.currentTarget.value = ''
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!selectedThumbnailFile || isUploadingThumbnail}
                    isLoading={isUploadingThumbnail}
                    onClick={() => {
                      if (selectedThumbnailFile) {
                        void handleThumbnailUpload(selectedThumbnailFile)
                      }
                    }}
                  >
                    {isUploadingThumbnail ? 'Uploading...' : 'Upload image'}
                  </Button>
                  {selectedThumbnailFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedThumbnailFile(null)}
                      disabled={isUploadingThumbnail}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
              {(selectedThumbnailPreviewUrl || form.thumbnail) && (
                <div className="mt-3 overflow-hidden rounded-2xl border border-(--border) bg-(--surface-soft) p-3">
                  <img
                    src={selectedThumbnailPreviewUrl || buildCloudinaryUrl(form.thumbnail, { width: 480, height: 240, crop: 'fill', quality: 'auto', format: 'auto' })}
                    alt="Highlight thumbnail preview"
                    className="h-32 w-full rounded-xl object-cover"
                  />
                </div>
              )}
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={isCreating || isUploadingThumbnail}>{isCreating ? 'Creating...' : 'Create Highlight'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-brand-border bg-brand-surface/50 p-6 shadow-xl">
        <CardHeader>
          <CardTitle className="text-xl text-brand-text-primary">Existing Highlights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoadingHighlights ? <Skeleton className="h-20 w-full" /> : isHighlightsError ? (
            <p className="text-sm text-red-400">Unable to load highlights. Please refresh and try again.</p>
          ) : highlights.length === 0 ? (
            <p className="text-sm text-muted-foreground">No highlights created yet.</p>
          ) : (
            highlights.map((highlight) => (
              <div key={highlight.id} className="flex min-w-0 flex-col items-stretch justify-between gap-3 rounded-2xl border border-brand-border bg-brand-surface-soft/70 p-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  {highlight.thumbnail ? (
                    <img
                      src={buildCloudinaryUrl(highlight.thumbnail, { width: 96, height: 64, crop: 'fill', quality: 'auto', format: 'auto' })}
                      alt={highlight.title}
                      className="h-16 w-24 rounded-xl object-cover border border-border bg-surface-soft"
                    />
                  ) : (
                    <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-dashed border-border bg-surface-soft text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                      Clip
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="min-w-0 wrap-break-word font-semibold text-brand-text-primary">{highlight.title}</p>
                    <p className="text-xs text-text-muted">{highlight.category || 'General highlight'}</p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(highlight.id, highlight.title)}
                  disabled={isDeleting}
                >
                  Delete
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}