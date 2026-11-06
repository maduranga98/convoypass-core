import { useNow } from '@/features/passes/useToday'
import { strings } from '@/lib/strings'
import { durationText, formatDateTime, reviewText, scopeOf, statusOf, targetText, type PenaltyRow } from './model'
import { PenaltyPhoto } from './PenaltyPhoto'
import { PenaltyStatusBadge } from './PenaltyBadges'
import { useTenantTimezone } from './queries'

const t = strings.penalties

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 text-sm">
      <dt className="text-slate-600">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words text-ink">{children}</dd>
    </div>
  )
}

/** Everything about one penalty: type, target, status, duration, who issued it and when, reason, photo and review state. */
export function PenaltyDetails({ penalty: p }: { penalty: PenaltyRow }) {
  const tz = useTenantTimezone()
  const now = useNow()
  const status = statusOf(p, now)
  const kind = scopeOf(p)
  return (
    <div>
      <dl className="divide-y divide-slate-100">
        <Row label={t.detail.type}>{p.typeName}</Row>
        <Row label={t.detail.target}>
          <span className="block">{targetText(p)}</span>
          <span className="text-xs text-slate-600">{kind === 'both' ? t.scopeBoth : kind === 'vehicle' ? t.scopeVehicle : t.scopeDriver}</span>
        </Row>
        <Row label={t.detail.status}>
          <PenaltyStatusBadge status={status} />
        </Row>
        <Row label={t.detail.duration}>{durationText(p, tz, now)}</Row>
        <Row label={t.detail.issuedBy}>{t.issuedBy(p.issuedBy.name, formatDateTime(p.issuedAt, tz))}</Row>
        <Row label={t.detail.reason}>
          <span className="whitespace-pre-wrap">{p.reason}</span>
        </Row>
        {p.revocation && (
          <Row label={t.detail.revocation}>
            <span className="block">{t.detail.revokedBy(p.revocation.byName, formatDateTime(p.revocation.at, tz))}</span>
            <span className="whitespace-pre-wrap text-slate-700">{p.revocation.note}</span>
          </Row>
        )}
        <Row label={t.detail.verification}>
          <span className="block">{reviewText(p, tz)}</span>
          {p.verification.verificationNote && <span className="whitespace-pre-wrap text-slate-700">{p.verification.verificationNote}</span>}
        </Row>
      </dl>
      {p.evidencePhotoPath && (
        <div className="space-y-1.5 border-t border-slate-100 pt-3">
          <p className="text-sm text-slate-600">{t.detail.photo}</p>
          <PenaltyPhoto path={p.evidencePhotoPath} className="aspect-video w-full max-w-sm" />
        </div>
      )}
    </div>
  )
}
