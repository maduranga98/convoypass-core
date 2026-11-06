import { describe, expect, it } from 'vitest'
import { EXPIRY_PAGE_SIZE, expirePenalties, expiryAudit, isDue, type PenaltyExpiryPort } from './penaltyExpiry.js'
import type { AuditEntry, PenaltyData } from './types.js'

const NOW = 1_700_000_000_000
const base = (over: Partial<PenaltyData>): PenaltyData => ({
  tenantId: 'T1', contractorId: 'C1', target: { driverId: null, vehicleId: 'v' }, targetLabels: { driverName: null, plateNo: 'X' },
  typeId: 'pty_1', typeName: 'T', duration: { kind: 'permanent' }, issuedBy: { uid: 'a', name: 'A', role: 'admin' }, issuedAt: 0,
  reason: 'Reason', evidencePhotoPath: null, status: 'active',
  verification: { verifiedBy: null, verifiedByName: null, verifiedAt: null, verificationNote: null }, ...over,
})

/** An in-memory port that behaves like the real one: due = active + fixed + end before now; expire re-checks. */
function fake(store: Map<string, PenaltyData>) {
  const audits: AuditEntry[] = []
  const port: PenaltyExpiryPort = {
    listDue: async (now, limit) =>
      [...store].filter(([, p]) => p.status === 'active' && p.duration.kind === 'fixed' && p.duration.endDate < now).slice(0, limit).map(([id, data]) => ({ id, data })),
    expire: async (ids, now) => {
      let n = 0
      for (const id of ids) {
        const p = store.get(id)
        if (!p || !isDue(p, now)) continue
        store.set(id, { ...p, status: 'expired', expiredAt: now })
        audits.push(expiryAudit(p, id))
        n++
      }
      return n
    },
  }
  return { port, audits }
}

describe('expirePenalties', () => {
  it('expires only active fixed penalties whose end passed; leaves permanent, future, revoked and ended ones', async () => {
    const store = new Map<string, PenaltyData>([
      ['past', base({ duration: { kind: 'fixed', endDate: NOW - 1 } })],
      ['edge', base({ duration: { kind: 'fixed', endDate: NOW } })],
      ['future', base({ duration: { kind: 'fixed', endDate: NOW + 1000 } })],
      ['perm', base({})],
      ['revoked', base({ status: 'revoked', duration: { kind: 'fixed', endDate: NOW - 1000 } })],
      ['done', base({ status: 'expired', duration: { kind: 'fixed', endDate: NOW - 1000 } })],
    ])
    const { port, audits } = fake(store)
    expect(await expirePenalties(port, NOW)).toMatchObject({ due: 1, expired: 1, failedPages: 0 })
    expect(store.get('past')).toMatchObject({ status: 'expired', expiredAt: NOW })
    for (const id of ['edge', 'future', 'perm']) expect(store.get(id)?.status).toBe('active')
    expect(store.get('revoked')?.status).toBe('revoked')
    expect(audits).toEqual([expect.objectContaining({ action: 'penalty.expire', actorRole: 'system', actorUid: 'system', targetType: 'penalty', targetId: 'past', tenantId: 'T1' })])
  })

  it('is idempotent: a second run finds nothing', async () => {
    const store = new Map([['past', base({ duration: { kind: 'fixed' as const, endDate: NOW - 1 } })]])
    const { port } = fake(store)
    await expirePenalties(port, NOW)
    expect(await expirePenalties(port, NOW)).toMatchObject({ due: 0, expired: 0 })
  })

  it('works through more than one page', async () => {
    const store = new Map<string, PenaltyData>()
    for (let i = 0; i < EXPIRY_PAGE_SIZE + 5; i++) store.set(`p${i}`, base({ duration: { kind: 'fixed', endDate: NOW - 1 } }))
    const { port } = fake(store)
    expect((await expirePenalties(port, NOW)).expired).toBe(EXPIRY_PAGE_SIZE + 5)
    expect([...store.values()].every((p) => p.status === 'expired')).toBe(true)
  })

  it('skips one revoked while the job ran (re-checked inside the transaction) and does not spin', async () => {
    const store = new Map([['p', base({ duration: { kind: 'fixed' as const, endDate: NOW - 1 } })]])
    const { port } = fake(store)
    const listed = port.listDue
    port.listDue = async (n, l) => {
      const rows = await listed(n, l)
      store.set('p', { ...store.get('p')!, status: 'revoked' })
      return rows
    }
    expect(await expirePenalties(port, NOW)).toMatchObject({ due: 1, expired: 0 })
    expect(store.get('p')?.status).toBe('revoked')
  })

  it('a failing page is counted and logged, not thrown', async () => {
    const port: PenaltyExpiryPort = {
      listDue: async () => [{ id: 'p', data: base({ duration: { kind: 'fixed', endDate: NOW - 1 } }) }],
      expire: async () => {
        throw new Error('boom')
      },
    }
    expect(await expirePenalties(port, NOW)).toMatchObject({ failedPages: 1, expired: 0 })
  })
})
