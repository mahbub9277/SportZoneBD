import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Grid3X3, Radio } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useGetPublicChannelsQuery } from '../../features/admin/channels.api'
import { Card } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import type { ChannelCategory } from '../../shared/types'

export function CategoriesPage() {
  const { data: categories = [], isLoading, isError } = useGetPublicChannelsQuery()
  const reducedMotion = useReducedMotion()

  if (isLoading) return <div className="app-page space-y-3"><Skeleton className="h-40 w-full rounded-3xl" /><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-36 w-full rounded-3xl" />)}</div></div>
  if (isError) return <div className="rounded-2xl border border-(--danger)/30 bg-(--danger-soft) p-5 text-center text-(--danger)">Failed to load categories.</div>

  return <main className="app-page w-full min-w-0 space-y-3 pb-28 xl:pb-8">
    <section className="relative overflow-hidden rounded-4xl border border-[#0474C4]/25 bg-linear-to-br from-[#0d1527] via-(--surface) to-[#0474C4]/10 p-5 shadow-[0_24px_70px_rgba(2,6,23,0.2)] sm:p-8">
      <Grid3X3 className="absolute -right-8 -top-8 h-44 w-44 text-[#0474C4]/10" aria-hidden="true" />
      <div className="relative max-w-2xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#0474C4]/30 bg-[#0474C4]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#8ed7ff]"><Radio className="h-3.5 w-3.5" /> Browse categories</div><h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Find your next channel</h1><p className="mt-3 text-sm leading-6 text-white/65 sm:text-base">Explore every available channel grouped by its real SportZoneBD category.</p></div>
    </section>
    {categories.length === 0 ? <div className="rounded-3xl border border-dashed border-(--border) p-12 text-center text-text-muted">No categories are available.</div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">{categories.map((category: ChannelCategory, index) => <motion.div key={category.id} initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? 0 : Math.min(index * 0.04, 0.3) }} whileHover={reducedMotion ? undefined : { y: -4 }}><Link to={`/categories/${encodeURIComponent(category.id)}`} className="group block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0474C4]"><Card className="flex h-full min-h-36 flex-col justify-between p-4 transition group-hover:border-[#0474C4]/50 group-hover:shadow-[0_18px_45px_rgba(4,116,196,0.16)] sm:min-h-40 sm:p-5"><div className="flex items-start justify-between gap-3">{category.image ? <img src={buildCloudinaryUrl(category.image, { width: 72, height: 72, crop: 'fill' })} alt="" className="h-12 w-12 rounded-2xl border border-border object-cover sm:h-14 sm:w-14" /> : <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#0474C4]/15 text-[#8ed7ff]"><Grid3X3 className="h-6 w-6" /></span>}<ArrowRight className="h-4 w-4 text-text-muted transition group-hover:translate-x-1 group-hover:text-[#8ed7ff]" /></div><div className="mt-5 min-w-0"><h2 className="truncate text-base font-semibold text-text-primary sm:text-lg">{category.name}</h2><p className="mt-1 text-xs text-text-muted">{category.channels?.length ?? 0} channels</p></div></Card></Link></motion.div>)}</div>}
  </main>
}
