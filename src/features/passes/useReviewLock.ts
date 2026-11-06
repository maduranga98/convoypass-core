import { useState } from 'react'
import type { PassWithId } from '@/types/passes'

/**
 * The version of a pass the reviewer is looking at. If the live pass moves on (the driver resubmitted, someone else
 * decided), `changed` turns true and decisions must stay locked until the reviewer acknowledges, so stale evidence is
 * never approved. The server checks the same thing again (`expectedStatus` + `expectedAttempt`).
 *
 * Mount it per pass id (`key={pass.id}`): what was "seen" starts fresh for every pass.
 */
export function useReviewLock(pass: PassWithId, busy: 'approve' | 'reject' | null) {
  const [seen, setSeen] = useState({ status: pass.status, attempt: pass.attempt })
  const [leaving, setLeaving] = useState(false)
  // Our own decision changes the pass too; that is not a surprise.
  const changed = !leaving && busy === null && (pass.status !== seen.status || pass.attempt !== seen.attempt)
  return {
    changed,
    acknowledge: () => setSeen({ status: pass.status, attempt: pass.attempt }),
    /** Call right after a successful decision, before the screen moves on. */
    leave: () => setLeaving(true),
  }
}
