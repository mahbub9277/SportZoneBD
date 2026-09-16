import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useDebounce } from '../../hooks/useDebounce'
import { toast } from 'sonner'
import { useGetUsersQuery, useCreateUserMutation, useUpdateUserMutation, useDeleteUserMutation, useSuspendUserMutation, useUnsuspendUserMutation } from '../../features/admin/users.api'
import { useGetRolesQuery } from '../../features/admin/roles.api'
import { Card, CardContent } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { AlertCircle, MoreVertical, UserPlus, Edit, Trash2, Search, Ban, CheckCircle } from 'lucide-react'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/Avatar'
import type { User } from '../../features/auth/auth.types'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/DropdownMenu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/Dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/AlertDialog'
import { UserForm } from './components/UserForm'
import { userSchema, type UserFormValues } from './components/user.schema'
import { motion } from 'framer-motion'

function UserRow({ user, onEdit, onDelete, onSuspend, onUnsuspend }: { user: User; onEdit: (user: User) => void; onDelete: (user: User) => void; onSuspend: (user: User) => void; onUnsuspend: (user: User) => void; }) {
  const getStatusClass = (user: User) => {
    if (user.isSuspended) {
      return 'bg-orange-500/20 text-orange-400';
    }
    return user.isActive ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400';
  }

  const getStatusText = (user: User) => user.isSuspended ? 'Suspended' : user.isActive ? 'Active' : 'Inactive';

  return (
    <tr className="border-b border-(--border) transition-colors hover:bg-(--surface-soft)/50">
      <td className="p-4 align-middle">
        <div className="flex items-center gap-3">
          <Avatar>
            {user.avatar && <AvatarImage src={buildCloudinaryUrl(user.avatar, { width: 40, height: 40, crop: 'fill', gravity: 'face' })} alt={user.fullName || 'User Avatar'} />}
            <AvatarFallback name={user.fullName || user.email || ''}>
              {(user.fullName || user.email || 'U').charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-(--text-primary)">{user.fullName || 'Guest User'}</p>
            <p className="text-sm text-(--text-muted)">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="p-4 align-middle text-sm text-[#b9a786]">
        {new Date(user.createdAt).toLocaleDateString()}
      </td>
      <td className="p-4 align-middle">
        <div className="flex flex-wrap gap-1">
          {user.roles?.map((role: any, roleIndex: number) => (
            <span key={role.id || role.name || `role-${roleIndex}`} className="rounded-full bg-(--accent)/20 px-2 py-0.5 text-xs font-medium text-(--accent)">
              {(role?.role?.name || role.name || role).toString().replace('_', ' ')}
            </span>
          ))}
        </div>
      </td>
      <td className="p-4 align-middle">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClass(user)}`}>
            {getStatusText(user)}
        </span>
      </td>
      <td className="p-4 align-middle">
        {user.subscription && user.subscription.status === 'ACTIVE' && new Date(user.subscription.expiresAt).getTime() > Date.now() ? (
          <span className="rounded-full bg-green-500/20 px-2.5 py-1 text-xs font-semibold text-green-400">Premium</span>
        ) : (
          <span className="rounded-full bg-gray-500/20 px-2.5 py-1 text-xs font-semibold text-gray-400">Free</span>
        )}
      </td>
      <td className="p-4 text-right align-middle">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${user.fullName || user.email}`}>
              <MoreVertical size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(user)} className="gap-2"><Edit size={14} /> Edit User</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete(user)} className="gap-2 text-red-400 focus:bg-red-500/10 focus:text-red-400"><Trash2 size={14} /> Delete</DropdownMenuItem>
            {user.isSuspended ? (
              <DropdownMenuItem onClick={() => onUnsuspend(user)} className="gap-2 text-green-400 focus:bg-green-500/10 focus:text-green-400"><CheckCircle size={14} /> Unsuspend</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onSuspend(user)} className="gap-2 text-orange-400 focus:bg-orange-500/10 focus:text-orange-400"><Ban size={14} /> Suspend</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  )
}

