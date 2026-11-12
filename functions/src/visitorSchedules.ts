import { onSchedule } from 'firebase-functions/v2/scheduler'
import { expireVisitorPasses } from './visitorExpiry.js'
import { visitorPort } from './visitorsPort.js'

/**
 * Every 15 minutes, like the vehicle dwell job it sits beside: expires visitor passes past their last day and flags (never
 * closes) visitors still inside past their limit, so the flag reaches supervisors within minutes. Idempotent and cheap on a
 * quiet company (two small queries).
 */
export const expireVisitorPassesScheduled = onSchedule({ schedule: '*/15 * * * *', timeZone: 'UTC', timeoutSeconds: 300 }, async () => {
  await expireVisitorPasses(visitorPort(), Date.now())
})
