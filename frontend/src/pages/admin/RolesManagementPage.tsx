import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Skeleton } from '../../components/ui/Skeleton'
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { useGetRolesQuery, useCreateRoleMutation } from '../../features/admin/roles.api'
import { getErrorMessage } from '../../utils/get-error-message'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../components/ui/Form'
import { motion } from 'framer-motion'
import { Shield } from 'lucide-react'
import { DescriptionGenerator } from '../../components/ai/DescriptionGenerator'

const roleSchema = z.object({
  name: z.string().min(2, 'Role name must be at least 2 characters.'),
  description: z.string().optional(),
})

type RoleFormData = z.infer<typeof roleSchema>

export default function RolesManagementPage() {
  const { data: roles = [], isLoading, isFetching, refetch } = useGetRolesQuery()
  const [createRole, { isLoading: isCreating }] = useCreateRoleMutation()

  const form = useForm<RoleFormData>({
    resolver: zodResolver(roleSchema),
    defaultValues: { name: '', description: '' },
  })

  const onSubmit = (values: RoleFormData) => {
    toast.promise(createRole(values).unwrap(), {
      loading: 'Creating role...',
      success: (newRole) => {
        form.reset()
        return `Role "${newRole.name}" created successfully!`
      },
      error: (err) => getErrorMessage(err),
    })
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div className="flex items-center justify-between" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-semibold text-(--text-primary)"><motion.span className="grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br from-violet-500 to-purple-600 text-white" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><Shield className="h-5 w-5" /></motion.span>Roles</h1>
          <p className="mt-1 text-(--text-muted)">Review and create admin roles for the platform.</p>
        </div>
        <Button onClick={() => refetch()} variant="outline" className="gap-2" disabled={isFetching}>
          {isFetching ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Refresh
        </Button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} whileHover={{ y: -4 }}><Card className="border-(--border) p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-2">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Role name</FormLabel><FormControl><Input placeholder="editor" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem className="md:col-span-2"><div className="flex items-center justify-between gap-3"><FormLabel>Description</FormLabel><DescriptionGenerator entityType="ROLE" title={form.watch('name')} currentDescription={field.value ?? ''} onGenerated={field.onChange} /></div><FormControl><Input placeholder="Can review content and manage media" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="md:col-span-2">
              <Button type="submit" isLoading={isCreating}>Create role</Button>
            </div>
          </form>
        </Form>
      </Card></motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} whileHover={{ y: -4 }}><Card className="border-(--border)">
        <CardHeader>
          <CardTitle>Available roles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)
          ) : roles.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-(--text-muted)"><AlertCircle size={16} /> No roles found.</div>
          ) : (
            roles.map((role) => (
              <div key={role.id} className="flex items-center justify-between rounded-2xl border border-(--border) bg-(--surface-soft)/70 p-4">
                <div>
                  <p className="font-semibold text-(--text-primary)">{role.name}</p>
                  <p className="text-sm text-(--text-muted)">{role.description || 'No description provided.'}</p>
                </div>
                {role.isSystem ? <span className="rounded-full border border-(--accent)/30 px-3 py-1 text-xs text-(--accent)">System</span> : null}
              </div>
            ))
          )}
        </CardContent>
      </Card></motion.div>
    </motion.div>
  )
}
