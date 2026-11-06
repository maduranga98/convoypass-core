import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/features/auth/useAuth'
import { strings } from '@/lib/strings'
import { setLoginReason } from './redirect'
import { clearSensitiveState } from './sensitive'

const t = strings.platformAuth.idle

/** A super admin is signed out after this long without activity (pointer, key, touch or scroll). */
export const IDLE_LIMIT_MS = 30 * 60_000
/** The warning dialog shows for the last minute. */
export const IDLE_WARNING_MS = 60_000

const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll', 'wheel'] as const

/**
 * Platform role only. 30 minutes without activity signs out; the last minute shows a warning with a countdown. While the
 * warning is up only its own button counts as activity (a nudged mouse must not hide it). Time is measured against the
 * clock on every tick (and when the tab comes back), so a throttled background tab cannot extend the session. On expiry the
 * one-time secrets held in memory (invite links, temporary passwords) are dropped before the sign-out.
 */
export function IdleGuard() {
  const { signOut } = useAuth()
  const last = useRef(0)
  const warned = useRef(false)
  const done = useRef(false)
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    last.current = Date.now()
    const touch = () => {
      if (!warned.current) last.current = Date.now()
    }
    const tick = () => {
      if (done.current) return
      const idle = Date.now() - last.current
      if (idle >= IDLE_LIMIT_MS) {
        done.current = true
        setRemaining(null)
        setLoginReason('idle')
        clearSensitiveState()
        void signOut()
        return
      }
      if (idle >= IDLE_LIMIT_MS - IDLE_WARNING_MS) {
        warned.current = true
        setRemaining(Math.max(1, Math.ceil((IDLE_LIMIT_MS - idle) / 1000)))
      }
    }
    for (const e of ACTIVITY) window.addEventListener(e, touch, { capture: true, passive: true })
    document.addEventListener('visibilitychange', tick)
    const timer = window.setInterval(tick, 1000)
    return () => {
      for (const e of ACTIVITY) window.removeEventListener(e, touch, { capture: true })
      document.removeEventListener('visibilitychange', tick)
      window.clearInterval(timer)
    }
  }, [signOut])

  const stay = () => {
    warned.current = false
    last.current = Date.now()
    setRemaining(null)
  }

  return (
    <Modal open={remaining !== null} onClose={stay} title={t.title}>
      <div className="space-y-4">
        <p role="alert" className="text-sm text-slate-700">{t.body(remaining ?? 0)}</p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              done.current = true
              setRemaining(null)
              clearSensitiveState()
              void signOut()
            }}
          >
            {t.signOut}
          </Button>
          <Button onClick={stay}>{t.stay}</Button>
        </div>
      </div>
    </Modal>
  )
}
