import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Label } from '@/components/ui/Label'
import {
  useGetSubscriptionPlansQuery,
  useCreateSubscriptionPlanMutation,
  useUpdateSubscriptionPlanMutation,
  useDeleteSubscriptionPlanMutation,
  useRestoreSubscriptionPlanMutation,
  usePermanentlyDeleteSubscriptionPlanMutation,
} from '@/features/admin/subscriptionPlans.api.ts'
import { Skeleton } from '@/components/ui/Skeleton'
import { Checkbox } from '@/components/ui/Checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/AlertDialog'
import type { SubscriptionPlan } from '@/features/admin/subscriptionPlans.api'
import { motion } from 'framer-motion'
import { Crown } from 'lucide-react'
import { DescriptionGenerator } from '../../components/ai/DescriptionGenerator'

export function SubscriptionPlanManagementPage() {
  const [showDeleted, setShowDeleted] = useState(false)
  const { data: plans = [], isLoading } = useGetSubscriptionPlansQuery({ includeDeleted: showDeleted })
  const [createPlan, { isLoading: isCreating }] = useCreateSubscriptionPlanMutation()
  const [updatePlan, { isLoading: isUpdating }] = useUpdateSubscriptionPlanMutation()
  const [deletePlan, { isLoading: isDeleting }] = useDeleteSubscriptionPlanMutation()

  const [form, setForm] = useState({
    name: '',
    price: '',
    durationDays: '',
    maxDevices: '1',
    status: 'ACTIVE',
    description: '',
  })
  const [planToDelete, setPlanToDelete] = useState<SubscriptionPlan | null>(null)
  const [restorePlan, { isLoading: isRestoring }] = useRestoreSubscriptionPlanMutation()
  const [permanentlyDeletePlan, { isLoading: isPermanentlyDeleting }] = usePermanentlyDeleteSubscriptionPlanMutation()
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null)
  const [planToPermanentlyDelete, setPlanToPermanentlyDelete] = useState<SubscriptionPlan | null>(null)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isCreating || isUpdating) return

    const price = Number(form.price)
    const durationDays = Number(form.durationDays)
    const maxDevices = Number(form.maxDevices)
    const name = form.name.trim()

    if (!name) {
      toast.error('Please enter a plan name.')
      return
    }

    if (!Number.isFinite(price) || price <= 0) {
      toast.error('Please enter a valid price greater than 0.')
      return
    }

    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      toast.error('Please enter a valid duration in days.')
      return
    }

    if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 20) {
      toast.error('Maximum devices must be a whole number between 1 and 20.')
      return
    }

    try {
      const payload = {
        name,
        price,
        durationDays,
        maxDevices,
        description: form.description.trim() || null,
        status: form.status,
      }
      if (editingPlan) {
        await updatePlan({ id: editingPlan.id, ...payload }).unwrap()
        toast.success('Subscription plan updated successfully!')
      } else {
        await createPlan(payload).unwrap()
        toast.success('New subscription plan created successfully!')
      }
      setEditingPlan(null)
      setForm({ name: '', price: '', durationDays: '', maxDevices: '1', status: 'ACTIVE', description: '' })
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = err as any
      if (error.data?.message) {
        toast.error(error.data.message)
      } else {
        toast.error('Failed to create subscription plan. Please check the fields and try again.')
      }
    }
  }

  const handleEdit = (plan: SubscriptionPlan) => {
    setEditingPlan(plan)
    setForm({ name: plan.name, price: String(plan.price), durationDays: String(plan.durationDays), maxDevices: String(plan.maxDevices), status: plan.status || 'ACTIVE', description: plan.description ?? '' })
  }

  const handleConfirmDelete = async () => {
    if (!planToDelete) return
    try {
      await deletePlan(planToDelete.id).unwrap()
      toast.success('Plan has been deleted.')
      setPlanToDelete(null)
    } catch {
      toast.error(`Failed to delete plan "${planToDelete.name}".`)
    }
  }

  const handleRestore = async (id: string) => {
    try {
      await restorePlan(id).unwrap()
      toast.success('Plan has been restored.')
    } catch {
      toast.error('Failed to restore plan.')
    }
  }

  const handlePermanentDelete = async () => {
    if (!planToPermanentlyDelete) return
    try {
      await permanentlyDeletePlan(planToPermanentlyDelete.id).unwrap()
      toast.success('Plan permanently deleted.')
      setPlanToPermanentlyDelete(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Plan history prevents permanent deletion.')
    }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} whileHover={{ y: -4 }}><Card className="border-brand-border bg-brand-surface/50 p-6 shadow-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl text-brand-text-primary"><motion.span className="grid h-9 w-9 place-items-center rounded-xl bg-linear-to-br from-amber-400 to-orange-600 text-white" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><Crown className="h-5 w-5" /></motion.span>{editingPlan ? 'Edit Subscription Plan' : 'Create Subscription Plan'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Plan Name</Label>
              <Input id="name" name="name" value={form.name} onChange={handleInputChange} placeholder="e.g., Monthly Pro" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Price (BDT)</Label>
              <Input id="price" name="price" type="number" value={form.price} onChange={handleInputChange} placeholder="e.g., 30" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="durationDays">Duration (Days)</Label>
              <Input id="durationDays" name="durationDays" type="number" value={form.durationDays} onChange={handleInputChange} placeholder="e.g., 30" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxDevices">Maximum Devices</Label>
              <Input id="maxDevices" name="maxDevices" type="number" min="1" max="20" value={form.maxDevices} onChange={handleInputChange} placeholder="e.g., 4" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={form.status} onValueChange={(value) => setForm((prev) => ({ ...prev, status: value }))}>
                <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ACTIVE">Active</SelectItem><SelectItem value="INACTIVE">Inactive</SelectItem><SelectItem value="ARCHIVED">Archived</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3"><Label htmlFor="description">Description</Label><DescriptionGenerator entityType="SUBSCRIPTION_PLAN" title={form.name} currentDescription={form.description} context={{ price: form.price, durationDays: form.durationDays, maxDevices: form.maxDevices, status: form.status }} onGenerated={(description) => setForm((previous) => ({ ...previous, description }))} /></div>
              <Input id="description" name="description" value={form.description} onChange={handleInputChange} placeholder="Optional description" />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={isCreating || isUpdating}>{isCreating || isUpdating ? 'Saving...' : editingPlan ? 'Save Changes' : 'Create Plan'}</Button>
              {editingPlan && <Button type="button" variant="outline" onClick={() => { setEditingPlan(null); setForm({ name: '', price: '', durationDays: '', maxDevices: '1', status: 'ACTIVE', description: '' }) }}>Cancel Edit</Button>}
            </div>
          </form>
        </CardContent>
      </Card></motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} whileHover={{ y: -4 }}><Card className="border-brand-border bg-brand-surface/50 p-6 shadow-xl">
        <CardHeader>
          <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <CardTitle className="text-xl text-brand-text-primary">Existing Plans</CardTitle>
            <div className="flex items-center space-x-2">
              <Checkbox id="show-deleted" checked={showDeleted} onCheckedChange={(checked) => setShowDeleted(!!checked)} />
              <Label htmlFor="show-deleted" className="text-sm font-medium">
                Show Deleted
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            plans.map((plan) => (
              <div key={plan.id} className="flex flex-col gap-3 rounded-2xl border border-brand-border bg-brand-surface-soft/70 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-semibold text-brand-text-primary">{plan.name}</p>
                  <p className="text-sm text-brand-text-muted">{plan.description || 'No description'}</p>
                  <p className="mt-1 text-xs text-brand-text-muted">Status: {plan.status} · Created {new Date(plan.createdAt ?? Date.now()).toLocaleDateString()} · Updated {new Date(plan.updatedAt ?? Date.now()).toLocaleDateString()}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                  <span className="font-semibold text-brand-text-primary">{plan.price} BDT / {plan.durationDays} days / {plan.maxDevices} devices</span>
                  {plan.deletedAt ? ( // If plan is soft-deleted, show Restore button
                    <><Button variant="outline" size="sm" onClick={() => handleRestore(plan.id)} disabled={isRestoring}>{isRestoring ? 'Restoring...' : 'Restore'}</Button><Button variant="destructive" size="sm" onClick={() => setPlanToPermanentlyDelete(plan)} disabled={isPermanentlyDeleting}>Permanent Delete</Button></>
                  ) : (
                    <><Button variant="outline" size="sm" onClick={() => handleEdit(plan)}>Edit</Button><Button variant="destructive" size="sm" onClick={() => setPlanToDelete(plan)} disabled={isDeleting}>{isDeleting ? 'Deleting...' : 'Delete'}</Button></>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card></motion.div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!planToDelete} onOpenChange={(isOpen) => !isOpen && setPlanToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will mark the plan "{planToDelete?.name}" as deleted. It can be restored later from the "Show Deleted" view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeleting ? 'Deleting...' : 'Yes, delete plan'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!planToPermanentlyDelete} onOpenChange={(open) => !open && setPlanToPermanentlyDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Permanently delete this archived plan?</AlertDialogTitle><AlertDialogDescription>This cannot be undone. Plans with subscription or payment history will be protected and rejected.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handlePermanentDelete} className="bg-destructive text-destructive-foreground">Permanently Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}