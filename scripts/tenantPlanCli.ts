// Sets the plan of a workspace (`tenants.plan`): the one input the visitor pass cap reads. There is no billing in the app, so
// the operator records the plan their client bought. Logic only; `tenant-plan.ts` wires the Admin SDK to it.
//   starter     20 new visitor passes a month
//   growth      unlimited
//   compliance  unlimited
//   none        removes the field (a workspace with no plan is not capped)
import { parseArgs } from 'node:util'
import { platformAudit, type PlatformAuditEntry } from '../functions/src/platform/platformAudit.ts'
import { VISITOR_PLANS } from '../functions/src/visitorLogic.ts'
import { COMMON_OPTIONS } from './lib/env.ts'

export interface TenantPlanIo {
  store: {
    /** The workspace's current `plan` (`null` = no plan recorded), or `undefined` when the workspace does not exist. */
    getPlan(tenantId: string): Promise<string | null | undefined>
    /** `plan: null` removes the field. Writes the audit entry in the same batch. */
    setPlan(tenantId: string, plan: string | null, audit: PlatformAuditEntry): Promise<void>
  }
  out: (line: string) => void
  env: string
}

class UsageError extends Error {}

export async function runTenantPlan(argv: string[], io: TenantPlanIo): Promise<number> {
  try {
    const { values } = parseArgs({ args: argv, options: { ...COMMON_OPTIONS, tenant: { type: 'string' }, plan: { type: 'string' } } })
    const tenantId = (values.tenant ?? '').trim()
    const plan = (values.plan ?? '').trim().toLowerCase()
    if (!/^ten_[a-z0-9]{10}$/.test(tenantId)) throw new UsageError('--tenant <ten_…> is required (the workspace id from the Super admin console)')
    if (plan !== 'none' && !(VISITOR_PLANS as readonly string[]).includes(plan)) throw new UsageError(`--plan must be one of: ${[...VISITOR_PLANS, 'none'].join(', ')}`)
    const current = await io.store.getPlan(tenantId)
    if (current === undefined) throw new UsageError(`no workspace ${tenantId}`)
    const next = plan === 'none' ? null : plan
    await io.store.setPlan(tenantId, next, platformAudit('script', 'workspace.planChanged', tenantId, { from: current, to: next, env: io.env }))
    io.out(`tenant:plan (${io.env}): ${tenantId} plan ${current ?? 'none'} -> ${next ?? 'none'}${next === 'starter' ? ' (20 visitor passes a month)' : ' (visitor passes not capped)'}.`)
    return 0
  } catch (e) {
    io.out(`tenant:plan: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
