import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import type { AutomationLog } from '../../features/admin/adminAutomation.api'
import { DataTableColumnHeader } from '../../components/ui/data-table/DataTableColumnHeader'
import { Badge } from '../../components/ui/Badge'
import { DataTableRowActions } from '../../components/ui/data-table/DataTableRowActions'

export const columns: ColumnDef<AutomationLog>[] = [
  {
    accessorKey: 'action',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Action" />,
    cell: ({ row }) => {
      const formattedAction = row.original.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      return <div className="font-medium">{formattedAction}</div>
    },
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => {
      const status = row.original.status
      const variant = status === 'SUCCESS' ? 'success' : status === 'FAILED' ? 'destructive' : 'default'
      return <Badge variant={variant}>{status}</Badge>
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },
  {
    accessorKey: 'summary',
    header: 'Summary',
    cell: ({ row }) => <div className="text-muted-foreground truncate max-w-md">{row.original.summary}</div>,
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Timestamp" />,
    cell: ({ row }) => {
      return <div className="text-sm text-muted-foreground">{format(new Date(row.original.createdAt), 'PPpp')}</div>
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      return <DataTableRowActions row={row} />
    },
  },
]