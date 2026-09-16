import { useState } from 'react'
import { motion } from 'framer-motion'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { PlusCircle, Trash2, Loader2, CheckCircle2, CircleOff, Bell, Edit3, Send, ExternalLink } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Textarea } from '../../components/ui/Textarea'
import { Switch } from '../../components/ui/Switch'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../components/ui/Form'
import { useGetPushNotificationTemplatesQuery, useCreatePushNotificationTemplateMutation, useDeletePushNotificationTemplateMutation, useUpdatePushNotificationTemplateMutation, type PushNotificationTemplate } from '../../features/admin/push-notifications.api'
import { getErrorMessage } from '../../utils/get-error-message'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/AlertDialog'
import { Skeleton } from '../../components/ui/Skeleton'
import { useBroadcastNotificationMutation } from '../../features/notifications/notification.api'
import { DescriptionGenerator } from '../../components/ai/DescriptionGenerator'

const templateSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters.'),
  body: z.string().min(10, 'Body must be at least 10 characters.'),
  targetAudience: z.enum(['ALL', 'PREMIUM', 'FREE']),
  link: z.union([z.literal(''), z.string().refine((value) => value.startsWith('/') || /^https:\/\//i.test(value), 'Use an internal path or HTTPS URL.')]),
  enabled: z.boolean(),
})

type TemplateFormData = z.infer<typeof templateSchema>

export default function PushNotificationsManagementPage() {
  const [deletingTemplate, setDeletingTemplate] = useState<PushNotificationTemplate | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<PushNotificationTemplate | null>(null)

  const { data: templates = [], isLoading: isLoadingTemplates, isError: isTemplatesError } = useGetPushNotificationTemplatesQuery()
  const [createTemplate, { isLoading: isCreating }] = useCreatePushNotificationTemplateMutation()
  const [updateTemplate, { isLoading: isUpdating }] = useUpdatePushNotificationTemplateMutation()
  const [deleteTemplate, { isLoading: isDeleting }] = useDeletePushNotificationTemplateMutation()
  const [broadcastNotification, { isLoading: isBroadcasting }] = useBroadcastNotificationMutation()

  const form = useForm<TemplateFormData>({
    resolver: zodResolver(templateSchema),
    defaultValues: { title: '', body: '', targetAudience: 'ALL', enabled: true, link: '' },
  })

  const onSubmit = (values: TemplateFormData) => {
    const request = editingTemplate
      ? updateTemplate({ id: editingTemplate.id, body: values })
      : createTemplate(values)
    toast.promise(request.unwrap(), {
      loading: editingTemplate ? 'Updating template...' : 'Creating template...',
      success: (newTemplate) => {
        form.reset()
        setEditingTemplate(null)
        return `Template "${newTemplate.title}" ${editingTemplate ? 'updated' : 'created'} successfully!`
      },
      error: (err) => getErrorMessage(err),
    })
  }

  const startEditing = (template: PushNotificationTemplate) => {
    setEditingTemplate(template)
    form.reset({ title: template.title, body: template.body, targetAudience: template.targetAudience, enabled: template.enabled, link: template.link ?? '' })
  }

  const clearForm = () => {
    setEditingTemplate(null)
    form.reset({ title: '', body: '', targetAudience: 'ALL', enabled: true, link: '' })
  }

  const handleDeleteConfirm = () => {
    if (!deletingTemplate) return
    toast.promise(deleteTemplate(deletingTemplate.id).unwrap(), {
      loading: 'Deleting template...',
      success: () => {
        setDeletingTemplate(null)
        return 'Template deleted successfully.'
      },
      error: (err) => getErrorMessage(err),
    })
  }

  const sendTemplate = async (template: PushNotificationTemplate) => {
    if (!template.enabled || isBroadcasting) return
    if (!window.confirm(`Send "${template.title}" to all active users?`)) return
    try {
      const result = await broadcastNotification({ title: template.title, body: template.body, type: 'info', link: template.link || undefined, targetAudience: template.targetAudience }).unwrap()
      toast.success(`Notification sent to ${result.createdCount} user${result.createdCount === 1 ? '' : 's'}.`)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <motion.div className="w-full min-w-0 space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div className="rounded-3xl border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) p-6 shadow-[0_20px_60px_var(--shadow)] sm:p-8" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <motion.div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}>
            <div className="flex items-center gap-3">
              <motion.div className="p-2 bg-linear-to-br from-orange-500 to-orange-600 rounded-lg" whileHover={{ scale: 1.1 }}>
              <Bell className="h-5 w-5 text-white" />
              </motion.div>
              <div>
            <h1 className="text-3xl font-semibold text-(--text-primary) sm:text-4xl">Push Notifications</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-(--text-muted)">Create and manage premium notification templates for targeted user engagement.</p>
              </div>
            </div>
          </motion.div>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <Button variant="secondary" className="gap-2 rounded-full px-5 py-3" onClick={clearForm}>
            <PlusCircle className="h-4 w-4" /> {editingTemplate ? 'New template' : 'New template'}
          </Button>
          </motion.div>
        </motion.div>
      </motion.div>

      <motion.div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
      <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) p-6 shadow-[0_20px_60px_var(--shadow)] sm:p-7">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem><FormLabel>Title</FormLabel><FormControl><Input placeholder="Match starting soon" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="body" render={({ field }) => (
                <FormItem><div className="flex items-center justify-between gap-3"><FormLabel>Message body</FormLabel><DescriptionGenerator entityType="PUSH_NOTIFICATION" title={form.watch('title')} currentDescription={field.value} context={{ targetAudience: form.watch('targetAudience'), enabled: form.watch('enabled'), link: form.watch('link') }} onGenerated={field.onChange} /></div><FormControl><Textarea rows={4} placeholder="Your favorite match is about to begin." {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="targetAudience" render={({ field }) => (
                <FormItem><FormLabel>Target audience</FormLabel><FormControl><select {...field} className="flex h-10 w-full rounded-xl border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"><option value="ALL">All members</option><option value="PREMIUM">Premium members</option><option value="FREE">Free members</option></select></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="link" render={({ field }) => (
                <FormItem><FormLabel>Notification link</FormLabel><FormControl><Input placeholder="/events/example or https://..." {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            <div className="space-y-4 rounded-3xl border border-(--border) bg-(--surface)/50 p-4">
              <FormField control={form.control} name="enabled" render={({ field }) => (
                <FormItem>
                  <FormLabel>Enabled</FormLabel>
                  <div className="flex items-center gap-3">
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <span className="text-sm text-(--text-muted)">{field.value ? 'Template is active' : 'Template is disabled'}</span>
                  </div>
                </FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={isCreating || isUpdating}>
                {(isCreating || isUpdating) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingTemplate ? 'Update Template' : 'Save Template'}
              </Button>
              {editingTemplate && <Button type="button" variant="ghost" className="w-full" onClick={clearForm}>Cancel Edit</Button>}
            </div>
          </form>
        </Form>
      </Card>
      <Card className="border border-(--border) bg-(--surface)/70 p-6 shadow-[0_20px_60px_var(--shadow)] sm:p-7">
        <CardHeader className="px-0 pt-0"><CardTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-accent" />Delivery preview</CardTitle><p className="text-sm text-(--text-muted)">Preview the notification as users will receive it.</p></CardHeader>
        <CardContent className="px-0 pb-0"><div className="rounded-2xl border border-(--border) bg-(--background) p-4 shadow-lg"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-slate-950"><Bell className="h-5 w-5" /></div><div className="min-w-0"><p className="truncate font-semibold text-(--text-primary)">{form.watch('title') || 'Notification title'}</p><p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm text-(--text-muted)">{form.watch('body') || 'Notification message preview will appear here.'}</p><p className="mt-3 text-xs text-(--text-muted)">Audience: {form.watch('targetAudience') === 'PREMIUM' ? 'Premium members' : form.watch('targetAudience') === 'FREE' ? 'Free members' : 'All members'}</p>{form.watch('link') && <p className="mt-2 flex items-center gap-1 text-xs text-accent"><ExternalLink className="h-3 w-3" />Click opens linked content</p>}</div></div></div></CardContent>
      </Card>
      </motion.div>

      {isLoadingTemplates ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : isTemplatesError ? (
        <Card className="border-(--danger)/30 bg-(--danger-soft) p-6 text-center text-(--danger)">
          Unable to load push notification templates. Please try again shortly.
        </Card>
      ) : templates.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border border-(--border) bg-red-500/10 p-6 text-center text-red-400">
          No push notification templates configured yet.
        </Card>
        </motion.div>
      ) : (
        <motion.div className="grid gap-4 lg:grid-cols-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.1 }}>
          {templates.map((template, index) => (
            <motion.div key={template.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
            <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface) p-5 transition-colors hover:border-accent/40 sm:p-6">
              <CardHeader className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>{template.title}</CardTitle>
                  <div className="flex items-center gap-2 text-sm text-(--text-muted)">
                    {template.enabled ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <CircleOff className="h-4 w-4 text-(--text-muted)" />}
                    <span>{template.targetAudience} · {template.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1"><Button variant="ghost" size="icon" onClick={() => void sendTemplate(template)} disabled={!template.enabled || isBroadcasting} aria-label={`Send ${template.title}`}><Send className="h-4 w-4 text-accent" /></Button><Button variant="ghost" size="icon" onClick={() => startEditing(template)} aria-label={`Edit ${template.title}`}><Edit3 className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => setDeletingTemplate(template)} aria-label="Delete template"><Trash2 className="h-4 w-4 text-red-500" /></Button></div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-(--text-muted)">{template.body}</p>
              </CardContent>
            </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      <AlertDialog open={!!deletingTemplate} onOpenChange={(isOpen) => !isOpen && setDeletingTemplate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>This action will permanently delete the template "{deletingTemplate?.title}".</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteConfirm} disabled={isDeleting} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}
