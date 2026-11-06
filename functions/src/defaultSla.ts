// Keep in sync with src/lib/defaultSla.ts (functions deploy from their own folder; a unit test compares them).

export interface SlaSettings {
  /** Minutes a submitted pass may wait for its supervisor. */
  supervisorMinutes: number
  /** Minutes a supervisor-approved pass may wait for an officer. */
  officerMinutes: number
}

export const SLA_MIN = 5
export const SLA_MAX = 240
export const DEFAULT_SLA: SlaSettings = { supervisorMinutes: 30, officerMinutes: 30 }

/** The tenant's SLA, or the default for whatever is missing. */
export const slaOf = (tenant: { sla?: Partial<SlaSettings> | undefined } | null | undefined): SlaSettings => ({
  supervisorMinutes: tenant?.sla?.supervisorMinutes ?? DEFAULT_SLA.supervisorMinutes,
  officerMinutes: tenant?.sla?.officerMinutes ?? DEFAULT_SLA.officerMinutes,
})
