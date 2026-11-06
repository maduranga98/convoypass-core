import type { Answers } from './checklist'

// Checklist answers survive an accidental reload (per vehicle and day). Photos are never stored.
const key = (vehicleId: string, dateKey: string): string => `cp:pretrip:${vehicleId}:${dateKey}`

export function loadDraft(vehicleId: string, dateKey: string): Answers | null {
  try {
    const raw = sessionStorage.getItem(key(vehicleId, dateKey))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const out: Answers = {}
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue
      const { answer, note } = v as { answer?: unknown; note?: unknown }
      out[id] = {
        ...(answer === 'yes' || answer === 'no' ? { answer } : {}),
        ...(typeof note === 'string' ? { note } : {}),
      }
    }
    return out
  } catch {
    return null
  }
}

export function saveDraft(vehicleId: string, dateKey: string, answers: Answers): void {
  try {
    sessionStorage.setItem(key(vehicleId, dateKey), JSON.stringify(answers))
  } catch {
    // Private mode or quota: the form still works, it just cannot survive a reload.
  }
}

export function clearDraft(vehicleId: string, dateKey: string): void {
  try {
    sessionStorage.removeItem(key(vehicleId, dateKey))
  } catch {
    // ignore
  }
}
