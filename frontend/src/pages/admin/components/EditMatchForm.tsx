import { useFieldArray, type UseFormReturn } from 'react-hook-form'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../../components/ui/Form'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'

type EditMatchFormValues = {
  title?: string
  homeTeamName?: string | null
  awayTeamName?: string | null
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="w-full min-w-0 space-y-6 overflow-x-hidden rounded-3xl bg-linear-to-br from-(--surface-soft)/35 to-transparent pb-2">
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