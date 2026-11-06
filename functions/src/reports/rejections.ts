import { rejectionEvents } from './passFacts.js'
import { byText, ratio } from './stats.js'
import {
  contractorName,
  type ReportColumn,
  type ReportInput,
  type ReportResult,
  type ReportRow,
  type SummarySection,
} from './types.js'

const COLUMNS: ReportColumn[] = [
  { key: 'time', label: 'Time', type: 'datetime' },
  { key: 'plate', label: 'Plate', type: 'text' },
  { key: 'contractor', label: 'Contractor', type: 'text' },
  { key: 'stage', label: 'Stage', type: 'text' },
  { key: 'approver', label: 'Approver', type: 'text' },
  { key: 'reason', label: 'Reason', type: 'text' },
  { key: 'note', label: 'Note', type: 'text' },
]

function breakdown(key: string, title: string, label: string, counts: Map<string, number>, total: number): SummarySection {
  const rows = [...counts]
    .sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))
    .map(([name, count]): ReportRow => ({ name, count, share: ratio(count, total) }))
  return {
    key,
    title,
    columns: [
      { key: 'name', label, type: 'text' },
      { key: 'count', label: 'Rejections', type: 'number' },
      { key: 'share', label: 'Share', type: 'percent' },
    ],
    rows,
  }
}

const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1)

/** Every rejection event: `rejectionHistory[]` plus the current `rejection` of a rejected pass. */
export function buildRejections(input: ReportInput): Pick<ReportResult, 'columns' | 'rows' | 'summary'> {
  const events = input.passes.flatMap((p) => rejectionEvents(p))
  const labelOf = (code: string): string => input.reasonLabels.get(code) ?? code
  const sorted = [...events].sort((a, b) => a.at - b.at || byText(a.passId, b.passId) || a.attempt - b.attempt)

  const byReason = new Map<string, number>()
  const byStage = new Map<string, number>()
  const byContractor = new Map<string, number>()
  const byApprover = new Map<string, number>()
  for (const e of events) {
    bump(byReason, labelOf(e.reasonCode))
    bump(byStage, e.stageLabel)
    bump(byContractor, contractorName(input.contractorNames, e.contractorId))
    bump(byApprover, e.byName)
  }

  const rows = sorted.map(
    (e): ReportRow => ({
      time: e.at,
      plate: e.plateNo,
      contractor: contractorName(input.contractorNames, e.contractorId),
      stage: e.stageLabel,
      approver: e.byName,
      reason: labelOf(e.reasonCode),
      note: e.note,
    }),
  )
  const n = events.length
  return {
    columns: COLUMNS,
    rows,
    summary: {
      tiles: [
        { key: 'rejections', label: 'Rejections', value: n },
        { key: 'passes', label: 'Passes affected', value: new Set(events.map((e) => e.passId)).size },
        { key: 'revoked', label: 'Revoked after approval', value: byStage.get('Revoked') ?? 0 },
      ],
      sections: [
        breakdown('byReason', 'By reason', 'Reason', byReason, n),
        breakdown('byStage', 'By stage', 'Stage', byStage, n),
        breakdown('byContractor', 'By contractor', 'Contractor', byContractor, n),
        breakdown('byApprover', 'By approver', 'Approver', byApprover, n),
      ],
    },
  }
}
