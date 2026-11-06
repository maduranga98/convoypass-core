import type { GatePassCheck } from '@/lib/gatePassLogic'
import { strings } from '@/lib/strings'

const g = strings.gatePasses.gate

/**
 * What the guard reads when the vehicle is eligible but its monthly gate pass does not let it in: three different
 * messages, so the guard (and the office) know whether a pass was never issued, was stopped, or simply ran out.
 */
export function gatePassDenial(check: Exclude<GatePassCheck, { state: 'active' }>): string {
  if (check.state === 'blocked') return g.blocked(g.blockedReason[check.reason])
  if (check.state === 'expired') return g.expired
  return g.none
}
