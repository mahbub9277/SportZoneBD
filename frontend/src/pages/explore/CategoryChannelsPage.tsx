import { Heart, Radio } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { useGetPublicChannelsQuery } from '../../features/admin/channels.api'
import { Card } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { Button } from '../../components/ui/Button'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { selectFavoriteChannelIds, toggleFavoriteChannel } from '../../features/favorites/favorites.slice'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { useAdvertisementGate } from '../../hooks/useAdvertisementGate'
import type { ChannelCategory } from '../../shared/types'

export function CategoryChannelsPage() {
  const { categoryId = '' } = useParams<{ categoryId: string }>()
  const navigate = useNavigate()
  const openChannel = useAdvertisementGate('CHANNEL')
  const shouldReduceMotion = useReducedMotion()
  const { data: categories = [], isLoading, isError } = useGetPublicChannelsQuery()
  const favorites = useAppSelector(selectFavoriteChannelIds)
  const dispatch = useAppDispatch()
  const category = categories.find((item: ChannelCategory) => item.id === decodeURIComponent(categoryId))

  if (isLoading) return <div className="app-page space-y-3"><Skeleton className="h-32 w-full rounded-3xl" /><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-36 w-full rounded-3xl" />)}</div></div>
  if (isError) return <div className="rounded-2xl border border-(--danger)/30 bg-(--danger-soft) p-5 text-center text-(--danger)">Failed to load category channels.</div>
  if (!category) return <main className="app-page flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center"><Radio className="h-12 w-12 text-text-muted" /><h1 className="text-2xl font-semibold text-text-primary">Category not found</h1><Button variant="outline" onClick={() => navigate('/categories')}>Back to categories</Button></main>

  const channels = category.channels ?? []
  return (
    <motion.main className="app-page w-full min-w-0 space-y-3 pb-28 xl:pb-8" initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: shouldReduceMotion ? 0 : 0.28, ease: 'easeOut' }}>
      <motion.section className="flex flex-col gap-4 rounded-3xl border border-[#0474C4]/25 bg-linear-to-br from-[#0d1527] via-(--surface) to-[#0474C4]/10 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7" initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: shouldReduceMotion ? 0 : 0.3, delay: shouldReduceMotion ? 0 : 0.05 }}>
        <div className="flex min-w-0 items-center gap-4">
          {category.image ? <motion.img whileHover={shouldReduceMotion ? undefined : { scale: 1.05, rotate: 2 }} src={buildCloudinaryUrl(category.image, { width: 88, height: 88, crop: 'fill' })} alt="" className="h-16 w-16 rounded-2xl object-cover sm:h-20 sm:w-20" /> : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[#0474C4]/15 text-[#8ed7ff]"><Radio className="h-7 w-7" /></span>}
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8ed7ff]">Category channels</p><h1 className="truncate text-2xl font-bold text-white sm:text-3xl">{category.name}</h1></div>
        </div>
        <span className="self-start rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm text-white/75 sm:self-auto">{channels.length} channels</span>
      </motion.section>

      {channels.length === 0 ? <div className="rounded-3xl border border-dashed border-border p-12 text-center text-text-muted">No channels are assigned to this category yet.</div> : (
        <motion.div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: shouldReduceMotion ? 0 : 0.045 } } }}>
          {channels.map((channel) => (
            <motion.div key={channel.id} variants={{ hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 10 }, visible: { opacity: 1, y: 0 } }} whileHover={shouldReduceMotion ? undefined : { y: -4 }} transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}>
              <Card className="group relative flex min-h-36 flex-col items-center justify-center p-3 text-center">
                <button type="button" onClick={() => openChannel(`/watch/${channel.id}`, channel.isPremium === true)} className="flex w-full min-w-0 flex-col items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0474C4]">
                  <motion.img whileHover={shouldReduceMotion ? undefined : { scale: 1.08, rotate: 2 }} src={buildCloudinaryUrl(channel.logo, { width: 96, height: 96, crop: 'fill' })} alt={`${channel.name} logo`} className="h-16 w-16 rounded-full border border-border bg-surface-soft p-1 object-contain transition group-hover:scale-105 sm:h-20 sm:w-20" />
                  <span className="line-clamp-2 w-full text-xs font-medium text-text-primary sm:text-sm">{channel.name}</span>
                </button>
                <button type="button" onClick={() => dispatch(toggleFavoriteChannel(channel.id))} className="absolute right-2 top-2 rounded-full p-1.5 text-text-muted opacity-100 transition hover:text-accent sm:opacity-0 sm:group-hover:opacity-100" aria-label={favorites.includes(channel.id) ? 'Remove from favorites' : 'Add to favorites'}>
                  <motion.span whileHover={shouldReduceMotion ? undefined : { scale: 1.15, rotate: 8 }} whileTap={shouldReduceMotion ? undefined : { scale: 0.9 }}><Heart className="h-4 w-4" fill={favorites.includes(channel.id) ? 'currentColor' : 'none'} /></motion.span>
                </button>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}
    </motion.main>
  )
}
