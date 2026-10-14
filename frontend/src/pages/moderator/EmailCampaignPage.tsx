import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Clock3, Mail, MailCheck, Megaphone, Send, Users } from 'lucide-react'
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
      <motion.header
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative isolate overflow-hidden rounded-4xl border border-(--border) bg-linear-to-br from-violet-500/10 via-(--surface) to-fuchsia-500/10 p-5 shadow-sm sm:p-7"
      >
        <motion.div
          aria-hidden="true"
          className="absolute -right-12 -top-16 h-52 w-52 rounded-full bg-violet-500/10 blur-3xl"
          animate={{ x: [0, -8, 0], y: [0, 10, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <Mail className="pointer-events-none absolute -bottom-10 right-9 h-44 w-44 rotate-12 text-violet-500/5" aria-hidden="true" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-violet-500/20">
              <Mail className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <span className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
                <MailCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Member communications
              </span>
              <h1 className="text-2xl font-semibold tracking-tight text-(--text-primary) sm:text-3xl">Email campaigns</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-(--text-muted)">
                Send an approved template to its audience. Provider outcomes are reported as received and recorded with your account.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-(--border) bg-(--surface)/80 px-4 py-3 shadow-sm backdrop-blur">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300">
              <Users className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-(--text-primary)">{audienceSize ?? '—'} recipients</span>
              <span className="block text-xs text-(--text-muted)">{selected?.targetAudience ?? 'Select a template'}</span>
            </span>
          </div>
        </div>
      </motion.header>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.08 }}
        transition={{ duration: 0.4 }}
        className="grid gap-4 lg:grid-cols-[1.2fr_1fr]"
      >
        <Card className="border-(--border) shadow-sm">
          <CardHeader className="flex-row items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
              <Megaphone className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-base">Choose a template</CardTitle>
              <p className="mt-0.5 text-xs text-(--text-muted)">Select an approved message and review its audience.</p>
            </div>
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

            {templates.map((template, index) => (
              <motion.button
                key={template.id}
                type="button"
                onClick={() => {
                  setSelectedId(template.id)
                  setConfirmed(false)
                }}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: Math.min(index * 0.035, 0.2) }}
                whileHover={{ y: -1 }}
                className={`w-full rounded-2xl border p-3 text-left shadow-sm transition-colors ${
                  template.id === selected?.id
                    ? 'border-(--accent)/60 bg-(--accent)/5 ring-1 ring-inset ring-(--accent)/15'
                    : 'border-(--border) bg-(--surface-soft)/40 hover:border-(--accent)/40 hover:bg-(--surface-soft)/80'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-300">
                      <Mail className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="truncate text-sm font-semibold text-(--text-primary)">{template.subject}</span>
                  </span>
                  <Badge variant="secondary">{template.targetAudience}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-(--text-muted)">{template.body}</p>
              </motion.button>
            ))}

            {selected && (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-3 border-t border-(--border) pt-4"
              >
                <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3 shadow-sm">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
                    <MailCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Approved email preview
                  </p>
                  <p className="mt-1 text-sm font-medium text-(--text-primary)">{selected.subject}</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-(--text-secondary)">{selected.body}</p>
                  {selected.link && <p className="mt-1 text-xs text-(--text-muted)">Link: {selected.link}</p>}
                </div>

                <div className="grid gap-2 text-xs sm:grid-cols-3">
                  <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3">
                    <p className="flex items-center gap-1.5 text-(--text-muted)"><Users className="h-3.5 w-3.5" aria-hidden="true" />Audience</p>
                    <p className="font-medium text-(--text-primary)">{selected.targetAudience}</p>
                  </div>
                  <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3">
                    <p className="text-(--text-muted)">Recipients</p>
                    <p className="font-medium text-(--text-primary)">{audienceSize ?? '—'}</p>
                  </div>
                  <div className="rounded-2xl border border-(--border) bg-(--surface-soft)/40 p-3">
                    <p className="text-(--text-muted)">Campaign limit</p>
                    <p className="font-medium text-(--text-primary)">{maxRecipients || '—'}</p>
                  </div>
                </div>

                {willTruncate && (
                  <p className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-amber-700 dark:text-amber-300">
                    This audience is larger than the campaign limit, so only the first {maxRecipients} recipients will be
                    contacted and the rest will be reported as skipped.
                  </p>
                )}

                <label className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-(--text-secondary)">
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

                <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    onClick={() => void handleSend()}
                    disabled={!confirmed || isLoading || audienceSize === null}
                    className="inline-flex items-center gap-2 shadow-sm"
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {isLoading ? 'Sending…' : 'Start campaign'}
                  </Button>
                </motion.div>

                {result && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-1 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs"
                  >
                    <p className="flex items-center gap-2 font-medium text-(--text-primary)">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
                      Campaign {result.campaignId.slice(0, 8)}… finished
                    </p>
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
                  </motion.div>
                )}
              </motion.div>
            )}
          </CardContent>
        </Card>

        <Card className="border-(--border) shadow-sm">
          <CardHeader className="flex-row items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
              <Clock3 className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-base">Previous campaigns</CardTitle>
              <p className="mt-0.5 text-xs text-(--text-muted)">Recent email send outcomes.</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {historyQuery.isLoading && <Skeleton className="h-16 rounded-2xl" />}
            {!historyQuery.isLoading && (historyQuery.data?.items.length ?? 0) === 0 && (
              <p className="text-xs text-(--text-muted)">No email campaign has been recorded yet.</p>
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
                </motion.div>
              )
            })}
          </CardContent>
        </Card>
      </motion.section>
    </motion.div>
  )
}

export default EmailCampaignPage
