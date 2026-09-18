import { startTransition, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Globe } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Skeleton } from '@/components/ui/Skeleton'
import { useGetAdminSettingsQuery, useUpsertAdminSettingMutation } from '@/features/admin/admin.api'
import { DescriptionGenerator } from '@/components/ai/DescriptionGenerator'

type WebsiteSettingsForm = {
  'site.title': string
  'site.description': string
  'site.tagline': string
  BKASH_MANUAL_PAYMENT_NUMBER: string
}

const defaultForm: WebsiteSettingsForm = {
  'site.title': '',
  'site.description': '',
  'site.tagline': '',
  BKASH_MANUAL_PAYMENT_NUMBER: '',
}

export default function WebsiteSettingsPage() {
  const { data: settings = [], isLoading } = useGetAdminSettingsQuery()
  const [upsertSetting, { isLoading: isSaving }] = useUpsertAdminSettingMutation()

  const [form, setForm] = useState<WebsiteSettingsForm>(defaultForm)

  const settingsMap = useMemo(
    () => Object.fromEntries(settings.map((setting) => [setting.key, setting.value] as const)),
    [settings],
  )

  useEffect(() => {
    startTransition(() => setForm((previous) => ({
      ...previous,
      'site.title': settingsMap['site.title'] ?? previous['site.title'] ?? '',
      'site.description': settingsMap['site.description'] ?? previous['site.description'] ?? '',
      'site.tagline': settingsMap['site.tagline'] ?? previous['site.tagline'] ?? '',
      BKASH_MANUAL_PAYMENT_NUMBER: settingsMap.BKASH_MANUAL_PAYMENT_NUMBER ?? previous.BKASH_MANUAL_PAYMENT_NUMBER ?? '',
    })))
  }, [settingsMap])

  const handleSave = async () => {
    const toastId = toast.loading('Saving website settings...')

    try {
      const settingsToSave = [
        { key: 'site.title', value: form['site.title'] },
        { key: 'site.description', value: form['site.description'] },
        { key: 'site.tagline', value: form['site.tagline'] },
        { key: 'BKASH_MANUAL_PAYMENT_NUMBER', value: form.BKASH_MANUAL_PAYMENT_NUMBER },
      ]

      await upsertSetting(settingsToSave).unwrap()
      toast.success('Website settings saved successfully.', { id: toastId })
    } catch {
      toast.error('Unable to save website settings.', { id: toastId })
    }
  }

  return (
    <motion.div className="space-y-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div className="space-y-2 border-b border-border/40 pb-6" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="flex items-center gap-3">
          <motion.div className="p-2 bg-linear-to-br from-cyan-500 to-cyan-600 rounded-lg" whileHover={{ scale: 1.1 }}>
          <Globe className="h-5 w-5 text-white" />
          </motion.div>
          <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Website Settings</h1>
        <p className="text-base text-muted-foreground/80">Manage your brand identity, SEO metadata, and payment information.</p>
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
      <Card className="premium-border overflow-hidden bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
        <CardHeader className="border-b border-border/40 bg-linear-to-r from-muted/50 via-muted/30 to-transparent px-6 py-4">
          <CardTitle className="text-2xl font-bold text-foreground">Metadata & Branding</CardTitle>
        </CardHeader>

        <CardContent className="space-y-8 p-6 sm:p-8">
          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <div className="space-y-8">
              <motion.div className="grid gap-6 md:grid-cols-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.1, delayChildren: 0.2 }}>
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                  <Label htmlFor="site.title" className="text-sm font-semibold text-foreground/90">Site Title</Label>
                  <Input
                    id="site.title"
                    value={form['site.title']}
                    onChange={(event) => setForm((previous) => ({ ...previous, 'site.title': event.target.value }))}
                    placeholder="SportZoneBD"
                    className="rounded-lg border-border/60 bg-background/60 px-4 py-2.5 text-base transition hover:border-border focus:bg-background focus:ring-2 focus:ring-accent/30"
                  />
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                  <Label htmlFor="site.tagline" className="text-sm font-semibold text-foreground/90">Site Tagline</Label>
                  <Input
                    id="site.tagline"
                    value={form['site.tagline']}
                    onChange={(event) => setForm((previous) => ({ ...previous, 'site.tagline': event.target.value }))}
                    placeholder="Live sports & entertainment"
                    className="rounded-lg border-border/60 bg-background/60 px-4 py-2.5 text-base transition hover:border-border focus:bg-background focus:ring-2 focus:ring-accent/30"
                  />
                </motion.div>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="premium-border space-y-3 rounded-xl bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3"><Label htmlFor="site.description" className="text-sm font-semibold text-foreground/90">Site Description</Label><DescriptionGenerator entityType="WEBSITE_SETTINGS" title={form['site.title'] || 'SportZoneBD'} currentDescription={form['site.description']} context={{ siteTitle: form['site.title'], tagline: form['site.tagline'], settingKey: 'site.description' }} onGenerated={(description) => setForm((previous) => ({ ...previous, 'site.description': description }))} /></div>
                <Input
                  id="site.description"
                  value={form['site.description']}
                  onChange={(event) => setForm((previous) => ({ ...previous, 'site.description': event.target.value }))}
                  placeholder="Catch live matches, channels, highlights, and premium content from one place."
                  className="rounded-lg border-border/60 bg-background/60 px-4 py-2.5 text-base transition hover:border-border focus:bg-background focus:ring-2 focus:ring-accent/30"
                />
                <p className="text-xs font-medium text-muted-foreground/70">Used for SEO and social media metadata.</p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="premium-border space-y-3 rounded-xl bg-muted/20 p-4">
                <Label htmlFor="BKASH_MANUAL_PAYMENT_NUMBER" className="text-sm font-semibold text-foreground/90">Manual bKash Payment Number</Label>
                <Input
                  id="BKASH_MANUAL_PAYMENT_NUMBER"
                  value={form.BKASH_MANUAL_PAYMENT_NUMBER}
                  onChange={(event) => setForm((previous) => ({ ...previous, BKASH_MANUAL_PAYMENT_NUMBER: event.target.value }))}
                  placeholder="01XXXXXXXXX"
                  className="rounded-lg border-border/60 bg-background/60 px-4 py-2.5 text-base font-mono transition hover:border-border focus:bg-background focus:ring-2 focus:ring-accent/30"
                />
                <p className="text-xs font-medium text-muted-foreground/70">Displayed to users during manual payment checkout.</p>
              </motion.div>
            </div>
          )}
        </CardContent>
      </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="flex justify-end border-t border-border/40 pt-6">
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
        <Button onClick={handleSave} disabled={isSaving} className="min-w-48 rounded-lg bg-linear-to-r from-accent to-accent/80 px-6 py-2.5 font-semibold shadow-md hover:shadow-lg disabled:opacity-60">
          {isSaving ? 'Saving Changes...' : 'Save Changes'}
        </Button>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
