import { useEffect } from 'react'

/** Keeps the screen on while the page is visible (`navigator.wakeLock`). Silently does nothing where unsupported. */
export function useWakeLock(active = true): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let sentinel: WakeLockSentinel | null = null
    let disposed = false
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || sentinel) return
      try {
        const s = await navigator.wakeLock.request('screen')
        if (disposed) void s.release()
        else {
          sentinel = s
          s.addEventListener('release', () => {
            if (sentinel === s) sentinel = null
          })
        }
      } catch {
        // battery saver, permissions policy, …: carry on without it
      }
    }
    // The browser drops the lock when the page is hidden; take it again when the guard comes back.
    const onVisible = () => void acquire()
    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => undefined)
    }
  }, [active])
}
