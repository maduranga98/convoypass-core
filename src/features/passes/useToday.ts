import { useEffect, useState } from 'react'
import { useSession } from '@/features/auth/useAuth'
import { dateKey, DEFAULT_TIMEZONE } from '@/lib/dates'
import { useTenant } from './queries'

const TICK_MS = 30_000

/**
 * Today's `dateKey` in the tenant's timezone (the Module 3 helper), kept fresh so the lists roll over at midnight
 * without a reload. `null` only while the tenant document is loading.
 */
export function useToday(): string | null {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const timezone = tenant.data?.timezone ?? DEFAULT_TIMEZONE
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  return tenant.isPending ? null : dateKey(timezone, now)
}

/** A clock for "5 min ago" labels. */
export function useNow(intervalMs = TICK_MS): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
