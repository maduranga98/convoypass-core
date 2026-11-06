import { describe, expect, it } from 'vitest'
import { auditCsv, auditFileName } from './exportAudit'
import { actionLabel, BATCH, fillPage, matches, serverFilter, summarise, toAuditEntry, toExportRows, type AuditEntry } from './model'
import { dayStartMs, rangeMs } from './range'

const entry = (i: number, over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: `e${i}`, action: 'pass.submit', actorUid: 'u1', actorRole: 'driver', targetType: 'pass', targetId: `p${i}`, meta: {}, createdAt: 1_700_000_000_000 - i * 1000, ...over,
})

const source = (all: AuditEntry[], batch = BATCH) => async (after: number | null) => {
  const from = after === null ? 0 : after + 1
  const slice = all.slice(from, from + batch)
  return { entries: slice.map((e, i) => ({ entry: e, cursor: from + i })), exhausted: slice.length < batch }
}

describe('toAuditEntry', () => {
  it('reads timestamps and keeps scalar meta only', () => {
    const e = toAuditEntry('x', { action: 'user.update', actorUid: 'a', actorRole: 'admin', targetType: 'user', targetId: 't', createdAt: { toMillis: () => 5 }, meta: { name: true, n: 2, s: 'x', nested: { a: 1 }, list: [1] } })
    expect(e).toMatchObject({ id: 'x', createdAt: 5, meta: { name: true, n: 2, s: 'x' } })
    expect(e.meta).not.toHaveProperty('nested')
    expect(toAuditEntry('y', {}).createdAt).toBe(0)
  })
})

describe('summaries and labels', () => {
  it('describes the common actions in one line', () => {
    expect(summarise({ action: 'user.update', targetType: 'user', meta: { name: true, phone: true, licenseNo: false } })).toBe('Changed: name, phone')
    expect(summarise({ action: 'vehicle.import', targetType: 'contractor', meta: { rows: 5, created: 4, failed: 1 } })).toBe('4 created, 1 failed, 5 rows')
    expect(summarise({ action: 'pass.reject.supervisor', targetType: 'pass', meta: { reasonCode: 'dashcam', attempt: 2 } })).toBe('reasonCode: dashcam · attempt: 2')
    expect(summarise({ action: 'user.create', targetType: 'user', meta: { role: 'driver' } })).toBe('Role: driver')
  })
  it('falls back to the raw action code for unknown actions', () => {
    expect(actionLabel('pass.checkIn')).toBe('Checked in')
    expect(actionLabel('something.new')).toBe('something.new')
  })
})

describe('filters', () => {
  it('uses one server-side filter (actor, then action, then target) and applies the rest to rows', () => {
    const f = { from: '2026-03-01', to: '2026-03-07', actor: 'u1', action: 'pass.submit', target: 'pass' }
    expect(serverFilter(f)).toEqual({ field: 'actorUid', value: 'u1' })
    expect(serverFilter({ ...f, actor: '' })).toEqual({ field: 'action', value: 'pass.submit' })
    expect(serverFilter({ ...f, actor: '', action: '' })).toEqual({ field: 'targetType', value: 'pass' })
    expect(serverFilter({ ...f, actor: '', action: '', target: '' })).toBeNull()
    expect(matches(f)(entry(1))).toBe(true)
    expect(matches(f)(entry(1, { action: 'gate.deny' }))).toBe(false)
    expect(matches(f)(entry(1, { actorUid: 'u2' }))).toBe(false)
    expect(matches(f)(entry(1, { targetType: 'user' }))).toBe(false)
  })
})

