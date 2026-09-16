export interface PaginationMeta {
  totalItems: number
  itemCount: number
  itemsPerPage: number
  totalPages: number
  currentPage: number
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
  error?: unknown
  meta?: PaginationMeta
}

export function successResponse<T>(
  data: T,
  message = 'Success',
  meta?: PaginationMeta,
): ApiResponse<T> {
  return { success: true, data, message, meta }
}

export function errorResponse(
  message: string,
  error?: unknown,
): ApiResponse<null> {
  return { success: false, message, error }
}
