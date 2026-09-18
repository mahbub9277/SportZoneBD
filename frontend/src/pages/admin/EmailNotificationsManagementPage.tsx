import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { PlusCircle, Trash2, Edit, Loader2, Mail, Send, Users, ExternalLink } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Textarea } from '../../components/ui/Textarea'
import { Switch } from '../../components/ui/Switch'
import {
  useGetEmailTemplatesQuery,
  useCreateEmailTemplateMutation,
  useUpdateEmailTemplateMutation,
  useDeleteEmailTemplateMutation,
  useSendEmailTemplateMutation,
  type EmailTemplate,
} from '../../features/email-notifications/email-notifications.api'
import { toast } from 'sonner'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/AlertDialog'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../components/ui/Form'
import { DescriptionGenerator } from '../../components/ai/DescriptionGenerator'

const emailTemplateSchema = z.object({
  subject: z.string().min(3, 'Subject must be at least 3 characters.'),
  body: z.string().min(10, 'Body must be at least 10 characters.'),
  targetAudience: z.enum(['ALL', 'PREMIUM', 'FREE']),
  link: z.union([z.literal(''), z.string().refine((value) => value.startsWith('/') || /^https:\/\//i.test(value), 'Use an internal path or HTTPS URL.')]),
  enabled: z.boolean(),
})

type EmailTemplateFormData = z.infer<typeof emailTemplateSchema>

export default function EmailNotificationsManagementPage() {
  const [deletingTemplate, setDeletingTemplate] = useState<EmailTemplate | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)

  const form = useForm<EmailTemplateFormData>({
    resolver: zodResolver(emailTemplateSchema),
    defaultValues: { subject: '', body: '', enabled: true, targetAudience: 'ALL', link: '' },
  })

  const { data: templates = [], isLoading: isLoadingTemplates } = useGetEmailTemplatesQuery()
  const [createTemplate, { isLoading: isCreating }] = useCreateEmailTemplateMutation()
  const [updateTemplate, { isLoading: isUpdating }] = useUpdateEmailTemplateMutation()
  const [deleteTemplate, { isLoading: isDeleting }] = useDeleteEmailTemplateMutation()
  const [sendEmailTemplate, { isLoading: isSending }] = useSendEmailTemplateMutation()

  const isEditing = selectedTemplateId !== null
  const isMutating = isCreating || isUpdating
  const subjectValue = useWatch({ control: form.control, name: 'subject' })
  const targetAudienceValue = useWatch({ control: form.control, name: 'targetAudience' })
  const enabledValue = useWatch({ control: form.control, name: 'enabled' })
  const linkValue = useWatch({ control: form.control, name: 'link' })

  const onSubmit = async (data: EmailTemplateFormData) => {
    const promise = isEditing
      ? updateTemplate({ id: selectedTemplateId!, body: data })
      : createTemplate(data)

    promise
      .unwrap()
      .then(() => {
        toast.success(`Email template ${isEditing ? 'updated' : 'created'} successfully.`)
        handleClearForm()
      })
      .catch((error) => {
        const message = error.data?.message || `Failed to ${isEditing ? 'update' : 'create'} template.`
        toast.error(message)
      })
  }

  const handleDelete = (template: EmailTemplate) => {
    setDeletingTemplate(template)
  }

  const handleDeleteConfirm = () => {
    if (!deletingTemplate) return
    if (isDeleting) return
    deleteTemplate(deletingTemplate.id)
      .unwrap()
      .then(() => toast.success('Email template deleted.'))
      .catch(() => toast.error('Failed to delete template.'))
      .finally(() => setDeletingTemplate(null))
  }

  const handleSelectForEditing = (template: EmailTemplate) => {
    setSelectedTemplateId(template.id)
    form.reset({
      subject: template.subject,
      body: template.body,
      enabled: template.enabled,
      targetAudience: template.targetAudience ?? 'ALL',
      link: template.link ?? '',
    })
  }

  useEffect(() => {
    if (isEditing) {
      document.getElementById('email-subject')?.focus()
    }
  }, [isEditing])

  const handleClearForm = () => {
    setSelectedTemplateId(null)
    form.reset({ subject: '', body: '', enabled: true, targetAudience: 'ALL', link: '' })
  }

  const handleSend = async (template: EmailTemplate) => {
    if (!template.enabled || isSending) return
    if (!window.confirm(`Send "${template.subject}" to ${(template.targetAudience ?? 'ALL').toLowerCase()} members?`)) return
    try {
      const result = await sendEmailTemplate({ id: template.id }).unwrap()
      toast.success(`Email sent to ${result.sentCount} member${result.sentCount === 1 ? '' : 's'}${result.failedCount ? `, ${result.failedCount} failed` : ''}.`)
    } catch {
      toast.error('Failed to send email campaign.')
    }
  }

  return (
    <motion.div className="w-full min-w-0 space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}>
          <div className="flex items-center gap-3">
            <motion.div className="p-2 bg-linear-to-br from-purple-500 to-purple-600 rounded-lg" whileHover={{ scale: 1.1 }}>
            <Mail className="h-5 w-5 text-white" />
            </motion.div>
            <div>
          <h1 className="text-3xl font-semibold text-(--text-primary)">Email Notifications</h1>
          <p className="mt-1 text-(--text-muted)">Create and manage email campaigns sent to subscribers.</p>
            </div>
          </div>
        </motion.div>
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
        <Button variant="outline" className="gap-2" onClick={handleClearForm}>
          <PlusCircle className="h-4 w-4" /> New email template
        </Button>
        </motion.div>
      </motion.div>

      <motion.div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
      <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) p-6 shadow-[0_20px_60px_var(--shadow)]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email subject</FormLabel>
                    <FormControl>
                      <Input placeholder="New match highlights available" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-3"><FormLabel>Body</FormLabel><DescriptionGenerator entityType="EMAIL_NOTIFICATION" title={subjectValue} currentDescription={field.value} context={{ targetAudience: targetAudienceValue, enabled: enabledValue, link: linkValue }} onGenerated={field.onChange} /></div>
                    <FormControl>
                      <Textarea rows={8} placeholder="Check out the latest match highlights..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField control={form.control} name="targetAudience" render={({ field }) => (
                <FormItem><FormLabel>Send to</FormLabel><FormControl><select {...field} className="flex h-10 w-full rounded-xl border border-(--border) bg-(--surface-soft) px-3 text-sm text-(--text-primary)"><option value="ALL">All members</option><option value="PREMIUM">Premium members</option><option value="FREE">Free members</option></select></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="link" render={({ field }) => (
                <FormItem><FormLabel>Optional link</FormLabel><FormControl><Input placeholder="/events/example or https://..." {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            <div className="space-y-4 rounded-3xl border border-(--border) bg-(--surface)/50 p-4">
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Enabled</FormLabel>
                    <div className="flex items-center gap-3">
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <span className="text-sm text-(--text-muted)">{field.value ? 'Template is active' : 'Template is inactive'}</span>
                    </div>
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isMutating}>
                {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? 'Update Template' : 'Save Template'}
              </Button>
              {isEditing && (
                <Button type="button" variant="ghost" className="w-full" onClick={handleClearForm}>
                  Cancel Edit
                </Button>
              )}
            </div>
          </form>
        </Form>
      </Card>
      <Card className="border border-(--border) bg-(--surface)/70 p-6 shadow-[0_20px_60px_var(--shadow)]">
        <CardHeader className="px-0 pt-0"><CardTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-accent" />Recipient preview</CardTitle><p className="text-sm text-(--text-muted)">Review the message before it is delivered.</p></CardHeader>
        <CardContent className="px-0 pb-0"><div className="overflow-hidden rounded-2xl border border-(--border) bg-(--background) shadow-lg"><div className="border-b border-(--border) bg-(--surface-soft) p-4"><p className="truncate text-sm font-semibold text-(--text-primary)">{subjectValue || 'Email subject preview'}</p><p className="mt-1 text-xs text-(--text-muted)">SportZoneBD notifications</p></div><p className="min-h-48 whitespace-pre-wrap wrap-break-word p-4 text-sm leading-6 text-(--text-muted)">{useWatch({ control: form.control, name: 'body' }) || 'Email body preview will appear here.'}</p>{linkValue && <div className="p-4 pt-0"><span className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-slate-950"><ExternalLink className="h-3.5 w-3.5" />Open linked content</span></div>}</div></CardContent>
      </Card>
      </motion.div>

      {isLoadingTemplates ? (
        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-(--text-muted)" /></div>
      ) : templates.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border border-(--border) bg-red-500/10 p-6 text-center text-red-400">
          No email templates have been created yet.
        </Card>
        </motion.div>
      ) : (
        <motion.div className="grid gap-4 lg:grid-cols-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.1 }}>
          {templates.map((template, index) => (
            <motion.div key={template.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
            <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) to-(--surface) p-6">
              <CardHeader className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>{template.subject}</CardTitle>
                  <p className="flex items-center gap-1 text-sm text-(--text-muted)"><Users className="h-3.5 w-3.5" />{template.targetAudience} · {template.enabled ? 'Active' : 'Disabled'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => void handleSend(template)} disabled={!template.enabled || isSending} aria-label={`Send ${template.subject}`}><Send className="h-4 w-4 text-accent" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => handleSelectForEditing(template)} aria-label="Edit email template">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(template)} aria-label="Delete email template">
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap wrap-break-word text-sm text-(--text-muted)">{template.body}</p>
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
            <AlertDialogDescription>
              This action will permanently delete the email template &quot;{deletingTemplate?.subject}&quot;. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}
