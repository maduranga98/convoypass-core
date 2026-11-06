export const ROLES = ['admin', 'officer', 'supervisor', 'safety', 'driver', 'security', 'yard'] as const
export type Role = (typeof ROLES)[number]

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v)

export const ROLE_HOME: Record<Role, string> = {
  admin: '/admin',
  officer: '/officer',
  supervisor: '/supervisor',
  safety: '/safety',
  driver: '/driver',
  security: '/security',
  yard: '/yard',
}

/** Roles a tenant admin may create. Admins are created by the platform super admin only (Module 10). */
export const CREATABLE_ROLES: readonly Role[] = ROLES.filter((r) => r !== 'admin')

export const STAFF_ROLES: readonly Role[] = ['admin', 'officer', 'supervisor', 'safety', 'security', 'yard']

/** Platform operators (Module 9) are not a tenant role: they have no tenant and live under /platform only. */
export const OPERATOR_HOME = '/platform'
