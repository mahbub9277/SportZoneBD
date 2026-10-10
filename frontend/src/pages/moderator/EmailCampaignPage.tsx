import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Mail, Send } from 'lucide-react'
import { toast } from 'sonner'

import {
  useGetEmailCampaignAudiencesQuery,
  useGetModerationActivityQuery,
  useGetSendableEmailTemplatesQuery,
  useSendEmailCampaignMutation,
  type EmailCampaignResult,
} from '../../features/moderation/moderation.api'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/Skeleton'

/**
 * Email campaigns.
 *
 * Only the templates the platform already keeps can be sent, so the wording is reviewed rather than
 * composed here, and the audience comes from the template itself. The result reports what the mail
 * provider accepted and refused — never a delivery that was merely attempted.
 */

function formatMoment(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function EmailCampaignPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<EmailCampaignResult | null>(null)

  const templatesQuery = useGetSendableEmailTemplatesQuery()
  const audiencesQuery = useGetEmailCampaignAudiencesQuery()
  const historyQuery = useGetModerationActivityQuery({ page: 1, limit: 8, scope: 'all', action: 'email.campaign.sent' })
  const [sendCampaign, { isLoading }] = useSendEmailCampaignMutation()

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data])
  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? templates[0] ?? null,
    [templates, selectedId],
  )

  const audienceSize = useMemo(() => {
    if (!selected || !audiencesQuery.data) return null
    return audiencesQuery.data.audiences.find((entry) => entry.audience === selected.targetAudience)?.recipients ?? null
  }, [audiencesQuery.data, selected])

  const maxRecipients = audiencesQuery.data?.maxRecipients ?? 0
  const willTruncate = audienceSize !== null && maxRecipients > 0 && audienceSize > maxRecipients

  const handleSend = async () => {
    if (!selected) return
    try {
      const campaign = await sendCampaign({ id: selected.id }).unwrap()
      setResult(campaign)
      setConfirmed(false)
      toast.success(`Campaign finished: ${campaign.sentCount} accepted, ${campaign.failedCount} failed.`)
    } catch (error) {
      const message = (error as { data?: { message?: string } })?.data?.message
        ?? (error instanceof Error ? error.message : 'The campaign could not be started.')
      toast.error(message)
    }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      <div>
        <h1 className="text-2xl font-semibold text-(--text-primary) sm:text-3xl">Email campaigns</h1>
        <p className="mt-1 text-sm text-(--text-muted)">
          Send one of the reviewed templates to its audience. Delivery is reported exactly as the mail provider answered it,
          and the send is recorded with your account.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="border-(--border)">
          <CardHeader>
            <CardTitle className="text-base">Choose a template</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {templatesQuery.isLoading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-2xl" />)}
              </div>
            )}

            {templatesQuery.isError && (
              <div className="rounded-2xl border border-(--border) p-4 text-sm text-(--text-muted)">
                Templates could not be loaded.
                <Button variant="outline" className="ml-3" onClick={() => void templatesQuery.refetch()}>Retry</Button>
              </div>
            )}

            {!templatesQuery.isLoading && !templatesQuery.isError && templates.length === 0 && (
              <p className="rounded-2xl border border-(--border) p-6 text-sm text-(--text-muted)">
                No enabled email template is available. An administrator enables the templates that may be sent.
              </p>
            )}

            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => {
                  setSelectedId(template.id)
                  setConfirmed(false)
                }}
                className={`w-full rounded-2xl border p-3 text-left transition ${
                  template.id === selected?.id
                    ? 'border-(--accent) bg-(--surface-soft)'
                    : 'border-(--border) bg-(--surface-soft)/40 hover:border-(--accent)/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-(--text-primary)">{template.subject}</span>
                  <Badge variant="secondary">{template.targetAudience}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-(--text-muted)">{template.body}</p>
              </button>
            ))}

            {selected && (
              <div className="space-y-3 border-t border-(--border) pt-4">
                <div className="rounded-2xl border border-(--border) p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Preview</p>
                  <p className="mt-1 text-sm font-medium text-(--text-primary)">{selected.subject}</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-(--text-secondary)">{selected.body}</p>
                  {selected.link && <p className="mt-1 text-xs text-(--text-muted)">Link: {selected.link}</p>}
                </div>

                <div className="grid gap-2 text-xs sm:grid-cols-3">
                  <div className="rounded-2xl border border-(--border) p-3">
                    <p className="text-(--text-muted)">Audience</p>
                    <p className="font-medium text-(--text-primary)">{selected.targetAudience}</p>
                  </div>
                  <div className="rounded-2xl border border-(--border) p-3">
                    <p className="text-(--text-muted)">Recipients</p>
                    <p className="font-medium text-(--text-primary)">{audienceSize ?? '—'}</p>
                  </div>
                  <div className="rounded-2xl border border-(--border) p-3">
                    <p className="text-(--text-muted)">Campaign limit</p>
                    <p className="font-medium text-(--text-primary)">{maxRecipients || '—'}</p>
                  </div>
                </div>

                {willTruncate && (
                  <p className="rounded-2xl bg-amber-500/10 p-3 text-xs text-amber-500">
                    This audience is larger than the campaign limit, so only the first {maxRecipients} recipients will be
                    contacted and the rest will be reported as skipped.
                  </p>
                )}

                <label className="flex items-start gap-2 rounded-2xl border border-(--border) bg-(--surface-soft)/50 p-3 text-xs text-(--text-secondary)">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>
                    I have read the template and checked the audience
                    {audienceSize !== null ? ` (${audienceSize} recipients)` : ''}. Sending cannot be recalled.
                  </span>
                </label>

                <Button
                  onClick={() => void handleSend()}
                  disabled={!confirmed || isLoading || audienceSize === null}
                  className="inline-flex items-center gap-2"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {isLoading ? 'Sending…' : 'Start campaign'}
                </Button>

                {result && (
                  <div className="space-y-1 rounded-2xl border border-(--border) bg-(--surface-soft)/60 p-3 text-xs">
                    <p className="font-medium text-(--text-primary)">Campaign {result.campaignId.slice(0, 8)}… finished</p>
                    <p className="text-(--text-muted)">
                      Audience {result.totalRecipients} · attempted {result.attempted} · accepted {result.sentCount} · failed{' '}
                      {result.failedCount} · skipped {result.skippedCount}
                    </p>
                    {result.failures.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-(--text-muted)">
                        {result.failures.map((failure) => (
                          <li key={failure.email}>{failure.email}: {failure.reason}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-(--border)">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Previous campaigns</CardTitle>
            <Mail className="h-4 w-4 text-(--text-muted)" aria-hidden="true" />
          </CardHeader>
          <CardContent className="space-y-2">
            {historyQuery.isLoading && <Skeleton className="h-16 rounded-2xl" />}
            {!historyQuery.isLoading && (historyQuery.data?.items.length ?? 0) === 0 && (
              <p className="text-xs text-(--text-muted)">No email campaign has been recorded yet.</p>
            )}
            {historyQuery.data?.items.map((event) => {
              const details = (event.details ?? {}) as Record<string, unknown>
              return (
                <div key={event.id} className="rounded-2xl border border-(--border) p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-(--text-primary)">
                      {typeof details.subject === 'string' ? details.subject : 'Campaign'}
                    </span>
                    <Badge variant={event.outcome === 'success' ? 'success' : 'destructive'}>
                      {String(details.sentCount ?? 0)} accepted
                    </Badge>
                  </div>
                  <p className="mt-1 text-(--text-muted)">
                    {event.actorName ?? 'unknown'} · {formatMoment(event.createdAt)} ·{' '}
                    {String(details.failedCount ?? 0)} failed
                    {Number(details.skippedCount ?? 0) > 0 ? ` · ${String(details.skippedCount)} skipped` : ''}
                  </p>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </motion.div>
  )
}

export default EmailCampaignPage
