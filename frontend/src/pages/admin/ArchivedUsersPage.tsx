import { useState, useMemo } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { toast } from 'sonner';
import { useGetArchivedUsersQuery, useRestoreUserMutation, usePermanentlyDeleteUserMutation, useUnsuspendUserMutation } from '../../features/admin/users.api';
import { DataTable } from '../../components/ui/data-table/DataTable';
import { type ColumnDef } from '@tanstack/react-table';
import { type User } from '../../features/auth/auth.types';
import { buildCloudinaryUrl } from '../../utils/cloudinary';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { DataTableColumnHeader } from '../../components/ui/data-table/DataTableColumnHeader';
import { Input } from '../../components/ui/Input';
import { ArchiveRestore, Archive, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/AlertDialog';
import { type PaginationState, type SortingState } from '@tanstack/react-table';
import { motion } from 'framer-motion'

export function ArchivedUsersPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 500);
  const [filter, setFilter] = useState('all'); // 'all', 'suspended', 'deleted'
  const [restoringUser, setRestoringUser] = useState<User | null>(null);
  const [unsuspendingUser, setUnsuspendingUser] = useState<User | null>(null);
  const [permanentlyDeletingUser, setPermanentlyDeletingUser] = useState<User | null>(null);
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);

  const pagination = useMemo(() => ({ pageIndex, pageSize }), [pageIndex, pageSize]);
  const page = pageIndex + 1;

  const { data, isLoading, isFetching, error } = useGetArchivedUsersQuery({
    page,
    search: debouncedSearch,
    status: filter,
    sortBy: sorting.map((s) => `${s.id}:${s.desc ? 'desc' : 'asc'}`).join(','),
  });
  const [restoreUser] = useRestoreUserMutation();
  const [unsuspendUser] = useUnsuspendUserMutation();
  const [permanentlyDeleteUser] = usePermanentlyDeleteUserMutation();

  const handleRestoreConfirm = async () => {
    if (!restoringUser) return;
    try {
      await restoreUser(restoringUser.id).unwrap();
      toast.success(`User "${restoringUser.fullName || restoringUser.email}" has been restored.`);
      setRestoringUser(null);
    } catch {
      toast.error('Failed to restore user.');
    }
  };

  const handlePermanentDeleteConfirm = async () => {
    if (!permanentlyDeletingUser) return;
    try {
      await permanentlyDeleteUser(permanentlyDeletingUser.id).unwrap();
      toast.success(`User "${permanentlyDeletingUser.fullName || permanentlyDeletingUser.email}" has been permanently deleted.`);
      setPermanentlyDeletingUser(null);
    } catch {
      toast.error('Failed to permanently delete user.');
    }
  };

  const handleUnsuspendConfirm = async () => {
    if (!unsuspendingUser) return;
    try {
      await unsuspendUser(unsuspendingUser.id).unwrap();
      toast.success(`User "${unsuspendingUser.fullName || unsuspendingUser.email}" has been unsuspended.`);
      setUnsuspendingUser(null);
    } catch {
      toast.error('Failed to unsuspend user.');
    }
  };

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="User" />,
        cell: ({ row }) => {
          const user = row.original;
          const avatarUrl = buildCloudinaryUrl(user.avatar, { width: 40, height: 40, crop: 'fill', gravity: 'face' });
          return (
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={avatarUrl} alt={user.fullName ?? undefined} />
                <AvatarFallback name={user.fullName || user.email || ''} />
              </Avatar>
              <div>
                <span className="font-medium">{user.fullName}</span>
                <p className="max-w-48 truncate text-sm text-(--text-muted)">{user.email}</p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => {
          const user = row.original;
          const status = user.deletedAt ? 'Deleted' : 'Suspended';
          const variant = user.deletedAt ? 'destructive' : 'default';
          return <Badge variant={variant}>{status}</Badge>;
        },
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className="text-right">
            <div className="flex justify-end gap-2">
              {row.original.deletedAt ? <Button variant="outline" size="sm" onClick={() => setRestoringUser(row.original)}><ArchiveRestore size={14} className="mr-2" />Restore</Button> : <Button variant="outline" size="sm" onClick={() => setUnsuspendingUser(row.original)}><ArchiveRestore size={14} className="mr-2" />Unsuspend</Button>}
              <Button variant="destructive" size="sm" onClick={() => setPermanentlyDeletingUser(row.original)}>
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <h1 className="text-3xl font-semibold text-(--text-primary) flex items-center gap-2">
          <motion.span className="grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br from-slate-500 to-slate-700 text-white" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><Archive className="h-5 w-5" /></motion.span>
          Archived Users
        </h1>
        <p className="mt-1 text-sm text-(--text-muted)">
          Review and restore suspended or soft-deleted user accounts.
        </p>
      </motion.div>

      <motion.div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <Input
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setPagination((prev) => ({ ...prev, pageIndex: 0 })) // Reset to first page when filter changes
          }}
          className="h-10 w-auto rounded-md border border-(--border) bg-(--surface-soft) px-3 py-2 text-sm text-(--text-primary)"
        >
          <option value="all">All Archived</option>
          <option value="suspended">Suspended Only</option>
          <option value="deleted">Deleted Only</option>
        </select>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} whileHover={{ y: -4 }}><DataTable<User, unknown> 
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading || isFetching}
        error={error ? 'Failed to load archived users.' : null}
        pageCount={data?.meta.totalPages ?? -1}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
      /></motion.div>

      <AlertDialog open={!!restoringUser} onOpenChange={(isOpen) => { if (!isOpen) setRestoringUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore User Account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reactivate the user&apos;s account and allow them to log in again. Are you sure you want to restore &quot;{restoringUser?.fullName || restoringUser?.email}&quot;?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestoreConfirm} className="bg-green-600 hover:bg-green-700">Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!unsuspendingUser} onOpenChange={(isOpen) => { if (!isOpen) setUnsuspendingUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsuspend User Account?</AlertDialogTitle>
            <AlertDialogDescription>This will reactivate access for &quot;{unsuspendingUser?.fullName || unsuspendingUser?.email}&quot;.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleUnsuspendConfirm} className="bg-green-600 hover:bg-green-700">Unsuspend</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!permanentlyDeletingUser} onOpenChange={(isOpen) => { if (!isOpen) setPermanentlyDeletingUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete User?</AlertDialogTitle>
            <AlertDialogDescription>
              This action is irreversible and will permanently remove all data associated with &quot;{permanentlyDeletingUser?.fullName || permanentlyDeletingUser?.email}&quot;. This cannot be undone. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePermanentDeleteConfirm} className="bg-red-600 hover:bg-red-700">Delete Permanently</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}