export function UserManagementPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const { data, isLoading, isError } = useGetUsersQuery({
    search: debouncedSearchTerm,
    page: currentPage,
    limit: itemsPerPage,
  });
  const { data: roles = [] } = useGetRolesQuery();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [suspendingUser, setSuspendingUser] = useState<User | null>(null);
  const [unsuspendingUser, setUnsuspendingUser] = useState<User | null>(null);

  const [createUser, { isLoading: isCreating }] = useCreateUserMutation();
  const [updateUser, { isLoading: isUpdating }] = useUpdateUserMutation();
  const [deleteUser] = useDeleteUserMutation();
  const [suspendUser] = useSuspendUserMutation();
  const [unsuspendUser] = useUnsuspendUserMutation();

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: { fullName: '', email: '', password: '', roleIds: [], isActive: true },
  });

  const handleCreate = () => {
    form.reset({ fullName: '', email: '', password: '', roleIds: [], isActive: true });
    setIsCreateModalOpen(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    form.reset({
      fullName: user.fullName || '',
      email: user.email || '',
      password: '', // Password is not fetched, leave blank for no change.
      roleIds: user.roles?.map((role: any) => role.id || role) || [], // The roles are now just an array of strings (IDs).
      isActive: user.isActive,
    });
  };

  const onSubmit = async (values: UserFormValues) => {
    try {
      if (editingUser) {
        await updateUser({ id: editingUser.id, ...values }).unwrap();
        toast.success(`User "${values.fullName}" updated successfully.`);
        setEditingUser(null);
      } else {
        await createUser(values).unwrap();
        toast.success(`User "${values.fullName}" created successfully.`);
        setIsCreateModalOpen(false);
      }
    } catch {
      toast.error('An error occurred. Please try again.');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingUser) return;

    try {
      await deleteUser(deletingUser.id).unwrap();
      toast.success(`User "${deletingUser.fullName || deletingUser.email}" has been deleted.`);
      setDeletingUser(null);
    } catch (error) {
      console.error(error)
      toast.error('Failed to delete user.');
    }
  };

  const handleSuspendConfirm = async () => {
    if (!suspendingUser) return;

    try {
      await suspendUser(suspendingUser.id).unwrap();
      toast.success(`User "${suspendingUser.fullName || suspendingUser.email}" has been suspended.`);
      setSuspendingUser(null);
    } catch (error) {
      console.error(error);
      toast.error('Failed to suspend user.');
    }
  };

  const handleUnsuspendConfirm = async () => {
    if (!unsuspendingUser) return;

    try {
      await unsuspendUser(unsuspendingUser.id).unwrap();
      toast.success(`User "${unsuspendingUser.fullName || unsuspendingUser.email}" has been unsuspended.`);
      setUnsuspendingUser(null);
    } catch (error) {
      console.error(error);
      toast.error('Failed to unsuspend user.');
    }
  };

  const users = data?.items ?? [];
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div>
          <h1 className="text-3xl font-semibold text-(--text-primary)">User Management</h1>
          <p className="mt-1 text-(--text-muted)">View, manage, and take action on user accounts.</p>
        </div>
        <Button className="gap-2" onClick={handleCreate}><motion.span whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><UserPlus size={16} /></motion.span> Add User</Button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} whileHover={{ y: -4 }}><Card className="border-(--border) p-4 shadow-none">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted)" size={18} />
          <Input
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              setCurrentPage(1)
            }}
            className="pl-10"
          />
        </div>
      </Card></motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} whileHover={{ y: -4 }}><Card className="overflow-hidden border-(--border) shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-(--border) bg-(--surface) text-left text-xs uppercase text-(--text-muted)">
              <tr>
                <th className="p-4 font-medium">User</th>
                <th className="p-4 font-medium">Date Joined</th>
                <th className="p-4 font-medium">Roles</th>
                <th className="p-4 font-medium">Account Status</th>
                <th className="p-4 font-medium">Membership</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-(--border)"><td colSpan={6}><Skeleton className="h-16 w-full" /></td></tr>
              ))}
              {isError && (
                <tr><td colSpan={6} className="p-6 text-center text-red-400"><AlertCircle className="mx-auto mb-2" /> Could not load users.</td></tr>
              )}
              {!isLoading && users?.map(user => <UserRow key={user.id} user={user} onEdit={handleEdit} onDelete={setDeletingUser} onSuspend={setSuspendingUser} onUnsuspend={setUnsuspendingUser} />)}
            </tbody>
          </table>
        </div>
        {!isLoading && users.length === 0 && (
          <div className="p-6 text-center text-(--text-muted)">No users found.</div>
        )}
        {totalPages > 1 && (
          <CardContent className="flex flex-col items-stretch justify-between gap-4 border-t border-(--border) p-4 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center justify-between gap-2 sm:space-x-2">
              <p className="text-sm text-(--text-muted)">Rows per page</p>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="h-10 w-auto rounded-md border border-brand-border bg-brand-surface-soft px-3 py-2 text-sm text-brand-text-primary"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm text-(--text-muted)">
                Page {currentPage} of {totalPages}
              </span>
              <Button variant="outline" onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1}>
                Previous
              </Button>
              <Button variant="outline" onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages}>
                Next
              </Button>
            </div>
          </CardContent>
        )}
      </Card></motion.div>

      <Dialog open={isCreateModalOpen || !!editingUser} onOpenChange={(isOpen) => {
        if (!isOpen) {
          setIsCreateModalOpen(false);
          setEditingUser(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Edit User' : 'Create New User'}</DialogTitle>
            <DialogDescription>
              {editingUser ? `Update details for ${editingUser.fullName}.` : 'Fill in the details to create a new user account.'}
            </DialogDescription>
          </DialogHeader>
          <UserForm form={form} onSubmit={onSubmit} isLoading={isCreating || isUpdating} roles={roles} isEditing={!!editingUser} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingUser} onOpenChange={(isOpen) => { if (!isOpen) setDeletingUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete the user account for "{deletingUser?.fullName || deletingUser?.email}". This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!suspendingUser} onOpenChange={(isOpen) => { if (!isOpen) setSuspendingUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend User Account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will temporarily disable the user's account, preventing them from logging in. Are you sure you want to suspend "{suspendingUser?.fullName || suspendingUser?.email}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSuspendConfirm} className="bg-orange-600 hover:bg-orange-700">Suspend</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!unsuspendingUser} onOpenChange={(isOpen) => { if (!isOpen) setUnsuspendingUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate User Account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will restore the user's account access, allowing them to log in again. Are you sure you want to unsuspend "{unsuspendingUser?.fullName || unsuspendingUser?.email}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnsuspendConfirm} className="bg-green-600 hover:bg-green-700">Unsuspend</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}