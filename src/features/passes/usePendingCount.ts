import { statusForStage } from '@/lib/passTransitions'
import { QUEUE_LIMIT, usePassQueue } from './usePassQueue'
import { useToday } from './useToday'

/**
 * Passes waiting for this role today: supervisor = their contractor's `submitted`, officer = `supervisor_approved`.
 * It reads the same shared listener as the list it badges, so the two can never disagree.
 */
export function usePendingCount(role: 'supervisor' | 'officer'): { count: number | null; capped: boolean } {
  const today = useToday()
  const q = usePassQueue({ scope: role, status: statusForStage(role), ...(today ? { dateKey: today } : {}), enabled: today !== null })
  const count = q.isLoading && q.items.length === 0 ? null : q.items.length
  return { count, capped: q.items.length >= QUEUE_LIMIT }
}
