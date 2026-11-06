// One-time secrets (an invite link, a temporary password) live in component state and nowhere else. This registry lets a
// session end (idle timeout, sign-out from any path) drop them at once, before the pages even unmount.
import { useEffect, useRef } from 'react'

const clears = new Set<() => void>()

/** Wipes every registered one-time secret held in memory. Safe to call at any time. */
export function clearSensitiveState(): void {
  for (const clear of [...clears]) {
    try {
      clear()
    } catch {
      /* a failing clear must not stop the others */
    }
  }
}

/** Register the function that drops this component's secret (e.g. `() => setCreds(null)`). Unregisters on unmount. */
export function useSensitiveState(clear: () => void): void {
  const latest = useRef(clear)
  useEffect(() => {
    latest.current = clear
  })
  useEffect(() => {
    const entry = () => latest.current()
    clears.add(entry)
    return () => void clears.delete(entry)
  }, [])
}
