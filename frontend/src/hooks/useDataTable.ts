import { useState, useMemo } from 'react'
import type { PaginationState, SortingState } from '@tanstack/react-table'

interface UseDataTableProps {
  initialPageSize?: number
}

/**
 * A custom hook to manage the state of a TanStack Table, including
 * pagination and sorting. It simplifies connecting the DataTable component
 * with server-side data fetching (e.g., RTK Query).
 *
 * @param {UseDataTableProps} props - Configuration for the hook.
 * @returns An object containing the table state and state setters.
 */
export function useDataTable({ initialPageSize = 10 }: UseDataTableProps = {}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  })

  const tableState = useMemo(
    () => ({
      page: pagination.pageIndex + 1,
      limit: pagination.pageSize,
      sort: sorting.length > 0 ? `${sorting[0].id}:${sorting[0].desc ? 'desc' : 'asc'}` : undefined,
    }),
    [pagination, sorting],
  )

  return {
    sorting,
    setSorting,
    pagination,
    setPagination,
    tableState, // This object can be passed directly to your RTK Query hook
  }
}