describe('fillPage (25 per page, cursor)', () => {
  const all = Array.from({ length: 120 }, (_, i) => entry(i))

  it('returns 25 newest entries and a cursor that continues right after the last one', async () => {
    const first = await fillPage(source(all), () => true, 25, null)
    expect(first.entries.map((e) => e.id)).toEqual(all.slice(0, 25).map((e) => e.id))
    expect(first.more).toBe(true)
    const second = await fillPage(source(all), () => true, 25, first.cursor)
    expect(second.entries[0]?.id).toBe('e25')
    expect(second.entries).toHaveLength(25)
  })
  it('walks the whole log page by page without gaps or repeats, and the last page says there is no more', async () => {
    const seen: string[] = []
    let cursor: number | null = null
    let more = true
    let pages = 0
    while (more) {
      const page: Awaited<ReturnType<typeof fillPage<number>>> = await fillPage(source(all), () => true, 25, cursor)
      seen.push(...page.entries.map((e) => e.id))
      cursor = page.cursor
      more = page.more
      pages++
    }
    expect(pages).toBe(5)
    expect(seen).toEqual(all.map((e) => e.id))
  })
  it('skims past rows a client-side filter rejects until the page is full', async () => {
    const mixed = Array.from({ length: 200 }, (_, i) => entry(i, { action: i % 10 === 0 ? 'gate.deny' : 'pass.submit' }))
    const page = await fillPage(source(mixed), (e) => e.action === 'gate.deny', 10, null)
    expect(page.entries).toHaveLength(10)
    expect(page.entries.every((e) => e.action === 'gate.deny')).toBe(true)
    expect(page.more).toBe(true)
    const next = await fillPage(source(mixed), (e) => e.action === 'gate.deny', 10, page.cursor)
    expect(next.entries).toHaveLength(10)
    expect(next.entries[0]?.id).toBe('e100')
    // The page filled exactly at the end of a full batch, so "more" is unknown: the next page is empty and says so.
    const last = await fillPage(source(mixed), (e) => e.action === 'gate.deny', 10, next.cursor)
    expect(last).toMatchObject({ entries: [], more: false })
  })
  it('an empty or exhausted log is an empty page without more', async () => {
    expect(await fillPage(source([]), () => true, 25, null)).toMatchObject({ entries: [], more: false })
  })
})

describe('date range in the tenant timezone', () => {
  it('Colombo (UTC+5:30): a day starts at 18:30Z the evening before', () => {
    expect(new Date(dayStartMs('2026-03-10', 'Asia/Colombo')).toISOString()).toBe('2026-03-09T18:30:00.000Z')
    const r = rangeMs('2026-03-10', '2026-03-11', 'Asia/Colombo')
    expect(new Date(r.endMs).toISOString()).toBe('2026-03-11T18:30:00.000Z')
    expect(r.endMs - r.startMs).toBe(2 * 86_400_000)
  })
  it('handles daylight saving: the spring-forward day is 23 hours', () => {
    const r = rangeMs('2026-03-08', '2026-03-08', 'America/New_York')
    expect(r.endMs - r.startMs).toBe(23 * 3_600_000)
  })
})

describe('CSV export', () => {
  const rows = [
    entry(1, { actorUid: 'evil', targetId: '=HYPERLINK("http://x","y")', action: 'user.update', meta: { name: true } }),
    entry(2, { targetId: '+1+1', actorUid: 'u2' }),
    entry(3, { targetId: '@SUM(A1)', actorUid: 'u3' }),
    entry(4, { targetId: '-2+3', actorUid: 'u4' }),
    entry(5, { actorUid: 'u5', targetId: 'plain, with "quotes"\nand a newline' }),
  ]
  const names: Record<string, string> = { evil: '=cmd|\' /C calc\'!A0', u2: '+Plus Person', u3: '@handle', u4: '-Dash', u5: 'Normal Name' }
  const csv = auditCsv(rows, (uid) => names[uid] ?? uid, 'Asia/Colombo')

  it('is UTF-8 with a BOM, CRLF line ends and a header', () => {
    expect(csv.startsWith('﻿Time,Actor,Role,Action,Action code,Target type,Target,Summary,Details\r\n')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
  })
  it('neutralises formulas in every text cell (actor names and target ids)', () => {
    expect(csv).toContain("'=cmd|' /C calc'!A0")
    expect(csv).toContain("'+Plus Person")
    expect(csv).toContain("'@handle")
    expect(csv).toContain("'-Dash")
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`)
    expect(csv).toContain("'+1+1")
    expect(csv).toContain("'@SUM(A1)")
    expect(csv).toContain("'-2+3")
    // No cell starts with a bare formula character.
    for (const line of csv.slice(1).split('\r\n').slice(1)) {
      for (const cell of line.split(',')) expect(cell.replace(/^"/, '')).not.toMatch(/^[=+@]/)
    }
  })
  it('quotes commas, quotes and line breaks (RFC 4180) and writes times in the tenant timezone', () => {
    expect(csv).toContain('"plain, with ""quotes""\nand a newline"')
    expect(csv).toContain('2023-11-15 03:43')
  })
  it('exports exactly the rows given, in the order given, and names the file by range', () => {
    expect(toExportRows(rows, (u) => u).map((r) => r.target)).toEqual(rows.map((r) => r.targetId))
    expect(auditFileName({ from: '2026-03-01', to: '2026-03-07' })).toBe('convoypass_audit_2026-03-01_2026-03-07.csv')
  })
})
