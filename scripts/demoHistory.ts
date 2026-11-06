/**
 * Deterministic history for the demo tenant: about `perDay` passes a day for `days` days, with varied approval
 * delays, ~12% first-attempt rejections spread over the tenant's reasons, resubmissions, a few revokes, offline
 * check-ins and denied entries. Pure (no Firebase): `seed-demo.ts` writes the result; tests call it directly.
 * The same `seed` and inputs always give the same passes, so reports are repeatable.
 */

// Calendar helpers (the same notion of "a day" as `dateKey` / functions/src/reports/range.ts).
const addDays = (day: string, n: number): string => {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const toDateKey = (day: string): string => day.replaceAll('-', '')

function offsetAt(timeZone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(ms)
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(ms / 1000) * 1000
}

/** Midnight at the start of `day` in `timeZone`, epoch milliseconds. */
function dayStartMs(timeZone: string, day: string): number {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  return guess - offsetAt(timeZone, guess - offsetAt(timeZone, guess))
}

export interface Person {
  uid: string
  name: string
}

export interface FleetVehicle {
  vehicleId: string
  contractorKey: string
  plateNo: string
  vehicleType: string
  driverIds: readonly string[]
}

export interface HistoryInput {
  seed: number
  /** Last day to generate, `YYYY-MM-DD` in the tenant timezone (the day before today for the demo). */
  endDay: string
  days: number
  timezone: string
  perDay: number
  tenantId: string
  vehicles: readonly FleetVehicle[]
  driverNames: Readonly<Record<string, string>>
  contractors: Readonly<Record<string, { id: string; supervisors: readonly Person[] }>>
  officers: readonly Person[]
  guards: readonly Person[]
  gates: readonly { id: string; name: string }[]
  checklist: readonly { id: string; label: string }[]
  reasons: readonly { id: string; label: string }[]
  /** `vehicleId_dateKey` ids that already exist (hand-made demo passes): never generated again. */
  taken: ReadonlySet<string>
}

type Role = 'supervisor' | 'officer' | 'security'
interface Entry { action: string; stage: string; byUid: string; byName: string; byRole: Role; at: number; attempt: number }
interface Rejection { reason: string; reasonCode: string; note?: string; stage: 'supervisor' | 'officer' | 'revoked'; byUid: string; byName: string; byRole: Role; at: number }
interface Checklist { id: string; label: string; answer: 'yes' | 'no'; note?: string }
interface Evidence { gps: { path: string; size: number; contentType: string }; dashcam: { path: string; size: number; contentType: string }; extra: never[] }

export interface HistoryPass {
  id: string
  data: {
    tenantId: string
    contractorId: string
    vehicleId: string
    plateNo: string
    vehicleType: string
    dateKey: string
    driverId: string
    driverName: string
    status: 'submitted' | 'supervisor_approved' | 'officer_approved' | 'checked_in' | 'rejected'
    attempt: number
    submittedAt: number
    updatedAt: number
    checklist: Checklist[]
    evidence: Evidence
    captureMeta: { method: 'file'; clientCapturedAt: { gps: string; dashcam: string } }
    supervisor?: { uid: string; name: string; at: number }
    officer?: { uid: string; name: string; at: number }
    rejection?: Rejection
    rejectionHistory?: (Rejection & { attempt: number; checklist: Checklist[]; evidence: Evidence })[]
    history: Entry[]
    checkIn?: { uid: string; name: string; at: number; gateId: string; gateName: string; requestId: string; offlineCapturedAt?: string }
  }
}

export interface HistoryEvent {
  id: string
  data: {
    tenantId: string
    type: 'denied'
    vehicleId: string
    plateNo: string
    contractorId: string
    passId: string | null
    passStatus: HistoryPass['data']['status'] | null
    driverName: string | null
    dateKey: string
    reasonCode: string
    note?: string
    gateId: string
    gateName: string
    byUid: string
    byName: string
    at: number
    requestId: string
  }
}

// ---- seeded randomness ------------------------------------------------------------------------

/** mulberry32: small, fast and identical on every platform. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rand = () => number
const MIN = 60_000
const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T
const normal = (r: Rand): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
/** Log-normal minutes around `median`: a few slow ones, never zero. */
const delay = (r: Rand, median: number, spread: number): number => Math.max(1, median * Math.exp(spread * normal(r)))
const weighted = <T>(r: Rand, items: readonly (readonly [T, number])[]): T => {
  const total = items.reduce((s, [, w]) => s + w, 0)
  let x = r() * total
  for (const [item, w] of items) {
    x -= w
    if (x < 0) return item
  }
  return items[items.length - 1]?.[0] as T
}

const REASON_WEIGHTS: Record<string, number> = { gps_unclear: 30, dashcam_unclear: 25, checklist_issue: 15, photo_not_fresh: 12, wrong_vehicle: 8, other: 10 }
const OTHER_NOTES = ['Plate not visible in the photo', 'Wrong driver on the photo', 'Photos taken in the dark']
const DENY: readonly (readonly [string, number])[] = [['not_approved', 40], ['driver_mismatch', 20], ['vehicle_condition', 15], ['suspended', 10], ['other', 15]]

function shuffled<T>(r: Rand, list: readonly T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

/** Passes and denials for `days` days ending at `endDay`, oldest first. */
export function generateHistory(input: HistoryInput): { passes: HistoryPass[]; events: HistoryEvent[] } {
  const passes: HistoryPass[] = []
  const events: HistoryEvent[] = []
  const reasonLabel = new Map(input.reasons.map((x) => [x.id, x.label]))
  const reasonIds = input.reasons.map((x) => x.id)

  for (let n = input.days - 1; n >= 0; n--) {
    const day = addDays(input.endDay, -n)
    const key = toDateKey(day)
    const r = rng(input.seed * 1009 + Number(key))
    const startMs = dayStartMs(input.timezone, day)
    const endMs = dayStartMs(input.timezone, addDays(day, 1))
    const sunday = new Date(`${day}T12:00:00Z`).getUTCDay() === 0
    const target = Math.round((sunday ? input.perDay * 0.45 : input.perDay) + normal(r) * 2)
    const fleet = shuffled(r, input.vehicles).filter((v) => !input.taken.has(`${v.vehicleId}_${key}`)).slice(0, Math.max(0, target))
    // Nothing is decided in the last half hour of the day: late stages simply do not happen.
    const limit = endMs - 30 * MIN

    for (const v of fleet) {
      const contractor = input.contractors[v.contractorKey]
      if (!contractor) continue
      const driverId = pick(r, v.driverIds)
      const driverName = input.driverNames[driverId] ?? 'Driver'
      const supervisor = pick(r, contractor.supervisors)
      const base = `tenants/${input.tenantId}/passes/${v.vehicleId}/${key}`
      const evidence = (attempt: number): Evidence => ({
        gps: { path: `${base}/${attempt}/gps.jpg`, size: 24_000, contentType: 'image/jpeg' },
        dashcam: { path: `${base}/${attempt}/dashcam.jpg`, size: 24_000, contentType: 'image/jpeg' },
        extra: [],
      })
      const checklist = (): Checklist[] => {
        const bad = r() < 0.06 ? pick(r, input.checklist) : null
        return input.checklist.map((c) => (bad?.id === c.id ? { id: c.id, label: c.label, answer: 'no', note: 'Will fix tomorrow' } : { id: c.id, label: c.label, answer: 'yes' }))
      }

      const history: Entry[] = []
      const rejectionHistory: NonNullable<HistoryPass['data']['rejectionHistory']> = []
      let attempt = 1
      // Morning rush: most trucks submit between 05:30 and 09:00 local.
      let submittedAt = startMs + (5.5 * 60 + Math.min(300, delay(r, 70, 0.6))) * MIN
      let state: HistoryPass['data']['status'] = 'submitted'
      let sup: HistoryPass['data']['supervisor']
      let off: HistoryPass['data']['officer']
      let rejection: Rejection | undefined
      let checkIn: HistoryPass['data']['checkIn']
      let currentChecklist = checklist()
      const rejectP = [0.12, 0.15, 0.1]

      for (;;) {
        sup = undefined
        off = undefined
        rejection = undefined
        const officer = pick(r, input.officers)
        const reject = (stage: 'supervisor' | 'officer' | 'revoked', by: Person, role: Role, at: number): Rejection => {
          const reasonCode = weighted(r, reasonIds.map((id) => [id, REASON_WEIGHTS[id] ?? 5] as const))
          const label = reasonLabel.get(reasonCode) ?? reasonCode
          const note = reasonCode === 'other' ? pick(r, OTHER_NOTES) : undefined
          return { reason: note ? (reasonCode === 'other' ? note : `${label}: ${note}`) : label, reasonCode, ...(note ? { note } : {}), stage, byUid: by.uid, byName: by.name, byRole: role, at }
        }
        const entry = (action: string, stage: string, by: Person, role: Role, at: number): void => void history.push({ action, stage, byUid: by.uid, byName: by.name, byRole: role, at, attempt })

        const supAt = submittedAt + delay(r, 12, 0.8) * MIN
        if (supAt > limit) {
          // the pass simply waits (it shows as expired the next day)
        } else if (r() < (attempt <= 3 ? (rejectP[attempt - 1] ?? 0.1) * 0.7 : 0)) {
          rejection = reject('supervisor', supervisor, 'supervisor', supAt)
          entry('reject', 'supervisor', supervisor, 'supervisor', supAt)
          state = 'rejected'
        } else {
          sup = { uid: supervisor.uid, name: supervisor.name, at: supAt }
          entry('approve', 'supervisor', supervisor, 'supervisor', supAt)
          state = 'supervisor_approved'
        }
        if (state === 'supervisor_approved') {
          const offAt = supAt + delay(r, 9, 0.8) * MIN
          if (offAt > limit) {
            // waits for the officer
          } else if (r() < (rejectP[attempt - 1] ?? 0.1) * 0.3) {
            rejection = reject('officer', officer, 'officer', offAt)
            entry('reject', 'officer', officer, 'officer', offAt)
            state = 'rejected'
          } else {
            off = { uid: officer.uid, name: officer.name, at: offAt }
            entry('approve', 'officer', officer, 'officer', offAt)
            state = 'officer_approved'
            const inAt = offAt + delay(r, 35, 0.7) * MIN
            if (r() < 0.012) {
              // Revoked by the officer before the vehicle reached the gate.
              const at = Math.min(offAt + delay(r, 15, 0.5) * MIN, endMs - 2 * MIN)
              rejection = reject('revoked', officer, 'officer', at)
              entry('revoke', 'revoked', officer, 'officer', at)
              state = 'rejected'
            } else if (inAt < limit && r() < 0.9) {
              const guard = pick(r, input.guards)
              const gate = pick(r, input.gates)
              const offline = r() < 0.06
              checkIn = {
                uid: guard.uid, name: guard.name, at: inAt, gateId: gate.id, gateName: gate.name,
                requestId: `${input.seed}-${key}-${v.vehicleId}-${attempt}`,
                ...(offline ? { offlineCapturedAt: new Date(inAt - (1 + Math.floor(r() * 8)) * MIN).toISOString() } : {}),
              }
              entry('check_in', 'gate', guard, 'security', inAt)
              state = 'checked_in'
            }
          }
        }
        if (state !== 'rejected' || attempt >= 5 || r() > 0.85) break
        // The driver fixes it and submits again; the old rejection moves to rejectionHistory.
        const next = (rejection as Rejection).at + delay(r, 35, 0.6) * MIN
        if (next > limit) break // too late in the day: the rejection stays as it is
        rejectionHistory.push({ ...(rejection as Rejection), attempt, checklist: currentChecklist, evidence: evidence(attempt) })
        attempt++
        submittedAt = next
        currentChecklist = checklist()
        state = 'submitted'
      }

      const lastAt = Math.max(submittedAt, ...history.map((h) => h.at))
      passes.push({
        id: `${v.vehicleId}_${key}`,
        data: {
          tenantId: input.tenantId, contractorId: contractor.id, vehicleId: v.vehicleId, plateNo: v.plateNo, vehicleType: v.vehicleType,
          dateKey: key, driverId, driverName, status: state, attempt, submittedAt, updatedAt: lastAt,
          checklist: currentChecklist, evidence: evidence(attempt),
          captureMeta: { method: 'file', clientCapturedAt: { gps: new Date(submittedAt - 2 * MIN).toISOString(), dashcam: new Date(submittedAt - 2 * MIN).toISOString() } },
          ...(sup ? { supervisor: sup } : {}),
          ...(off ? { officer: off } : {}),
          ...(state === 'rejected' && rejection ? { rejection: stripAttempt(rejection) } : {}),
          ...(rejectionHistory.length > 0 ? { rejectionHistory } : {}),
          history,
          ...(checkIn ? { checkIn } : {}),
        },
      })
    }

    // Denied entries: about one a day, at the gate between 06:00 and 18:00.
    const denials = weighted(r, [[0, 25], [1, 40], [2, 25], [3, 10]] as const)
    for (let d = 0; d < denials; d++) {
      const v = pick(r, input.vehicles)
      const contractor = input.contractors[v.contractorKey]
      if (!contractor) continue
      const gate = pick(r, input.gates)
      const guard = pick(r, input.guards)
      const reasonCode = weighted(r, DENY)
      const passId = `${v.vehicleId}_${key}`
      const pass = passes.find((p) => p.id === passId)
      const at = startMs + (6 * 60 + Math.floor(r() * 12 * 60)) * MIN
      events.push({
        id: `den_${input.seed}-${key}-${d}`,
        data: {
          tenantId: input.tenantId, type: 'denied', vehicleId: v.vehicleId, plateNo: v.plateNo, contractorId: contractor.id,
          passId: pass ? passId : null, passStatus: pass ? pass.data.status : null, driverName: pass ? pass.data.driverName : null,
          dateKey: key, reasonCode, ...(reasonCode === 'other' ? { note: 'Papers not in order' } : {}), gateId: gate.id, gateName: gate.name,
          byUid: guard.uid, byName: guard.name, at, requestId: `${input.seed}-${key}-d${d}`,
        },
      })
    }
  }
  return { passes, events }
}

const stripAttempt = (r: Rejection): Rejection => {
  const { reason, reasonCode, note, stage, byUid, byName, byRole, at } = r
  return { reason, reasonCode, ...(note ? { note } : {}), stage, byUid, byName, byRole, at }
}
