/**
 * A callable answered `session-expired` (Module 12: a PIN session past its maximum age, or one from before a reissued
 * PIN). `AuthProvider` listens and signs out with "Please enter your PIN again."; RequireAuth keeps the return URL.
 */
type Listener = () => void
const listeners = new Set<Listener>()

export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function reportSessionExpired(): void {
  for (const l of [...listeners]) l()
}

/** True for a Functions error whose `details.reason` is `session-expired`. */
export function isSessionExpired(e: unknown): boolean {
  const details = typeof e === 'object' && e !== null ? (e as { details?: unknown }).details : undefined
  return typeof details === 'object' && details !== null && (details as { reason?: unknown }).reason === 'session-expired'
}
