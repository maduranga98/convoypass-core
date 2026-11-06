import { onSchedule } from 'firebase-functions/v2/scheduler'
import { computeQualificationLists, rolloverGatePasses } from './gatePasses.js'
import { gatePassPort } from './gatePassPort.js'
import { deps } from './runtime.js'

/**
 * Every 10 minutes: for each company whose month just changed (in ITS timezone) expires last month's passes and, only when the
 * company switched on "auto-issue", issues the new month's passes to the whole qualified list. A company that already rolled
 * over costs one read of its own document, so this is cheap on every other run. The short interval keeps the gap after midnight
 * (vehicles without a pass yet) to minutes.
 */
export const rolloverGatePassesScheduled = onSchedule({ schedule: '*/10 * * * *', timeZone: 'UTC', timeoutSeconds: 540, memory: '512MiB' }, async () => {
  await rolloverGatePasses(deps(), gatePassPort(), Date.now())
})

/**
 * Daily, shortly after midnight UTC: in the last days of a company's month recomputes next month's qualification list, so the
 * screen opens on a ready, current list. Computed here and stored, never on page load.
 */
export const computeQualificationScheduled = onSchedule({ schedule: '30 0 * * *', timeZone: 'UTC', timeoutSeconds: 540, memory: '512MiB' }, async () => {
  await computeQualificationLists(deps(), gatePassPort(), Date.now())
})
