import { rejectionCount, reachedOfficer, reachedSupervisor, wasCheckedIn } from './passFacts.js'
import { byText, ratio } from './stats.js'
import { contractorName, type ReportColumn, type ReportInput, type ReportResult, type ReportRow } from './types.js'

const COLUMNS: ReportColumn[] = [
  { key: 'contractor', label: 'Contractor', type: 'text' },
  { key: 'submissions', label: 'Submissions', type: 'number' },
  { key: 'supervisorApproved', label: 'Supervisor-approved', type: 'number' },
  { key: 'officerApproved', label: 'Officer-approved', type: 'number' },
  { key: 'checkedIn', label: 'Checked in', type: 'number' },
  { key: 'rejections', label: 'Rejections', type: 'number' },
  { key: 'rejectionRate', label: 'Rejection rate', type: 'percent' },
]

interface Tally {
  submissions: number
  supervisorApproved: number
  officerApproved: number
  checkedIn: number
  rejections: number
}
const empty = (): Tally => ({ submissions: 0, supervisorApproved: 0, officerApproved: 0, checkedIn: 0, rejections: 0 })

const rowOf = (name: string, t: Tally, isTotal = false): ReportRow => ({
  contractor: name,
  submissions: t.submissions,
  supervisorApproved: t.supervisorApproved,
  officerApproved: t.officerApproved,
  checkedIn: t.checkedIn,
  rejections: t.rejections,
  rejectionRate: ratio(t.rejections, t.submissions),
  ...(isTotal ? { isTotal: true } : {}),
})

/**
 * Per contractor. Submissions are the sum of `attempt` (a pass resubmitted twice is three submissions);
 * rejections count every `reject` and `revoke` decision, so the rate is rejections / submissions.
 */
export function buildContractorActivity(input: ReportInput): Pick<ReportResult, 'columns' | 'rows' | 'summary'> {
  const tallies = new Map<string, Tally>()
  const total = empty()
  for (const p of input.passes) {
    const t = tallies.get(p.contractorId) ?? empty()
    const add = (key: keyof Tally, n: number): void => {
      t[key] += n
      total[key] += n
    }
    add('submissions', p.attempt)
    add('supervisorApproved', reachedSupervisor(p) ? 1 : 0)
    add('officerApproved', reachedOfficer(p) ? 1 : 0)
    add('checkedIn', wasCheckedIn(p) ? 1 : 0)
    add('rejections', rejectionCount(p))
    tallies.set(p.contractorId, t)
  }
  const named = [...tallies].map(([id, t]) => ({ name: contractorName(input.contractorNames, id), id, t }))
  named.sort((a, b) => b.t.submissions - a.t.submissions || byText(a.name, b.name) || byText(a.id, b.id))
  const rows = [...named.map((n) => rowOf(n.name, n.t)), rowOf('Total', total, true)]
  return {
    columns: COLUMNS,
    rows,
    summary: {
      tiles: [
        { key: 'submissions', label: 'Submissions', value: total.submissions },
        { key: 'checkedIn', label: 'Checked in', value: total.checkedIn },
        { key: 'rejections', label: 'Rejections', value: total.rejections },
        { key: 'rejectionRate', label: 'Rejection rate', value: ratio(total.rejections, total.submissions), type: 'percent' },
      ],
      sections: [],
    },
  }
}
