import { PassConflictError } from './core.js'
import { fail } from './errors.js'
import { MAX_ATTEMPTS } from './schemas.js'
import type { ChecklistItemDef, PassChecklistItem, PassData } from './types.js'

export const MIN_NOTE_LENGTH = 3
export const MAX_NOTE_LENGTH = 200

/** Evidence file limits (the Storage rules enforce the upper bound too). */
export const MIN_EVIDENCE_BYTES = 10 * 1024
export const MAX_EVIDENCE_BYTES = 700 * 1024
export const MAX_EVIDENCE_AGE_MS = 30 * 60 * 1000

/** The attempt number the next submission must carry: 1 for a new pass, previous + 1 after a rejection. */
export const expectedAttempt = (existing: Pick<PassData, 'attempt'> | null): number =>
  existing ? existing.attempt + 1 : 1

/**
 * What a submission by `driverId` with `attempt` would do to the stored pass. Throws PassConflictError when it
 * would do nothing legal. Used inside the transaction (real port and fake) so the check races safely.
 */
export function planSubmit(
  existing: Pick<PassData, 'status' | 'attempt' | 'driverId'> | null,
  driverId: string,
  attempt: number,
): 'create' | 'resubmit' {
  if (!existing) {
    if (attempt !== 1) throw new PassConflictError('attempt')
    return 'create'
  }
  if (existing.status !== 'rejected') throw new PassConflictError('exists')
  if (existing.driverId !== driverId) throw new PassConflictError('driver')
  if (existing.attempt >= MAX_ATTEMPTS || attempt !== expectedAttempt(existing)) throw new PassConflictError('attempt')
  return 'resubmit'
}

/**
 * Every item of the tenant's template must be answered exactly once. A `no` needs a note and may not be a
 * blocking item. Labels come from the template, never from the client.
 */
export function validateChecklist(
  template: readonly ChecklistItemDef[],
  answers: readonly { id: string; answer: 'yes' | 'no'; note?: string | undefined }[],
): PassChecklistItem[] {
  const byId = new Map<string, (typeof answers)[number]>()
  for (const a of answers) {
    if (byId.has(a.id)) throw fail('invalid-argument', 'checklist-invalid', 'Checklist item answered twice')
    byId.set(a.id, a)
  }
  const known = new Set(template.map((t) => t.id))
  if ([...byId.keys()].some((id) => !known.has(id))) {
    throw fail('invalid-argument', 'checklist-invalid', 'Checklist has an unknown item')
  }

  return template.map((item) => {
    const a = byId.get(item.id)
    if (!a) throw fail('invalid-argument', 'checklist-invalid', `Checklist item “${item.label}” is not answered`)
    if (a.answer === 'yes') return { id: item.id, label: item.label, answer: 'yes' }
    if (item.failBlocks) {
      throw fail('failed-precondition', 'checklist-blocked', `“${item.label}” must be fixed before submitting`)
    }
    const note = (a.note ?? '').trim()
    if (note.length < MIN_NOTE_LENGTH) {
      throw fail('invalid-argument', 'checklist-note-required', `Add a short note for “${item.label}”`)
    }
    return { id: item.id, label: item.label, answer: 'no', note: note.slice(0, MAX_NOTE_LENGTH) }
  })
}

export const EVIDENCE_FILES = ['gps.jpg', 'dashcam.jpg', 'extra1.jpg', 'extra2.jpg'] as const

export const evidenceFolder = (tenantId: string, vehicleId: string, dateKey: string, attempt: number): string =>
  `tenants/${tenantId}/passes/${vehicleId}/${dateKey}/${attempt}/`

/** JPEG files start with FF D8 FF. */
export const isJpeg = (head: Uint8Array): boolean => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
