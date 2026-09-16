import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../../components/ui/Form'
import { Input } from '../../../components/ui/Input'
import { Button } from '../../../components/ui/Button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectPortal } from '../../../components/ui/Select'
import type { Channel } from '../../../shared/types'
import { Switch } from '../../../components/ui/Switch'
import type { Match } from '../../../features/matches/matches.types'
import { ImagePlus, Loader2, X } from 'lucide-react'

export type StreamFormValues = {
  sourceType: 'DIRECT_URL' | 'CHANNEL'
  channelId?: string
  name: string
  logo?: string
  primaryUrl: string
  backupUrl?: string
  matchId: string
  enabled: boolean
  quality: string
  status: 'READY' | 'LIVE' | 'OFFLINE' | 'ERROR'
}

interface StreamFormProps {
  form: UseFormReturn<StreamFormValues>
  onSubmit: (values: StreamFormValues) => void
  isLoading: boolean
  matches: Match[]
  channels: Channel[]
  onLogoUpload?: (file: File) => void
  isUploadingLogo?: boolean
}

export function StreamForm({ form, onSubmit, isLoading, matches, channels, onLogoUpload, isUploadingLogo = false }: StreamFormProps) {
  const logoUrl = form.watch('logo')
  const selectableMatches = matches
    .filter((match) => match.status !== 'FINISHED')
    .sort((first, second) => new Date(first.kickoffAt).getTime() - new Date(second.kickoffAt).getTime())
  const sourceType = form.watch('sourceType')
  const selectedChannel = channels.find((channel) => channel.id === form.watch('channelId'))
  const [channelSearch, setChannelSearch] = useState('')
  const selectableChannels = channels.filter((channel) => channel.name.toLowerCase().includes(channelSearch.trim().toLowerCase()))

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem><FormLabel>Channel name</FormLabel><FormControl><Input {...field} placeholder="Sportzfy Sports HD" required /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="logo" render={({ field }) => (
          <FormItem>
            <FormLabel>Channel logo</FormLabel>
            <FormControl>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  {logoUrl ? <img src={logoUrl} alt="Channel logo preview" className="h-12 w-12 rounded-xl border border-border object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground"><ImagePlus className="h-5 w-5" /></div>}
                  {onLogoUpload && <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface-soft px-3 py-2 text-sm font-medium text-text-primary transition hover:border-accent/40 hover:text-accent">
                    {isUploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    {isUploadingLogo ? 'Uploading...' : logoUrl ? 'Change logo' : 'Upload logo'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={isUploadingLogo} onChange={(event) => { const file = event.target.files?.[0]; if (file) onLogoUpload(file); event.currentTarget.value = '' }} />
                  </label>}
                  {logoUrl && <Button type="button" variant="ghost" size="icon" onClick={() => field.onChange('')} aria-label="Remove channel logo"><X className="h-4 w-4" /></Button>}
                </div>
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="primaryUrl" render={({ field }) => (
          <FormItem className="md:col-span-2"><FormLabel>Primary URL</FormLabel><FormControl><Input {...field} placeholder="https://..." required /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="backupUrl" render={({ field }) => (
          <FormItem className="md:col-span-2"><FormLabel>Backup URL (Optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ''} placeholder="https://..." /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="matchId" render={({ field }) => (
          <FormItem><FormLabel>Associated Match</FormLabel>
            <Select onValueChange={field.onChange} value={field.value} disabled={isLoading}><FormControl><SelectTrigger><SelectValue placeholder="Select an upcoming or live match" /></SelectTrigger></FormControl>
              <SelectPortal>
                <SelectContent>{selectableMatches.map(match => <SelectItem key={match.id} value={match.id}>{match.title} ({match.status === 'LIVE' ? 'Live' : new Date(match.kickoffAt).toLocaleString()})</SelectItem>)}</SelectContent>
              </SelectPortal>
            </Select><FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="sourceType" render={({ field }) => (
          <FormItem><FormLabel>Stream type</FormLabel><Select onValueChange={field.onChange} value={field.value} disabled={isLoading}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="DIRECT_URL">Match stream</SelectItem><SelectItem value="CHANNEL">Channel stream</SelectItem></SelectContent></Select><FormMessage /></FormItem>
        )} />
        {sourceType === 'CHANNEL' && <FormField control={form.control} name="channelId" render={({ field }) => (
          <FormItem><FormLabel>Existing channel</FormLabel><Input value={channelSearch} onChange={(event) => setChannelSearch(event.target.value)} placeholder="Search channels..." className="mb-2" /><Select onValueChange={field.onChange} value={field.value ?? ''} disabled={isLoading}><FormControl><SelectTrigger><SelectValue placeholder="Select an existing channel" /></SelectTrigger></FormControl><SelectPortal><SelectContent>{selectableChannels.map((channel) => <SelectItem key={channel.id} value={channel.id}>{channel.name}{channel.category?.name ? ` · ${channel.category.name}` : ''}</SelectItem>)}</SelectContent></SelectPortal></Select>{selectedChannel && <p className="mt-2 text-xs text-text-muted">Using existing {selectedChannel.name} channel record{selectedChannel.category?.name ? ` in ${selectedChannel.category.name}` : ''}.</p>}<FormMessage /></FormItem>
        )} />}
        <FormField control={form.control} name="quality" render={({ field }) => (
          <FormItem><FormLabel>Quality</FormLabel><FormControl><Input {...field} placeholder="e.g., 1080p" /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="status" render={({ field }) => (
          <FormItem><FormLabel>Status</FormLabel>
            <Select onValueChange={field.onChange} value={field.value} disabled={isLoading}>
              <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="READY">Ready</SelectItem>
                <SelectItem value="LIVE">Live</SelectItem>
                <SelectItem value="OFFLINE">Offline</SelectItem>
                <SelectItem value="ERROR">Error</SelectItem>
              </SelectContent>
            </Select><FormMessage />
          </FormItem>
        )} />
        <div className="flex items-center space-x-2 pt-2 md:pt-6">
          <FormField control={form.control} name="enabled" render={({ field }) => (
            <FormItem className="flex items-center gap-2"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel>Enabled</FormLabel></FormItem>
          )} />
        </div>
        <div className="md:col-span-2">
          <Button type="submit" disabled={isLoading} className="w-full">{isLoading ? 'Saving...' : 'Save Stream'}</Button>
        </div>
      </form>
    </Form>
  )
}