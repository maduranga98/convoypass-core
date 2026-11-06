import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { setMyPermits } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { db } from '@/lib/firebase'
import { MAX_PERMITS, normalisePermitNumber, PERMIT_NUMBER_MAX, PERMIT_NUMBER_MIN, permitState } from '@/lib/requirementLogic'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import type { Driver } from '@/types'
import { useRequirementContext } from './model'

const t = strings.permits

const numberOk = (n: string): boolean => n.length >= PERMIT_NUMBER_MIN && n.length <= PERMIT_NUMBER_MAX

/**
 * The driver's own permit numbers: one or two, each valid for three months from the day it was entered. Information only
 * (nothing is blocked by it). Big touch targets and plain words, like the rest of the driver screens.
 */
export function PermitsCard() {
  const { uid } = useSession()
  const queryClient = useQueryClient()
  const ctx = useRequirementContext()
  const mine = useQuery({
    queryKey: ['drivers', 'self', uid],
    queryFn: async (): Promise<Driver | null> => {
      const snap = await getDoc(doc(db, 'drivers', uid))
      return snap.exists() ? (snap.data() as Driver) : null
    },
  })
  const [draft, setDraft] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (mine.isPending || ctx.isPending) return null
  const saved = mine.data?.permits ?? []
  const editing = draft !== null
  const numbers = (draft ?? []).map(normalisePermitNumber)
  const invalid = numbers.some((n) => !numberOk(n)) || new Set(numbers).size !== numbers.length

  const save = async () => {
    if (invalid) return
    setBusy(true)
    setError(null)
    try {
      await setMyPermits({ permits: numbers })
      await queryClient.invalidateQueries({ queryKey: ['drivers', 'self', uid] })
      toast.success(t.saved)
      setDraft(null)
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="permits-h" className="space-y-3">
      <h2 id="permits-h" className="text-xl font-bold text-ink">{t.title}</h2>
      {error && <NotificationBanner tone="error">{error}</NotificationBanner>}
      {editing ? (
        <div className="space-y-3 rounded-2xl border border-slate-300 bg-surface p-4">
          <p className="text-base text-slate-700">{t.hint}</p>
          {(draft ?? []).map((value, i) => (
            <div key={i} className="flex items-end gap-2">
              <label className="flex-1 space-y-1 text-base font-medium">
                {t.number}
                <input
                  value={value}
                  maxLength={PERMIT_NUMBER_MAX}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setDraft((d) => (d ?? []).map((x, n) => (n === i ? e.target.value : x)))}
                  className="h-14 w-full rounded-xl border-2 border-slate-300 px-3 font-mono text-xl uppercase focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus"
                />
              </label>
              <Button variant="ghost" className="size-14" aria-label={`${t.remove} ${i + 1}`} onClick={() => setDraft((d) => (d ?? []).filter((_, n) => n !== i))}>
                <Trash2 aria-hidden className="size-6" />
              </Button>
            </div>
          ))}
          {(draft ?? []).length < MAX_PERMITS ? (
            <Button variant="secondary" className="h-14 w-full text-lg" icon={<Plus aria-hidden className="size-5" />} onClick={() => setDraft((d) => [...(d ?? []), ''])}>
              {t.add}
            </Button>
          ) : (
            <p className="text-sm text-slate-600">{t.max}</p>
          )}
          {invalid && <p role="alert" className="text-base text-danger-strong">{t.invalid}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="h-14 flex-1 text-lg" onClick={() => setDraft(null)}>
              {strings.common.cancel}
            </Button>
            <Button className="h-14 flex-1 text-lg" loading={busy} disabled={invalid} onClick={() => void save()}>
              {t.save}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl border border-slate-300 bg-surface p-4">
          {saved.length === 0 ? (
            <p className="text-base text-slate-700">{t.none}</p>
          ) : (
            <ul className="space-y-2">
              {saved.map((p) => {
                const state = permitState(p, ctx.today, ctx.warningDays)
                return (
                  <li key={p.number} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-xl font-bold">{p.number}</span>
                    <span className={state === 'expired' ? 'text-base font-semibold text-danger-strong' : 'text-base text-slate-700'}>
                      {state === 'expired' ? t.expired(p.expiresOn) : state === 'expiringSoon' ? t.expiringSoon(p.expiresOn) : t.valid(p.expiresOn)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          <Button variant="secondary" className="h-14 w-full text-lg" onClick={() => setDraft(saved.length > 0 ? saved.map((p) => p.number) : [''])}>
            {saved.length === 0 ? t.add : strings.common.edit}
          </Button>
        </div>
      )}
    </section>
  )
}
