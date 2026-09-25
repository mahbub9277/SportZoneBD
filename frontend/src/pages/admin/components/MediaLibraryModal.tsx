import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, LayoutList, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import { useDeleteMediaMutation, useGetMediaLibraryQuery, useLazyGetMediaUsageQuery, type MediaAsset } from '../../../features/events/events.api'

interface MediaLibraryModalProps {
  mediaType: 'BANNER' | 'LOGO'
  onCancel: () => void
  onConfirm: (media: MediaAsset) => void
}

export function MediaLibraryModal({ mediaType, onCancel, onConfirm }: MediaLibraryModalProps) {
  const { data: mediaLibrary, isLoading, isError } = useGetMediaLibraryQuery()
  const [deleteMedia, { isLoading: isDeleting }] = useDeleteMediaMutation()
  const [checkMediaUsage] = useLazyGetMediaUsageQuery()
  const [filter, setFilter] = useState<'ALL' | 'BANNER' | 'LOGO'>(mediaType)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<MediaAsset | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selectedTypeLabel = mediaType === 'LOGO' ? 'logo' : 'banner'

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    searchInputRef.current?.focus()

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onCancel])

  const media = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (mediaLibrary ?? []).filter((item) =>
      (filter === 'ALL' || item.type === filter)
      && (!query || `${item.fileName ?? ''} ${item.publicId}`.toLowerCase().includes(query)),
    )
  }, [filter, mediaLibrary, search])

  const handleDelete = async (item: MediaAsset) => {
    if (!window.confirm(`Delete ${item.fileName ?? 'this media'}?`)) return
    try {
      const usage = await checkMediaUsage(item.id).unwrap()
      if (usage.count > 0) {
        toast.warning(`This media is used by ${usage.count} event${usage.count === 1 ? '' : 's'}. Remove those references first.`)
        return
      }
      await deleteMedia(item.id).unwrap()
      if (selected?.id === item.id) setSelected(null)
      toast.success('Media deleted.')
    } catch {
      toast.error('Media could not be deleted safely.')
    }
  }

  return createPortal((
    <div data-media-library-modal="true" className="fixed inset-0 z-100 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="media-library-title" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onCancel() }}>
      <div className="flex max-h-[calc(100dvh-1.5rem)] w-full min-w-0 max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900/95 shadow-2xl sm:max-h-[calc(100dvh-3rem)]" onPointerDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4 sm:p-6">
          <div className="min-w-0"><h2 id="media-library-title" className="flex items-center gap-2 text-xl font-semibold text-text-primary"><LayoutList className="h-5 w-5 shrink-0 text-accent" />Media Library</h2><p className="text-xs text-text-muted">Select a {selectedTypeLabel} asset before confirming the form action.</p></div>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} aria-label="Close media library"><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:p-6">
          <div className="flex flex-wrap items-center gap-2" aria-label="Media type filter"><span className="mr-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Show</span><Button type="button" size="sm" variant={filter === 'ALL' ? 'default' : 'outline'} onClick={() => setFilter('ALL')}>All</Button><Button type="button" size="sm" variant={filter === 'BANNER' ? 'default' : 'outline'} onClick={() => setFilter('BANNER')}>Banners</Button><Button type="button" size="sm" variant={filter === 'LOGO' ? 'default' : 'outline'} onClick={() => setFilter('LOGO')}>Logos</Button></div>
          <div className="relative w-full min-w-0 sm:ml-auto sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" /><Input ref={searchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search filename or public ID" className="min-w-0 pl-9" /></div>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          {isLoading ? <p className="py-12 text-center text-sm text-text-muted">Loading media library...</p> : isError ? <p className="py-12 text-center text-sm text-red-300">Unable to load the media library.</p> : media.length === 0 ? <p className="py-12 text-center text-sm text-text-muted">No matching media found.</p> : <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{media.map((item) => <div key={item.id} className={`group relative overflow-hidden rounded-2xl border bg-surface-soft/60 p-2 transition ${selected?.id === item.id ? 'border-accent ring-2 ring-accent/40' : 'border-white/10 hover:border-accent/50'}`}><button type="button" className="block w-full text-left" onClick={() => item.type === mediaType && setSelected(item)} disabled={item.type !== mediaType} aria-label={`Select ${item.fileName ?? item.type.toLowerCase()}`}><img src={buildCloudinaryUrl(item.url, { width: item.type === 'BANNER' ? 960 : 320, height: item.type === 'BANNER' ? 240 : 320, crop: 'fill', gravity: 'auto', quality: 'auto', format: 'auto' })} alt={item.fileName ?? item.type} loading="lazy" decoding="async" className={`w-full rounded-xl object-cover ${item.type === 'BANNER' ? 'aspect-4/1' : 'aspect-square'}`} /><p className="mt-2 truncate text-xs font-medium text-text-primary">{item.fileName ?? item.type}</p><p className="text-[10px] uppercase tracking-wider text-text-muted">{item.type}</p></button>{selected?.id === item.id && <span className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-full bg-accent text-slate-950"><Check className="h-4 w-4" /></span>}<Button type="button" variant="ghost" size="sm" className="absolute bottom-1 right-1 z-10 bg-slate-950/70" onClick={() => void handleDelete(item)} disabled={isDeleting} aria-label={`Delete ${item.fileName ?? 'media'}`}><Trash2 className="h-3.5 w-3.5 text-red-300" /></Button></div>)}</div>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6"><p className="text-xs text-text-muted">{selected ? `Selected ${selectedTypeLabel}: ${selected.fileName ?? selected.type}` : `Choose a ${selectedTypeLabel} to continue.`}</p><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="button" onClick={() => selected && onConfirm(selected)} disabled={!selected}>Use {selectedTypeLabel}</Button></div></div>
      </div>
    </div>
  ), document.body)
}
