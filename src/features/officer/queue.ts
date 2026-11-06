import { toMs } from '@/features/passes/passView'
import type { PassDoc } from '@/types/passes'

type Waiting = Pick<PassDoc, 'submittedAt' | 'supervisor'>

/** When the pass reached the officer: the supervisor's approval (the clock the officer SLA uses), else submission. */
export const waitingSince = (pass: Waiting): number | null => toMs(pass.supervisor?.at) ?? toMs(pass.submittedAt)

/** Longest waiting for the officer first. A pending server time sorts last. */
export const oldestWaitingFirst = <T extends Waiting>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => (waitingSince(a) ?? Infinity) - (waitingSince(b) ?? Infinity))

/** Waited longer than the tenant's officer time target since the supervisor approved it. */
export function isOfficerOverdue(pass: Waiting, now: number, targetMinutes: number): boolean {
  const ms = waitingSince(pass)
  return ms !== null && now - ms > targetMinutes * 60_000
}
