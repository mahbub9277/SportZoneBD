import { Input } from '../../../components/ui/Input'
import { Card } from '../../../components/ui/Card'

interface MatchFiltersProps {
  searchTerm: string
  setSearchTerm: (value: string) => void
  statusFilter: string
  setStatusFilter: (value: string) => void
  setCurrentPage: (page: number) => void
}

export function MatchFilters({
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
  setCurrentPage,
}: MatchFiltersProps) {
  const handleFilterChange = (setter: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setter(e.target.value)
    setCurrentPage(1) // Reset to first page on filter change
  }

  return (
    <Card className="border-(--border) p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Input
          placeholder="Search by title..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="md:col-span-1"
        />
        <select
          value={statusFilter}
          onChange={handleFilterChange(setStatusFilter)}
          className="h-10 w-full rounded-md border border-brand-border bg-brand-surface-soft px-3 py-2 text-sm text-brand-text-primary"
        >
          <option value="All">All Statuses</option>
          <option value="UPCOMING">Upcoming</option>
          <option value="LIVE">Live</option>
          <option value="FINISHED">Finished</option>
        </select>
      </div>
    </Card>
  )
}