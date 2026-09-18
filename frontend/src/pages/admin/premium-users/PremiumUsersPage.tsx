import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useGetPremiumUsersQuery } from '../../../features/admin/users.api';
import { DataTable } from '../../../components/ui/data-table/DataTable';
import { type ColumnDef } from '@tanstack/react-table';
import { type User } from '../../../features/auth/auth.types';
import { buildCloudinaryUrl } from '../../../utils/cloudinary';
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { DataTableColumnHeader } from '../../../components/ui/data-table/DataTableColumnHeader';
import { Input } from '../../../components/ui/Input';
import { ShieldCheck, MoreVertical, Eye } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui/DropdownMenu';
import { useDebounce } from '../../../hooks/useDebounce';
import { type PaginationState, type SortingState } from '@tanstack/react-table';
import { motion } from 'framer-motion'

export function PremiumUsersPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 500);
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [sorting, setSorting] = useState<SortingState>([]);

  const pagination = useMemo(() => ({ pageIndex, pageSize }), [pageIndex, pageSize]);
  const page = pageIndex + 1;

  const { data, isLoading, isFetching, error } = useGetPremiumUsersQuery({
    page,
    search: debouncedSearch,
    sortBy: sorting.length > 0
      ? sorting.map((s) => `${s.id}:${s.desc ? 'desc' : 'asc'}`).join(',')
      : undefined,
  });

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="User" />,
        cell: ({ row }) => {
          const user = row.original;
          const avatarUrl = buildCloudinaryUrl(user.avatar, {
            width: 40,
            height: 40,
            crop: 'fill',
            gravity: 'face',
          });
          return (
            <Link to={`/admin/users?search=${user.email}`} className="flex items-center gap-3 group">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={avatarUrl} alt={user.fullName ?? undefined} />
                  <AvatarFallback name={user.fullName || user.email || ''} />
                </Avatar>
                <div className="flex flex-col">
                  <span className="font-medium group-hover:text-(--accent) transition-colors">{user.fullName}</span>
                  <span className="text-sm text-gray-500">{user.email}</span>
                </div>
              </div>
            </Link>
          );
        },
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => {
          const status = row.original.isActive ? 'Active' : 'Inactive'
          const variant = row.original.isActive ? 'success' : 'destructive'
          return <Badge variant={variant}>{status}</Badge>;
        },
      },
      {
        id: 'membership',
        header: 'Membership',
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <Badge variant="success">Active</Badge>
            <span className="text-xs text-text-muted">
              Until {row.original.subscription?.expiresAt ? new Date(row.original.subscription.expiresAt).toLocaleDateString() : 'N/A'}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Member Since" />,
        cell: ({ row }) => {
          const date = new Date(row.getValue('createdAt'));
          return <span>{date.toLocaleDateString()}</span>;
        },
      },
      {
        id: 'actions',
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`Actions for ${user.fullName}`}>
                    <MoreVertical size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to={`/admin/users?search=${user.email}`} className="flex items-center gap-2 w-full">
                      <Eye size={14} /> View Profile
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [],
  );

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <h1 className="text-3xl font-semibold text-(--text-primary) flex items-center gap-2">
          <motion.span className="grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br from-amber-400 to-orange-600 text-white" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><ShieldCheck className="h-5 w-5" /></motion.span>
          Premium Users
        </h1>
        <p className="mt-1 text-sm text-(--text-muted)">
          A list of all users with an active premium subscription.
        </p>
      </motion.div>

      <motion.div className="flex items-center justify-between" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <Input
          placeholder="Search by name or email..."
          value={search}
          onChange={useCallback((e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value), [])}
          className="max-w-sm"
        />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} whileHover={{ y: -4 }}><DataTable<User, unknown>
        columns={columns}
        data={data?.items ?? []}        
        isLoading={isLoading || isFetching}
        error={error ? 'Failed to load premium users.' : null}
        pageCount={data?.meta.totalPages ?? -1}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
      /></motion.div>
    </motion.div>
  );
}