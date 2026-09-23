import { useState } from 'react'
import { useFieldArray, type UseFormReturn } from 'react-hook-form'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../../components/ui/Form'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useParseMatchMutation, type ParsedMatchDetails } from '../../../features/ai/ai.api'

type EditMatchFormValues = {
  title?: string
  homeTeamName?: string | null
  awayTeamName?: string | null
  homeTeamId?: string | null
  awayTeamId?: string | null
  homeTeamLogo?: string | null
  awayTeamLogo?: string | null
  kickoffDate?: string
  kickoffTime?: string
  expectedDurationMinutes?: number
  expectedEndTime?: string
  autoFinish?: boolean
  status: 'LIVE' | 'UPCOMING' | 'FINISHED'
  streams?: {
    id?: string
    name?: string
    logo?: string | null
    sourceType?: 'DIRECT_URL' | 'CHANNEL'
    channelId?: string | null
    primaryUrl: string
    backupUrl?: string | null
    quality: string
    status: string
  }[]
}

interface EditMatchFormProps {
  form: UseFormReturn<EditMatchFormValues>
  onSubmit: (values: EditMatchFormValues) => void
  isLoading: boolean
  children?: React.ReactNode
}

export function EditMatchForm({ form, onSubmit, isLoading }: EditMatchFormProps) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'streams',
  })
  const [prompt, setPrompt] = useState('')
  const [parseMatch, { isLoading: isAssistantLoading }] = useParseMatchMutation()
  const [lastResult, setLastResult] = useState<ParsedMatchDetails | null>(null)

  const applyAssistantResult = (result: ParsedMatchDetails) => {
    const setFormValue = form.setValue as unknown as (name: keyof EditMatchFormValues, value: unknown, options: { shouldDirty: boolean; shouldValidate: boolean }) => void
    const setIfUntouched = <T extends keyof EditMatchFormValues>(name: T, value: EditMatchFormValues[T] | null | undefined) => {
      if (value === null || value === undefined || form.getFieldState(name).isDirty) return false
      setFormValue(name, value, { shouldDirty: true, shouldValidate: true })
      return true
    }

    let applied = 0
    if (setIfUntouched('title', result.title)) applied += 1
    if (setIfUntouched('homeTeamName', result.homeTeamName)) applied += 1
    if (setIfUntouched('awayTeamName', result.awayTeamName)) applied += 1
    if (setIfUntouched('homeTeamLogo', result.homeTeamLogo)) applied += 1
    if (setIfUntouched('awayTeamLogo', result.awayTeamLogo)) applied += 1
    if (setIfUntouched('kickoffDate', result.kickoffDate)) applied += 1
    if (setIfUntouched('kickoffTime', result.kickoffTime)) applied += 1
    setLastResult(result)
    toast.success(`AI applied ${applied} trusted field${applied === 1 ? '' : 's'}. Review before saving.`)
    if (result.warnings.length > 0) toast.warning(result.warnings[0])
  }

  const handleAssistantParse = async () => {
    const input = prompt.trim()
    if (!input) {
      toast.error('Describe the match before using the AI assistant.')
      return
    }
    try {
      const result = await parseMatch({ input }).unwrap()
      applyAssistantResult(result)
    } catch {
      toast.error('AI could not interpret this match description. Please try again.')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="w-full min-w-0 space-y-6 overflow-x-hidden rounded-3xl bg-linear-to-br from-(--surface-soft)/35 to-transparent pb-2">
        <section className="relative overflow-hidden rounded-2xl border border-accent/35 bg-linear-to-br from-accent/12 via-surface-soft/90 to-surface p-4 shadow-[0_18px_50px_rgba(2,6,23,0.16)] ring-1 ring-accent/10 sm:p-5">
          <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><span className="grid h-8 w-8 place-items-center rounded-xl bg-accent/15 text-accent"><Sparkles className="h-4 w-4" /></span> Edit Match Copilot <span className="rounded-full border border-success/25 bg-success-soft px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-success">Ready</span></div><p className="mt-2 max-w-2xl text-xs leading-5 text-text-muted">Describe corrected teams, competition, date, or kickoff time. Existing values stay protected until you review the suggestion.</p></div>
            <span className="self-start rounded-full border border-border bg-surface/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Review before save</span>
          </div>
          <div className="relative mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-stretch"><Input value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} aria-label="Describe match changes for AI" placeholder="Correct the teams and kickoff for Real Madrid vs Barcelona..." disabled={isLoading || isAssistantLoading} className="min-h-11 min-w-0 bg-background/35" /><Button type="button" onClick={() => void handleAssistantParse()} disabled={isLoading || isAssistantLoading} className="min-h-11 shrink-0 gap-2 px-5 sm:min-w-40">{isAssistantLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{isAssistantLoading ? 'Analyzing...' : 'Analyze changes'}</Button></div>
          <div className="relative mt-3 flex flex-wrap gap-2 text-[10px] text-text-muted"><span className="rounded-full border border-border bg-surface/60 px-2 py-1">Teams + competition</span><span className="rounded-full border border-border bg-surface/60 px-2 py-1">Date + kickoff</span><span className="rounded-full border border-border bg-surface/60 px-2 py-1">Human review</span></div>
          {lastResult && <div className="relative mt-3 rounded-xl border border-border/70 bg-background/25 px-3 py-2.5 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-text-primary">Draft details extracted{lastResult.title ? ` for ${lastResult.title}` : ''}</p><span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] text-success">{Object.values(lastResult.confidence).filter((level) => level === 'high').length} high-confidence</span></div><p className="mt-0.5 text-[11px] text-text-muted">Review the highlighted fields before saving.</p>{lastResult.warnings.length > 0 && <p className="mt-2 text-warning">{lastResult.warnings[0]}</p>}</div>}
        </section>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField control={form.control} name="homeTeamName" render={({ field }) => <FormItem><FormLabel>Home team</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="Home team name" /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="awayTeamName" render={({ field }) => <FormItem><FormLabel>Away team</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="Away team name" /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="kickoffDate" render={({ field }) => <FormItem><FormLabel>Kickoff date</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="kickoffTime" render={({ field }) => <FormItem><FormLabel>Kickoff time (Dhaka)</FormLabel><FormControl><Input type="time" step={60} {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="expectedDurationMinutes" render={({ field }) => <FormItem><FormLabel>Expected duration (minutes)</FormLabel><FormControl><Input type="number" min={1} max={1440} {...field} value={field.value ?? 120} onChange={(event) => field.onChange(Number(event.target.value) || 1)} /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="expectedEndTime" render={({ field }) => <FormItem><FormLabel>Expected end</FormLabel><FormControl><Input type="datetime-local" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>} />
        </div>
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem className="space-y-2 rounded-2xl border border-(--border)/80 bg-(--surface-soft)/55 p-4 shadow-[0_12px_30px_rgba(2,6,23,0.08)]">
              <FormLabel className="text-xs font-semibold uppercase tracking-[0.14em] text-(--text-muted)">Match status</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="h-11 w-full rounded-xl border border-(--border) bg-(--surface) px-4 py-2 text-sm font-medium text-(--text-primary) outline-none transition-colors focus:border-(--accent)/70 focus:ring-2 focus:ring-(--accent)/20"
                >
                  <option value="UPCOMING">Upcoming</option>
                  <option value="LIVE">Live</option>
                  <option value="FINISHED">Finished</option>
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div>
          <div className="mb-3 flex flex-col gap-2 border-b border-(--border) pb-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-(--text-primary)">Streams</h3><p className="mt-1 text-xs text-(--text-muted)">Update playback sources without changing match metadata.</p></div><span className="rounded-full border border-(--border) bg-(--surface-soft) px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-(--text-muted)">Optional</span></div>
          {fields.map((field, index) => (
            <div key={field.id} className="mb-4 min-w-0 space-y-3 rounded-3xl border border-(--border)/80 bg-linear-to-br from-(--surface-soft) to-(--surface) p-4 shadow-[0_16px_40px_rgba(2,6,23,0.12)] sm:p-5">
              <FormField control={form.control} name={`streams.${index}.name`} render={({ field }) => (
                <FormItem><FormLabel>Channel Name</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="Sportzfy Sports HD" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name={`streams.${index}.logo`} render={({ field }) => (
                <FormItem><FormLabel>Channel Logo URL</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="https://..." /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name={`streams.${index}.sourceType`} render={({ field }) => (
                <FormItem><FormLabel>Source type</FormLabel><FormControl><select {...field} value={field.value ?? 'DIRECT_URL'} className="h-11 w-full rounded-xl border border-(--border) bg-(--surface) px-3 text-sm"><option value="DIRECT_URL">Direct URL</option><option value="CHANNEL">Existing channel</option></select></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name={`streams.${index}.channelId`} render={({ field }) => (
                <FormItem><FormLabel>Channel ID (for channel source)</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="Existing channel ID" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name={`streams.${index}.primaryUrl`} render={({ field }) => (
                <FormItem className="min-w-0"><FormLabel>Primary URL</FormLabel><FormControl><Input {...field} className="min-w-0" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name={`streams.${index}.backupUrl`} render={({ field }) => (
                <FormItem><FormLabel>Backup URL (Optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name={`streams.${index}.quality`} render={({ field }) => (
                <FormItem><FormLabel>Quality (e.g., 1080p)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <Button type="button" variant="destructive" size="sm" onClick={() => remove(index)}>Remove Stream</Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => append({ name: 'Main stream', logo: '', sourceType: 'DIRECT_URL', channelId: '', primaryUrl: '', backupUrl: '', quality: '1080p', status: 'READY' })}
            className="min-h-10 border-dashed hover:border-(--accent)/60 hover:bg-(--accent)/5"
          >
            Add Stream
          </Button>
        </div>
        <Button type="submit" isLoading={isLoading} className="min-h-12 w-full rounded-2xl bg-(--accent) font-semibold text-slate-950 shadow-[0_12px_30px_rgba(247,199,93,0.18)] hover:bg-(--accent-strong)">
          <span>Save Changes</span>
        </Button>
      </form>
    </Form>
  )
}