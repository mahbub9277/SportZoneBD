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
import { useDeleteUploadedFileMutation } from '@/features/admin/uploads.api'
import { useMediaUploadProgress } from '@/hooks/useMediaUploadProgress'
import { UploadProgress } from '@/components/ui/UploadProgress'
import { Switch } from '@/components/ui/Switch'
import { DescriptionGenerator } from '@/components/ai/DescriptionGenerator'

/** Mirrors the backend `match-prestart-video` upload policy: 100 MB, MP4/WebM only. */
const PRE_START_VIDEO_MAX_BYTES = 100 * 1024 * 1024
const PRE_START_VIDEO_FOLDER = 'sportzone/match-prestart'
const PRE_START_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm']

const formatMegabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

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
  const { upload: uploadFiles, progress: videoUploadProgress, isUploading: isUploadingVideo } = useMediaUploadProgress()
  const [deleteUploadedFile] = useDeleteUploadedFileMutation()

  const [form, setForm] = useState<WebsiteSettingsForm>(defaultForm)
  const [videoError, setVideoError] = useState<string | null>(null)

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

  const preStartVideoUrl = settingsMap['match.prestart_video_url']?.trim() ?? ''
  const preStartVideoPublicId = settingsMap['match.prestart_video_public_id']?.trim() ?? ''
  const isPreStartVideoEnabled = (settingsMap['match.prestart_video_enabled'] ?? 'true') !== 'false'

  const handlePreStartVideoSelected = async (file: File | undefined) => {
    if (!file) return
    setVideoError(null)
    if (!PRE_START_VIDEO_MIME_TYPES.includes(file.type)) {
      setVideoError('Only MP4 or WebM video files can be used here.')
      return
    }
    if (file.size > PRE_START_VIDEO_MAX_BYTES) {
      setVideoError(`The video must be ${formatMegabytes(PRE_START_VIDEO_MAX_BYTES)} or smaller.`)
      return
    }

    const toastId = toast.loading('Uploading pre-match video...')
    try {
      const result = await uploadFiles({ files: [file], folder: PRE_START_VIDEO_FOLDER })
      const uploaded = result.uploads[0]
      if (!uploaded) throw new Error(result.failedUploads[0] ?? 'The upload did not complete.')

      await upsertSetting([
        { key: 'match.prestart_video_url', value: uploaded.url },
        { key: 'match.prestart_video_public_id', value: uploaded.publicId },
        { key: 'match.prestart_video_enabled', value: 'true' },
      ]).unwrap()

      if (preStartVideoPublicId && preStartVideoPublicId !== uploaded.publicId) {
        try {
          await deleteUploadedFile(preStartVideoPublicId).unwrap()
        } catch {
          // The replaced asset is simply left in Cloudinary when it cannot be removed.
        }
      }
      toast.success('Pre-match video updated.', { id: toastId })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to upload the pre-match video.'
      setVideoError(message)
      toast.error(message, { id: toastId })
    }
  }

  const handlePreStartVideoRemoved = async () => {
    const toastId = toast.loading('Removing pre-match video...')
    try {
      await upsertSetting([
        { key: 'match.prestart_video_url', value: '' },
        { key: 'match.prestart_video_public_id', value: '' },
      ]).unwrap()
      if (preStartVideoPublicId) {
        try {
          await deleteUploadedFile(preStartVideoPublicId).unwrap()
        } catch {
          // Nothing else references the setting once it is cleared, so a failed delete is not an error here.
        }
      }
      setVideoError(null)
      toast.success('Pre-match video removed.', { id: toastId })
    } catch {
      toast.error('Unable to remove the pre-match video.', { id: toastId })
    }
  }

  const handlePreStartVideoToggle = async (enabled: boolean) => {
    const toastId = toast.loading(enabled ? 'Enabling pre-match video...' : 'Disabling pre-match video...')
    try {
      await upsertSetting([{ key: 'match.prestart_video_enabled', value: enabled ? 'true' : 'false' }]).unwrap()
      toast.success(enabled ? 'Pre-match video enabled.' : 'Pre-match video disabled.', { id: toastId })
    } catch {
      toast.error('Unable to change the pre-match video setting.', { id: toastId })
    }
  }

  return (
    <motion.div className="space-y-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div className="space-y-2 border-b border-(--border)/40 pb-6" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="flex items-center gap-3">
          <motion.div className="p-2 bg-linear-to-br from-cyan-500 to-cyan-600 rounded-lg" whileHover={{ scale: 1.1 }}>
          <Globe className="h-5 w-5 text-white" />
          </motion.div>
          <div>
        <h1 className="text-4xl font-bold tracking-tight text-(--text-primary)">Website Settings</h1>
        <p className="text-base text-(--text-muted)/80">Manage your brand identity, SEO metadata, and payment information.</p>
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
      <Card className="premium-border overflow-hidden bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
        <CardHeader className="border-b border-(--border)/40 bg-linear-to-r from-(--surface-soft)/50 via-(--surface-soft)/30 to-transparent px-6 py-4">
          <CardTitle className="text-2xl font-bold text-(--text-primary)">Metadata & Branding</CardTitle>
        </CardHeader>

        <CardContent className="space-y-8 p-6 sm:p-8">
          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <div className="space-y-8">
              <motion.div className="grid gap-6 md:grid-cols-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.1, delayChildren: 0.2 }}>
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                  <Label htmlFor="site.title" className="text-sm font-semibold text-(--text-primary)/90">Site Title</Label>
                  <Input
                    id="site.title"
                    value={form['site.title']}
                    onChange={(event) => setForm((previous) => ({ ...previous, 'site.title': event.target.value }))}
                    placeholder="SportZoneBD"
                    className="rounded-lg border-(--border)/60 bg-(--background)/60 px-4 py-2.5 text-base transition hover:border-(--border) focus:bg-(--background) focus:ring-2 focus:ring-(--accent)/30"
                  />
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                  <Label htmlFor="site.tagline" className="text-sm font-semibold text-(--text-primary)/90">Site Tagline</Label>
                  <Input
                    id="site.tagline"
                    value={form['site.tagline']}
                    onChange={(event) => setForm((previous) => ({ ...previous, 'site.tagline': event.target.value }))}
                    placeholder="Live sports & entertainment"
                    className="rounded-lg border-(--border)/60 bg-(--background)/60 px-4 py-2.5 text-base transition hover:border-(--border) focus:bg-(--background) focus:ring-2 focus:ring-(--accent)/30"
                  />
                </motion.div>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="premium-border space-y-3 rounded-xl bg-(--surface-soft)/20 p-4">
                <div className="flex items-center justify-between gap-3"><Label htmlFor="site.description" className="text-sm font-semibold text-(--text-primary)/90">Site Description</Label><DescriptionGenerator entityType="WEBSITE_SETTINGS" title={form['site.title'] || 'SportZoneBD'} currentDescription={form['site.description']} context={{ siteTitle: form['site.title'], tagline: form['site.tagline'], settingKey: 'site.description' }} onGenerated={(description) => setForm((previous) => ({ ...previous, 'site.description': description }))} /></div>
                <Input
                  id="site.description"
                  value={form['site.description']}
                  onChange={(event) => setForm((previous) => ({ ...previous, 'site.description': event.target.value }))}
                  placeholder="Catch live matches, channels, highlights, and premium content from one place."
                  className="rounded-lg border-(--border)/60 bg-(--background)/60 px-4 py-2.5 text-base transition hover:border-(--border) focus:bg-(--background) focus:ring-2 focus:ring-(--accent)/30"
                />
                <p className="text-xs font-medium text-(--text-muted)/70">Used for SEO and social media metadata.</p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="premium-border space-y-3 rounded-xl bg-(--surface-soft)/20 p-4">
                <Label htmlFor="BKASH_MANUAL_PAYMENT_NUMBER" className="text-sm font-semibold text-(--text-primary)/90">Manual bKash Payment Number</Label>
                <Input
                  id="BKASH_MANUAL_PAYMENT_NUMBER"
                  value={form.BKASH_MANUAL_PAYMENT_NUMBER}
                  onChange={(event) => setForm((previous) => ({ ...previous, BKASH_MANUAL_PAYMENT_NUMBER: event.target.value }))}
                  placeholder="01XXXXXXXXX"
                  className="rounded-lg border-(--border)/60 bg-(--background)/60 px-4 py-2.5 text-base font-mono transition hover:border-(--border) focus:bg-(--background) focus:ring-2 focus:ring-(--accent)/30"
                />
                <p className="text-xs font-medium text-(--text-muted)/70">Displayed to users during manual payment checkout.</p>
              </motion.div>
            </div>
          )}
        </CardContent>
      </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }}>
        <Card className="premium-border overflow-hidden bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
          <CardHeader className="border-b border-(--border)/40 bg-linear-to-r from-(--surface-soft)/50 via-(--surface-soft)/30 to-transparent px-6 py-4">
            <CardTitle className="text-2xl font-bold text-(--text-primary)">Match Page Pre-Match Video</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 p-6 sm:p-8">
            <p className="text-sm text-(--text-muted)/80">
              This MP4/WebM clip plays behind the “Match Starting Soon” panel on match pages while the broadcast is being
              prepared. It is never used as the live stream. Match pages fall back to the built-in design when the video is
              disabled, missing, or cannot be played.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-(--border)/60 bg-(--surface-soft)/20 p-4">
              <div className="min-w-0">
                <Label htmlFor="match.prestart_video_enabled" className="text-sm font-semibold text-(--text-primary)/90">Use pre-match video</Label>
                <p className="mt-1 text-xs text-(--text-muted)/70">
                  {preStartVideoUrl ? 'Enabled on match pages while waiting for the broadcast.' : 'Upload a video to enable this.'}
                </p>
              </div>
              <Switch
                id="match.prestart_video_enabled"
                checked={isPreStartVideoEnabled}
                disabled={isSaving || !preStartVideoUrl}
                onCheckedChange={(checked) => void handlePreStartVideoToggle(checked)}
              />
            </div>

            {preStartVideoUrl ? (
              <div className="premium-border space-y-3 rounded-xl bg-(--surface-soft)/20 p-4">
                <video src={preStartVideoUrl} muted loop playsInline controls preload="metadata" className="aspect-video w-full rounded-lg bg-black object-contain" />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-xs text-(--text-muted)/70">{preStartVideoUrl}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void handlePreStartVideoRemoved()} disabled={isSaving}>Remove video</Button>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-(--border)/70 bg-(--surface-soft)/10 p-4 text-sm text-(--text-muted)/70">No pre-match video configured.</p>
            )}

            <div className="space-y-3">
              <Label htmlFor="match.prestart_video_file" className="text-sm font-semibold text-(--text-primary)/90">Upload a new video</Label>
              <input
                id="match.prestart_video_file"
                type="file"
                accept="video/mp4,video/webm"
                disabled={isUploadingVideo || isSaving}
                onChange={(event) => {
                  void handlePreStartVideoSelected(event.target.files?.[0])
                  event.target.value = ''
                }}
                className="block w-full cursor-pointer text-sm text-(--text-muted) file:mr-3 file:rounded-lg file:border-0 file:bg-(--accent)/10 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-(--accent) hover:file:bg-(--accent)/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="text-xs font-medium text-(--text-muted)/70">
                {isUploadingVideo ? 'Uploading…' : `MP4 or WebM, up to ${formatMegabytes(PRE_START_VIDEO_MAX_BYTES)}.`}
              </p>
              <UploadProgress update={videoUploadProgress.update} error={isUploadingVideo ? null : videoUploadProgress.error} className="mt-2" />
              {videoError && <p className="text-xs font-medium text-(--danger)" role="alert">{videoError}</p>}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="flex justify-end border-t border-(--border)/40 pt-6">
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
        <Button onClick={handleSave} disabled={isSaving} className="min-w-48 rounded-lg bg-linear-to-r from-(--accent) to-(--accent)/80 px-6 py-2.5 font-semibold shadow-md hover:shadow-lg disabled:opacity-60">
          {isSaving ? 'Saving Changes...' : 'Save Changes'}
        </Button>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
