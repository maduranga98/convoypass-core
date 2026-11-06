// Per-device bookkeeping for the first-run checklist. localStorage is a convenience here, never the source of truth:
// every read and write is guarded, and the card still works (just without memory) when storage is unavailable.
const PREFIX = 'convoypass:onboarding'
export const settingsVisitedKey = (tenantId: string): string => `${PREFIX}:settingsVisited:${tenantId}`
export const dismissedKey = (tenantId: string): string => `${PREFIX}:dismissed:${tenantId}`

const read = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
const write = (key: string): void => {
  try {
    localStorage.setItem(key, '1')
  } catch {
    /* storage unavailable */
  }
}

export const hasVisitedSettings = (tenantId: string): boolean => read(settingsVisitedKey(tenantId))
export const markSettingsVisited = (tenantId: string): void => write(settingsVisitedKey(tenantId))
export const isDismissed = (tenantId: string): boolean => read(dismissedKey(tenantId))
export const dismissOnboarding = (tenantId: string): void => write(dismissedKey(tenantId))
