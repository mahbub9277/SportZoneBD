import React, { useState, useEffect } from 'react'
import { useUpdateUserMutation } from '../admin/users.api'
import type { User } from '../auth/auth.types'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Label } from '../../components/ui/Label'
import { Checkbox } from '../../components/ui/Checkbox'
import { toast } from 'sonner'

interface EditUserFormProps {
  user: User
  onClose: () => void
}

export const EditUserForm: React.FC<EditUserFormProps> = ({ user, onClose }) => {
  const [fullName, setFullName] = useState(user.fullName || '')
  const [isActive, setIsActive] = useState(user.isActive)

  const [updateUser, { isLoading, isSuccess, isError, error }] = useUpdateUserMutation()

  useEffect(() => {
    if (isSuccess) {
      toast.success('User updated successfully.')
      onClose()
    }
    if (isError) {
      const message = typeof error === 'object' && error !== null && 'data' in error && typeof (error as { data?: { message?: string } }).data?.message === 'string'
        ? (error as { data?: { message?: string } }).data?.message
        : 'Unknown error'

      toast.error(`Failed to update user: ${message}`)
    }
  }, [isSuccess, isError, error, onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await updateUser({
      id: user.id,
      fullName,
      isActive,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="fullName">Full Name</Label>
        <Input
          id="fullName"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          disabled={isLoading}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">User Status</legend>
        <div>
          <Label className="flex cursor-pointer items-center space-x-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            <Checkbox
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(Boolean(checked))}
              disabled={isLoading}
            />
            <span>Active</span>
          </Label>
        </div>
      </fieldset>

      <div className="flex justify-end space-x-2 pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}