import { buildContractorActivity } from './contractorActivity.js'
import { buildGateLog } from './gateLog.js'
import { buildGatePasses } from './gatePasses.js'
import { buildHistory } from './history.js'
import { buildRejections } from './rejections.js'
import { buildTurnaround } from './turnaround.js'
import type { ReportInput, ReportResult } from './types.js'

export * from './types.js'
export * from './range.js'
export { median, percentile } from './stats.js'

/** Pure: plain documents in, a report out. Auth, queries and caps live in the callable. */
export function buildReport(input: ReportInput): ReportResult {
  const body = (() => {
    switch (input.type) {
      case 'gate_log':
        return buildGateLog(input)
      case 'gate_passes':
        return buildGatePasses(input)
      case 'contractor_activity':
        return buildContractorActivity(input)
      case 'turnaround':
        return buildTurnaround(input)
      case 'rejections':
        return buildRejections(input)
      case 'vehicle_history':
      case 'driver_history':
        return buildHistory(input)
    }
  })()
  return { type: input.type, ...body, generatedAt: input.generatedAt, timezone: input.timezone, from: input.from, to: input.to }
}
