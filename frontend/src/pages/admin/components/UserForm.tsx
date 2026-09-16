import type { UseFormReturn } from 'react-hook-form'
import { Button } from '../../../components/ui/Button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../../components/ui/Form'
import { Input } from '../../../components/ui/Input'
import { Switch } from '../../../components/ui/Switch'
import type { Role } from '../../../features/admin/roles.api'
import { type UserFormValues } from './user.schema'

interface UserFormProps {
  form: UseFormReturn<UserFormValues>;
  onSubmit: (values: UserFormValues) => void;
  isLoading: boolean;
  roles: Role[];
  isEditing?: boolean;
  submitButtonText?: string;
}

export function UserForm({
  form,
  onSubmit,
  isLoading,
  roles,
  isEditing = false,
  submitButtonText = 'Save User',
}: UserFormProps) {
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Your Name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email Address</FormLabel>
              <FormControl>
                <Input type="email" placeholder="user@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" placeholder={isEditing ? 'Leave blank to keep current password' : '••••••••'} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="roleIds"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Roles</FormLabel>
              <FormControl>
                {/* For simplicity, this is a single-select. For multi-select, a more advanced component would be needed. */}
                <select
                  value={field.value?.[0] || ''}
                  onChange={(e) => field.onChange([e.target.value])}
                  className="h-10 w-full rounded-md border border-brand-border bg-brand-surface-soft px-3 py-2 text-sm text-brand-text-primary"
                >
                  <option value="" disabled>Select a role...</option>
                  {roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border border-(--border) p-3 shadow-sm">
              <div className="space-y-0.5">
                <FormLabel>User Status</FormLabel>
                <p className="text-xs text-(--text-muted)">Inactive users cannot log in.</p>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" isLoading={isLoading}>
          {submitButtonText}
        </Button>
      </form>
    </Form>
  );
}