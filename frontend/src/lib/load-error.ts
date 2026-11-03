import { ApiError } from '@/lib/api'

// What went wrong with a request, in the four kinds a page shows differently.
// 401 never gets here: api() sends the person to sign-in first (src/lib/api.ts).
export type LoadErrorKind = 'not_found' | 'forbidden' | 'offline' | 'server'

export function loadErrorKind(error: unknown): LoadErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.status === 410) return 'not_found'
    if (error.status === 403) return 'forbidden'
    return 'server'
  }
  // fetch() rejects with a TypeError when the request never reaches the server.
  if (error instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine)) return 'offline'
  return 'server'
}

/** True for an answer that will not change on a retry: the item is missing, forbidden, or the request is invalid. */
export function isFinalError(error: unknown) {
  return error instanceof ApiError && error.status >= 400 && error.status < 500
}

/**
 * The query retry rule for the whole app: never retry a 4xx (the answer will be the same, and the page would
 * show a skeleton for seconds before the message). Retry a lost connection or a 5xx up to twice.
 */
export function retryQuery(failureCount: number, error: unknown) {
  return !isFinalError(error) && failureCount < 2
}

/** For a list that loaded but does not hold the item: the same as the server saying 404. */
export const notFoundError = new ApiError(404, 'Not found')
