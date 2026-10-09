import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Play, Tv, Radio, CalendarClock, LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, CardContent } from '../../components/ui/Card'
import { useGetMatchesQuery } from '../matches/matches.api'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/Tabs'
import { MatchCardDisplay } from '../../components/MatchCardDisplay'
import { MatchCardSkeleton } from '../../components/skeletons/MatchCardSkeleton';
import { HomePageHeroSkeleton } from '../../components/skeletons/HomePageHeroSkeleton';
import type { Match } from '../matches/matches.types'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '../../lib/utils'
import { useGetActiveBannersQuery, type Banner } from '../admin/banners.api'
import { filterMatches, getMatchStatus, sortMatches } from '../matches/matchOrdering'
import { formatMatchKickoff, getMatchCalendarWindowEnd } from '../../utils/matchDateTime'
import { buildCloudinaryUrl } from '../../utils/cloudinary'

const HOMEPAGE_MATCH_LIMIT = 24

const BANNER_IMAGE_WIDTHS = [640, 960, 1280, 1600, 1920]

// The banner specification is unchanged; this only lets the browser download the width it actually
// needs. The URLs come from the shared Cloudinary builder, so a non-Cloudinary URL is still handed
// back untouched and `dpr_auto` stays out of the descriptors.
const buildBannerSrcSet = (url?: string | null) => {
  if (!url || !/cloudinary\.com/i.test(url)) return undefined

  return BANNER_IMAGE_WIDTHS
    .map((width) => `${buildCloudinaryUrl(url, { width, crop: 'fill', gravity: 'center' })} ${width}w`)
    .join(', ')
}

// Mirrors the homepage shell insets (px-3 / sm:px-4 / lg:px-6) and its 1920px max width.
const BANNER_SIZES = '(min-width: 1920px) 1856px, (min-width: 1024px) calc(100vw - 48px), (min-width: 640px) calc(100vw - 32px), calc(100vw - 24px)'

export function HomePage() {
  const { data: matchesData, isLoading, isError } = useGetMatchesQuery({
    page: 1,
    limit: HOMEPAGE_MATCH_LIMIT,
    sort: 'date-asc',
    activeOnly: true,
  })
  const { data: banners = [] } = useGetActiveBannersQuery()
  const [activeBannerIndex, setActiveBannerIndex] = useState(0)
  const matches = useMemo(() => matchesData?.items ?? [], [matchesData?.items])

  const { liveMatches, upcomingMatches, allMatches } = useMemo(() => {
    const sortedMatches = sortMatches(matches)
    const live = filterMatches(sortedMatches, 'LIVE')
    const now = new Date()
    const nowTime = now.getTime()
    const windowEnd = getMatchCalendarWindowEnd(now, 2)
    const windowEndTime = windowEnd ? new Date(windowEnd).getTime() : nowTime
    const upcoming = filterMatches(sortedMatches, 'UPCOMING').filter((match) => {
      const kickoffAt = new Date(match.kickoffAt).getTime()
      return Number.isFinite(kickoffAt) && kickoffAt >= nowTime && kickoffAt < windowEndTime
    })

    return {
      liveMatches: live.slice(0, 8),
      upcomingMatches: upcoming.slice(0, 8),
      allMatches: sortedMatches.slice(0, HOMEPAGE_MATCH_LIMIT),
    }
  }, [matches])

  const stats = useMemo(() => {
    const liveCount = liveMatches.length
    const upcomingCount = upcomingMatches.length
    const syncedCount = matches.length

    return [
      { label: 'Live now', value: liveCount, icon: Radio },
      { label: 'Upcoming', value: upcomingCount, icon: CalendarClock },
      { label: 'Total matches', value: syncedCount, icon: CalendarClock },
    ]
  }, [matches.length, liveMatches.length, upcomingMatches.length])

  if (isLoading) {
    return (
      <div className="space-y-10">
        <HomePageHeroSkeleton />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <MatchCardSkeleton key={index} />)}</div>
      </div>
    )
  }

  return (
    <div className="home-page-shell mx-auto w-full max-w-[1920px] space-y-10 px-3 sm:space-y-12 sm:px-4 lg:px-6">
      {banners.length > 0 ? <BannerHero banners={banners} activeIndex={activeBannerIndex} setActiveIndex={setActiveBannerIndex} /> : <HeroSection featuredMatch={liveMatches[0] ?? upcomingMatches[0]} />}
      <StatsSection stats={stats} />
      <FixturesSection
        liveMatches={liveMatches}
        upcomingMatches={upcomingMatches}
        allMatches={allMatches}
        isError={isError}
      />
    </div>
  )
}

