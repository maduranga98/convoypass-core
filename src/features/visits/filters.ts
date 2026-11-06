import { plateSearchKey } from '@/lib/plate'
import type { Visit } from '@/types/visits'

/** Search on the gate and yard lists: part of the plate (spaces and dashes ignored) or part of the driver's name. */
export const matchesVisit = (v: Pick<Visit, 'plateNo' | 'driverName'>, q: string): boolean => {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const key = plateSearchKey(q)
  return (key.length > 0 && plateSearchKey(v.plateNo).includes(key)) || v.driverName.toLowerCase().includes(needle)
}

/** Distinct, non-empty unload places already used on the visits on screen, most recent first. */
export function recentLocations(visits: Pick<Visit, 'unloadingCheck'>[], max = 6): string[] {
  const seen = new Map<string, number>()
  for (const v of visits) {
    const u = v.unloadingCheck
    if (u?.unloadLocation) seen.set(u.unloadLocation, Math.max(seen.get(u.unloadLocation) ?? 0, u.timestamp.toMillis()))
  }
  return [...seen].sort((a, b) => b[1] - a[1]).slice(0, max).map(([place]) => place)
}
