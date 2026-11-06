// Operator audit trail: `platformAuditLog/{id}`. No client can read or write it (rules deny everyone); only the platform
// callables and the operator scripts add entries. Pure builder, free of firebase imports (the scripts import it).
// `targetRef` is a hash PREFIX (8 chars) or a tenantId or an operator uid, never a code or a full hash.
import { sanitiseMeta } from '../auditMeta.js'

export type PlatformAction =
  | 'invite.created'
  | 'invite.revoked'
  | 'operator.created'
  | 'operator.disabled'
  | 'operator.repaired'
  | 'operator.passwordReset'
  | 'operator.passwordChanged'
  | 'workspace.created'
  | 'admin.created'
  | 'admin.credentialReset'
  | 'admin.updated'
  | 'admin.disabled'
  | 'admin.enabled'
  | 'security.pin_probe_suspected'

export interface PlatformAuditEntry {
  /** The operator's uid, or `script` for the operator scripts. */
  actorUid: string
  action: PlatformAction
  targetRef: string
  meta: Record<string, string | number | boolean | null>
}

export const platformAudit = (
  actorUid: string,
  action: PlatformAction,
  targetRef: string,
  meta: PlatformAuditEntry['meta'] = {},
): PlatformAuditEntry => ({ actorUid, action, targetRef, meta: sanitiseMeta(meta) })

export const HASH_PREFIX_LENGTH = 8
export const hashPrefixOf = (hash: string): string => hash.slice(0, HASH_PREFIX_LENGTH)