const BannerHero = ({ banners, activeIndex, setActiveIndex }: { banners: Banner[]; activeIndex: number; setActiveIndex: Dispatch<SetStateAction<number>> }) => {
  const [slideDirection, setSlideDirection] = useState(1)
  // Which banner's own media is already able to paint. Comparing ids (instead of a boolean) keeps this
  // correct across rotation without an extra effect: a newly shown banner is never treated as ready.
  const [readyBannerId, setReadyBannerId] = useState<string | null>(null)

  useEffect(() => {
    if (banners.length < 2 || typeof document === 'undefined') return
    const advance = () => {
      if (!document.hidden) {
        setSlideDirection(1)
        setActiveIndex((currentIndex) => (currentIndex + 1) % banners.length)
      }
    }
    const timer = window.setInterval(advance, 6000)
    return () => window.clearInterval(timer)
  }, [banners.length, setActiveIndex])

  const banner = banners[activeIndex % banners.length]
  const isVideo = banner.type === 'VIDEO' && Boolean(banner.videoUrl)
  const bannerLink = banner.ctaUrl?.trim() || ''
  // A banner may legitimately have no title; the homepage then renders no heading instead of a label.
  const displayTitle = banner.title?.trim() ?? ''
  const bannerImage = buildCloudinaryUrl(banner.imageUrl ?? banner.posterUrl ?? null, { width: 1800, crop: 'fill', gravity: 'center' })
  const bannerPoster = buildCloudinaryUrl(banner.posterUrl ?? banner.imageUrl ?? null, { width: 1600, crop: 'fill', gravity: 'center' })
  const bannerLinkLabel = displayTitle || banner.ctaText?.trim() || 'featured banner'
  const bannerHasMedia = isVideo || Boolean(bannerImage)
  // The placeholder covers the media area until this banner's own media can paint, and never appears for a
  // banner that has no media at all (so it cannot get stuck).
  const showBannerPlaceholder = bannerHasMedia && readyBannerId !== banner.id
  const markBannerReady = () => setReadyBannerId(banner.id)
  const openBannerLink = () => { if (bannerLink) window.location.assign(bannerLink) }
  const selectBanner = (index: number) => {
    setSlideDirection(index >= activeIndex ? 1 : -1)
    setActiveIndex(index)
  }
  return <motion.section role={bannerLink ? 'link' : undefined} tabIndex={bannerLink ? 0 : undefined} onClick={bannerLink ? openBannerLink : undefined} onKeyDown={bannerLink ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBannerLink() } } : undefined} aria-label={bannerLink ? `Open ${bannerLinkLabel}${displayTitle && banner.ctaText?.trim() ? `: ${banner.ctaText}` : ''}` : undefined} className={cn('relative w-full overflow-hidden rounded-3xl border border-white/10 bg-(--surface-strong) shadow-premium', 'sm:aspect-16/7 sm:min-h-60 lg:aspect-16/5', bannerLink && 'cursor-pointer')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45 }}>
    <AnimatePresence initial={false} mode="wait" custom={slideDirection}>
      <motion.div key={banner.id} custom={slideDirection} variants={{ enter: (direction: number) => ({ opacity: 0, x: direction * 44, scale: 1.025 }), center: { opacity: 1, x: 0, scale: 1 }, exit: (direction: number) => ({ opacity: 0, x: direction * -44, scale: 0.99 }) }} initial="enter" animate="center" exit="exit" transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} className="relative sm:absolute sm:inset-0">
        <div className="relative aspect-16/7 min-h-44 w-full overflow-hidden sm:absolute sm:inset-0 sm:aspect-auto sm:min-h-0">
          {isVideo ? <>{bannerPoster && <img src={bannerPoster} srcSet={buildBannerSrcSet(banner.posterUrl ?? banner.imageUrl)} sizes={BANNER_SIZES} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover object-center" loading="eager" decoding="async" onLoad={markBannerReady} />}<video src={banner.videoUrl ?? undefined} poster={bannerPoster || undefined} autoPlay muted loop playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover object-center" onLoadedData={markBannerReady} onPlaying={markBannerReady} onError={(event) => { event.currentTarget.style.display = 'none'; markBannerReady() }} /></> : bannerImage ? <img src={bannerImage} srcSet={buildBannerSrcSet(banner.imageUrl ?? banner.posterUrl)} sizes={BANNER_SIZES} alt={displayTitle || 'SportZoneBD banner'} className="absolute inset-0 h-full w-full object-cover object-center" loading="eager" fetchPriority="high" decoding="async" onLoad={markBannerReady} onError={markBannerReady} /> : null}
          <div className="absolute inset-0 bg-linear-to-r from-black/85 via-black/45 to-transparent" />
          {showBannerPlaceholder && <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-(--surface-soft)"><div className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-(--skeleton-shimmer) to-transparent motion-reduce:hidden" /></div>}
        </div>
        <div className="relative z-10 flex items-end bg-(--surface-strong) p-3 sm:absolute sm:inset-0 sm:h-full sm:bg-transparent sm:p-8 sm:pb-8 lg:p-12"><motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, duration: 0.55, ease: [0.22, 1, 0.36, 1] }} className="max-w-2xl space-y-2 sm:space-y-4">{banner.badge && banner.badge !== 'SportZoneBD' && <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white sm:text-xs sm:tracking-[0.28em]">{banner.badge}</p>}{displayTitle && <h1 className="text-xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">{displayTitle}</h1>}{banner.subtitle && <p className="max-w-xl text-[11px] leading-5 text-white sm:text-base sm:leading-7">{banner.subtitle}</p>}{banner.ctaText?.trim() && bannerLink && <span aria-hidden="true" className="inline-flex min-h-9 items-center rounded-lg border border-white/30 bg-black/35 px-4 text-sm font-semibold text-white shadow-sm">{banner.ctaText}</span>}</motion.div></div>
      </motion.div>
    </AnimatePresence>
    {banners.length > 1 && <div className="absolute right-4 top-3 z-20 flex items-center gap-2 rounded-full border border-white/15 bg-black/25 px-3 py-2 backdrop-blur-md sm:bottom-4 sm:right-5 sm:top-auto" onClick={(event) => event.stopPropagation()}>{banners.map((item, index) => <button key={item.id} type="button" aria-label={`Show banner ${index + 1}`} onClick={() => selectBanner(index)} className={cn('h-1.5 rounded-full transition-[width,background-color,opacity] duration-300', index === activeIndex ? 'w-8 bg-(--accent)' : 'w-1.5 bg-white/60 hover:bg-white')} />)}</div>}
  </motion.section>
}

