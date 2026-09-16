import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Radio, Edit, Trash2, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { useGetAdminStreamsQuery, useCreateStreamMutation, useUpdateStreamMutation, useDeleteStreamMutation } from '../../features/admin/adminStreams.api'
import { useGetMatchesQuery } from '../../features/matches/matches.api'
import { Skeleton } from '../../components/ui/Skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '../../components/ui/Dialog'
import { StreamForm, type StreamFormValues } from './components/StreamForm'
import type { Stream } from '../../features/admin/adminStreams.api'
import { zodResolver } from '@hookform/resolvers/zod'
import { useUploadFilesMutation } from '../../features/admin/uploads.api'
import { useGetAdminChannelsQuery, useUpdateChannelMutation } from '../../features/admin/channels.api'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/AlertDialog'

const streamSchema = z.object({
  name: z.string().trim().min(2, 'Channel name is required.').max(80),
  logo: z.string().url('Logo must be a valid URL.').optional().or(z.literal('')),
  primaryUrl: z.string().url('Please enter a valid URL.'),
  backupUrl: z.string().url('Please enter a valid URL.').optional().or(z.literal('')),
  matchId: z.string().min(1, 'You must select a match.').uuid('Invalid match ID format.'),
  enabled: z.boolean(),
  quality: z.string().min(1, 'Quality is required.'),
  status: z.enum(['READY', 'LIVE', 'OFFLINE', 'ERROR']),
  sourceType: z.enum(['DIRECT_URL', 'CHANNEL']),
  channelId: z.string().optional(),
})

