import { useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Plus, Tags, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input } from '@/components/ui/Input'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { createPenaltyType, deletePenaltyType, updatePenaltyType } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { MAX_PENALTY_TYPES, PENALTY_TYPE_NAME_MAX, PENALTY_TYPE_NAME_MIN } from '@/lib/penaltyLogic'
import { strings } from '@/lib/strings'
import type { PenaltyType } from '@/types/penalties'
import type { WithId } from '@/types'
import { usePenaltyTypes } from './queries'

const t = strings.penalties.types

const nameOk = (name: string): boolean => {
  const n = name.trim().replace(/\s+/g, ' ')
  return n.length >= PENALTY_TYPE_NAME_MIN && n.length <= PENALTY_TYPE_NAME_MAX
}

/**
 * Penalty types (admin): the company's own list, no seeded entries. Same idea as the vehicle types, but each change is
 * saved on its own (add, rename, remove). A type that any penalty uses cannot be removed (the server refuses and says why).
 */
export default function PenaltyTypesPage() {
  const queryClient = useQueryClient()
  const types = usePenaltyTypes()
  const [adding, setAdding] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState<WithId<PenaltyType> | null>(null)
  const [busy, setBusy] = useState(false)
  const items = types.data ?? []
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['penaltyTypes'] })

  const run = async (action: () => Promise<unknown>, done: string, after?: () => void) => {
    setBusy(true)
    try {
      await action()
      await refresh()
      toast.success(done)
      after?.()
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-sm text-slate-600">{t.hint}</p>
      </div>

      <form
        className="flex items-end gap-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (nameOk(adding)) void run(() => createPenaltyType({ name: adding.trim() }), t.added, () => setAdding(''))
        }}
      >
        <div className="flex-1">
          <Input label={t.newName} value={adding} maxLength={PENALTY_TYPE_NAME_MAX} disabled={busy || items.length >= MAX_PENALTY_TYPES} error={adding !== '' && !nameOk(adding) ? t.nameError : undefined} onChange={(e) => setAdding(e.target.value)} />
        </div>
        <Button type="submit" className="mb-px" icon={<Plus aria-hidden className="size-4" />} disabled={!nameOk(adding) || items.length >= MAX_PENALTY_TYPES} loading={busy && editing === null}>
          {t.add}
        </Button>
      </form>
      {items.length >= MAX_PENALTY_TYPES && <p className="text-xs text-slate-500">{t.max}</p>}

      {types.isPending ? (
        <ListSkeleton />
      ) : types.isError ? (
        <ErrorState error={types.error} onRetry={() => void types.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Tags aria-hidden />} title={t.emptyTitle} body={t.emptyBody} />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-surface">
          {items.map((type) => (
            <li key={type.id} className="flex items-center gap-2 px-4 py-2">
              {editing?.id === type.id ? (
                <form
                  className="flex flex-1 items-end gap-2"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (nameOk(editing.name)) void run(() => updatePenaltyType({ typeId: type.id, name: editing.name.trim() }), t.saved, () => setEditing(null))
                  }}
                >
                  <div className="flex-1">
                    <Input label={t.name} value={editing.name} maxLength={PENALTY_TYPE_NAME_MAX} error={!nameOk(editing.name) ? t.nameError : undefined} onChange={(e) => setEditing({ id: type.id, name: e.target.value })} />
                  </div>
                  <Button type="submit" variant="ghost" size="icon" className="mb-px" aria-label={t.save} title={t.save} disabled={!nameOk(editing.name)} loading={busy}>
                    <Check aria-hidden className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="mb-px" aria-label={t.cancel} title={t.cancel} disabled={busy} onClick={() => setEditing(null)}>
                    <X aria-hidden className="size-4" />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate py-2 font-medium text-ink">{type.name}</span>
                  <Button variant="ghost" size="icon" aria-label={`${t.rename}: ${type.name}`} title={t.rename} onClick={() => setEditing({ id: type.id, name: type.name })}>
                    <Pencil aria-hidden className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`${t.remove}: ${type.name}`} title={t.remove} onClick={() => setRemoving(type)}>
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t.removeTitle}
        body={removing ? t.removeBody(removing.name) : ''}
        confirmLabel={t.remove}
        tone="danger"
        loading={busy}
        onConfirm={() => {
          if (removing) void run(() => deletePenaltyType({ typeId: removing.id }), t.removed).then(() => setRemoving(null))
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
