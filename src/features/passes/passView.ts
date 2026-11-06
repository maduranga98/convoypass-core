import type { Timestamp } from 'firebase/firestore'
import { strings } from '@/lib/strings'
import type { PassDoc, PassStatus } from '@/types/passes'

const t = strings.approvals

/** Firestore Timestamp -> ms. Pending server timestamps are `null`. */
export const toMs = (ts: Timestamp | null | undefined): number | null => (ts ? ts.toMillis() : null)

export const issueCount = (pass: Pick<PassDoc, 'checklist'>): number => pass.checklist.filter((c) => c.answer === 'no').length

export type DisplayStatus = PassStatus | 'expired'

/** Waiting for a reviewer, but from a previous day: nobody can decide it any more. */
export function isExpired(pass: Pick<PassDoc, 'status' | 'dateKey'>, today: string): boolean {
  return (pass.status === 'submitted' || pass.status === 'supervisor_approved') && pass.dateKey < today
}

export const displayStatus = (pass: Pick<PassDoc, 'status' | 'dateKey'>, today: string | null): DisplayStatus =>
  today && isExpired(pass, today) ? 'expired' : pass.status

/** "Just now", "5 min ago", "3 h ago", "2 d ago". */
export function timeAgo(ms: number | null, now: number): string {
  if (ms === null) return strings.common.none
  const mins = Math.max(0, Math.floor((now - ms) / 60_000))
  if (mins < 1) return t.time.justNow
  if (mins < 60) return t.time.minutes(mins)
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t.time.hours(hours)
  return t.time.days(Math.floor(hours / 24))
}

export const formatTime = (ms: number | null): string =>
  ms === null ? strings.common.none : new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

export const formatDateTime = (ms: number | null): string =>
  ms === null ? strings.common.none : new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** `20260310` -> "10 Mar 2026". */
export const formatDateKey = (key: string): string =>
  new Date(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  })

export interface EvidenceItem {
  key: string
  label: string
  path: string
}

/** GPS, dashcam, then the extras, in the order the reviewer should look at them. */
export function evidenceItems(pass: Pick<PassDoc, 'evidence'>): EvidenceItem[] {
  return [
    { key: 'gps', label: t.evidence.gps, path: pass.evidence.gps.path },
    { key: 'dashcam', label: t.evidence.dashcam, path: pass.evidence.dashcam.path },
    ...pass.evidence.extra.map((f, i) => ({ key: `extra${i + 1}`, label: t.evidence.extra(i + 1), path: f.path })),
  ]
}

/** A decided version of a pass: used to hide it optimistically without hiding a later resubmission. */
export const versionKey = (p: Pick<PassDoc, 'status' | 'attempt'> & { id: string }): string => `${p.id}|${p.status}|${p.attempt}`
