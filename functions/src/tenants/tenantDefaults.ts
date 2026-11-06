// The ONE place new-tenant defaults live. `completeSetup`, `scripts/create-tenant.ts` and `scripts/seed.ts` all go
// through `provisionTenant`, so a tenant made by any route has exactly the same settings. Reuses the constants the
// modules that read them already fall back to. Keep this file free of firebase-functions imports: scripts import it.
import { randomInt } from 'node:crypto'
import { DEFAULT_CHECKLIST, DEFAULT_PASS_SETTINGS, type ChecklistItemDef, type PassSettings } from '../defaultChecklist.js'
import { DEFAULT_REJECTION_REASONS, type RejectionReasonDef } from '../defaultRejectionReasons.js'
import { DEFAULT_SLA, type SlaSettings } from '../defaultSla.js'
import { DEFAULT_EXPIRY_WARNING_DAYS } from '../expiry.js'
import { DEFAULT_GATES, type GateDef } from '../gates.js'
import { VEHICLE_TYPES } from '../vehicleTypes.js'

export const DEFAULT_TIMEZONE = 'Asia/Colombo'

/** `ten_` + 10 random chars [a-z0-9]. Generated server-side only. */
export const TENANT_ID_PATTERN = /^ten_[a-z0-9]{10}$/
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
export const newTenantId = (): string => `ten_${Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`

export interface TenantDefaults {
  timezone: string
  checklist: ChecklistItemDef[]
  rejectionReasons: RejectionReasonDef[]
  gates: GateDef[]
  sla: SlaSettings
  passSettings: PassSettings
  retentionDays: number
  vehicleTypes: string[]
  expiryWarningDays: number
  /** Gate passes: manual review is the default; automatic issue at month rollover is an option the Company Admin switches on. */
  autoIssueGatePasses: boolean
}

/** A fresh copy every time, so no caller can mutate the shared constants. */
export function tenantDefaults(timezone: string = DEFAULT_TIMEZONE): TenantDefaults {
  return {
    timezone,
    checklist: DEFAULT_CHECKLIST.map((c) => ({ ...c })),
    rejectionReasons: DEFAULT_REJECTION_REASONS.map((r) => ({ ...r })),
    gates: DEFAULT_GATES.map((g) => ({ ...g })),
    sla: { ...DEFAULT_SLA },
    passSettings: { ...DEFAULT_PASS_SETTINGS },
    retentionDays: 0,
    vehicleTypes: [...VEHICLE_TYPES],
    expiryWarningDays: DEFAULT_EXPIRY_WARNING_DAYS,
    autoIssueGatePasses: false,
  }
}

export type AuditMeta = Record<string, string | number | boolean | null>

export interface ProvisionInput {
  tenantId: string
  tenantName: string
  timezone: string
  admin: {
    uid: string
    name: string
    /** Lowercased. */
    email: string
    mustChangePassword: boolean
    /** `users.createdBy`: 'setup', 'create-tenant', 'seed'. */
    createdBy: string
  }
  /** Audit actor for both entries (`system` for the setup flow and the operator scripts). */
  actor: { uid: string; role: 'system' | 'admin' | 'superadmin'; /** Display name shown in the tenant's audit viewer. */ name?: string }
  /** Extra short scalars for the `tenant.created` entry (never secrets). */
  meta?: AuditMeta
  /** `FieldValue.serverTimestamp()` from the caller's own firebase-admin (so this file needs no Firebase import). */
  createdAt: unknown
}

/** The few Firestore members provisioning needs. Satisfied by a WriteBatch and a Transaction. */
export interface ProvisionWriter {
  create(ref: unknown, data: Record<string, unknown>): unknown
}
export interface ProvisionDb {
  doc(path: string): unknown
  collection(path: string): { doc(): unknown }
}

/** The documents a new tenant needs, as plain data. Pure: this is what the tests assert against. */
export function buildTenantDocs(input: ProvisionInput): {
  tenant: Record<string, unknown>
  user: Record<string, unknown>
  audits: Record<string, unknown>[]
} {
  const { tenantId, tenantName, admin, actor, createdAt } = input
  const d = tenantDefaults(input.timezone)
  return {
    tenant: { name: tenantName, status: 'active', ...d, createdAt },
    user: {
      tenantId,
      role: 'admin',
      contractorId: null,
      name: admin.name,
      email: admin.email,
      phone: null,
      status: 'active',
      mustChangePassword: admin.mustChangePassword,
      createdAt,
      createdBy: admin.createdBy,
      updatedAt: createdAt,
    },
    audits: [
      {
        tenantId, action: 'tenant.created', actorUid: actor.uid, actorRole: actor.role, ...(actor.name ? { actorName: actor.name } : {}), targetType: 'tenant', targetId: tenantId,
        meta: { timezone: input.timezone, ...(input.meta ?? {}) }, createdAt,
      },
      {
        tenantId, action: 'user.created', actorUid: actor.uid, actorRole: actor.role, ...(actor.name ? { actorName: actor.name } : {}), targetType: 'user', targetId: admin.uid,
        meta: { role: 'admin', createdBy: admin.createdBy }, createdAt,
      },
    ],
  }
}

/**
 * Writes the tenant, its first admin `users` doc and the two audit entries (`tenant.created`, `user.created`) through
 * `writer` (one batch or one transaction, so it is all or nothing). Everything uses `create`, which fails if the
 * tenant or user already exists: provisioning can never overwrite or join an existing tenant. Claims are the caller's job.
 */
export function provisionTenant(db: ProvisionDb, writer: ProvisionWriter, input: ProvisionInput): void {
  const { tenant, user, audits } = buildTenantDocs(input)
  writer.create(db.doc(`tenants/${input.tenantId}`), tenant)
  writer.create(db.doc(`users/${input.admin.uid}`), user)
  for (const a of audits) writer.create(db.collection('auditLog').doc(), a)
}
