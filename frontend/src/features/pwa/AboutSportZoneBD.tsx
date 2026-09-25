import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Code2, Copyright, Download, FileText, Info, LockKeyhole, RefreshCw, Share2, ShieldCheck, Sparkles, Tag } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { usePwaExperience } from './PwaExperienceContext'
import { APP_VERSION, CURRENT_RELEASE_NOTES, getAppShareUrl } from './appInfo'
import appLogo from '@/assets/site.logo.webp'

const updateStatusText = {
  idle: 'Check whether a newer app version is available.',
  checking: 'Checking for updates...',
  available: 'A new version is available.',
  'up-to-date': "You're up to date.",
  error: 'Unable to check for updates. Check your connection and try again.',
  updating: 'Updating SportZoneBD...',
} as const

export function AboutSportZoneBD() {
  const pwa = usePwaExperience()
  const [shareMessage, setShareMessage] = useState('')

  const shareApp = async () => {
    const url = getAppShareUrl()
    try {
      if (navigator.share) {
        await navigator.share({ title: 'SportZoneBD', text: 'Live sports, instant access.', url })
        setShareMessage('')
        return
      }
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable')
      await navigator.clipboard.writeText(url)
      setShareMessage('App link copied.')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setShareMessage('Could not share the app link from this browser.')
    }
  }

  return (
    <div className="space-y-4" aria-labelledby="about-sportzone-title">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left">
          <img src={appLogo} alt="SportZoneBD logo" width={88} height={88} className="h-20 w-32 shrink-0 object-contain" />
          <div className="min-w-0 flex-1">
            <h2 id="about-sportzone-title" className="text-xl font-semibold text-(--text-primary)">SportZoneBD</h2>
            <p className="mt-1 text-sm text-(--text-muted)">Live sports, instant access.</p>
            <p className="mt-3 inline-flex items-center gap-2 text-xs text-(--text-muted)"><Tag className="h-4 w-4" />Version {APP_VERSION}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void shareApp()} className="min-h-10 w-full gap-2 sm:w-auto">
            <Share2 className="h-4 w-4" />Share SportZoneBD
          </Button>
        </CardContent>
        {shareMessage && <p role="status" aria-live="polite" className="px-6 pb-4 text-center text-xs text-(--text-muted) sm:text-left">{shareMessage}</p>}
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-(--accent)" />What&apos;s New</CardTitle></CardHeader>
        <CardContent className="space-y-3 pt-0">
          {CURRENT_RELEASE_NOTES.length ? CURRENT_RELEASE_NOTES.map((group) => (
            <section key={group.category}>
              <h3 className="text-sm font-semibold text-(--text-primary)">{group.category}</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-(--text-muted)">{group.items.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          )) : <p className="text-sm leading-6 text-(--text-muted)">Release notes are not available for this version.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><RefreshCw className="h-4 w-4 text-(--accent)" />App updates</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0 sm:flex-row sm:items-center sm:justify-between">
          <p role="status" aria-live="polite" className="min-w-0 text-sm leading-6 text-(--text-muted)">{updateStatusText[pwa.updateStatus]}</p>
          <Button type="button" variant="outline" onClick={() => void pwa.checkForUpdates()} disabled={pwa.updateStatus === 'checking' || pwa.updateStatus === 'updating'} className="min-h-10 w-full shrink-0 gap-2 sm:w-auto">
            <RefreshCw className={`h-4 w-4 ${pwa.updateStatus === 'checking' ? 'animate-spin' : ''}`} />Check for updates
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Download className="h-4 w-4 text-(--accent)" />Install app</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-(--text-muted)">{pwa.isInstalled ? 'SportZoneBD is installed on this device.' : pwa.canInstall ? 'Get a faster, app-like experience from your home screen.' : 'Installation is not available in this browser. Use its browser menu if it offers an install option.'}</p>
          {pwa.canInstall && <Button type="button" onClick={() => void pwa.installApp()} className="min-h-10 w-full shrink-0 gap-2 sm:w-auto"><Download className="h-4 w-4" />Install App</Button>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Info className="h-4 w-4 text-(--accent)" />Legal &amp; information</CardTitle></CardHeader>
        <CardContent className="space-y-1 pt-0">
          <Link to="/terms-of-service" className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm text-(--text-primary) transition hover:bg-(--surface-soft) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"><FileText className="h-4 w-4 text-(--text-muted)" />Terms of Service</Link>
          <Link to="/privacy-policy" className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm text-(--text-primary) transition hover:bg-(--surface-soft) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"><ShieldCheck className="h-4 w-4 text-(--text-muted)" />Privacy Policy</Link>
          <div className="flex items-center gap-3 px-2 py-2 text-xs text-(--text-muted)"><LockKeyhole className="h-4 w-4" />Authentication is protected by secure server-managed sessions.</div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 px-1 py-2 text-sm text-(--text-muted)">
        <Code2 className="h-4 w-4 shrink-0 text-(--accent)" />
        <span><span className="block text-xs">Developed by</span><span className="font-medium text-(--text-primary)">Mahbub Ullah Masum</span></span>
      </div>

      <p className="flex items-center justify-center gap-1.5 px-2 pb-2 text-center text-xs text-(--text-muted)"><Copyright className="h-3.5 w-3.5" />{new Date().getFullYear()} SportZoneBD. All rights reserved.</p>
    </div>
  )
}