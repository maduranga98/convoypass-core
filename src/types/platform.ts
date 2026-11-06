// Module 9: shapes returned by the operator callables. Times are epoch milliseconds. No tenant business data, no codes.
export type InviteStatus = 'unused' | 'claimed' | 'used' | 'expired'

export interface CreatedInvite {
  /** Shown once. Never stored, cached or logged by the client. */
  code: string
  link: string
  hashPrefix: string
  expiresAt: number
}

export interface InviteRow {
  hashPrefix: string
  companyHint: string | null
  lockEmail: string | null
  status: InviteStatus
  createdAt: number
  expiresAt: number
  usedAt: number | null
  tenantId: string | null
  tenantName: string | null
}

export interface TenantRow {
  tenantId: string
  name: string
  createdAt: number
  timezone: string
  adminName: string | null
  adminEmail: string | null
  userCount: number
  vehicleCount: number
  adminCount: number
  activeAdminCount: number
  /** At least one admin has signed in. */
  adminSignedIn: boolean
}

export interface OperatorOverview {
  invites: Record<InviteStatus, number>
  tenants: number
}

/** Shown once, in the response that created or reset an admin's temporary password. Never cached or stored. */
export interface WorkspaceCredentials {
  tenantId: string
  adminUid: string
  loginUrl: string
  tempPassword: string
}

export interface WorkspaceAdmin {
  uid: string
  name: string
  email: string
  status: 'active' | 'disabled'
  mustChangePassword: boolean
  createdAt: number
  /** Epoch ms, or null if the admin has never signed in. */
  lastSignInAt: number | null
}

export interface WorkspaceDetail {
  tenant: { tenantId: string; name: string; createdAt: number; timezone: string; userCount: number; vehicleCount: number }
  admins: WorkspaceAdmin[]
}