const HeroSection = ({ featuredMatch }: { featuredMatch?: Match }) => {
  const isLive = featuredMatch ? getMatchStatus(featuredMatch) === 'LIVE' : false
  const homeLogo = featuredMatch ? buildCloudinaryUrl(featuredMatch.homeTeamLogo, { width: 180, crop: 'limit' }) : undefined
  const awayLogo = featuredMatch ? buildCloudinaryUrl(featuredMatch.awayTeamLogo, { width: 180, crop: 'limit' }) : undefined
  // Keyed by URL, so a crest that failed for one fixture is shown again for the next one.
  const [failedLogoSrc, setFailedLogoSrc] = useState<string | null>(null)

  return (
    <motion.section className="home-page-section relative min-h-60 overflow-hidden rounded-4xl border border-border bg-(--surface) shadow-premium sm:min-h-75" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45 }}>
      <div className="absolute inset-0 bg-linear-to-br from-surface-strong via-surface to-accent/10" />
      <div className="relative z-10 flex min-h-105 items-end p-6 sm:min-h-120 sm:p-10 lg:p-14">
        <div className="max-w-2xl space-y-5">
          {featuredMatch && <div className="flex items-center gap-5" aria-label={`${featuredMatch.homeTeamName ?? 'Team 1'} versus ${featuredMatch.awayTeamName ?? 'Team 2'}`}>
            {homeLogo && failedLogoSrc !== homeLogo && <img src={homeLogo} alt={featuredMatch.homeTeamName ?? 'Team 1'} className="h-16 w-16 object-contain sm:h-24 sm:w-24" loading="lazy" decoding="async" onError={() => setFailedLogoSrc(homeLogo)} />}
            <span className="text-xl font-black text-accent sm:text-3xl">VS</span>
            {awayLogo && failedLogoSrc !== awayLogo && <img src={awayLogo} alt={featuredMatch.awayTeamName ?? 'Team 2'} className="h-16 w-16 object-contain sm:h-24 sm:w-24" loading="lazy" decoding="async" onError={() => setFailedLogoSrc(awayLogo)} />}
          </div>}
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.28em] text-(--accent)"><span className={cn('h-2 w-2 rounded-full', isLive ? 'bg-rose-400 motion-safe:animate-pulse' : 'bg-(--accent)')} />{isLive ? 'Live now' : 'Next on SportZoneBD'}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">{featuredMatch?.title ?? 'Every match, one clear view.'}</h1>
          <p className="max-w-xl text-sm leading-7 text-white sm:text-base">{featuredMatch ? (isLive ? 'Watch the live broadcast and stay close to every moment.' : `Kickoff ${formatMatchKickoff(featuredMatch.kickoffAt)}. Get ready for the broadcast.`) : 'Follow live action, upcoming fixtures, and premium coverage from one connected sports hub.'}</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="neon" size="lg"><Link to={featuredMatch ? `/matches/${featuredMatch.id}` : '/matches'}><Play size={18} /> {isLive ? 'Watch live' : 'Browse matches'}</Link></Button>
            <Button asChild variant="outline" size="lg"><Link to="/highlights"><Tv size={18} /> Highlights</Link></Button>
          </div>
        </div>
      </div>
    </motion.section>
  )
}

