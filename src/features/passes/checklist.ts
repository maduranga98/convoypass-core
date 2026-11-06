import type { ChecklistItemDef } from '@/lib/defaultChecklist'
import type { PassChecklistItem } from '@/types/passes'

export const MIN_NOTE_LENGTH = 3

/** `undefined` means "not answered yet": nothing is ever preselected. */
export type Answers = Record<string, { answer?: 'yes' | 'no'; note?: string }>

export const isAnswered = (a: Answers, id: string): boolean => a[id]?.answer !== undefined

/** A "no" without a usable note, or a blocking "no". */
export const noteMissing = (a: Answers, id: string): boolean =>
  a[id]?.answer === 'no' && (a[id]?.note ?? '').trim().length < MIN_NOTE_LENGTH

export const isBlocked = (a: Answers, item: ChecklistItemDef): boolean => item.failBlocks && a[item.id]?.answer === 'no'

export interface ChecklistStatus {
  answered: number
  total: number
  /** Every item answered, every "no" has a note, and no blocking item is "no". */
  complete: boolean
  blocked: ChecklistItemDef[]
}

export function checklistStatus(items: readonly ChecklistItemDef[], a: Answers): ChecklistStatus {
  const answered = items.filter((i) => isAnswered(a, i.id)).length
  const blocked = items.filter((i) => isBlocked(a, i))
  const complete =
    answered === items.length && blocked.length === 0 && items.every((i) => !noteMissing(a, i.id))
  return { answered, total: items.length, complete, blocked }
}

/** "All OK": every item becomes Yes (notes of earlier "No" answers are dropped). */
export const allOk = (items: readonly ChecklistItemDef[]): Answers =>
  Object.fromEntries(items.map((i) => [i.id, { answer: 'yes' as const }]))

/** Prefills from a rejected attempt, only for items that still exist in the template. */
export function answersFromPrevious(items: readonly ChecklistItemDef[], previous: readonly PassChecklistItem[]): Answers {
  const known = new Set(items.map((i) => i.id))
  const out: Answers = {}
  for (const p of previous) {
    if (known.has(p.id)) out[p.id] = { answer: p.answer, ...(p.note ? { note: p.note } : {}) }
  }
  return out
}

/** What `submitPass` receives. Only call when `checklistStatus(...).complete`. */
export function toPayload(items: readonly ChecklistItemDef[], a: Answers): { id: string; answer: 'yes' | 'no'; note?: string }[] {
  return items.map((i) => {
    const entry = a[i.id]
    const answer = entry?.answer ?? 'yes'
    return answer === 'no' ? { id: i.id, answer, note: (entry?.note ?? '').trim() } : { id: i.id, answer }
  })
}
