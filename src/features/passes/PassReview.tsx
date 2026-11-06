import { Archive, History } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import type { PassWithId } from '@/types/passes'
import { ChecklistSummary } from './ChecklistSummary'
import { EvidenceThumb } from './EvidenceThumb'
import { EvidenceViewer } from './EvidenceViewer'
import { PassStatusBadge } from './PassStatusBadge'
import { PassTimeline } from './PassTimeline'
import { displayStatus, evidenceItems, formatDateKey, formatDateTime, toMs } from './passView'

const t = strings.approvals

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 px-4 py-3">
    <dt className="text-sm text-slate-600">{label}</dt>
    <dd className="text-right text-base font-medium text-ink">{children}</dd>
  </div>
)

interface Props {
  pass: PassWithId
  today: string | null
  /** Officers and admins see which contractor the vehicle belongs to. */
  contractorName?: string
  /** Admin and officer: link to this vehicle's history report. */
  historyHref?: string
  /** `wide` lays the photos out two across (officer panel, admin drawer); `stack` is one full-width photo per row. */
  layout?: 'stack' | 'wide'
  /** Lets a parent that has keyboard shortcuts stand down while the full-screen viewer is open. */
  onViewerOpenChange?: (open: boolean) => void
}

/** What a reviewer looks at: photos (tap for the viewer), people and vehicle, checklist, who approved what. */
export function PassReview({ pass, today, contractorName, historyHref, layout = 'stack', onViewerOpenChange }: Props) {
  const [viewer, setViewerState] = useState<number | null>(null)
  const setViewer = (v: number | null) => {
    setViewerState(v)
    onViewerOpenChange?.(v !== null)
  }
  const items = evidenceItems(pass)
  const rejection = pass.status === 'rejected' ? pass.rejection : undefined

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">{pass.plateNo}</h2>
          <p className="text-base text-slate-700">{pass.vehicleType} · {pass.driverName}</p>
          {historyHref && (
            <Link to={historyHref} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus">
              <History aria-hidden className="size-4" />
              {t.info.vehicleHistory}
            </Link>
          )}
        </div>
        <PassStatusBadge status={displayStatus(pass, today)} />
      </header>

      {rejection && (
        <section aria-label={t.info.previousRejection} className="rounded-xl border-2 border-danger/40 bg-danger-soft px-4 py-3 text-danger-ink">
          <p className="text-sm font-semibold">{t.info.stage[rejection.stage]} · {rejection.byName}</p>
          <p className="text-base">{rejection.reason}</p>
        </section>
      )}

      <section aria-labelledby="photos-h" className="space-y-2">
        <h3 id="photos-h" className="text-base font-semibold">{t.evidence.title}</h3>
        {pass.evidenceDeletedAt ? (
          <p role="note" className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800">
            <Archive aria-hidden className="size-4 shrink-0" />
            {strings.retention.removed}
          </p>
        ) : (
        <ul className={cn('grid gap-3', layout === 'wide' ? 'grid-cols-2' : 'grid-cols-1')}>
          {items.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => setViewer(i)}
                aria-label={t.evidence.open(item.label)}
                className="relative block aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <EvidenceThumb path={item.path} alt={t.card.photoOf(item.label, pass.plateNo)} />
                <span className="absolute left-2 top-2 rounded-md bg-scrim/70 px-2 py-1 text-sm font-semibold text-on-solid">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
        )}
      </section>

      <dl className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-300 bg-surface">
        <Row label={t.info.driver}>{pass.driverName}</Row>
        {contractorName && <Row label={t.info.contractor}>{contractorName}</Row>}
        <Row label={t.info.submitted}>{formatDateTime(toMs(pass.submittedAt))}</Row>
        <Row label={t.info.attempt}>{pass.attempt}</Row>
        {pass.dateKey && <Row label={strings.admin.passes.day}>{formatDateKey(pass.dateKey)}</Row>}
        {pass.supervisor && <Row label={t.info.supervisorApproved}>{pass.supervisor.name} · {formatDateTime(toMs(pass.supervisor.at))}</Row>}
        {pass.officer && <Row label={t.info.officerApproved}>{pass.officer.name} · {formatDateTime(toMs(pass.officer.at))}</Row>}
      </dl>

      <ChecklistSummary items={pass.checklist} />

      <section aria-label={t.timeline.title} className="rounded-xl border border-slate-300 bg-surface px-2 py-4">
        <PassTimeline status={pass.status} pass={pass} />
      </section>

      {viewer !== null && <EvidenceViewer items={items} index={viewer} plateNo={pass.plateNo} onIndexChange={setViewer} onClose={() => setViewer(null)} />}
    </div>
  )
}
