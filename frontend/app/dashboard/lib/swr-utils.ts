import { Key, mutate as globalMutate } from 'swr'
import { toast } from 'sonner'
import { revalidateDashboardData } from './api-client'

type LocalMutate<T> = (
  data?: T | Promise<T> | ((currentData?: T) => T | Promise<T>),
  options?: boolean | { revalidate?: boolean; rollbackOnError?: boolean; populateCache?: boolean },
) => Promise<T | undefined>

const DEFAULT_INVALIDATE_KEYS = [
  '/api/auth/pending-approvals',
  '/api/analytics/dashboard',
  '/api/applications',
  '/api/decisions',
  '/api/jobs',
  '/api/notifications',
  '/api/tickets',
]

/** In-memory single-flight guard for rapid double-clicks (per browser tab). */
const mutationLocks = new Set<string>()

function matchesKey(cacheKey: unknown, key: string) {
  if (typeof cacheKey !== 'string') {
    return false
  }

  return cacheKey === key || cacheKey.startsWith(`${key}?`) || cacheKey.startsWith(`${key}/`)
}

async function revalidateKeys(keys: string[]) {
  await Promise.all(
    keys.map((key) =>
      globalMutate(
        (cacheKey) => matchesKey(cacheKey, key),
        undefined,
        { revalidate: true },
      ),
    ),
  )
}

/**
 * Standardized mutation helper for SWR with optimistic UI updates.
 * Handles optimistic update, API call, broad revalidation, and rollback on error.
 */
export async function performMutation<T>(
  key: Key,
  mutate: LocalMutate<T>,
  action: () => Promise<unknown>,
  options: {
    optimisticData?: (current?: T) => T
    successMessage?: string
    errorMessage?: string
    invalidateKeys?: string[]
    /** When set, ignore overlapping mutations with the same key (e.g. `application-42`). */
    lockKey?: string
  } = {},
) {
  const {
    optimisticData,
    successMessage,
    errorMessage,
    invalidateKeys = [],
    lockKey,
  } = options

  if (lockKey) {
    if (mutationLocks.has(lockKey)) {
      return
    }
    mutationLocks.add(lockKey)
  }

  const keysToRevalidate = Array.from(
    new Set(
      [
        ...DEFAULT_INVALIDATE_KEYS,
        ...(typeof key === 'string' ? [key] : []),
        ...invalidateKeys,
      ].filter(Boolean),
    ),
  )

  try {
    if (optimisticData) {
      await mutate(optimisticData, { revalidate: false, rollbackOnError: true })
    }

    await action()
    await mutate(undefined, { revalidate: true })
    await revalidateKeys(keysToRevalidate)
    revalidateDashboardData()

    if (successMessage) {
      toast.success(successMessage)
    }
  } catch (err: any) {
    await mutate(undefined, { revalidate: true })

    const errorDetail = err?.message || 'Operation failed'
    console.error(`[Mutation Error] ${String(key)}:`, err)
    toast.error(errorMessage || errorDetail)
    throw err
  } finally {
    if (lockKey) {
      mutationLocks.delete(lockKey)
    }
  }
}
