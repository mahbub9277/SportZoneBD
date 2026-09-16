import { useParams, useNavigate } from 'react-router-dom'
import { useGetChannelByIdQuery } from '../../../features/admin/channels.api'
import { CustomVideoPlayer } from '../../../components/player/CustomVideoPlayer'
import { Skeleton } from '../../../components/ui/Skeleton'
import { AlertCircle, Tv, ArrowLeft } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Button } from '../../../components/ui/Button'
import { motion } from 'framer-motion'

export function ManageChannelPage() {
  const { channelId } = useParams<{ channelId: string }>()
  const navigate = useNavigate()

  // NOTE: Using `useGetChannelByIdQuery` which is assumed to be the admin-only endpoint
  const { data: channelData, isLoading, isError } = useGetChannelByIdQuery(channelId!, {
    skip: !channelId,
  })

  const channel = channelData

  if (isLoading) {
    return (
      <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-bold">Manage Channel</h1>
        <Skeleton className="aspect-video w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </motion.div>
    )
  }

  if (isError || !channel) {
    return (
      <motion.div className="flex h-[60vh] items-center justify-center rounded-xl border border-dashed border-red-500/50 bg-red-500/10" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
        <div className="text-center">
          <motion.div whileHover={{ scale: 1.15, rotate: 5 }}><AlertCircle className="mx-auto h-12 w-12 text-red-400" /></motion.div>
          <h2 className="mt-4 text-xl font-semibold text-red-300">Channel Not Found</h2>
          <p className="mt-2 text-red-400/80">This channel could not be loaded or does not exist.</p>
          <Button variant="outline" onClick={() => navigate('/admin/channels')} className="mt-6 gap-2">
            <ArrowLeft size={16} /> Back to Channels
          </Button>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div className="flex items-center justify-between" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <h1 className="text-2xl font-bold">Manage: {channel.name}</h1>
        {/* Admin controls can be added here */}
        <Button>Edit Channel</Button>
      </motion.div>

      <Card className="relative overflow-hidden border-border bg-transparent p-0 shadow-lg">
        <div className="aspect-video w-full bg-black/80">
          {channel.url ? (
            <CustomVideoPlayer url={channel.url} presenceId={channel.id} presenceType="channel" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-black text-center text-muted-foreground">
              <motion.div whileHover={{ scale: 1.15, rotate: 5 }}><Tv size={48} className="mx-auto mb-4" /></motion.div>
              <p>Stream URL is not available for this channel.</p>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h3 className="font-semibold text-primary">Channel Name</h3>
            <p className="text-muted-foreground">{channel.name}</p>
          </div>
          <div>
            <h3 className="font-semibold text-primary">Category</h3>
            <p className="text-muted-foreground">{channel.category?.name || 'N/A'}</p>
          </div>
          <div className="md:col-span-2">
            <h3 className="font-semibold text-primary">Stream URL</h3>
            <p className="break-all text-sm text-muted-foreground">{channel.url || 'Not set'}</p>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}