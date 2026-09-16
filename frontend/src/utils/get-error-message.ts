import logger from '../core/logger'

interface ApiError {
  message?: string
  error?: unknown
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extracts a user-friendly error message from various error types.
 * @param error The error object.
 * @returns A string containing the error message.
 */
export function getErrorMessage(error: unknown): string {
  // 1. Handle RTK Query error structure: { data: { message: '...' } }
  if (isObject(error) && isObject(error.data)) {
    const apiResponse = error.data as ApiError
    if (typeof apiResponse.message === 'string' && apiResponse.message.length > 0) {
      return apiResponse.message
    }
    if (typeof apiResponse.error === 'string' && apiResponse.error.length > 0) {
      return apiResponse.error
    }
  }

  // 2. Handle generic objects with a 'message' property: { message: '...' }
  if (isObject(error) && typeof error.message === 'string' && error.message.length > 0) {
    return error.message
  }

  // 3. Handle cases where the error message is nested under an 'error' property
  if (isObject(error) && isObject(error.error)) {
    if (typeof error.error.message === 'string' && error.error.message.length > 0) {
      return error.error.message
    }
  }

  // 4. Handle standard JavaScript Error objects
  if (error instanceof Error) {
    return error.message
  }

  // 5. Handle if the error is just a string
  if (typeof error === 'string') {
    return error
  }

  logger.warn('Could not extract a specific error message.', { error })
  return 'An unexpected error occurred. Please try again.'
}