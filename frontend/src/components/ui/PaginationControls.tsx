import { Button } from './Button'

interface PaginationControlsProps {
  currentPage: number
  totalPages: number
  itemsPerPage: number
  setCurrentPage: (page: number) => void
  setItemsPerPage: (limit: number) => void
}

export function PaginationControls({
  currentPage,
  totalPages,
  itemsPerPage,
  setCurrentPage,
  setItemsPerPage,
}: PaginationControlsProps) {
  if (totalPages <= 1) {
    return null
  }

  return (
    <div className="flex flex-col items-center justify-between gap-4 border-t border-(--border) p-4 md:flex-row">
      <div className="flex items-center space-x-2">
        <p className="text-sm text-(--text-muted)">Rows per page</p>
        <select
          value={itemsPerPage}
          onChange={(e) => {
            setItemsPerPage(Number(e.target.value))
            setCurrentPage(1)
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
        <Button variant="outline" onClick={() => setCurrentPage(Math.max(currentPage - 1, 1))} disabled={currentPage === 1}>Previous</Button>
        <Button variant="outline" onClick={() => setCurrentPage(Math.min(currentPage + 1, totalPages))} disabled={currentPage === totalPages}>Next</Button>
      </div>
    </div>
  )
}