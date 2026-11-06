import { useCallback, useMemo, useState } from 'react'
import type { PassWithId } from '@/types/passes'
import { issueCount, isExpired } from './passView'

/** Pass id -> the attempt that was on screen when it was ticked. */
export type Selection = ReadonlyMap<string, number>

/**
 * Only a pass with every checklist answer Yes, from today, can be picked for bulk approval. The server refuses the
 * others anyway (`has_issues`); the UI just does not offer them.
 */
export const isBulkSelectable = (pass: Pick<PassWithId, 'checklist' | 'status' | 'dateKey'>, today: string): boolean =>
  issueCount(pass) === 0 && !isExpired(pass, today)

/** Toggle one pass in a selection. Passes that are not selectable are never added. */
export function toggleSelection(selected: Selection, pass: PassWithId, today: string): Map<string, number> {
  const next = new Map(selected)
  if (next.has(pass.id)) next.delete(pass.id)
  else if (isBulkSelectable(pass, today)) next.set(pass.id, pass.attempt)
  return next
}

/** Ids of every selectable pass in the list. */
export const selectableIds = (items: readonly PassWithId[], today: string): string[] =>
  items.filter((p) => isBulkSelectable(p, today)).map((p) => p.id)

/**
 * The list is live, so a ticked pass can change under the reviewer. It stays ticked only while it is still in the
 * list, still selectable and still on the attempt that was ticked: if the driver resubmitted with new photos, the
 * reviewer has not seen those, so the pass drops out of the selection.
 */
export function pruneSelection(selected: Selection, items: readonly PassWithId[], today: string): Map<string, number> {
  const next = new Map<string, number>()
  for (const p of items) {
    const attempt = selected.get(p.id)
    if (attempt !== undefined && attempt === p.attempt && isBulkSelectable(p, today)) next.set(p.id, attempt)
  }
  return next
}

/** Select mode state for a live list. */
export function useBulkSelection(items: readonly PassWithId[], today: string | null) {
  const [active, setActive] = useState(false)
  const [raw, setRaw] = useState<Selection>(new Map())
  const selection = useMemo<Selection>(() => (today ? pruneSelection(raw, items, today) : raw), [raw, items, today])

  const toggle = useCallback(
    (pass: PassWithId) => {
      if (today) setRaw((s) => toggleSelection(pruneSelection(s, items, today), pass, today))
    },
    [items, today],
  )
  const clear = useCallback(() => setRaw(new Map()), [])
  const selectAll = useCallback(() => {
    if (today) setRaw(new Map(items.filter((p) => isBulkSelectable(p, today)).map((p) => [p.id, p.attempt])))
  }, [items, today])
  const exit = useCallback(() => {
    setActive(false)
    setRaw(new Map())
  }, [])
  const selected = useMemo<ReadonlySet<string>>(() => new Set(selection.keys()), [selection])
  const chosen = useMemo(() => items.filter((p) => selection.has(p.id)), [items, selection])

  return { active, enter: () => setActive(true), exit, selected, chosen, toggle, clear, selectAll }
}
