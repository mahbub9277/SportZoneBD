import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, Crown, Tv } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGetEventBySlugQuery } from '../../features/events/events.api'
import { Card } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import type { Channel } from '../../shared/types'
import type { Match } from '../../features/matches/matches.types'
import { MatchCardDisplay } from '../../components/MatchCardDisplay'
import { useAppSelector } from '../../app/hooks'
import { selectIsPremiumSubscriber } from '../../features/auth/authSlice'
import { SubscriptionModal } from '../../components/shared/SubscriptionModal'
import { CustomVideoPlayer } from '../../components/player/CustomVideoPlayer'
import { useAdvertisementGate } from '../../hooks/useAdvertisementGate'

const getChannel = (entry: { channel: Channel } | { channelId: string } | Channel) => {
  if ('channel' in entry) return entry.channel
  if ('name' in entry) return entry
  return null
}

const getMatch = (entry: { match: Match } | { matchId: string } | Match) => {
  if ('match' in entry) return entry.match
  if ('title' in entry) return entry
  return null
}

export default function EventPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { data: event, isLoading, isError } = useGetEventBySlugQuery(slug, {
    skip: !slug,
    refetchOnMountOrArgChange: true,
  })
  const isPremiumSubscriber = useAppSelector(selectIsPremiumSubscriber)
  const openMatch = useAdvertisementGate('MATCH')
  const openChannel = useAdvertisementGate('CHANNEL')
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null)
  const [isBannerVisible, setIsBannerVisible] = useState(true)
  const [subscriptionReturnPath, setSubscriptionReturnPath] = useState<string | undefined>()

  useEffect(() => {
    setSelectedChannel(null)
    setIsBannerVisible(true)
  }, [slug])

  if (isLoading) {
    return <div className="app-page space-y-3"><Skeleton className="h-52 w-full rounded-3xl" /><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-52 w-full rounded-2xl" />)}</div></div>
  }

  if (isError || !event) {
    return <motion.div className="app-page flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}><AlertCircle className="h-12 w-12 text-(--danger)" /><h1 className="text-2xl font-semibold text-text-primary">Event not found</h1><p className="text-text-muted">This event is unavailable or no longer active.</p></motion.div>
  }

  const channels = (event.eventChannels ?? []).map(getChannel).filter((channel): channel is Channel => channel !== null)
  const matches = (event.eventMatches ?? []).map(getMatch).filter((match): match is Match => match !== null)
  const relatedChannels = selectedChannel ? channels.filter((channel) => channel.id !== selectedChannel.id) : channels
  const requiresPremiumAccess = event.isPremium && !isPremiumSubscriber

  const handleChannelOpen = (channel: Channel) => {
    if (requiresPremiumAccess || channel.isPremium && !isPremiumSubscriber) {
      setSubscriptionReturnPath(`/watch/${channel.id}`)
      setIsSubscriptionModalOpen(true)
      return
    }
    openChannel(`/watch/${channel.id}`, false, () => {
      setSelectedChannel(channel)
      setIsBannerVisible(false)
    })
  }

  const handleMatchOpen = (match: Match) => {
    if (requiresPremiumAccess || match.premium && !isPremiumSubscriber) {
      setSubscriptionReturnPath(`/matches/${match.id}`)
      setIsSubscriptionModalOpen(true)
      return
    }
    openMatch(`/matches/${match.id}`, match.premium === true, () => {
      setIsBannerVisible(false)
      window.setTimeout(() => navigate(`/matches/${match.id}`), 420)
    })
  }

  return (
    <motion.main className="app-page w-full min-w-0 space-y-3 px-4 pb-8 md:px-5 lg:px-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <AnimatePresence initial={false}>
        {isBannerVisible && <motion.div key="event-hero" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }} className="w-full overflow-hidden">
        <motion.section className="relative isolate origin-top min-h-48 w-full aspect-16/5 overflow-hidden rounded-xl bg-linear-to-br from-surface-soft via-surface to-accent/10 shadow-[0_18px_50px_rgba(2,6,23,0.14)] sm:min-h-64 md:min-h-0 lg:translate-y-2 lg:scale-[0.97]">
          {event.banner && <img src={buildCloudinaryUrl(event.banner, { width: 1600, height: 500, crop: 'fill', gravity: 'center' })} alt={`${event.name} banner`} className="absolute inset-0 z-0 h-full w-full object-contain object-center" />}
          <div className="absolute inset-0 z-1 bg-linear-to-t from-black/80 via-black/40 to-transparent" aria-hidden="true" />
          <div className="absolute bottom-2 left-2 right-2 z-10 flex min-w-0 max-w-full items-end gap-2 md:bottom-4 md:left-4 md:right-4 md:gap-3">
            <div className="premium-border relative shrink-0 rounded-xl bg-surface/70 p-1.5 shadow-lg"><div className="grid h-12 w-12 place-items-center rounded-lg bg-surface-soft/80 sm:h-14 sm:w-14 md:h-18 md:w-18">{event.logo ? <img src={buildCloudinaryUrl(event.logo, { width: 144, height: 144, crop: 'fit' })} alt={`${event.name} logo`} className="h-full w-full rounded-lg object-contain" /> : <Tv className="h-6 w-6 text-white md:h-8 md:w-8" />}</div>{event.isPremium && <span className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-yellow-400 text-slate-950 shadow-[0_3px_10px_rgba(250,204,21,0.55)] md:h-7 md:w-7" title="Premium event"><Crown className="h-3.5 w-3.5 md:h-4 md:w-4" /></span>}</div>
            <div className="min-w-0 flex-1 pb-0.5 drop-shadow-[0_3px_10px_rgba(0,0,0,0.8)] md:max-w-3xl md:pb-1"><h1 className="truncate text-lg font-bold tracking-tight text-white sm:text-xl md:text-2xl">{event.name}</h1>{event.description && <p className="mt-0.5 line-clamp-1 max-w-2xl text-xs leading-4 text-gray-200 sm:text-sm md:line-clamp-2 md:leading-5">{event.description}</p>}</div>
            </div>
        </motion.section>
        </motion.div>}
      </AnimatePresence>

      {selectedChannel && (
        <motion.section aria-labelledby="event-player-heading" className="mx-auto w-full max-w-none xl:max-w-[calc(100vw-24rem)]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0"><h2 id="event-player-heading" className="truncate text-xl font-semibold text-text-primary">{selectedChannel.name}</h2></div>
            <div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => setIsBannerVisible((visible) => !visible)} className="grid h-9 w-9 place-items-center rounded-full bg-surface-soft/70 text-text-muted shadow-sm transition hover:bg-surface-soft hover:text-text-primary" aria-label={isBannerVisible ? 'Hide event banner' : 'Show event banner'} title={isBannerVisible ? 'Hide event banner' : 'Show event banner'}>{isBannerVisible ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button><button type="button" onClick={() => { setSelectedChannel(null); setIsBannerVisible(true) }} className="rounded-full bg-surface-soft/70 px-3 py-1.5 text-xs font-medium text-text-muted shadow-sm transition hover:bg-surface-soft hover:text-text-primary">Close player</button></div>
          </div>
          <Card className="premium-border overflow-hidden bg-black/80 p-1 shadow-[0_24px_70px_rgba(2,6,23,0.24)] sm:p-2">
            {selectedChannel.url ? <CustomVideoPlayer url={selectedChannel.url} presenceId={selectedChannel.id} channelId={selectedChannel.id} presenceType="channel" title={selectedChannel.name} poster={selectedChannel.logo ? buildCloudinaryUrl(selectedChannel.logo, { width: 1280, height: 720, crop: 'fill' }) : undefined} autoPlay /> : <div className="flex aspect-video items-center justify-center p-6 text-center text-sm text-white/70">This channel is unavailable until premium access is enabled.</div>}
          </Card>
        </motion.section>
      )}

      <section aria-labelledby="event-channels-heading">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="event-channels-heading" className="text-2xl font-semibold text-text-primary">{selectedChannel ? 'Related channels' : 'Channels'}</h2><p className="mt-1 text-sm text-text-muted">{selectedChannel ? 'Choose another channel assigned to this event.' : 'Select a channel to start watching.'}</p></div><span className="self-start rounded-full bg-surface-soft px-3 py-1 text-xs text-text-muted shadow-sm sm:self-auto">{relatedChannels.length} available</span></div>
        {relatedChannels.length === 0 ? <Card className="premium-border bg-surface-soft/45 p-8 text-center text-sm text-text-muted shadow-sm">{selectedChannel ? 'No other channels are assigned to this event.' : 'No channels have been assigned to this event yet.'}</Card> : <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">{relatedChannels.map((channel, index) => <motion.div key={channel.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.04, 0.24) }} whileHover={{ y: -4 }} className="h-full"><Card className="premium-border group relative flex h-full min-h-36 flex-col items-center justify-center bg-surface-soft/55 p-2.5 text-center shadow-sm transition-colors hover:bg-surface-soft sm:min-h-44 sm:p-3"><button type="button" onClick={() => handleChannelOpen(channel)} className="flex w-full min-w-0 flex-col items-center justify-center gap-2"><motion.img whileHover={{ scale: 1.08, rotate: 2 }} src={buildCloudinaryUrl(channel.logo, { width: 96, height: 96, crop: 'fill' })} alt={`${channel.name} logo`} className="h-14 w-14 rounded-full bg-surface-soft p-1 object-contain sm:h-20 sm:w-20" /><span className="line-clamp-2 w-full text-xs font-medium leading-tight text-text-primary sm:text-sm">{channel.name}</span>{(event.isPremium || channel.isPremium) && <Crown className="h-3.5 w-3.5 text-amber-400" aria-label="Premium channel" />}</button></Card></motion.div>)}</div>}
      </section>
      {matches.length > 0 && <section aria-labelledby="event-matches-heading"><div className="mb-4 flex items-end justify-between gap-3"><div><h2 id="event-matches-heading" className="text-2xl font-semibold text-text-primary">Matches</h2><p className="mt-1 text-sm text-text-muted">Matches assigned to this event.</p></div><span className="rounded-full bg-surface-soft px-3 py-1 text-xs text-text-muted shadow-sm">{matches.length}</span></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{matches.map((match, index) => <motion.div key={match.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.04, 0.24) }}><div className="premium-border rounded-3xl"><MatchCardDisplay match={match} onOpen={() => handleMatchOpen(match)} /></div></motion.div>)}</div></section>}
      <SubscriptionModal isOpen={isSubscriptionModalOpen} returnPath={subscriptionReturnPath} onClose={() => setIsSubscriptionModalOpen(false)} />
    </motion.main>
  )
}
