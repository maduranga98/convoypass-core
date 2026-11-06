// Setup invite codes. Shared by the setup callables and `scripts/invites.ts` (keep this file free of firebase-functions
// imports). A code is 32 random bytes, base64url (43 chars). Only its SHA-256 hash is ever stored or looked up.
import { createHash, randomBytes } from 'node:crypto'

export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/
/** A claim (someone is mid-setup) blocks other attempts for this long; after it, the code can be claimed again. */
export const CLAIM_TTL_MS = 10 * 60 * 1000
export const INVITE_MIN_DAYS = 1
export const INVITE_MAX_DAYS = 30
export const INVITE_DEFAULT_DAYS = 7

export const generateInviteCode = (): string => randomBytes(32).toString('base64url')
export const hashInviteCode = (code: string): string => createHash('sha256').update(code, 'utf8').digest('hex')

export interface InviteTimes {
  expiresAtMs: number
  usedAtMs: number | null
  claimedAtMs: number | null
}

export type InviteStatus = 'unused' | 'claimed' | 'used' | 'expired'

/** What an operator sees in `invite:list`. A used invite stays "used" even after its expiry date. */
export function inviteStatus(i: InviteTimes, nowMs: number): InviteStatus {
  if (i.usedAtMs !== null) return 'used'
  if (i.expiresAtMs <= nowMs) return 'expired'
  if (i.claimedAtMs !== null && nowMs - i.claimedAtMs < CLAIM_TTL_MS) return 'claimed'
  return 'unused'
}

/** Can this invite be claimed right now? (Expiry, use and a still-live claim all say no.) */
export const isClaimable = (i: InviteTimes, nowMs: number): boolean => inviteStatus(i, nowMs) === 'unused'

export const inviteLink = (appBaseUrl: string, code: string): string => `${appBaseUrl.replace(/\/+$/, '')}/setup#code=${code}`
