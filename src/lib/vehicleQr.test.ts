import { describe, expect, it } from 'vitest'
import { parseVehicleQr } from './vehicleQr'

const BASE = 'https://gate.example.com'
const ID = 'veh_ab12cd34ef'

describe('parseVehicleQr', () => {
  it('accepts the app URL, with a trailing slash, a query string or a hash', () => {
    for (const text of [`${BASE}/v/${ID}`, `${BASE}/v/${ID}/`, `${BASE}/v/${ID}?src=label`, `${BASE}/v/${ID}#x`, `  ${BASE}/v/${ID}\n`]) {
      expect(parseVehicleQr(text, BASE)).toBe(ID)
    }
  })
  it('honours a base with a path prefix and is case-insensitive on the host', () => {
    expect(parseVehicleQr(`https://GATE.example.com/app/v/${ID}`, 'https://gate.example.com/app/')).toBe(ID)
    expect(parseVehicleQr(`${BASE}/v/${ID}`, `${BASE}/app`)).toBeNull()
  })
  it('accepts a raw vehicle id', () => {
    expect(parseVehicleQr(ID, BASE)).toBe(ID)
    expect(parseVehicleQr(ID, null)).toBe(ID)
  })
  it('refuses a foreign domain, another scheme or port, and look-alike paths', () => {
    expect(parseVehicleQr(`https://evil.example.com/v/${ID}`, BASE)).toBeNull()
    expect(parseVehicleQr(`http://gate.example.com/v/${ID}`, BASE)).toBeNull()
    expect(parseVehicleQr(`https://gate.example.com:8443/v/${ID}`, BASE)).toBeNull()
    expect(parseVehicleQr(`${BASE}/x/v/${ID}`, BASE)).toBeNull()
    expect(parseVehicleQr(`${BASE}/v/${ID}/extra`, BASE)).toBeNull()
    expect(parseVehicleQr(`${BASE}/v/${ID}`, null)).toBeNull()
  })
  it('refuses junk and ids of the wrong shape or length', () => {
    for (const text of ['', 'hello', 'WIFI:S:x;;', 'veh_ab12cd34e', 'veh_ab12cd34efg', 'VEH_AB12CD34EF', 'veh_ab12-d34ef']) {
      expect(parseVehicleQr(text, BASE)).toBeNull()
    }
    expect(parseVehicleQr(`${BASE}/v/veh_short`, BASE)).toBeNull()
    expect(parseVehicleQr(`${BASE}/v/${ID.toUpperCase()}`, BASE)).toBeNull()
  })
})
