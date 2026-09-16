import { MoreHorizontal } from 'lucide-react'
import { Button } from '../Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../DropdownMenu'

interface DataTableRowActionsProps<TData> {
  row: any // Using `any` for flexibility with different row types
  onEdit?: (item: TData) => void
  onDelete?: (item: TData) => void
  // Add other common actions here
}

export function DataTableRowActions<TData>({
  row,
  onEdit,
  onDelete,
}: DataTableRowActionsProps<TData>) {
  const item = row.original as TData

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Open row actions">
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        {onEdit && <DropdownMenuItem onClick={() => onEdit(item)}>Edit</DropdownMenuItem>}
        {onDelete && <DropdownMenuItem onClick={() => onDelete(item)} className="text-destructive focus:text-destructive">Delete</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}