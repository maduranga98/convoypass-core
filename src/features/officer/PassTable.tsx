import { CircleCheck, Clock, TriangleAlert } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { EvidenceThumb } from '@/features/passes/EvidenceThumb'
import { PassStatusBadge } from '@/features/passes/PassStatusBadge'
import { displayStatus, formatTime, issueCount, timeAgo, toMs } from '@/features/passes/passView'
import { PassRow } from '@/features/supervisor/PassRow'
import type { PassWithId } from '@/types/passes'
import { waitingSince } from './queue'

const t = strings.officer
const c = strings.approvals

interface Props {
  rows: readonly PassWithId[]
  now: number
  today: string
  contractorName: (id: string) => string
  openId: string | null
  onOpen: (pass: PassWithId) => void
  /** Link that opens a pass (the phone list is made of links). */
  hrefOf: (pass: PassWithId) => string
  /** Waited past the officer time target. */
  isOverdue: (pass: PassWithId) => boolean
  /** Show the checkbox column (Awaiting me). */
  selectable: boolean
  isSelectable: (pass: PassWithId) => boolean
  selected: ReadonlySet<string>
  onToggle: (pass: PassWithId) => void
  onSelectAll: () => void
  onClear: () => void
  /** Show the Revoke action on approved (not yet checked in) passes. */
  revocable: boolean
  onRevoke: (pass: PassWithId) => void
  /** Show the status column (lists that mix statuses). */
  showStatus: boolean
  /** Phones: the rows are in select mode (desktop always shows checkboxes when `selectable`). */
  selectMode: boolean
  /** The review panel is open beside the table: drop the supervisor and photo columns. */
  compact: boolean
}

/**
 * The officer's pass list. Desktop (lg): a dense table; a row opens the review panel, checkboxes and buttons do not.
 * Phones and tablets: the same compact rows the supervisor uses (about 70 px each).
 */
