export const DEFAULT_SETUP_TIMEZONE = 'Asia/Colombo'

const browserZones = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
}

/** Every IANA zone the browser knows (Intl.supportedValuesOf), always including the default. */
export function timezoneList(): string[] {
  const zones = browserZones()
  return zones.includes(DEFAULT_SETUP_TIMEZONE) ? zones : [DEFAULT_SETUP_TIMEZONE, ...zones]
}
