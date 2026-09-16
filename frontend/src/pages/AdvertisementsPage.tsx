import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useGetActiveAdvertisementsQuery } from '../features/admin/advertisements.api'
import { useTrackEventMutation } from '../features/analytics/analytics.api'
import { Skeleton } from '../components/ui/Skeleton'
import type { Advertisement } from '../features/admin/advertisements.api'

const emptyAdvertisements: Advertisement[] = []

export function AdvertisementsPage() {
  const adsQuery = useGetActiveAdvertisementsQuery()
  const ads = adsQuery.data ?? emptyAdvertisements
  const { isLoading, isError } = adsQuery
  const [trackEvent] = useTrackEventMutation();

  return (
    <div className="app-page mx-auto max-w-5xl space-y-3 p-4 sm:p-6 lg:p-8">
      <div className="app-page-section rounded-3xl border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface) p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-(--accent)">Partner offers</p>
        <h1 className="mt-2 text-3xl font-semibold text-(--text-primary)">Latest promotions</h1>
      </div>

      <div className="app-page-section grid gap-4 md:grid-cols-2">
        {isLoading ? (
          <>
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </>
        ) : isError ? (
          <p className="col-span-full rounded-2xl border border-red-500/30 p-6 text-center text-sm text-red-400">Advertisements are temporarily unavailable.</p>
        ) : ads.length === 0 ? (
          <p className="col-span-full rounded-2xl border border-(--border) p-6 text-center text-sm text-(--text-muted)">No active offers are available right now.</p>
        ) : (
          ads.map((ad) => (
            <Card key={ad.id} className="border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface) p-6 shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
              <CardHeader className="p-0">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-lg">{ad.title}</CardTitle>
                  <span className="rounded-full border border-(--accent)/25 bg-(--accent)/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-(--accent)">Ad</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-0 pt-4">
                {ad.imageUrl && <img src={ad.imageUrl} alt={ad.title} className="aspect-4/1 w-full rounded-xl border border-(--border) object-cover" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
                <Button asChild className="w-full">
                  <a
                    href={ad.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackEvent({ type: 'ADVERTISEMENT_CLICK', entityId: ad.id })}
                  >
                    Open offer
                  </a>
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
