// Module 6: dashboard trend and reports. Read only. Admin SDK queries, tenant always from the verified claims.
// The pure report logic lives in ./reports; this file handles auth, validation, queries and caps only.
import { z } from 'zod'
import { parse, requireActiveCaller, type Deps, type PassQuery } from './core.js'
import { dateKey as computeDateKey, DEFAULT_TIMEZONE, isValidTimezone } from './dates.js'
import { DEFAULT_REJECTION_REASONS } from './defaultRejectionReasons.js'
import { fail } from './errors.js'
import { addDays, buildReport, checkRange, fromDateKey, rangeBounds, REPORT_TYPES, type ReportResult } from './reports/index.js'
import type { ReportEvent, ReportPass, ReportVisit } from './reports/types.js'
import { dwellLimitHoursOf } from './visitLogic.js'
import type { Caller, PassStatus, TenantData } from './types.js'

/** Most passes (plus denials, for the gate log) one report may scan. Over it the report is refused, never truncated. */
export const SCAN_CAP = 20_000
export const TREND_DAYS = [7, 14, 30] as const

const id = z.string().trim().min(1).max(128)

export const getDashboardTrendSchema = z.object({ days: z.union([z.literal(7), z.literal(14), z.literal(30)]) })

export const runReportSchema = z.object({
  type: z.enum(REPORT_TYPES),
  from: z.string().max(10),
  to: z.string().max(10),
  contractorId: id.optional(),
  vehicleId: id.optional(),
  driverId: id.optional(),
})

export interface TrendDay {
  dateKey: string
  submitted: number
  approved: number
  checkedIn: number
  rejected: number
}

export interface TrendResult {
  days: TrendDay[]
  timezone: string
  generatedAt: number
}

const timezoneOf = (tenant: TenantData | null): string =>
  tenant?.timezone && isValidTimezone(tenant.timezone) ? tenant.timezone : DEFAULT_TIMEZONE

/** Reports are for management only: admin and officer. Everyone else is refused whatever the payload says. */
async function requireManagement(deps: Deps, caller: Caller): Promise<void> {
  await requireActiveCaller(deps, caller)
  if (caller.role !== 'admin' && caller.role !== 'officer') {
    throw fail('permission-denied', 'forbidden', 'Only admins and officers can see reports')
  }
}

const APPROVED: readonly PassStatus[] = ['officer_approved', 'checked_in']

/** `count()` aggregations only: no pass document is read. Days with no passes are zeros. */
export async function getDashboardTrend(deps: Deps, caller: Caller, raw: unknown): Promise<TrendResult> {
  const { days } = parse(getDashboardTrendSchema, raw)
  await requireManagement(deps, caller)
  const tenant = await deps.data.getTenant(caller.tenantId)
  const timezone = timezoneOf(tenant)
  const nowMs = deps.now() * 1000
  const today = computeDateKey(timezone, new Date(nowMs))
  const todayDay = fromDateKey(today)
  const keys = Array.from({ length: days }, (_, i) => addDays(todayDay, i - (days - 1)).replaceAll('-', ''))

  const count = (key: string, statuses?: readonly PassStatus[]): Promise<number> =>
    deps.data.countPasses({
      kind: 'dateKey',
      tenantId: caller.tenantId,
      fromKey: key,
      toKey: key,
      ...(statuses ? { statuses } : {}),
    })
  const perDay = await Promise.all(
    keys.map(async (key): Promise<TrendDay> => {
      const [submitted, approved, checkedIn, rejected] = await Promise.all([
        count(key),
        count(key, APPROVED),
        count(key, ['checked_in']),
        count(key, ['rejected']),
      ])
      return { dateKey: key, submitted, approved, checkedIn, rejected }
    }),
  )
  return { days: perDay, timezone, generatedAt: nowMs }
}

const tooLarge = () =>
  fail('resource-exhausted', 'range-too-large', 'This report is too large. Narrow the date range or add a filter.')

