import { describe, expect, it } from 'vitest'
import { runTenantPlan } from './tenantPlanCli.ts'

const TENANT = 'ten_a1b2c3d4e5'
const make = (current: string | null | undefined) => {
  const out: string[] = []
  const writes: { tenantId: string; plan: string | null; audit: unknown }[] = []
  return {
    out,
    writes,
    io: {
      env: 'emulator',
      out: (l: string) => out.push(l),
      store: { getPlan: async () => current, setPlan: async (tenantId: string, plan: string | null, audit: unknown) => void writes.push({ tenantId, plan, audit }) },
    },
  }
}

describe('tenant:plan', () => {
  it('sets a plan and audits the change', async () => {
    const m = make(null)
    expect(await runTenantPlan(['--env', 'emulator', '--tenant', TENANT, '--plan', 'Starter'], m.io)).toBe(0)
    expect(m.writes).toEqual([{ tenantId: TENANT, plan: 'starter', audit: expect.objectContaining({ actorUid: 'script', action: 'workspace.planChanged', targetRef: TENANT, meta: { from: null, to: 'starter', env: 'emulator' } }) }])
    expect(m.out.join('\n')).toContain('20 visitor passes a month')
  })
  it('"none" removes the plan', async () => {
    const m = make('starter')
    expect(await runTenantPlan(['--env', 'emulator', '--tenant', TENANT, '--plan', 'none'], m.io)).toBe(0)
    expect(m.writes[0]?.plan).toBeNull()
  })
  it('refuses a bad plan, a bad workspace id and a workspace that does not exist, writing nothing', async () => {
    for (const argv of [['--tenant', TENANT, '--plan', 'platinum'], ['--tenant', 'x', '--plan', 'starter'], ['--plan', 'starter']]) {
      const m = make(null)
      expect(await runTenantPlan(['--env', 'emulator', ...argv], m.io)).toBe(1)
      expect(m.writes).toEqual([])
    }
    const m = make(undefined)
    expect(await runTenantPlan(['--env', 'emulator', '--tenant', TENANT, '--plan', 'growth'], m.io)).toBe(1)
    expect(m.out.join('\n')).toContain('no workspace')
    expect(m.writes).toEqual([])
  })
})
