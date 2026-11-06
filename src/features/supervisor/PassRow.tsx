import { Check, ChevronRight, Clock, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { EvidenceThumb } from '@/features/passes/EvidenceThumb'
import { PassStatusBadge } from '@/features/passes/PassStatusBadge'
import { displayStatus, issueCount, timeAgo, toMs } from '@/features/passes/passView'
import type { PassWithId } from '@/types/passes'

const c = strings.approvals.card

interface Props {
  pass: PassWithId
  now: number
  today: string | null
  /** Where the row leads (the review screen). */
  to: string
  /** The pass open in the review panel next to the list (desktop). */
  active?: boolean
  /** Waited past the supervisor time target. */
  overdue?: boolean
  /** Approved/Rejected lists: show the status badge instead of the wait. */
  showStatus?: boolean
  /** A short line under the driver (rejection reason, ...). */
  note?: string | undefined
  /** When the wait shown on the row started (epoch ms). Defaults to the submission time. */
  since?: number | null
  /** Select mode: a pickable row toggles instead of opening; a row with issues still opens. */
  selecting?: boolean
  selectable?: boolean
  selected?: boolean
  onToggle?: () => void
}

/** One pass in a dense list: about 70 px tall whatever the screen, so a long queue stays scannable. */
export function PassRow({ pass, now, today, to, active = false, overdue = false, showStatus = false, note, since, selecting = false, selectable = true, selected = false, onToggle }: Props) {
  const issues = issueCount(pass)
  const toggles = selecting && selectable
  const waited = timeAgo(since === undefined ? toMs(pass.submittedAt) : since, now)
  const body = (
    <>
      <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-slate-200">
        <EvidenceThumb path={pass.evidence.gps.path} alt={c.photoOf(strings.approvals.evidence.gps, pass.plateNo)} removed={Boolean(pass.evidenceDeletedAt)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="truncate text-base font-bold tracking-tight text-ink">{pass.plateNo}</span>
          {pass.attempt > 1 && <span className="shrink-0 text-xs font-medium text-slate-600">{c.attempt(pass.attempt)}</span>}
        </p>
        <p className="truncate text-sm text-slate-600">{pass.vehicleType} · {pass.driverName}</p>
        {note && <p className="truncate text-xs text-slate-700">{note}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {showStatus ? (
          <PassStatusBadge status={displayStatus(pass, today)} />
        ) : overdue ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-ink">
            <Clock aria-hidden className="size-3.5" />
            <span className="sr-only">{c.overdue}: </span>
            {waited}
          </span>
        ) : (
          <span className="text-xs font-medium text-slate-600">{waited}</span>
        )}
        {issues > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-danger-strong px-2 py-0.5 text-xs font-bold text-on-solid">
            <TriangleAlert aria-hidden className="size-3.5" />
            {c.issues(issues)}
          </span>
        )}
      </div>
      <ChevronRight aria-hidden className="hidden size-4 shrink-0 text-slate-500 sm:block" />
    </>
  )
  const mainClass = 'flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

  return (
    <li
      data-testid="pass-row"
      className={cn(
        'flex items-center gap-2 border-l-4 px-3 py-2.5 transition-colors',
        selected || active ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-slate-50',
      )}
    >
      {selecting &&
        (selectable ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={c.select(pass.plateNo)}
            onClick={onToggle}
            className="grid size-11 shrink-0 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span className={cn('grid size-6 place-items-center rounded-md border-2', selected ? 'border-brand bg-brand text-on-solid' : 'border-slate-500 bg-surface')}>
              {selected && <Check aria-hidden className="size-4" />}
            </span>
          </button>
        ) : (
          <span aria-hidden className="grid size-11 shrink-0 place-items-center">
            <span className="size-6 rounded-md border-2 border-dashed border-slate-300" />
          </span>
        ))}
      {toggles ? (
        <button type="button" onClick={onToggle} aria-pressed={selected} className={mainClass}>
          {body}
        </button>
      ) : (
        <Link to={to} aria-current={active ? 'page' : undefined} className={mainClass}>
          {body}
        </Link>
      )}
    </li>
  )
}