const StatsSection = ({ stats }: { stats: { label: string; value: number; icon: LucideIcon }[] }) => (
  <motion.section initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08, delayChildren: 0.12 } } }} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Match summary">
    {stats.map((item) => (
      <motion.div key={item.label} variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } } }} whileHover={{ y: -3 }} className="min-w-0">
        <Card className="group premium-card h-full">
          <CardContent className="flex items-center gap-4 p-4 sm:p-5">
            <div className="rounded-2xl border border-accent/25 bg-accent-soft p-3 text-accent transition-transform duration-300 group-hover:scale-105">
              <item.icon size={20} aria-hidden="true" />
            </div>
            <div>
              <p className="text-3xl font-semibold tabular-nums text-text-primary">{item.value}</p>
              <p className="text-body-sm text-text-muted">{item.label}</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    ))}
  </motion.section>
)

const FixturesSection = ({ // prettier-ignore
  liveMatches,
  upcomingMatches,
  allMatches,
  isError,
}: {
  liveMatches: Match[];
  upcomingMatches: Match[];
  allMatches: Match[];
  isError: boolean
}) => (
  <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.5 }}
    className="w-full space-y-4"
  >
    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-rose-400" />
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">Matches</span>
      </div>
    </div>
    {/* The shared TabsContent box (border, surface fill, p-5) is neutralised here so the match cards sit
        directly in the page flow and receive the full column width, exactly as they do on AllMatchesPage. */}
    <Tabs defaultValue="live" className="w-full">
      <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
        <TabsTrigger value="live">Live</TabsTrigger>
        <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
        <TabsTrigger value="all">All</TabsTrigger>
      </TabsList>
      <TabsContent value="live" className="rounded-none border-0 bg-transparent p-0 pt-4">
        <div className="grid w-full items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {isError && <p className="text-center text-red-400 lg:col-span-3">Could not load live matches from the backend.</p>}
          {!isError && liveMatches.length === 0 && <p className="text-center text-text-muted lg:col-span-3">No matches are currently live.</p>}
          {liveMatches.map((match) => (
            <MatchCardDisplay key={match.id} match={match} compact />
          ))}
        </div>
      </TabsContent>
      <TabsContent value="upcoming" className="rounded-none border-0 bg-transparent p-0 pt-4">
        <div className="grid w-full items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {isError && <p className="text-center text-red-400 lg:col-span-3">Could not load upcoming matches from the backend.</p>}
          {!isError && upcomingMatches.length === 0 && <p className="text-center text-text-muted lg:col-span-3">No upcoming matches are available right now.</p>}
          {upcomingMatches.slice(0, 6).map((match) => (
            <MatchCardDisplay key={match.id} match={match} compact />
          ))}
        </div>
      </TabsContent>
      <TabsContent value="all" className="rounded-none border-0 bg-transparent p-0 pt-4">
        <div className="grid w-full items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {isError && <p className="text-center text-red-400 lg:col-span-3">Could not load fixtures from the backend.</p>}
          {!isError && allMatches.length === 0 && <p className="text-center text-text-muted lg:col-span-3">No fixtures are available yet.</p>}
          {allMatches.map((match) => (
            <MatchCardDisplay key={match.id} match={match} compact />
          ))}
        </div>
      </TabsContent>
    </Tabs>
  </motion.section>
)
