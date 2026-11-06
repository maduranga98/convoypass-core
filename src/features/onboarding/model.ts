export const ONBOARDING_STEPS = ['contractor', 'supervisor', 'vehicles', 'drivers', 'officer', 'security', 'settings'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export interface OnboardingCounts {
  contractors: number
  supervisors: number
  vehicles: number
  drivers: number
  officers: number
  security: number
}

/** Steps are derived from live data; only "settings" depends on this device (the admin has opened Settings). */
export function stepsDone(counts: OnboardingCounts, visitedSettings: boolean): Record<OnboardingStep, boolean> {
  return {
    contractor: counts.contractors > 0,
    supervisor: counts.supervisors > 0,
    vehicles: counts.vehicles > 0,
    drivers: counts.drivers > 0,
    officer: counts.officers > 0,
    security: counts.security > 0,
    settings: visitedSettings,
  }
}

export const stepLink: Record<OnboardingStep, string> = {
  contractor: '/admin/contractors',
  supervisor: '/admin/users',
  vehicles: '/admin/vehicles',
  drivers: '/admin/drivers',
  officer: '/admin/users',
  security: '/admin/users',
  settings: '/admin/settings',
}
export const IMPORT_LINK = '/admin/vehicles?import=1'
