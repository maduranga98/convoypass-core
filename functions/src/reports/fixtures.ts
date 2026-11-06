// Test fixtures for the pure report modules. Not part of the build (see tsconfig.json: *.test.ts and this file are dev only).
import type { HistoryEntry, Role } from '../types.js'
import type { ReportInput, ReportPass } from './types.js'

export const MIN = 60_000
/** 2026-03-10 08:00 Asia/Colombo. */
export const T0 = Date.UTC(2026, 2, 10, 2, 30)

export const hist = (
  action: HistoryEntry['action'],
  stage: HistoryEntry['stage'],
  at: number,
  attempt = 1,
  by: { uid: string; name: string; role: Role } = { uid: 'u1', name: 'Sam', role: 'supervisor' },
): HistoryEntry => ({ action, stage, byUid: by.uid, byName: by.name, byRole: by.role, at, attempt })

export const makePass = (over: Partial<ReportPass> = {}): ReportPass => ({
  id: 'veh_aaaaaaaaaa_20260310',
  contractorId: 'C1',
  vehicleId: 'veh_aaaaaaaaaa',
  plateNo: 'WP CAB 1234',
  vehicleType: 'Truck',
  dateKey: '20260310',
  driverId: 'd1',
  driverName: 'Nimal',
  status: 'submitted',
  attempt: 1,
  submittedAt: T0,
  ...over,
})

export const makeInput = (over: Partial<ReportInput> = {}): ReportInput => ({
  type: 'turnaround',
  passes: [],
  events: [],
  visits: [],
  gateTimeHours: 16,
  contractorNames: new Map([['C1', 'Alpha'], ['C2', 'Beta']]),
  reasonLabels: new Map([['gps_unclear', 'GPS unclear'], ['other', 'Other']]),
  timezone: 'Asia/Colombo',
  from: '2026-03-10',
  to: '2026-03-10',
  generatedAt: T0,
  filters: {},
  ...over,
})
