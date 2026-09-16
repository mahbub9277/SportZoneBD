import type { ApiResponse, WrappedApiResponse } from './types'

/**
 * A type guard to check if the response is a `WrappedApiResponse`.
 * @param response The API response to check.
 * @returns `true` if the response is wrapped, `false` otherwise.
 */
function isWrappedApiResponse<T>(response: ApiResponse<T>): response is WrappedApiResponse<T> {
  return response != null && typeof response === 'object' && 'success' in response
}

/**
 * A utility function to safely unwrap data from a potential ApiResponse wrapper.
 * If the response is wrapped (e.g., `{ success: true, data: ... }`), it returns the `data` property.
 * Otherwise, it returns the response as is.
 * @param response The API response, which may or may not be wrapped.
 * @returns The unwrapped data, or throws an error if the wrapped response was not successful.
 */
export const unwrapApiResponse = <T>(response: ApiResponse<T>, fallback?: T): T => {
  if (isWrappedApiResponse(response)) {
    if (response.success && 'data' in response && response.data !== undefined) {
      return response.data as T
    }

    if (fallback !== undefined) {
      return fallback
    }

    if ('data' in response && response.data !== undefined) {
      return response.data as T
    }

    return null as unknown as T
  }

  return response as T
}

/**
 * Transforms a sort string from a frontend-friendly format (e.g., 'date-asc')
 * to a backend-compatible format (e.g., 'kickoffAt:asc').
 * @param sort The sort string from the client.
 * @returns The transformed sort string for the API.
 */
export const transformSortParam = (sort?: string) => {
  if (!sort) return undefined
  const [field, order] = sort.split('-')
  if (!['asc', 'desc'].includes(order)) return undefined
  if (field === 'date') return `kickoffAt:${order}`
  if (field === 'title') return `title:${order}`
  return sort // Return as is if no specific mapping
}