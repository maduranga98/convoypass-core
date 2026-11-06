import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { bulkApprove, decidePass, revokePass } from '@/lib/api'
import { apiErrorMessage, apiErrorReason } from '@/lib/errors'
import { strings } from '@/lib/strings'
import type { BulkItemResult, PassWithId } from '@/types/passes'
import { versionKey } from './passView'

const t = strings.approvals.toast

export interface DecisionOutcome {
  outcome: 'ok' | 'changed' | 'error'
  /** User-facing text for `error` (also shown as a toast unless `inline` was asked for). */
  message?: string
}

interface Options {
  /** The caller shows the failure itself (a sheet that stays open), so no error toast. */
  inline?: boolean
}

export interface RejectInput {
  reasonCode: string
  note?: string
}

/**
 * Sends decisions and keeps the optimistic state: a decided pass is hidden at once (`isHidden`), and shown again if
 * the server refuses. The list itself is live, so the real change arrives by itself a moment later. A second decision
 * on a pass that is already in flight is ignored.
 */
export function useDecisions() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<ReadonlyMap<string, 'approve' | 'reject'>>(new Map())
  const inFlight = useRef(new Set<string>())

  const hide = (keys: string[]) => setHidden((s) => new Set([...s, ...keys]))
  const unhide = (keys: string[]) => setHidden((s) => new Set([...s].filter((k) => !keys.includes(k))))
  const setBusyFor = (id: string, what: 'approve' | 'reject' | null) =>
    setBusy((m) => {
      const next = new Map(m)
      if (what) next.set(id, what)
      else next.delete(id)
      return next
    })

  const run = useCallback(async (pass: PassWithId, what: 'approve' | 'reject', call: () => Promise<unknown>, done: string, opts: Options = {}): Promise<DecisionOutcome> => {
    const key = versionKey(pass)
    if (inFlight.current.has(pass.id)) return { outcome: 'error' }
    inFlight.current.add(pass.id)
    setBusyFor(pass.id, what)
    hide([key])
    try {
      await call()
      toast.success(done)
      return { outcome: 'ok' }
    } catch (e) {
      unhide([key])
      if (apiErrorReason(e) === 'pass-changed') {
        toast.error(t.changed)
        return { outcome: 'changed', message: t.changed }
      }
      const message = apiErrorMessage(e)
      if (!opts.inline) toast.error(message)
      return { outcome: 'error', message }
    } finally {
      inFlight.current.delete(pass.id)
      setBusyFor(pass.id, null)
    }
  }, [])

  const approve = useCallback(
    (pass: PassWithId) =>
      run(pass, 'approve', () => decidePass({ passId: pass.id, action: 'approve', expectedStatus: pass.status, expectedAttempt: pass.attempt }), t.approved(pass.plateNo)),
    [run],
  )

  const reject = useCallback(
    (pass: PassWithId, input: RejectInput, opts?: Options) =>
      run(
        pass,
        'reject',
        () => decidePass({ passId: pass.id, action: 'reject', expectedStatus: pass.status, expectedAttempt: pass.attempt, ...input }),
        t.rejected(pass.plateNo),
        opts,
      ),
    [run],
  )

  const revoke = useCallback(
    (pass: PassWithId, input: RejectInput, opts?: Options) =>
      run(pass, 'reject', () => revokePass({ passId: pass.id, expectedAttempt: pass.attempt, ...input }), t.revoked(pass.plateNo), opts),
    [run],
  )

  /** Approves many at once. Resolves with per-item results (or `null` when the whole call failed). */
  const approveMany = useCallback(async (passes: readonly PassWithId[]): Promise<BulkItemResult[] | null> => {
    const keys = passes.map(versionKey)
    hide(keys)
    try {
      const { results } = await bulkApprove({ items: passes.map((p) => ({ passId: p.id, expectedAttempt: p.attempt })) })
      const failed = new Set(results.filter((r) => !r.ok).map((r) => r.passId))
      unhide(passes.filter((p) => failed.has(p.id)).map(versionKey))
      return results
    } catch (e) {
      unhide(keys)
      toast.error(apiErrorMessage(e))
      return null
    }
  }, [])

  return {
    approve,
    reject,
    revoke,
    approveMany,
    isHidden: (pass: PassWithId): boolean => hidden.has(versionKey(pass)),
    /** The decision in flight for this pass, if any. */
    busyOf: (id: string): 'approve' | 'reject' | null => busy.get(id) ?? null,
  }
}
