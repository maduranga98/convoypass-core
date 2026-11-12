import { useCallback, useState } from 'react'
import { lookupVisitorPass } from '@/lib/api'
import { apiErrorMessage, apiErrorReason } from '@/lib/errors'
import { normalisePassCode } from '@/lib/visitorLogic'
import type { VisitorPassView } from '@/types/visitors'

export type Target = { code: string } | { passId: string }

export type Lookup =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'found'; view: VisitorPassView }
  | { state: 'notFound' }
  | { state: 'error'; message: string; target: Target }

/** Looks a pass up by scanned or typed code, or by id (a row of the inside list). An unreadable code never reaches the server. */
export function useVisitorLookup() {
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' })

  const find = useCallback(async (target: Target) => {
    if ('code' in target && normalisePassCode(target.code) === null) {
      setLookup({ state: 'notFound' })
      return
    }
    setLookup({ state: 'loading' })
    try {
      const view = await lookupVisitorPass('code' in target ? { code: normalisePassCode(target.code) as string } : target)
      setLookup({ state: 'found', view })
    } catch (e) {
      if (apiErrorReason(e) === 'visitor-pass-not-found') setLookup({ state: 'notFound' })
      else setLookup({ state: 'error', message: apiErrorMessage(e), target })
    }
  }, [])

  const reset = useCallback(() => setLookup({ state: 'idle' }), [])
  return { lookup, find, reset }
}
