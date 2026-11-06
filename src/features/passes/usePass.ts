import { doc, onSnapshot, type FirestoreError } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from '@/lib/firebase'
import type { PassDoc, PassWithId } from '@/types/passes'

export type PassState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; error: FirestoreError }
  | { status: 'ready'; pass: PassWithId }

/** Live single pass (rules decide who may read it). Unsubscribes on unmount or when the id changes. */
export function usePass(passId: string | null): PassState {
  const [state, setState] = useState<{ id: string | null; value: PassState }>({ id: null, value: { status: 'loading' } })

  useEffect(() => {
    if (!passId) return
    return onSnapshot(
      doc(db, 'passes', passId),
      (snap) => {
        const value: PassState = snap.exists()
          ? { status: 'ready', pass: { ...(snap.data() as PassDoc), id: snap.id } }
          : { status: 'missing' }
        setState({ id: passId, value })
      },
      (error) => setState({ id: passId, value: { status: 'error', error } }),
    )
  }, [passId])

  // A value for a previous id is stale: show loading until the new listener answers.
  return passId !== null && state.id === passId ? state.value : { status: 'loading' }
}