export async function runReport(deps: Deps, caller: Caller, raw: unknown, scanCap = SCAN_CAP): Promise<ReportResult> {
  const input = parse(runReportSchema, raw)
  await requireManagement(deps, caller)

  const check = checkRange(input.from, input.to)
  if (!check.ok) {
    throw check.problem === 'too-long'
      ? fail('invalid-argument', 'range-too-long', 'Choose a range of at most 92 days')
      : fail('invalid-argument', 'range-invalid', 'Choose a valid date range')
  }
  if (input.type === 'vehicle_history' && !input.vehicleId) {
    throw fail('invalid-argument', 'id-required', 'Choose a vehicle')
  }
  if (input.type === 'driver_history' && !input.driverId) {
    throw fail('invalid-argument', 'id-required', 'Choose a driver')
  }

  // Every id must belong to the caller's tenant: a foreign id looks exactly like a missing one.
  const { tenantId } = caller
  const [contractor, vehicle, driver] = await Promise.all([
    input.contractorId ? deps.data.getContractor(input.contractorId) : null,
    input.vehicleId ? deps.data.getVehicle(input.vehicleId) : null,
    input.driverId ? deps.data.getDriver(input.driverId) : null,
  ])
  if (
    (input.contractorId && contractor?.tenantId !== tenantId) ||
    (input.vehicleId && vehicle?.tenantId !== tenantId) ||
    (input.driverId && driver?.tenantId !== tenantId)
  ) {
    throw fail('invalid-argument', 'filter-invalid', 'That filter does not exist')
  }

  const tenant = await deps.data.getTenant(tenantId)
  const timezone = timezoneOf(tenant)
  const bounds = rangeBounds(timezone, input.from, input.to)
  const filters = {
    ...(input.contractorId ? { contractorId: input.contractorId } : {}),
    ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
    ...(input.driverId ? { driverId: input.driverId } : {}),
  }

  let passes: ReportPass[]
  let events: ReportEvent[]
  let visits: ReportVisit[] = []
  if (input.type === 'gate_log') {
    // Check-ins by `checkIn.at`, denials by `at`. Filters apply in memory so no extra indexes are needed.
    const passQuery: PassQuery = { kind: 'checkIn', tenantId, startMs: bounds.startMs, endMs: bounds.endMs }
    const eventQuery = { tenantId, startMs: bounds.startMs, endMs: bounds.endMs }
    const [passCount, eventCount] = await Promise.all([deps.data.countPasses(passQuery), deps.data.countGateEvents(eventQuery)])
    if (passCount + eventCount > scanCap) throw tooLarge()
    const [rawPasses, rawEvents] = await Promise.all([
      deps.data.listPasses(passQuery, scanCap + 1),
      deps.data.listGateEvents(eventQuery, scanCap + 1),
    ])
    if (rawPasses.length + rawEvents.length > scanCap) throw tooLarge()
    passes = rawPasses.filter(
      (p) =>
        (!input.contractorId || p.contractorId === input.contractorId) &&
        (!input.vehicleId || p.vehicleId === input.vehicleId) &&
        (!input.driverId || p.driverId === input.driverId),
    )
    // Denials do not record a driver id, so a driver filter shows that driver's check-ins only.
    events = input.driverId
      ? []
      : rawEvents.filter(
          (e) => (!input.contractorId || e.contractorId === input.contractorId) && (!input.vehicleId || e.vehicleId === input.vehicleId),
        )
  } else {
    const query: PassQuery = { kind: 'dateKey', tenantId, fromKey: bounds.fromKey, toKey: bounds.toKey, ...filters }
    if ((await deps.data.countPasses(query)) > scanCap) throw tooLarge()
    passes = await deps.data.listPasses(query, scanCap + 1)
    if (passes.length > scanCap) throw tooLarge()
    events = []
    if (input.type === 'gate_passes') {
      // The in/out movements of the same days. Filters apply in memory (visits carry the vehicle id and the pass id).
      const vq = { tenantId, fromKey: bounds.fromKey, toKey: bounds.toKey }
      if ((await deps.data.countVisits(vq)) > scanCap) throw tooLarge()
      const wanted = new Set(passes.map((p) => p.vehicleId))
      visits = (await deps.data.listVisits(vq, scanCap + 1)).filter((v) => wanted.has(v.vehicleId))
    }
  }

  const reasonLabels = new Map<string, string>(DEFAULT_REJECTION_REASONS.map((r) => [r.id, r.label]))
  for (const r of tenant?.rejectionReasons ?? []) reasonLabels.set(r.id, r.label)

  return buildReport({
    type: input.type,
    passes,
    events,
    visits,
    gateTimeHours: dwellLimitHoursOf(tenant),
    contractorNames: await deps.data.listContractorNames(tenantId),
    reasonLabels,
    timezone,
    from: input.from,
    to: input.to,
    generatedAt: deps.now() * 1000,
    filters,
  })
}
