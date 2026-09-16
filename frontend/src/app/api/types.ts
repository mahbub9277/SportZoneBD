export interface PaginationMeta {
  totalItems: number
  itemCount: number
  itemsPerPage: number
  totalPages: number
  currentPage: number
}

export interface PaginatedResult<T> {
  items: T[]
  meta: PaginationMeta
}

export interface WrappedApiResponse<T> {
  success: boolean
  data?: T
  message?: string
  error?: unknown
  meta?: PaginationMeta
}

export type ApiResponse<T> = T | WrappedApiResponse<T>