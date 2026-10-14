import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { BellRing, CheckCircle2, Megaphone, Radio, Send, Smartphone, Users } from 'lucide-react'
import { toast } from 'sonner'

import {
  useGetModerationActivityQuery,
  useGetPushAudiencePreviewQuery,
  useSendPushCampaignMutation,
  type PushCampaignResult,
} from '../../features/moderation/moderation.api'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Label } from '../../components/ui/Label'
import { Textarea } from '../../components/ui/Textarea'
import { Skeleton } from '../../components/ui/Skeleton'

/**
 * Push and in-app campaigns.
 *
 * The recipient count shown before sending is counted by the backend from the same audience the send
 * resolves, and the count after sending is what the notification queue accepted. Delivery itself is not
 * reported as confirmed, because the platform cannot observe per-recipient delivery for a campaign.
 */

const AUDIENCE_LABELS: Record<'ALL' | 'PREMIUM' | 'FREE', string> = {
  ALL: 'Everyone with an account',
  PREMIUM: 'Active premium members',
  FREE: 'Members without an active subscription',
}

function formatMoment(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function PushCampaignPage() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [audience, setAudience] = useState<'ALL' | 'PREMIUM' | 'FREE'>('ALL')
  const [channel, setChannel] = useState<'IN_APP' | 'PUSH' | 'BOTH'>('BOTH')
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<PushCampaignResult | null>(null)

  const previewQuery = useGetPushAudiencePreviewQuery()
  const [sendCampaign, { isLoading }] = useSendPushCampaignMutation()
  const historyQuery = useGetModerationActivityQuery({
    page: 1,
    limit: 8,
    scope: 'all',
    action: 'push.campaign.sent',
  })

  const preview = useMemo(
    () => previewQuery.data?.audiences.find((entry) => entry.audience === audience) ?? null,
    [previewQuery.data, audience],
  )

  const isValid = title.trim().length >= 3 && body.trim().length >= 3
  const willSendPush = channel !== 'IN_APP'

  const handleSend = async () => {
    try {
      const campaign = await sendCampaign({
        title: title.trim(),
        body: body.trim(),
        targetAudience: audience,
        channel,
        ...(link.trim() ? { link: link.trim() } : {}),
      }).unwrap()
      setResult(campaign)
      setConfirmed(false)
      if (campaign.pushBlocked) {
        toast.warning(campaign.channel === 'PUSH'
          ? 'Push delivery is disabled by the Push Notifications Automation switch, so nothing was queued.'
          : 'In-app notifications queued; push delivery is disabled by the Push Notifications Automation switch.')
        return
      }
      toast.success(`Campaign queued for ${campaign.queuedRecipients} recipient(s).`)
    } catch (error) {
      const message = (error as { data?: { message?: string } })?.data?.message
        ?? (error instanceof Error ? error.message : 'The campaign could not be started.')
      toast.error(message)
    }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      <motion.header
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative isolate overflow-hidden rounded-4xl border border-(--border) bg-linear-to-br from-cyan-500/10 via-(--surface) to-blue-500/10 p-5 shadow-sm sm:p-7"
      >
        <motion.div
          aria-hidden="true"
          className="absolute -right-12 -top-16 h-52 w-52 rounded-full bg-cyan-500/10 blur-3xl"
          animate={{ x: [0, -8, 0], y: [0, 10, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <Megaphone className="pointer-events-none absolute -bottom-10 right-9 h-44 w-44 -rotate-12 text-cyan-500/5" aria-hidden="true" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20">
              <BellRing className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <span className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                Audience messaging
              </span>
              <h1 className="text-2xl font-semibold tracking-tight text-(--text-primary) sm:text-3xl">Push campaigns</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-(--text-muted)">
                Compose a notification, confirm the live audience count and queue the campaign. Every send is recorded with your account.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-(--border) bg-(--surface)/80 px-4 py-3 shadow-sm backdrop-blur">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-300">
              <Users className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-(--text-primary)">{preview?.recipients ?? '—'} recipients</span>
              <span className="block text-xs text-(--text-muted)">{AUDIENCE_LABELS[audience]}</span>
            </span>
          </div>
        </div>
      </motion.header>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.08 }}
          transition={{ duration: 0.4 }}
        >
        <Card className="border-(--border) shadow-sm">
          <CardHeader className="flex-row items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
              <Megaphone className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-base">Compose campaign</CardTitle>
              <p className="mt-0.5 text-xs text-(--text-muted)">Prepare and preview the message before it is queued.</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-title">Title</Label>
              <Input
                id="campaign-title"
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Tonight’s matches are live"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="campaign-body">Message</Label>
              <Textarea
                id="campaign-body"
                value={body}
                maxLength={500}
                rows={4}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Coverage starts at 8pm. Open the app to watch."
              />
              <p className="text-xs text-(--text-muted)">{body.length}/500 characters</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="campaign-link">Link (optional)</Label>
              <Input
                id="campaign-link"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="/matches or https://…"
              />
              <p className="text-xs text-(--text-muted)">Internal paths and HTTPS links only.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="campaign-audience">Audience</Label>
                <select
                  id="campaign-audience"
                  value={audience}
                  onChange={(event) => setAudience(event.target.value as 'ALL' | 'PREMIUM' | 'FREE')}
                  className="h-10 w-full rounded-md border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"
                >
                  {Object.entries(AUDIENCE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="campaign-channel">Delivery</Label>
                <select
                  id="campaign-channel"
                  value={channel}
                  onChange={(event) => setChannel(event.target.value as 'IN_APP' | 'PUSH' | 'BOTH')}
                  className="h-10 w-full rounded-md border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"
                >
                  <option value="BOTH">In-app and push</option>
                  <option value="IN_APP">In-app only</option>
                  <option value="PUSH">Push only</option>
                </select>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-(--text-secondary)">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I have checked the wording and the audience. This sends one notification per recipient and cannot be
                recalled.
              </span>
            </label>

            {/* The preview is the same text the recipients receive, so nothing has to be imagined. */}
            <div className="space-y-1 rounded-2xl border border-(--border) bg-(--nav-surface,var(--surface-soft)) p-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
                <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
                Live preview
              </p>
              <motion.div
                key={`${title}|${body}|${link}`}
                initial={{ opacity: 0.75, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl bg-(--surface) p-3 shadow-sm"
              >
                <p className="text-sm font-semibold text-(--text-primary)">{title.trim() || 'Notification title'}</p>
                <p className="mt-1 text-xs text-(--text-secondary)">{body.trim() || 'The message body appears here.'}</p>
                {link.trim() && <p className="mt-1 text-xs text-(--accent)">{link.trim()}</p>}
              </motion.div>
              <p className="text-xs text-(--text-muted)">
                {channel === 'IN_APP'
                  ? 'Shown in the in-app notification list only.'
                  : channel === 'PUSH'
                    ? 'Sent as a device push to recipients with a push subscription.'
                    : 'Shown in-app and sent as a device push where a subscription exists.'}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
                <Button
                  onClick={() => void handleSend()}
                  disabled={!isValid || !confirmed || isLoading}
                  className="inline-flex items-center gap-2 shadow-sm"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {isLoading ? 'Starting…' : 'Start campaign'}
                </Button>
              </motion.div>
              <p className="text-xs text-(--text-muted)">
                {isValid ? 'Ready to send once confirmed.' : 'A title and a message of at least 3 characters are required.'}
              </p>
            </div>

            {result && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="space-y-1 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs"
              >
                <p className="flex items-center gap-2 font-medium text-(--text-primary)">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
                  Campaign {result.campaignId.slice(0, 8)}… started
                </p>
                <p className="text-(--text-muted)">
                  Audience size {result.audienceSize} · push-eligible {result.pushEligibleRecipients} · queued{' '}
                  {result.queuedRecipients}
                </p>
                <p className="text-(--text-muted)">
                  Queued is not the same as delivered: the queue accepted these recipients, and per-recipient delivery is not
                  recorded for a campaign.
                </p>
              </motion.div>
            )}
          </CardContent>
        </Card>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.08 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className="space-y-4"
        >
          <Card className="border-(--border) shadow-sm">
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-300">
                  <Users className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <CardTitle className="text-base">Audience reach</CardTitle>
                  <p className="mt-0.5 text-xs text-(--text-muted)">Live estimate for the selected group.</p>
                </div>
              </div>
              <BellRing className="h-4 w-4 text-(--text-muted)" aria-hidden="true" />
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {previewQuery.isLoading && <Skeleton className="h-20 rounded-2xl" />}
              {previewQuery.isError && (
                <p className="text-xs text-(--text-muted)">
                  Audience counts could not be loaded. Sending stays blocked until they can be.
                </p>
              )}
              {preview && (
                <>
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-(--surface-soft)/70 p-3">
                    <span className="flex items-center gap-2 text-(--text-muted)"><Users className="h-4 w-4" aria-hidden="true" />Recipients</span>
                    <span className="text-lg font-semibold text-(--text-primary)">{preview.recipients}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-(--surface-soft)/70 p-3">
                    <span className="flex items-center gap-2 text-(--text-muted)"><Smartphone className="h-4 w-4" aria-hidden="true" />Push enabled</span>
                    <span className="text-lg font-semibold text-(--text-primary)">{preview.pushEligibleRecipients}</span>
                  </div>
                  {willSendPush && preview.pushEligibleRecipients < preview.recipients && (
                    <p className="rounded-2xl bg-(--surface-soft)/60 p-3 text-xs text-(--text-muted)">
                      {preview.recipients - preview.pushEligibleRecipients} recipient(s) have no push subscription, so push
                      cannot reach them. In-app delivery is unaffected.
                    </p>
                  )}
                </>
              )}
              {(previewQuery.data?.audiences ?? []).map((entry) => (
                <div key={entry.audience} className="flex items-center justify-between gap-2 text-xs text-(--text-muted)">
                  <span>{AUDIENCE_LABELS[entry.audience]}</span>
                  <span>{entry.recipients}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-(--border) shadow-sm">
            <CardHeader className="flex-row items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                <Radio className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <CardTitle className="text-base">Previous campaigns</CardTitle>
                <p className="mt-0.5 text-xs text-(--text-muted)">Recent queue activity.</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {historyQuery.isLoading && <Skeleton className="h-16 rounded-2xl" />}
              {!historyQuery.isLoading && (historyQuery.data?.items.length ?? 0) === 0 && (
                <p className="text-xs text-(--text-muted)">No push campaign has been recorded yet.</p>
              )}
              {historyQuery.data?.items.map((event, index) => {
                const details = (event.details ?? {}) as Record<string, unknown>
                return (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.24, delay: Math.min(index * 0.04, 0.16) }}
                    className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3 text-xs transition-colors hover:border-(--accent)/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-(--text-primary)">
                        {typeof details.title === 'string' ? details.title : 'Campaign'}
                      </span>
                      <Badge variant={event.outcome === 'success' ? 'success' : 'destructive'}>
                        {event.outcome === 'success' ? 'Queued' : 'Failed'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-(--text-muted)">
                      {event.actorName ?? 'unknown'} · {formatMoment(event.createdAt)} ·{' '}
                      {String(details.audience ?? 'ALL')} · {String(details.queuedRecipients ?? 0)} queued
                    </p>
                  </motion.div>
                )
              })}
            </CardContent>
          </Card>
        </motion.section>
      </div>
    </motion.div>
  )
}

export default PushCampaignPage
