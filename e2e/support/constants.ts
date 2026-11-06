// Shared by the tests and the Admin SDK helper. No imports: safe to load in the Playwright worker.
export const PROJECT = 'demo-conveypass-e2e'
export const PASSWORD = 'Passw0rd!e2e'
export const TENANT = 't1'
export const CONTRACTOR = 'c1'
export const VEHICLE = 'veh_e2etest001'
export const PLATE = 'WP LJ-4821'
/** Module 12: drivers and security sign in with an 8-digit PIN (hashed into pinIndex with the emulator's dev pepper). */
export const DRIVER_PIN = '48291736'
export const SECURITY_PIN = '59302847'

export const STAFF = {
  admin: { email: 'admin@e2e.test', name: 'Ann Admin' },
  officer: { email: 'officer@e2e.test', name: 'Olga Officer' },
  supervisor: { email: 'supervisor@e2e.test', name: 'Sue Supervisor' },
  security: { email: 'security@e2e.test', name: 'Sam Security' }, // a PIN user: the email is not used to sign in
} as const