export function PassTable({ rows, now, today, contractorName, openId, onOpen, hrefOf, isOverdue, selectable, isSelectable, selected, onToggle, onSelectAll, onClear, revocable, onRevoke, showStatus, selectMode, compact }: Props) {
  const pickable = rows.filter(isSelectable)
  const allPicked = pickable.length > 0 && pickable.every((p) => selected.has(p.id))

  const rowKey = (p: PassWithId) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onOpen(p)
    }
  }

  const noteOf = (p: PassWithId) =>
    [contractorName(p.contractorId), p.status === 'rejected' ? p.rejection?.reason : p.supervisor ? t.approvedBy(p.supervisor.name) : undefined].filter(Boolean).join(' · ')

  return (
    <>
      {/* Phones and tablets */}
      <ul aria-label={t.listLabel} className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm lg:hidden">
        {rows.map((p) => (
          <PassRow
            key={p.id}
            pass={p}
            now={now}
            today={today}
            to={hrefOf(p)}
            active={openId === p.id}
            overdue={!showStatus && isOverdue(p)}
            showStatus={showStatus}
            since={waitingSince(p)}
            note={noteOf(p)}
            selecting={selectable && selectMode}
            selectable={isSelectable(p)}
            selected={selected.has(p.id)}
            onToggle={() => onToggle(p)}
          />
        ))}
      </ul>

      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-surface shadow-sm lg:block">
        <table className={cn('w-full border-collapse text-sm', compact ? 'min-w-[600px]' : 'min-w-[880px]')}>
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              {selectable && (
                <th scope="col" className="w-10 py-3 pl-4 pr-2">
                  <input
                    type="checkbox"
                    aria-label={t.selectAll}
                    className="size-4 accent-brand"
                    checked={allPicked}
                    disabled={pickable.length === 0}
                    onChange={() => (allPicked ? onClear() : onSelectAll())}
                  />
                </th>
              )}
              <th scope="col" className={cn('py-3 pr-3', selectable ? 'pl-2' : 'pl-4')}>{t.columns.plate}</th>
              <th scope="col" className="px-3 py-3">{t.columns.contractor}</th>
              <th scope="col" className="px-3 py-3">{t.columns.driver}</th>
              <th scope="col" className="px-3 py-3">{showStatus ? t.columns.submitted : t.columns.waiting}</th>
              {!compact && <th scope="col" className="px-3 py-3">{t.columns.supervisor}</th>}
              {showStatus && <th scope="col" className="px-3 py-3">{t.columns.status}</th>}
              <th scope="col" className="px-3 py-3">{t.columns.checklist}</th>
              {!compact && <th scope="col" className="px-3 py-3">{t.columns.photos}</th>}
              <th scope="col" className="py-3 pl-3 pr-4 text-right">{t.columns.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => {
              const issues = issueCount(p)
              const isOpen = openId === p.id
              const isPicked = selected.has(p.id)
              const overdue = !showStatus && isOverdue(p)
              const since = showStatus ? toMs(p.submittedAt) : waitingSince(p)
              return (
                <tr
                  key={p.id}
                  tabIndex={0}
                  aria-selected={isOpen}
                  onClick={() => onOpen(p)}
                  onKeyDown={rowKey(p)}
                  className={cn(
                    'cursor-pointer align-middle transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                    isOpen || isPicked ? 'bg-accent-soft' : 'hover:bg-slate-50',
                  )}
                >
                  {selectable && (
                    <td className={cn('border-l-4 py-2.5 pl-3 pr-2', isOpen ? 'border-accent' : 'border-transparent')} onClick={(e) => e.stopPropagation()}>
                      {isSelectable(p) ? (
                        <input type="checkbox" aria-label={t.selectRow(p.plateNo)} className="size-4 accent-brand" checked={isPicked} onChange={() => onToggle(p)} />
                      ) : (
                        <span aria-hidden className="block size-4 rounded border border-dashed border-slate-300" />
                      )}
                    </td>
                  )}
                  <td className={cn('py-2.5 pr-3', selectable ? 'pl-2' : cn('border-l-4 pl-3', isOpen ? 'border-accent' : 'border-transparent'))}>
                    <p className="whitespace-nowrap text-base font-bold tracking-tight text-ink">{p.plateNo}</p>
                    <p className="text-xs text-slate-600">{p.vehicleType}{p.attempt > 1 ? ` · ${c.card.attempt(p.attempt)}` : ''}</p>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-slate-800">{contractorName(p.contractorId)}</td>
                  <td className="px-3 py-2.5 text-slate-800">{p.driverName}</td>
                  <td className="whitespace-nowrap px-3 py-2.5" title={formatTime(since)}>
                    {overdue ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-ink">
                        <Clock aria-hidden className="size-3.5" />
                        <span className="sr-only">{c.card.overdue}: </span>
                        {timeAgo(since, now)}
                      </span>
                    ) : (
                      <p className="font-medium text-slate-800">{timeAgo(since, now)}</p>
                    )}
                    <p className="text-xs text-slate-600">{formatTime(since)}</p>
                  </td>
                  {!compact && <td className="whitespace-nowrap px-3 py-2.5">
                    {p.supervisor ? (
                      <>
                        <p className="font-medium text-slate-800">{p.supervisor.name}</p>
                        <p className="text-xs text-slate-600">{formatTime(toMs(p.supervisor.at))}</p>
                      </>
                    ) : (
                      <span className="text-slate-500">{strings.common.none}</span>
                    )}
                  </td>}
                  {showStatus && <td className="whitespace-nowrap px-3 py-2.5"><PassStatusBadge status={displayStatus(p, today)} /></td>}
                  <td className="px-3 py-2.5">
                    {issues > 0 ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-danger-strong px-2.5 py-0.5 text-xs font-bold text-on-solid">
                        <TriangleAlert aria-hidden className="size-3.5" />
                        {c.card.issues(issues)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-success-strong">
                        <CircleCheck aria-hidden className="size-4" />
                        {t.allClear}
                      </span>
                    )}
                  </td>
                  {!compact && <td className="px-3 py-2.5">
                    <div className="flex gap-1.5">
                      {([[c.evidence.gps, p.evidence.gps.path], [c.evidence.dashcam, p.evidence.dashcam.path]] as const).map(([label, path]) => (
                        <div key={label} className="size-10 overflow-hidden rounded-md bg-slate-200 ring-1 ring-slate-200">
                          <EvidenceThumb path={path} alt={c.card.photoOf(label, p.plateNo)} removed={Boolean(p.evidenceDeletedAt)} />
                        </div>
                      ))}
                    </div>
                  </td>}
                  <td className="py-2.5 pl-3 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">
                      {revocable && p.status === 'officer_approved' && (
                        <Button variant="secondary" size="sm" className="border-danger/40 text-danger-ink hover:bg-danger-soft" onClick={() => onRevoke(p)}>{t.revoke}</Button>
                      )}
                      <Button variant={isOpen ? 'primary' : 'secondary'} size="sm" onClick={() => onOpen(p)} aria-label={`${t.review}: ${p.plateNo}`}>{t.review}</Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
