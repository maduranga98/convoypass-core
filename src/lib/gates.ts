// Keep in sync with functions/src/gates.ts (functions deploy from their own folder; a unit test compares them).

export interface GateDef {
  /** Slug, created once and never changed: check-ins and denials keep the id they were recorded with. */
  id: string
  name: string
}

export const GATE_ID_PATTERN = /^[a-z0-9_]{2,40}$/
export const MIN_GATES = 1
export const MAX_GATES = 10
export const GATE_NAME_MIN = 2
export const GATE_NAME_MAX = 40

/** Used when the tenant has not configured its own gates. */
export const DEFAULT_GATES: readonly GateDef[] = [{ id: 'main', name: 'Main Gate' }]

/** The tenant's gates, or the default when it has none. */
export const gatesOf = (tenant: { gates?: readonly GateDef[] | undefined } | null | undefined): readonly GateDef[] =>
  tenant?.gates && tenant.gates.length > 0 ? tenant.gates : DEFAULT_GATES
