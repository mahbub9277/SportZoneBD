import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import type { Channel, ChannelCategory } from '../../shared/types'
import {
  useGetAdminChannelsQuery,
  useDeleteChannelMutation,
  useGetAdminCategoriesQuery,
  useDeleteCategoryMutation,
} from '../../features/admin/channels.api'
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/AlertDialog'
import { PlusCircle, Trash2, Edit, Search } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/Select'
import { Skeleton } from '../../components/ui/Skeleton'
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious, PaginationEllipsis } from '../../components/ui/Pagination'
import { Tv } from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { CategoryFormModal } from './components/CategoryFormModal'
import { ChannelFormModal } from './components/ChannelFormModal'

const CHANNELS_PER_PAGE = 6

export function ChannelManagementPage() {
  const { data: categoriesData, isLoading: isLoadingCategories, refetch: refetchCategories } = useGetAdminCategoriesQuery()
  const { data: channelsData, isLoading: isLoadingChannels, refetch: refetchChannels } = useGetAdminChannelsQuery()

  const [deleteCategory] = useDeleteCategoryMutation()
  const [deleteChannel] = useDeleteChannelMutation()

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [deletingChannelId, setDeletingChannelId] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState<ChannelCategory | null>(null)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [categoryPages, setCategoryPages] = useState<Record<string, number>>({})
  const [filters, setFilters] = useState({
    search: '',
    status: 'all',
    premium: 'all',
    sort: 'name-asc',
  })

  const debouncedSearch = useDebounce(filters.search, 300)

  const filteredChannels = useMemo(() => {
    if (!channelsData) return []

    let channels = [...channelsData]

    // 1. Filter by search term
    if (debouncedSearch) {
      channels = channels.filter(channel =>
        channel.name.toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    }

    // 2. Filter by status
    if (filters.status !== 'all') {
      channels = channels.filter(channel => channel.status === filters.status)
    }

    // 3. Filter by premium
    if (filters.premium !== 'all') {
      channels = channels.filter(channel => String(channel.isPremium) === filters.premium)
    }

    // 4. Sort
    const [sortKey, sortDir] = filters.sort.split('-') as [keyof Channel, 'asc' | 'desc']
    channels.sort((a, b) => {
      const valA = a[sortKey] ?? ''
      const valB = b[sortKey] ?? ''

      if (valA < valB) {
        return sortDir === 'asc' ? -1 : 1
      }
      if (valA > valB) {
        return sortDir === 'asc' ? 1 : -1
      }
      return 0
    })

    return channels
  }, [channelsData, debouncedSearch, filters])

  const handleEditCategory = (category: ChannelCategory) => {
    setEditingCategory(category)
    setIsCategoryModalOpen(true)
  }

  const handleOpenCreateCategory = () => {
    setEditingCategory(null)
    setIsCategoryModalOpen(true)
  }

  const handleEditChannel = (channel: Channel) => {
    setEditingChannel(channel)
    setIsChannelModalOpen(true)
  }

  const handleOpenCreateChannel = () => {
    setEditingChannel(null)
    setIsChannelModalOpen(true)
  }

  const handleModalSuccess = () => {
    setEditingCategory(null)
    setEditingChannel(null)
    setIsCategoryModalOpen(false)
    setIsChannelModalOpen(false)
    refetchCategories()
    refetchChannels()
  }

  const handleDeleteCategory = async () => {
    if (!deletingCategoryId) return
    await toast.promise(deleteCategory(deletingCategoryId).unwrap(), {
      loading: 'Deleting category...',
      success: () => {
        setDeletingCategoryId(null)
        refetchCategories()
        refetchChannels()
        return 'Category deleted.'
      },
      error: 'Failed to delete category.',
    })
  }

  const handleDeleteChannel = async () => {
    if (!deletingChannelId) return
    await toast.promise(deleteChannel(deletingChannelId).unwrap(), {
      loading: 'Deleting channel...',
      success: () => {
        setDeletingChannelId(null)
        refetchChannels()
        return 'Channel deleted.'
      },
      error: 'Failed to delete channel.',
    })
  }

  const renderPagination = (totalPages: number, currentPage: number, onPageChange: (page: number) => void) => {
    const items: (number | '...')[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) items.push(i)
    } else {
      items.push(1)
      if (currentPage > 3) items.push('...')
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)
      for (let i = start; i <= end; i++) {
        items.push(i)
      }
      if (currentPage < totalPages - 2) items.push('...')
      items.push(totalPages)
    }

    return (
      <Pagination className="mt-4">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious onClick={() => onPageChange(currentPage - 1)} className={currentPage === 1 ? 'pointer-events-none opacity-50' : undefined} />
          </PaginationItem>
          {items.map((item, index) => (
            <PaginationItem key={index}>
              {item === '...' ? <PaginationEllipsis /> : <PaginationLink onClick={() => onPageChange(item as number)} isActive={currentPage === item}>{item}</PaginationLink>}
            </PaginationItem>
          ))}
          <PaginationItem>
            <PaginationNext onClick={() => onPageChange(currentPage + 1)} className={currentPage === totalPages ? 'pointer-events-none opacity-50' : undefined} />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    )
  }

  if (isLoadingCategories || isLoadingChannels) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-64" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-36" />
            <Skeleton className="h-10 w-36" />
          </div>
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-7 w-1/4" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex flex-col items-center gap-2 rounded-lg border p-4">
                    <Skeleton className="h-16 w-16 rounded-full" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="text-3xl font-semibold">Channel Management</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleOpenCreateCategory}><PlusCircle size={16} className="mr-2" /> Add Category</Button>
          <Button onClick={handleOpenCreateChannel}><PlusCircle size={16} className="mr-2" /> Add Channel</Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-text-muted" />
            <Input placeholder="Search channels..." value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} className="pl-10" />
          </div>
          <Select value={filters.status} onValueChange={value => setFilters(f => ({ ...f, status: value }))}>
            <SelectTrigger><SelectValue placeholder="Filter by status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.premium} onValueChange={value => setFilters(f => ({ ...f, premium: value }))}>
            <SelectTrigger><SelectValue placeholder="Filter by type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="true">Premium</SelectItem>
              <SelectItem value="false">Free</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.sort} onValueChange={value => setFilters(f => ({ ...f, sort: value }))}>
            <SelectTrigger><SelectValue placeholder="Sort by..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name (A-Z)</SelectItem>
              <SelectItem value="name-desc">Name (Z-A)</SelectItem>
              <SelectItem value="createdAt-desc">Newest</SelectItem>
              <SelectItem value="createdAt-asc">Oldest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {categoriesData && categoriesData.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-4 border-dashed p-12 text-center">
          <Tv className="h-12 w-12 text-brand-text-muted" />
          <h3 className="text-xl font-semibold">No Categories Found</h3>
          <p className="text-brand-text-muted">Get started by creating your first channel category.</p>
          <Button onClick={handleOpenCreateCategory} className="mt-2">
            <PlusCircle size={16} className="mr-2" /> Add Category
          </Button>
        </Card>
      ) : (
        categoriesData?.map((category: ChannelCategory) => {
        const categoryChannels = filteredChannels.filter(c => c.categoryId === category.id)
        const totalPages = Math.ceil(categoryChannels.length / CHANNELS_PER_PAGE)
        const currentPage = categoryPages[category.id] ?? 1
        const paginatedChannels = categoryChannels.slice((currentPage - 1) * CHANNELS_PER_PAGE, currentPage * CHANNELS_PER_PAGE)
        const handlePageChange = (page: number) => setCategoryPages(prev => ({ ...prev, [category.id]: page }))

        return (
          <Card key={category.id}>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {category.image ? (
                  <img src={buildCloudinaryUrl(category.image, { width: 44, height: 44, crop: 'fill' })} alt={category.name} className="h-10 w-10 rounded-lg object-cover border border-border bg-surface-soft" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-soft text-xs font-semibold text-text-muted">{category.name.slice(0, 2).toUpperCase()}</div>
                )}
                <CardTitle className="text-lg">{category.name}</CardTitle>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => handleEditCategory(category)} aria-label={`Edit category ${category.name}`}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setDeletingCategoryId(category.id)} aria-label={`Delete category ${category.name}`}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {categoryChannels.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-4 lg:grid-cols-6">
                    {paginatedChannels.map((channel, idx) => (
                    <div key={channel.id || `channel-${idx}`} className="group relative flex min-h-32 flex-col items-center gap-2 rounded-2xl border border-border bg-surface-soft/50 p-3 text-center sm:p-4">
                      <img src={buildCloudinaryUrl(channel.logo, { width: 64, height: 64, crop: 'fill' })} alt={channel.name} className="h-16 w-16 rounded-full object-contain bg-gray-700 p-1" />
                      <p className="text-sm font-medium text-center">{channel.name}</p>
                      <div className="flex items-center gap-2 text-[10px] text-text-muted"><span>👍 {channel.reactionCounts?.like ?? 0}</span><span>👎 {channel.reactionCounts?.dislike ?? 0}</span></div>
                      <div className="absolute right-1 top-1 flex rounded-full border border-border/70 bg-surface/90 p-0.5 opacity-100 shadow-sm backdrop-blur-sm transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                        <Button variant="ghost" size="icon" onClick={() => handleEditChannel(channel)} aria-label={`Edit channel ${channel.name}`}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeletingChannelId(channel.id)} aria-label={`Delete channel ${channel.name}`}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  </div>
                  {totalPages > 1 && renderPagination(totalPages, currentPage, handlePageChange)}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-brand-text-muted">
                  <Search className="h-8 w-8" />
                  <p className="font-medium">No Channels Found</p>
                  <p className="text-sm">
                    No channels in this category match your current filters.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )
      }))}

      <CategoryFormModal
        isOpen={isCategoryModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCategory(null)
          }
          setIsCategoryModalOpen(open)
        }}
        onSuccess={handleModalSuccess}
        editingCategory={editingCategory}
      />

      <ChannelFormModal
        isOpen={isChannelModalOpen}
        onOpenChange={setIsChannelModalOpen}
        onSuccess={handleModalSuccess}
        editingChannel={editingChannel}
        categories={categoriesData ?? []}
      />

      {/* Delete Confirmation Dialogs */}
      <AlertDialog open={!!deletingCategoryId} onOpenChange={(isOpen) => !isOpen && setDeletingCategoryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Category?</AlertDialogTitle><AlertDialogDescription>This will also delete all channels within this category. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteCategory}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!deletingChannelId} onOpenChange={(isOpen) => !isOpen && setDeletingChannelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Channel?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteChannel}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}