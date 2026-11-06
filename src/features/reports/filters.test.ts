import { describe, expect, it } from 'vitest'
import { filterProblem, parseFilters, presetRange, toParams, toRequest, vehicleHistoryLink, type ReportFilters } from './filters'

const TODAY = '2026-03-10'
const parse = (q: string) => parseFilters(new URLSearchParams(q), TODAY)

describe('report filters in the URL', () => {
  it('round-trips every filter', () => {
    const f: ReportFilters = { type: 'vehicle_history', preset: 'custom', from: '2026-02-01', to: '2026-02-20', contractorId: 'c1', vehicleId: 'veh_aaaaaaaaaa', driverId: '' }
    expect(parse(toParams(f).toString())).toEqual(f)
    const g: ReportFilters = { type: 'driver_history', preset: 'last7', from: '2026-03-04', to: '2026-03-10', contractorId: '', vehicleId: '', driverId: 'drv1' }
    expect(parse(toParams(g).toString())).toEqual(g)
    const h: ReportFilters = { type: 'turnaround', preset: 'thisMonth', from: '2026-03-01', to: '2026-03-10', contractorId: 'c2', vehicleId: '', driverId: '' }
    expect(parse(toParams(h).toString())).toEqual(h)
  })
  it('keeps only the id that belongs to the report type', () => {
    const f: ReportFilters = { type: 'rejections', preset: 'today', from: TODAY, to: TODAY, contractorId: '', vehicleId: 'veh_x', driverId: 'drv_x' }
    expect(toParams(f).has('vehicle')).toBe(false)
    expect(toParams(f).has('driver')).toBe(false)
    expect(toRequest(f)).toEqual({ type: 'rejections', from: TODAY, to: TODAY })
  })
  it('no report type means the picker; ?type= alone runs today’s report (the gate-log redirect)', () => {
    expect(parse('')).toBeNull()
    expect(parse('type=nope')).toBeNull()
    expect(parse('type=gate_log')).toMatchObject({ type: 'gate_log', preset: 'today', from: TODAY, to: TODAY })
  })
  it('explicit dates win over a preset, bad dates fall back to the preset', () => {
    expect(parse('type=gate_log&preset=last7&from=2026-01-01&to=2026-01-05')).toMatchObject({ preset: 'last7', from: '2026-01-01', to: '2026-01-05' })
    expect(parse('type=gate_log&from=2026-01-01&to=2026-01-05')).toMatchObject({ preset: 'custom' })
    expect(parse('type=gate_log&preset=last7&from=2026-02-30&to=2026-03-01')).toMatchObject({ from: '2026-03-04', to: TODAY })
  })
  it('presets', () => {
    expect(presetRange('yesterday', TODAY)).toEqual({ from: '2026-03-09', to: '2026-03-09' })
    expect(presetRange('last30', TODAY)).toEqual({ from: '2026-02-09', to: TODAY })
    expect(presetRange('thisMonth', '2026-03-31')).toEqual({ from: '2026-03-01', to: '2026-03-31' })
  })
  it('flags what cannot run', () => {
    const base: ReportFilters = { type: 'gate_log', preset: 'custom', from: TODAY, to: TODAY, contractorId: '', vehicleId: '', driverId: '' }
    expect(filterProblem(base)).toBeNull()
    expect(filterProblem({ ...base, from: '2026-03-11' })).toBe('range-order')
    expect(filterProblem({ ...base, from: '2025-12-01' })).toBe('range-long')
    expect(filterProblem({ ...base, from: '2025-12-09' })).toBeNull() // exactly 92 days
    expect(filterProblem({ ...base, type: 'vehicle_history' })).toBe('need-vehicle')
    expect(filterProblem({ ...base, type: 'driver_history' })).toBe('need-driver')
  })
  it('links to a vehicle’s last 30 days', () => {
    const url = new URL(vehicleHistoryLink('officer', 'veh_aaaaaaaaaa', TODAY), 'http://x')
    expect(url.pathname).toBe('/officer/reports')
    expect(parseFilters(url.searchParams, TODAY)).toMatchObject({ type: 'vehicle_history', vehicleId: 'veh_aaaaaaaaaa', from: '2026-02-09', to: TODAY })
  })
})
