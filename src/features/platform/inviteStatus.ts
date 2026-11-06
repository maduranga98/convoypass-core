import type { InviteRow, InviteStatus } from '@/types/platform'

/** A list left open past an expiry still shows it: the server derives the status, this keeps it current on screen. */
export const displayStatus = (r: Pick<InviteRow, 'status' | 'expiresAt'>, now: number): InviteStatus =>
  r.status === 'unused' && r.expiresAt <= now ? 'expired' : r.status
