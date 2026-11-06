import { useEffect } from 'react'

/**
 * Screens where a page reload would lose work (a live camera, a form being filled in) hold a lock while they are
 * open. A new app version that arrives meanwhile waits behind the lock and asks instead of reloading
 * (see `createUpdateController`).
 */
const holders = new Set<symbol>()

export function acquireUpdateLock(): () => void {
  const key = Symbol('update-lock')
  holders.add(key)
  return () => void holders.delete(key)
}

export const isUpdateLocked = (): boolean => holders.size > 0

/** Hold the lock while `active` is true and the component is mounted. */
export function useUpdateLock(active = true): void {
  useEffect(() => {
    if (active) return acquireUpdateLock()
  }, [active])
}