export function StreamsManagementPage() {
  const streamsQuery = useGetAdminStreamsQuery({})
  const matchesQuery = useGetMatchesQuery({})
  const { data, isLoading: isLoadingStreams, isError: isStreamsError } = streamsQuery
  const { data: matchesData, isError: isMatchesError } = matchesQuery
  const [createStream, { isLoading: isCreating }] = useCreateStreamMutation()
  const [updateStream, { isLoading: isUpdating }] = useUpdateStreamMutation()
  const [deleteStream, { isLoading: isDeleting }] = useDeleteStreamMutation()
  const [uploadFiles, { isLoading: isUploadingLogo }] = useUploadFilesMutation()
  const { data: channels = [] } = useGetAdminChannelsQuery()
  const [updateChannel] = useUpdateChannelMutation()

  const [editingStream, setEditingStream] = useState<Stream | null>(null)
  const [deletingStream, setDeletingStream] = useState<Stream | null>(null)

  const form = useForm<StreamFormValues>({
    resolver: zodResolver(streamSchema),
    defaultValues: {
      name: 'Main stream',
      logo: '',
      primaryUrl: '',
      backupUrl: '',
      matchId: '',
      enabled: true,
      quality: '1080p',
      status: 'READY',
      sourceType: 'DIRECT_URL',
      channelId: '',
    },
  })

  const streams = data?.items ?? [];
  const matches = matchesData?.items ?? [];

  const handleEditClick = (stream: Stream) => {
    setEditingStream(stream)
    form.reset({
      name: stream.name || 'Main stream',
      logo: stream.logo || '',
      primaryUrl: stream.primaryUrl,
      backupUrl: stream.backupUrl || '',
      matchId: stream.matchId,
      enabled: stream.enabled,
      quality: stream.quality,
      status: stream.status as StreamFormValues['status'],
      sourceType: stream.sourceType ?? 'DIRECT_URL',
      channelId: stream.channelId ?? '',
    })
  }

  const handleFormSubmit = async (values: StreamFormValues) => {
    try {
      const normalizedValues: StreamFormValues = {
        ...values,
        channelId: values.sourceType === 'CHANNEL' && values.channelId?.trim()
          ? values.channelId.trim()
          : undefined,
      }

      if (normalizedValues.sourceType === 'CHANNEL' && normalizedValues.channelId) {
        const channelFormData = new FormData()
        channelFormData.append('url', normalizedValues.primaryUrl)
        await updateChannel({ id: normalizedValues.channelId, formData: channelFormData }).unwrap()
      }
      if (editingStream) {
        await updateStream({ id: editingStream.id, ...normalizedValues }).unwrap()
        toast.success('Stream updated successfully!')
        setEditingStream(null)
      } else {
        await createStream(normalizedValues).unwrap()
        toast.success('New stream created!')
        form.reset()
      }
    } catch {
      toast.error(`Failed to ${editingStream ? 'update' : 'create'} stream.`)
    }
  }

  const handleLogoUpload = async (file: File) => {
    try {
      const result = await uploadFiles({ files: [file], folder: 'sportzone/stream-logos' }).unwrap()
      const uploadedUrl = result.uploads[0]?.url
      if (!uploadedUrl) throw new Error('Cloudinary did not return a logo URL.')
      form.setValue('logo', uploadedUrl, { shouldDirty: true, shouldValidate: true })
      toast.success('Stream logo uploaded.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Stream logo upload failed.')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteStream(id).unwrap()
      setDeletingStream(null)
      toast.success('Stream deleted.')
    } catch {
      toast.error('Failed to delete stream.')
    }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      {/* Create Stream Form */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }}>
        <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)] p-0" id="create-stream">
          <CardHeader>
            <motion.div className="flex items-center gap-3" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15, duration: 0.4 }}>
              <motion.div className="p-2 bg-linear-to-br from-purple-500 to-purple-600 rounded-lg" whileHover={{ scale: 1.1 }}>
                <Radio className="h-5 w-5 text-white" />
              </motion.div>
              <CardTitle className="text-2xl text-brand-text-primary">Create Stream</CardTitle>
            </motion.div>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            <StreamForm form={form} onSubmit={handleFormSubmit} isLoading={isCreating} matches={matches} channels={channels} onLogoUpload={handleLogoUpload} isUploadingLogo={isUploadingLogo} />
            {isMatchesError && <motion.p className="mt-3 text-sm text-red-400" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Unable to load matches. Stream creation is unavailable.</motion.p>}
          </CardContent>
        </Card>
      </motion.div>
      
      <Dialog open={!!editingStream} onOpenChange={(isOpen) => !isOpen && setEditingStream(null)}>
        <DialogContent className="bg-linear-to-br from-(--surface-soft) to-(--surface)">
          <DialogHeader>
            <DialogTitle className="text-brand-text-primary">Edit Stream</DialogTitle>
            <DialogDescription>Update the details for this stream.</DialogDescription>
          </DialogHeader>
          <StreamForm form={form} onSubmit={handleFormSubmit} isLoading={isUpdating} matches={matches} channels={channels} onLogoUpload={handleLogoUpload} isUploadingLogo={isUploadingLogo} />
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Existing Streams */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.4 }}>
        <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)] p-0">
          <CardHeader>
            <motion.div className="flex items-center gap-3" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25, duration: 0.4 }}>
              <motion.div className="p-2 bg-linear-to-br from-blue-500 to-blue-600 rounded-lg" whileHover={{ scale: 1.1 }}>
                <Zap className="h-5 w-5 text-white" />
              </motion.div>
              <CardTitle className="text-xl text-brand-text-primary">Existing Streams</CardTitle>
            </motion.div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoadingStreams ? (
              <Skeleton className="h-20 w-full" />
            ) : isStreamsError ? (
              <motion.p className="text-sm text-red-400" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Unable to load streams. Please refresh and try again.</motion.p>
            ) : streams.length === 0 ? (
              <motion.p className="text-sm text-brand-text-muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>No streams configured yet.</motion.p>
            ) : (
              <motion.div className="space-y-3">
                {streams.map((stream, idx) => (
                  <motion.div
                    key={stream.id}
                    className="flex min-w-0 flex-col items-stretch justify-between gap-4 rounded-2xl border border-(--border) bg-linear-to-r from-(--surface-soft)/50 to-transparent hover:from-(--surface-soft)/70 transition-colors p-4 sm:flex-row sm:items-center"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + idx * 0.05 }}
                    whileHover={{ scale: 1.01 }}
                  >
                    <div className="min-w-0"><p className="truncate font-semibold text-brand-text-primary">{stream.sourceType === 'CHANNEL' ? `Channel stream · ${channels.find((channel) => channel.id === stream.channelId)?.name ?? 'Existing channel'}` : stream.name}</p><p className="text-xs text-brand-text-muted">{stream.status} · {stream.quality} · {stream.sourceType === 'CHANNEL' ? 'Channel URL linked' : 'Match stream'}</p></div>
                    <div className="flex shrink-0 gap-2">
                      <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button variant="outline" size="sm" onClick={() => handleEditClick(stream)} className="border-(--accent)/50 hover:border-(--accent)"><Edit size={14} className="mr-2" /> Edit</Button>
                      </motion.div>
                      <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button variant="destructive" size="sm" onClick={() => setDeletingStream(stream)} disabled={isDeleting}><Trash2 size={14} className="mr-2" /> Delete</Button>
                      </motion.div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <AlertDialog open={!!deletingStream} onOpenChange={(open) => !open && setDeletingStream(null)}>
        <AlertDialogContent className="bg-linear-to-br from-(--surface-soft) to-(--surface)">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this stream?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <strong>{deletingStream?.name || deletingStream?.primaryUrl}</strong> from the available stream list. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (deletingStream) void handleDelete(deletingStream.id)
              }}
            >
              Delete stream
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}