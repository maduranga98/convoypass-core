export type NotificationType =
  | 'approval_needed'
  | 'resubmitted'
  | 'awaiting_officer'
  | 'pass_approved'
  | 'pass_rejected'
  | 'pass_rejected_info'
  | 'checked_in'
  | 'entry_denied'
  | 'sla_overdue'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  body: string
  /** An app path. Always checked with `safeLink` before navigating. */
  link: string
  createdAt: Date
  readAt: Date | null
}

interface Stamp {
  toDate: () => Date
}
const isStamp = (v: unknown): v is Stamp => typeof v === 'object' && v !== null && typeof (v as Stamp).toDate === 'function'

/** Firestore data -> view model. A pending server timestamp (local write) counts as "now". */
export function toNotification(id: string, data: Record<string, unknown>): AppNotification {
  return {
    id,
    type: data.type as NotificationType,
    title: String(data.title ?? ''),
    body: String(data.body ?? ''),
    link: String(data.link ?? '/'),
    createdAt: isStamp(data.createdAt) ? data.createdAt.toDate() : new Date(),
    readAt: isStamp(data.readAt) ? data.readAt.toDate() : null,
  }
}

/** Only in-app paths: a notification can never send someone to another site. */
export const safeLink = (link: string): string => (link.startsWith('/') && !link.startsWith('//') ? link : '/')
