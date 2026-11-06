import { stageTimes, type StageTimes } from './passFacts.js'
import { byText, median, percentile, round1 } from './stats.js'
import { contractorName, type ReportColumn, type ReportInput, type ReportResult, type ReportRow } from './types.js'

export const METRICS = [
  { key: 'supervisor', label: 'Submit → supervisor', short: 'To supervisor' },
  { key: 'officer', label: 'Supervisor → officer', short: 'To officer' },
  { key: 'gate', label: 'Officer → check-in', short: 'To check-in' },
  { key: 'total', label: 'Submit → check-in', short: 'Total' },
] as const
type MetricKey = (typeof METRICS)[number]['key']
type Minutes = Record<MetricKey, number | null>

const minutesBetween = (from: number | null, to: number | null): number | null =>
  from === null || to === null ? null : Math.max(0, (to - from) / 60_000)

/** Minutes of the latest attempt only. A missing stage leaves only the metrics that need it empty. */
export function passMinutes(t: StageTimes): Minutes {
  return {
    supervisor: minutesBetween(t.submitted, t.supervisor),
    officer: minutesBetween(t.supervisor, t.officer),
    gate: minutesBetween(t.officer, t.checkIn),
    total: minutesBetween(t.submitted, t.checkIn),
  }
}

const valuesOf = (list: readonly Minutes[], key: MetricKey): number[] =>
  list.map((m) => m[key]).filter((v): v is number => v !== null)

const stat = (values: number[]) => ({ count: values.length, median: round1(median(values)), p90: round1(percentile(values, 0.9)) })

const COLUMNS: ReportColumn[] = [
  { key: 'contractor', label: 'Contractor', type: 'text' },
  { key: 'passes', label: 'Passes', type: 'number' },
  ...METRICS.flatMap((m): ReportColumn[] => [
    { key: `${m.key}Median`, label: `${m.short} median (min)`, type: 'minutes' },
    { key: `${m.key}P90`, label: `${m.short} p90 (min)`, type: 'minutes' },
  ]),
]

function rowFor(name: string, list: readonly Minutes[], isTotal = false): ReportRow {
  const row: ReportRow = { contractor: name, passes: list.length }
  for (const m of METRICS) {
    const s = stat(valuesOf(list, m.key))
    row[`${m.key}Median`] = s.median
    row[`${m.key}P90`] = s.p90
  }
  if (isTotal) row.isTotal = true
  return row
}

/**
 * Median and p90 per stage, overall and per contractor, plus who decides how fast. Timing uses the latest attempt
 * of each pass; earlier attempts only count in the submissions and rejections reports.
 */
export function buildTurnaround(input: ReportInput): Pick<ReportResult, 'columns' | 'rows' | 'summary'> {
  const all: Minutes[] = []
  const byContractor = new Map<string, Minutes[]>()
  const approvers = new Map<string, { name: string; role: string; minutes: number[] }>()

  for (const p of input.passes) {
    const times = stageTimes(p)
    const minutes = passMinutes(times)
    all.push(minutes)
    const list = byContractor.get(p.contractorId) ?? []
    list.push(minutes)
    byContractor.set(p.contractorId, list)

    // A decision (approve or reject) of the latest attempt, timed from when the pass reached that reviewer.
    for (const h of (p.history ?? []).filter((x) => x.attempt === p.attempt)) {
      if (h.action !== 'approve' && h.action !== 'reject') continue
      const reachedAt = h.stage === 'supervisor' ? times.submitted : h.stage === 'officer' ? times.supervisor : null
      const m = minutesBetween(reachedAt, h.at)
      if (m === null) continue
      const entry = approvers.get(h.byUid) ?? { name: h.byName, role: h.byRole, minutes: [] }
      entry.minutes.push(m)
      approvers.set(h.byUid, entry)
    }
  }

  const named = [...byContractor].map(([id, list]) => ({ id, name: contractorName(input.contractorNames, id), list }))
  named.sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id))
  const rows = [...named.map((n) => rowFor(n.name, n.list)), rowFor('All contractors', all, true)]

  const overallSection = {
    key: 'overall',
    title: 'Overall by stage',
    columns: [
      { key: 'metric', label: 'Stage', type: 'text' },
      { key: 'count', label: 'Passes', type: 'number' },
      { key: 'median', label: 'Median (min)', type: 'minutes' },
      { key: 'p90', label: 'p90 (min)', type: 'minutes' },
    ] satisfies ReportColumn[],
    rows: METRICS.map((m): ReportRow => ({ metric: m.label, ...stat(valuesOf(all, m.key)) })),
  }
  const approverRows = [...approvers.entries()]
    .map(([uid, a]) => ({ uid, ...a }))
    .sort((a, b) => b.minutes.length - a.minutes.length || byText(a.name, b.name) || byText(a.uid, b.uid))
    .map((a): ReportRow => ({ name: a.name, role: a.role, decisions: a.minutes.length, median: round1(median(a.minutes)) }))

  const total = stat(valuesOf(all, 'total'))
  return {
    columns: COLUMNS,
    rows,
    summary: {
      tiles: [
        { key: 'passes', label: 'Passes', value: all.length },
        { key: 'totalMedian', label: 'Median submit → check-in', value: total.median ?? '–', type: 'minutes' },
        { key: 'totalP90', label: 'p90 submit → check-in', value: total.p90 ?? '–', type: 'minutes' },
      ],
      sections: [
        overallSection,
        {
          key: 'approvers',
          title: 'Approvers',
          columns: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'role', label: 'Role', type: 'text' },
            { key: 'decisions', label: 'Decisions', type: 'number' },
            { key: 'median', label: 'Median minutes to decide', type: 'minutes' },
          ],
          rows: approverRows,
        },
      ],
    },
  }
}
