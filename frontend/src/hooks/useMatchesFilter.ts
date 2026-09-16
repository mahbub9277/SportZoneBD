import { useMemo, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDebounce } from './useDebounce'
import type { Match } from '../features/matches/matches.types'

const ITEMS_PER_PAGE = 9

export function useMatchesFilter(matches: Match[] | undefined) {
  const [searchParams, setSearchParams] = useSearchParams()

  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('search') || '')
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || 'All')
  const [premiumFilter, setPremiumFilter] = useState(() => searchParams.get('premium') === 'true')
  const [currentPage, setCurrentPage] = useState(() => Number(searchParams.get('page')) || 1)
  const [sortBy, setSortBy] = useState(() => searchParams.get('sort') || 'date-asc')

  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  useEffect(() => {
    const params = new URLSearchParams()
    if (debouncedSearchTerm) params.set('search', debouncedSearchTerm)
    if (statusFilter !== 'All') params.set('status', statusFilter)
    if (premiumFilter) params.set('premium', 'true')
    if (currentPage > 1) params.set('page', String(currentPage))
    if (sortBy !== 'date-asc') params.set('sort', sortBy)
    setSearchParams(params, { replace: true })
  }, [debouncedSearchTerm, statusFilter, premiumFilter, currentPage, sortBy, setSearchParams])

  const filteredAndSortedMatches = useMemo(() => {
    if (!matches) return []

    const filtered = matches.filter(match => {
      const searchMatch = debouncedSearchTerm === '' || match.title.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
      const statusMatch = statusFilter === 'All' || match.status === statusFilter
      const premiumMatch = !premiumFilter || match.premium === true
      return searchMatch && statusMatch && premiumMatch
    })

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          return new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime()
        case 'title-asc':
          return a.title.localeCompare(b.title)
        case 'title-desc':
          return b.title.localeCompare(a.title)
        case 'date-asc':
        default:
          return new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime()
      }
    })
  }, [matches, debouncedSearchTerm, statusFilter, premiumFilter, sortBy])

  const totalPages = Math.ceil(filteredAndSortedMatches.length / ITEMS_PER_PAGE)

  const paginatedMatches = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredAndSortedMatches.slice(startIndex, startIndex + ITEMS_PER_PAGE)
  }, [filteredAndSortedMatches, currentPage])

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }

  const handleClearFilters = () => {
    setSearchTerm('')
    setStatusFilter('All')
    setPremiumFilter(false)
    setSortBy('date-asc')
    setCurrentPage(1)
  }

  return {
    // State values
    searchTerm,
    statusFilter,
    premiumFilter,
    sortBy,
    currentPage,
    // Setters
    setSearchTerm,
    setStatusFilter: (value: string) => { setStatusFilter(value); setCurrentPage(1); },
    setPremiumFilter: (value: boolean) => { setPremiumFilter(value); setCurrentPage(1); },
    setSortBy,
    handlePageChange,
    handleClearFilters,
    // Derived data
    paginatedMatches,
    totalPages,
  }
}