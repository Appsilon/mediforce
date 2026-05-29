import { ApiError } from '@/lib/mediforce';

/**
 * React-query `retry` callback — ADR-0006 §8a.
 *
 * 4xx responses are client errors (403 forbidden, 404 not found, etc.) that
 * will not resolve on their own. Retrying them wastes Firestore reads and
 * hides the real error from the UI. Stop immediately; let 5xx/network errors
 * retry up to two times.
 */
export function stopRetryOn4xx(failureCount: number, err: unknown): boolean {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
  return failureCount < 2;
}
