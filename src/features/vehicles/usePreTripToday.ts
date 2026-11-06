import { useMemo } from 'react'
import { usePassQueue } from '@/features/passes/usePassQueue'
import { useToday } from '@/features/passes/useToday'
import type { PassWithId } from '@/types/passes'
import type { Scope } from '@/features/shared/scope'

/** Today's pre-trip pass of each vehicle (one per vehicle per day), from the shared live pass listener. */
export function usePreTripToday(scope: Scope): Map<string, PassWithId> {
  const today = useToday()
  const queue = usePassQueue({ scope, dateKey: today ?? undefined, enabled: today !== null })
  return useMemo(() => new Map(queue.items.map((p) => [p.vehicleId, p])), [queue.items])
}
