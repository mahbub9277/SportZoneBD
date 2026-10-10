import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { BellRing, Send } from 'lucide-react'
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
      toast.success(`Campaign queued for ${campaign.queuedRecipients} recipient(s).`)
    } catch (error) {
      const message = (error as { data?: { message?: string } })?.data?.message
        ?? (error instanceof Error ? error.message : 'The campaign could not be started.')
      toast.error(message)
    }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      <div>
        <h1 className="text-2xl font-semibold text-(--text-primary) sm:text-3xl">Push campaigns</h1>
        <p className="mt-1 text-sm text-(--text-muted)">
          Compose a notification, choose an audience, confirm the real recipient count and send. Every campaign is recorded
          with your account as its sender.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="border-(--border)">
          <CardHeader>
            <CardTitle className="text-base">Compose</CardTitle>
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

            <label className="flex items-start gap-2 rounded-2xl border border-(--border) bg-(--surface-soft)/50 p-3 text-xs text-(--text-secondary)">
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
              <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Preview</p>
              <div className="rounded-2xl bg-(--surface) p-3">
                <p className="text-sm font-semibold text-(--text-primary)">{title.trim() || 'Notification title'}</p>
                <p className="mt-1 text-xs text-(--text-secondary)">{body.trim() || 'The message body appears here.'}</p>
                {link.trim() && <p className="mt-1 text-xs text-(--accent)">{link.trim()}</p>}
              </div>
              <p className="text-xs text-(--text-muted)">
                {channel === 'IN_APP'
                  ? 'Shown in the in-app notification list only.'
                  : channel === 'PUSH'
                    ? 'Sent as a device push to recipients with a push subscription.'
                    : 'Shown in-app and sent as a device push where a subscription exists.'}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleSend()}
                disabled={!isValid || !confirmed || isLoading}
                className="inline-flex items-center gap-2"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                {isLoading ? 'Starting…' : 'Start campaign'}
              </Button>
              <p className="text-xs text-(--text-muted)">
                {isValid ? 'Ready to send once confirmed.' : 'A title and a message of at least 3 characters are required.'}
              </p>
            </div>

            {result && (
              <div className="space-y-1 rounded-2xl border border-(--border) bg-(--surface-soft)/60 p-3 text-xs">
                <p className="font-medium text-(--text-primary)">Campaign {result.campaignId.slice(0, 8)}… started</p>
                <p className="text-(--text-muted)">
                  Audience size {result.audienceSize} · push-eligible {result.pushEligibleRecipients} · queued{' '}
                  {result.queuedRecipients}
                </p>
                <p className="text-(--text-muted)">
                  Queued is not the same as delivered: the queue accepted these recipients, and per-recipient delivery is not
                  recorded for a campaign.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-(--border)">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Audience</CardTitle>
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
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-(--text-muted)">Recipients</span>
                    <span className="font-semibold text-(--text-primary)">{preview.recipients}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-(--text-muted)">With a push subscription</span>
                    <span className="font-semibold text-(--text-primary)">{preview.pushEligibleRecipients}</span>
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

          <Card className="border-(--border)">
            <CardHeader>
              <CardTitle className="text-base">Previous campaigns</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {historyQuery.isLoading && <Skeleton className="h-16 rounded-2xl" />}
              {!historyQuery.isLoading && (historyQuery.data?.items.length ?? 0) === 0 && (
                <p className="text-xs text-(--text-muted)">No push campaign has been recorded yet.</p>
              )}
              {historyQuery.data?.items.map((event) => {
                const details = (event.details ?? {}) as Record<string, unknown>
                return (
                  <div key={event.id} className="rounded-2xl border border-(--border) p-3 text-xs">
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
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </motion.div>
  )
}

export default PushCampaignPage
